// Smoke test against the real MTA feeds (runs in CI, where the internet is open).
// Reports per feed: HTTP status, size, CORS header, decode time and trip count.
// It also runs the planner on a generic example route.
import { decodeFeed } from '../src/gtfsrt.js';
import { FEEDS, FEED_URL } from '../src/planner.js';
import { buildPlan } from '../src/plan.js';

const ORIGIN = 'https://example.github.io';
let failures = 0;

for (const key of Object.keys(FEEDS)) {
  const url = FEED_URL(key);
  try {
    const res = await fetch(url, { headers: { Origin: ORIGIN } });
    const buf = new Uint8Array(await res.arrayBuffer());
    const cors = res.headers.get('access-control-allow-origin');
    const t0 = performance.now();
    const feed = decodeFeed(buf);
    const ms = (performance.now() - t0).toFixed(1);
    const age = feed.timestamp ? Math.round(Date.now() / 1000 - feed.timestamp) : 'n/a';
    console.log(`${(key || '1-7').padEnd(5)} HTTP ${res.status}  ${(buf.length / 1024).toFixed(0).padStart(4)} KB  ` +
      `CORS=${cors ?? 'none'}  decode ${ms} ms  trips ${feed.trips.length}  feed age ${age}s`);
    if (!res.ok || !feed.trips.length) failures++;
  } catch (e) {
    failures++;
    console.log(`${key || '1-7'}: ERROR ${e.message}`);
  }
}

// Browser preflight check, in case a client ever sends custom headers.
const pre = await fetch(FEED_URL('ace'), {
  method: 'OPTIONS',
  headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET' },
});
console.log(`OPTIONS preflight: HTTP ${pre.status}, allow-origin=${pre.headers.get('access-control-allow-origin') ?? 'none'}`);

// Generic example: 1 train, Van Cortlandt Park-242 St -> Times Sq-42 St.
const params = new URLSearchParams('h=101&w=127&r=1');
const plan = await buildPlan(params, async (key, wanted) => {
  const res = await fetch(FEED_URL(key));
  return decodeFeed(new Uint8Array(await res.arrayBuffer()), (r) => wanted.has(r));
});
const j = plan.dirs.work.journeys[0];
console.log('Example plan:', j
  ? `leave in ${Math.round((j.dep - plan.now) / 60)} min, arrive in ${Math.round((j.arr - plan.now) / 60)} min`
  : 'no journeys', '| response bytes:', JSON.stringify(plan).length, '| errors:', plan.errors);

process.exit(failures ? 1 : 0);
