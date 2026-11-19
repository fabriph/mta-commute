// Turns decoded realtime trips into commute options.
//
// Config (all from the URL, never stored in the repo):
//   h  origin stop id for the "to work" direction (e.g. 101)
//   w  destination stop id for the "to work" direction
//   r  comma-separated routes, written in the "to work" direction:
//        LINE                     direct ride, e.g. "1"
//        LINE>STOP>LINE           one transfer, e.g. "2>127>7"
//        LINE>STOP/STOP>LINE      transfer where the two platforms have different ids
//        A|C>STOP>E               any of several lines for a leg
//        ...:3                    transfer time override in minutes for this route
//   x  default transfer time in minutes (walking between platforms), default 2
// The "to home" direction is the same routes reversed. Every train is shown as if you
// are already on the platform; any other params (e.g. an old k=) are ignored.

export const FEEDS = {
  ace: ['A', 'C', 'E', 'H', 'FS'],
  bdfm: ['B', 'D', 'F', 'M'],
  g: ['G'],
  jz: ['J', 'Z'],
  nqrw: ['N', 'Q', 'R', 'W'],
  l: ['L'],
  '': ['1', '2', '3', '4', '5', '6', '7', 'GS'],
  si: ['SI'],
};

export const FEED_URL = (key) =>
  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs' + (key ? '-' + key : '');

const LINE_TO_FEED = {};
for (const [k, lines] of Object.entries(FEEDS)) for (const l of lines) LINE_TO_FEED[l] = k;

const STOP_RE = /^[A-Z0-9]{2,4}$/;
const LINE_RE = /^[A-Z0-9]{1,3}$/;

export class ConfigError extends Error {}

export function parseConfig(params) {
  const home = (params.get('h') || '').toUpperCase();
  const work = (params.get('w') || '').toUpperCase();
  const routesRaw = params.get('r') || '';
  const xfer = numberParam(params.get('x'), 2);
  if (!STOP_RE.test(home)) throw new ConfigError('h (origin stop id) is missing or invalid');
  if (!STOP_RE.test(work)) throw new ConfigError('w (destination stop id) is missing or invalid');
  const routes = routesRaw.split(',').filter(Boolean).map((spec) => parseRoute(spec.toUpperCase(), xfer));
  if (!routes.length) throw new ConfigError('r (routes) is missing');
  if (routes.length > 6) throw new ConfigError('at most 6 routes');
  return { home, work, routes };
}

function numberParam(v, dflt) {
  if (v == null || v === '') return dflt;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 30) throw new ConfigError(`invalid number: ${v}`);
  return n;
}

function parseRoute(spec, defaultXfer) {
  let xfer = defaultXfer;
  const m = spec.match(/^(.*):(\d+(?:\.\d+)?)$/);
  if (m) {
    spec = m[1];
    xfer = Number(m[2]);
  }
  const parts = spec.split('>');
  if (parts.length % 2 === 0 || parts.length > 7) throw new ConfigError(`bad route: ${spec}`);
  const legs = [];
  const transfers = [];
  parts.forEach((p, i) => {
    if (i % 2 === 0) {
      const lines = p.split('|');
      for (const l of lines) {
        if (!LINE_RE.test(l) || !(l in LINE_TO_FEED)) throw new ConfigError(`unknown line: ${l}`);
      }
      legs.push(lines);
    } else {
      const ids = p.split('/');
      for (const s of ids) if (!STOP_RE.test(s)) throw new ConfigError(`bad stop: ${s}`);
      transfers.push({ alight: ids[0], board: ids[1] || ids[0] });
    }
  });
  return { spec, legs, transfers, xfer };
}

/** Routes for one direction as concrete legs: [{lines, from, to}] */
export function directionLegs(config, dir) {
  return config.routes.map((r) => {
    let legs = r.legs;
    let transfers = r.transfers;
    let origin = config.home;
    let dest = config.work;
    if (dir === 'home') {
      legs = [...legs].reverse();
      transfers = [...transfers].reverse().map((t) => ({ alight: t.board, board: t.alight }));
      origin = config.work;
      dest = config.home;
    }
    const out = legs.map((lines, i) => ({
      lines,
      from: i === 0 ? origin : transfers[i - 1].board,
      to: i === legs.length - 1 ? dest : transfers[i].alight,
    }));
    return { spec: r.spec, xfer: r.xfer, legs: out };
  });
}

export function feedsFor(config) {
  const keys = new Set();
  for (const r of config.routes) for (const lines of r.legs) for (const l of lines) keys.add(LINE_TO_FEED[l]);
  return [...keys];
}

export function linesFor(config) {
  const s = new Set();
  for (const r of config.routes) for (const lines of r.legs) for (const l of lines) s.add(l);
  return s;
}

const base = (id) => id.replace(/[NS]$/, '');

/** Index trips by route with a stop -> position map for fast lookups. */
export function indexTrips(trips) {
  const byRoute = new Map();
  for (const t of trips) {
    const pos = new Map();
    t.stops.forEach((s, i) => {
      const b = base(s.stop);
      if (!pos.has(b)) pos.set(b, i);
    });
    const entry = { id: t.id, route: t.route, stops: t.stops, pos };
    if (!byRoute.has(t.route)) byRoute.set(t.route, []);
    byRoute.get(t.route).push(entry);
  }
  return byRoute;
}

/** Trips on `lines` that stop at `from` and later at `to`, leaving `from` at or after `after`. */
function legOptions(index, lines, from, to, after) {
  const out = [];
  for (const line of lines) {
    for (const t of index.get(line) || []) {
      const i = t.pos.get(from);
      const j = t.pos.get(to);
      if (i == null || j == null || j <= i) continue;
      const dep = t.stops[i].dep;
      const arr = t.stops[j].arr;
      if (dep == null || dep < after) continue;
      out.push({ trip: t.id, line, from, to, dep, arr });
    }
  }
  out.sort((a, b) => a.dep - b.dep);
  return out;
}

const MAX_FIRST = 4;
const GRACE = 15; // seconds: a train "arriving now" still shows as 0 min

export function planDirection(index, routes, now) {
  const journeys = [];
  // Departure boards: the origin, then every transfer station inferred from the
  // routes, each listing the lines you'd board there (in the right direction).
  const boards = new Map(); // stop -> Map(line -> Set(dep))
  const addBoard = (stop, opts) => {
    if (!boards.has(stop)) boards.set(stop, new Map());
    const lines = boards.get(stop);
    for (const o of opts) {
      if (!lines.has(o.line)) lines.set(o.line, new Set());
      lines.get(o.line).add(o.dep);
    }
  };
  routes.forEach((route, ri) => {
    const [first, ...rest] = route.legs;
    const firstOpts = legOptions(index, first.lines, first.from, first.to, now - GRACE);
    addBoard(first.from, firstOpts);
    for (const leg of rest) addBoard(leg.from, legOptions(index, leg.lines, leg.from, leg.to, now - GRACE));
    const seenFinal = new Map();
    for (const o of firstOpts.slice(0, MAX_FIRST)) {
      const legs = [o];
      let complete = true;
      for (const leg of rest) {
        const prev = legs[legs.length - 1];
        if (prev.arr == null) { complete = false; break; }
        const next = legOptions(index, leg.lines, leg.from, leg.to, prev.arr + route.xfer * 60)[0];
        if (!next) { complete = false; break; }
        legs.push(next);
      }
      const last = legs[legs.length - 1];
      const j = {
        route: ri,
        legs,
        dep: o.dep,
        arr: complete ? last.arr : null,
      };
      // Two earlier trains that make the same final connection: keep the later one.
      if (complete) {
        const key = last.trip;
        const prevIdx = seenFinal.get(key);
        if (prevIdx != null) journeys[prevIdx] = null;
        seenFinal.set(key, journeys.length);
      }
      journeys.push(j);
    }
  });
  const list = journeys.filter(Boolean);
  list.sort((a, b) => {
    if (a.arr != null && b.arr != null) return a.arr - b.arr || a.dep - b.dep;
    if (a.arr != null) return -1;
    if (b.arr != null) return 1;
    return a.dep - b.dep;
  });
  const best = list.find((j) => j.arr != null);
  if (best) best.best = true;
  const stations = [...boards.entries()].map(([stop, lines]) => ({
    stop,
    boards: [...lines.entries()].map(([line, deps]) => ({
      line,
      deps: [...deps].sort((a, b) => a - b).slice(0, 4),
    })),
  }));
  return { journeys: list.slice(0, 6), stations };
}
