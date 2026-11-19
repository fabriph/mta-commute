// Local preview with synthetic data (the MTA feeds aren't needed).
// Usage: node scripts/dev-server.mjs, then open
//   http://localhost:8787/#h=H01&w=W01&r=R>T01>7,N>T02>7
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { decodeFeed } from '../src/gtfsrt.js';
import { buildPlan } from '../src/plan.js';
import { STOP_NAMES } from '../src/stops.js';
import { ConfigError } from '../src/planner.js';
import { NOW, encodeFeed, scenario } from '../test/fixtures.js';

const page = (f) => readFileSync(new URL('../src/' + f, import.meta.url));

async function fixtureFeed(_key, wanted) {
  const shift = Math.floor(Date.now() / 1000) - NOW;
  const trips = scenario().map((t) => ({ ...t, stops: t.stops.map(([s, time, o]) => [s, time + shift, o]) }));
  return decodeFeed(encodeFeed(NOW + shift - 12, trips), (r) => wanted.has(r));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (code, type, body) => { res.writeHead(code, { 'content-type': type }); res.end(body); };
  try {
    if (url.pathname === '/') return send(200, 'text/html', page('index.html'));
    if (url.pathname === '/setup') return send(200, 'text/html', page('setup.html'));
    if (url.pathname === '/api/stops') return send(200, 'application/json', JSON.stringify(STOP_NAMES));
    if (url.pathname === '/api/plan') {
      return send(200, 'application/json', JSON.stringify(await buildPlan(url.searchParams, fixtureFeed, { names: STOP_NAMES })));
    }
    send(404, 'text/plain', 'Not found');
  } catch (e) {
    send(e instanceof ConfigError ? 400 : 500, 'application/json', JSON.stringify({ error: e.message }));
  }
}).listen(8787, () => console.log('http://localhost:8787/#h=H01&w=W01&r=R>T01>7,N>T02>7'));
