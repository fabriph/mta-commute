// Minimal GTFS-realtime protobuf decoder: just enough for subway trip updates.
// Hand-written (no dependencies) so the Worker stays tiny and fast. Trips whose
// route is not wanted are skipped without decoding their stop list.
//
// Field numbers (gtfs-realtime.proto):
//   FeedMessage:    1 header, 2 entity
//   FeedHeader:     3 timestamp
//   FeedEntity:     1 id, 3 trip_update
//   TripUpdate:     1 trip, 2 stop_time_update
//   TripDescriptor: 1 trip_id, 5 route_id
//   StopTimeUpdate: 2 arrival, 3 departure, 4 stop_id
//   StopTimeEvent:  2 time

const td = new TextDecoder();

class Reader {
  constructor(buf, pos = 0, end = buf.length) {
    this.buf = buf;
    this.pos = pos;
    this.end = end;
  }
  varint() {
    // Safe up to 2^53, plenty for epoch seconds and lengths.
    let result = 0;
    let mul = 1;
    let b;
    do {
      b = this.buf[this.pos++];
      result += (b & 0x7f) * mul;
      mul *= 128;
    } while (b & 0x80);
    return result;
  }
  tag() {
    const t = this.varint();
    return [Math.floor(t / 8), t & 7];
  }
  bytesRange() {
    const len = this.varint();
    const start = this.pos;
    this.pos += len;
    return [start, start + len];
  }
  string() {
    const len = this.varint();
    const s = this.pos;
    this.pos += len;
    // Ids in these feeds are short ASCII; building them directly is much
    // cheaper than TextDecoder for thousands of tiny strings.
    if (len <= 32) {
      let out = '';
      for (let i = s; i < s + len; i++) {
        const c = this.buf[i];
        if (c > 127) return td.decode(this.buf.subarray(s, s + len));
        out += String.fromCharCode(c);
      }
      return out;
    }
    return td.decode(this.buf.subarray(s, s + len));
  }
  skip(wire) {
    switch (wire) {
      case 0: this.varint(); break;
      case 1: this.pos += 8; break;
      case 2: { const len = this.varint(); this.pos += len; break; }
      case 5: this.pos += 4; break;
      default: throw new Error(`Unsupported wire type ${wire}`);
    }
  }
  more() {
    return this.pos < this.end;
  }
  sub(range) {
    return new Reader(this.buf, range[0], range[1]);
  }
}

function eventTime(r) {
  let time = null;
  while (r.more()) {
    const [f, w] = r.tag();
    if (f === 2 && w === 0) time = r.varint();
    else r.skip(w);
  }
  return time;
}

function stopTimeUpdate(r) {
  let stop = null, arr = null, dep = null;
  while (r.more()) {
    const [f, w] = r.tag();
    if (f === 4 && w === 2) stop = r.string();
    else if (f === 2 && w === 2) arr = eventTime(r.sub(r.bytesRange()));
    else if (f === 3 && w === 2) dep = eventTime(r.sub(r.bytesRange()));
    else r.skip(w);
  }
  return { stop, arr, dep };
}

function tripDescriptor(r) {
  let tripId = null, routeId = null;
  while (r.more()) {
    const [f, w] = r.tag();
    if (f === 1 && w === 2) tripId = r.string();
    else if (f === 5 && w === 2) routeId = r.string();
    else r.skip(w);
  }
  return { tripId, routeId };
}

function tripUpdate(r, wantRoute) {
  let trip = null;
  const stuRanges = [];
  while (r.more()) {
    const [f, w] = r.tag();
    if (f === 1 && w === 2) trip = tripDescriptor(r.sub(r.bytesRange()));
    else if (f === 2 && w === 2) stuRanges.push(r.bytesRange());
    else r.skip(w);
  }
  if (!trip || !trip.routeId) return null;
  const route = normalizeRoute(trip.routeId);
  if (wantRoute && !wantRoute(route)) return null;
  const stops = [];
  for (const range of stuRanges) {
    const s = stopTimeUpdate(r.sub(range));
    if (!s.stop) continue;
    stops.push({
      stop: s.stop,
      arr: s.arr ?? s.dep,
      dep: s.dep ?? s.arr,
    });
  }
  return { id: trip.tripId, route, stops };
}

// Express variants share the local line's bullet for commuting purposes.
export function normalizeRoute(id) {
  if (id === 'FX') return 'F';
  if (id === '6X') return '6';
  if (id === '7X') return '7';
  return id;
}

/**
 * Decode a GTFS-realtime feed into trips.
 * @param {Uint8Array} buf
 * @param {(route: string) => boolean} [wantRoute] skip trips on other routes
 * @returns {{timestamp: number|null, trips: {id: string, route: string, stops: {stop: string, arr: number, dep: number}[]}[]}}
 */
export function decodeFeed(buf, wantRoute) {
  const r = new Reader(buf);
  let timestamp = null;
  const trips = [];
  while (r.more()) {
    const [f, w] = r.tag();
    if (f === 1 && w === 2) {
      const h = r.sub(r.bytesRange());
      while (h.more()) {
        const [hf, hw] = h.tag();
        if (hf === 3 && hw === 0) timestamp = h.varint();
        else h.skip(hw);
      }
    } else if (f === 2 && w === 2) {
      const e = r.sub(r.bytesRange());
      while (e.more()) {
        const [ef, ew] = e.tag();
        if (ef === 3 && ew === 2) {
          const t = tripUpdate(e.sub(e.bytesRange()), wantRoute);
          if (t) trips.push(t);
        } else e.skip(ew);
      }
    } else r.skip(w);
  }
  return { timestamp, trips };
}
