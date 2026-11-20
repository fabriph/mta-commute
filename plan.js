import {
  directionLegs, feedsFor, indexTrips, linesFor, parseConfig, planDirection,
} from './planner.js';

/**
 * Build the /api/plan response.
 * @param {URLSearchParams} params
 * @param {(feedKey: string, wantedLines: Set<string>) => Promise<{timestamp?: number, trips?: any[], error?: string}>} loadFeed
 * @param {{names?: Record<string, string>, now?: number}} [opts] station names by stop id
 *   (the page gets them from its link, so it never loads the full station list)
 */
export async function buildPlan(params, loadFeed, { names: stopNames = {}, now = Math.floor(Date.now() / 1000) } = {}) {
  const config = parseConfig(params);
  const wanted = linesFor(config);
  const keys = feedsFor(config);
  const results = await Promise.all(keys.map((k) => loadFeed(k, wanted)));
  const trips = [];
  const seen = new Set();
  const errors = [];
  let oldest = null;
  results.forEach((r, i) => {
    if (r.error) {
      errors.push(`${keys[i] || '1-7'}: ${r.error}`);
      return;
    }
    // A trip should only be in one feed, but never count the same trip twice.
    for (const t of r.trips) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      trips.push(t);
    }
    if (r.timestamp && (oldest == null || r.timestamp < oldest)) oldest = r.timestamp;
  });
  const index = indexTrips(trips);
  const dirs = {};
  const stopIds = new Set();
  for (const dir of ['work', 'home']) {
    const routes = directionLegs(config, dir);
    dirs[dir] = {
      origin: dir === 'work' ? config.home : config.work,
      ...planDirection(index, routes, now),
    };
    for (const r of routes) for (const l of r.legs) { stopIds.add(l.from); stopIds.add(l.to); }
  }
  const names = {};
  for (const id of stopIds) names[id] = stopNames[id] || id;
  return { now, feedTime: oldest, dirs, names, errors };
}
