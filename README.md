# mta-commute

A tiny, fast page that answers one question: **which train should I take right now?**

It shows live NYC subway arrivals for a fixed commute, including transfers, and ranks the
options by when you'd actually arrive, not just by which train leaves first. If the slower
line happens to come right away, it can still be the faster choice, and the page says so.

- One Cloudflare Worker serves the page and a small JSON API. The page is ~9 KB, and
  each refresh downloads ~2 KB of JSON instead of the MTA's large protobuf feeds.
- The Worker fetches the [MTA GTFS-realtime feeds](https://api.mta.info/) (no API key
  needed), decodes only the lines you use, and works out the connections.
- Your stations are **not** in this repo. They live in the URL fragment of your personal
  link, plus the browser's local storage on your phone.
- Weak signal underground: the last result is saved on the phone and shown instantly
  with a "x min ago" marker. Countdowns keep ticking from absolute times, so they stay
  useful offline.
- The direction switches automatically: before 13:00 (New York time) it shows the trip to
  work, after that the trip home. Tap the title to flip it.

## Configure

Open `/setup` on your deployment, or write the link by hand:

```
https://<your-worker>.workers.dev/#h=<home stop>&w=<work stop>&r=<routes>
```

| Param | Meaning | Default |
|---|---|---|
| `h` | Home stop id, the start of the trip to work | required |
| `w` | Work stop id | required |
| `r` | Routes, written home → work, comma-separated (see below) | required |
| `x` | Minutes to walk between platforms when transferring | `2` |
| `k` | Minutes to reach the first platform. Sooner trains are shown as missed. | `0` |
| `s` | Hour (0–23, New York time) from which the page shows the trip home | `13` |

Route syntax:

- `1`: ride the 1 directly.
- `2>127>7`: ride the 2 to stop `127`, transfer, then ride the 7.
- `A|C>...`: either line works for that leg.
- `X>A01/B02>Y`: the two platforms have different stop ids (alight at `A01`, board at `B02`).
- `...:3`: per-route transfer time in minutes.

The trip home uses the same routes in reverse. Stop ids are the MTA GTFS `stop_id`s
without the `N`/`S` suffix. The setup page's station search shows them.

## Deploy (free)

Everything fits in Cloudflare's free Workers plan.

1. Create a free Cloudflare account at <https://dash.cloudflare.com/sign-up>.
2. Note your **Account ID**: in the dashboard, open *Workers & Pages*. It's shown on the
   right side, or in the account menu under *Account home → ⋯ → Copy account ID*.
3. Create an API token: *My Profile → API Tokens → Create Token →* use the
   **Edit Cloudflare Workers** template, then *Continue → Create Token*. Copy it.
4. In this GitHub repo, open *Settings → Secrets and variables → Actions → New
   repository secret* and add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
5. Re-run the latest *Test and deploy* workflow from the *Actions* tab, or push any
   commit. Each push to `main` tests and deploys.

The page will be at `https://mta-commute.<your-subdomain>.workers.dev`. The first time,
Cloudflare asks you to pick that `workers.dev` subdomain under *Workers & Pages*.

**No GitHub setup?** Run `npm run bundle`. It writes one self-contained file, `dist/worker.js`. In the Cloudflare dashboard, create a Worker from the *Hello World* template, open *Edit code*, replace everything with that file and click *Deploy*.

Prefer the terminal? `npx wrangler login && npx wrangler deploy` works as well.

## Develop

```sh
npm install
npm test                      # decoder + planner tests against synthetic feeds
node scripts/dev-server.mjs   # preview with fake trains, no MTA access needed
npx wrangler dev              # run the real Worker locally against live feeds
```

`src/stops.js` maps stop ids to station names. It was generated from MTA static GTFS
station data.

## Roadmap

- Service alerts and planned work for your lines (the alerts feed is free too)
- Offline-first PWA with a service worker
- Pick the direction from device location
