import { decodeFeed } from './gtfsrt.js';
import { ConfigError, FEED_URL } from './planner.js';
import { buildPlan } from './plan.js';
import INDEX_HTML from './index.html';
import SETUP_HTML from './setup.html';
import { STOP_NAMES } from './stops.js';

import MANIFEST from './manifest.webmanifest';
import ICON_PNG from './icon-180.png';

// Tells the pages to ask this Worker for plans instead of decoding feeds in the browser.
const API_META = '<meta name="mode" content="api">';
const INDEX = INDEX_HTML.replace('<!--MODE-->', API_META);
const SETUP = SETUP_HTML.replace('<!--MODE-->', API_META);

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
      case '/index.html':
        return text(INDEX, 'text/html; charset=utf-8', 'public, max-age=300');
      case '/setup':
      case '/setup.html':
        return text(SETUP, 'text/html; charset=utf-8', 'public, max-age=300');
      case '/manifest.webmanifest':
        return text(MANIFEST, 'application/manifest+json', 'public, max-age=86400');
      case '/icon-180.png':
        return new Response(ICON_PNG, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' } });
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
