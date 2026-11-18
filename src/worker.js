import { decodeFeed } from './gtfsrt.js';
import { ConfigError, FEED_URL } from './planner.js';
import { buildPlan } from './plan.js';
import INDEX_HTML from './index.html';
import SETUP_HTML from './setup.html';
import { STOP_NAMES } from './stops.js';

const MANIFEST = JSON.stringify({
  name: 'Commute',
  short_name: 'Commute',
  start_url: '/',
  display: 'standalone',
  background_color: '#0b0b0c',
  theme_color: '#0b0b0c',
  icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
});

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#0b0b0c"/><circle cx="50" cy="50" r="30" fill="#fff"/><text x="50" y="62" font-family="Helvetica,Arial,sans-serif" font-size="34" font-weight="700" text-anchor="middle" fill="#0b0b0c">go</text></svg>';

const FEED_CACHE_SECONDS = 15;
const FEED_TIMEOUT_MS = 6000;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }
    switch (url.pathname) {
      case '/':
        return text(INDEX_HTML, 'text/html; charset=utf-8', 'public, max-age=300');
      case '/setup':
        return text(SETUP_HTML, 'text/html; charset=utf-8', 'public, max-age=300');
      case '/manifest.webmanifest':
        return text(MANIFEST, 'application/manifest+json', 'public, max-age=86400');
      case '/icon.svg':
        return text(ICON_SVG, 'image/svg+xml', 'public, max-age=86400');
      case '/api/stops':
        return json(STOP_NAMES, 200, 'public, max-age=86400');
      case '/api/plan':
        return plan(url.searchParams);
      default:
        return new Response('Not found', { status: 404 });
    }
  },
};

async function plan(params) {
  try {
    return json(await buildPlan(params, loadFeed), 200, 'no-store');
  } catch (e) {
    if (e instanceof ConfigError) return json({ error: e.message }, 400);
    throw e;
  }
}

async function loadFeed(key, wanted) {
  try {
    const res = await fetch(FEED_URL(key), {
      cf: { cacheTtl: FEED_CACHE_SECONDS, cacheEverything: true },
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const buf = new Uint8Array(await res.arrayBuffer());
    return decodeFeed(buf, (route) => wanted.has(route));
  } catch (e) {
    return { error: e.name === 'TimeoutError' ? 'timeout' : String(e.message || e) };
  }
}

function text(body, type, cache) {
  return new Response(body, { headers: { 'content-type': type, 'cache-control': cache } });
}

function json(obj, status = 200, cache = 'no-store') {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cache,
      'access-control-allow-origin': '*',
    },
  });
}
