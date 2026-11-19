# mta-commute

A tiny, fast page that answers one question: **which train should I take right now?**

It shows live NYC subway arrivals for a fixed commute, including transfers, and ranks the
options by when you'd actually arrive, not just by which train leaves first. If the slower
line happens to come right away, it can still be the faster choice, and the page says so.

- Static site on GitHub Pages: the phone fetches the [MTA GTFS-realtime feeds](https://api.mta.info/)
  directly (no API key; the MTA sends `Access-Control-Allow-Origin: *`) and decodes
  them with a tiny dependency-free protobuf reader, only for the lines you use.
- Optional fast mode: the same code runs as a Cloudflare Worker that does the decoding
  server-side, so each refresh is ~2 KB of JSON instead of the raw feeds (~100–200 KB
  each). Useful on weak signal; see *Cloudflare (optional)* below.
- Your stations are **not** in this repo. They live in the URL fragment of your personal
  link, plus the browser's local storage on your phone.
- Weak signal underground: the last result is saved on the phone and shown instantly
  with a "x min ago" marker. Countdowns keep ticking from absolute times, so they stay
  useful offline.
- The direction switches automatically: before 13:00 (New York time) it shows the trip to
  work, after that the trip home. Tap the title to flip it. Tap the status (top right) to refresh without clearing the screen.

## Configure

Open `setup.html` on your deployment, or write the link by hand:

```
https://<user>.github.io/mta-commute/#h=<home stop>&w=<work stop>&r=<routes>
```

| Param | Meaning | Default |
|---|---|---|
| `h` | Home stop id, the start of the trip to work | required |
| `w` | Work stop id | required |
| `r` | Routes, written home → work, comma-separated (see below) | required |
| `x` | Minutes to walk between platforms when transferring | `2` |
| `n` | Station names for the stops above, `ID~Name` joined by `\|`. Added by the setup page so the timetable never downloads the full station list. | optional |

Route syntax:

- `1`: ride the 1 directly.
- `2>127>7`: ride the 2 to stop `127`, transfer, then ride the 7.
- `A|C>...`: either line works for that leg.
- `X>A01/B02>Y`: the two platforms have different stop ids (alight at `A01`, board at `B02`).
- `...:3`: per-route transfer time in minutes.

The trip home uses the same routes in reverse. Stop ids are the MTA GTFS `stop_id`s
without the `N`/`S` suffix. The setup page's station search shows them.

## Deploy (free)

Every push to `main` runs the tests, then publishes the site to the `gh-pages` branch.
Once, in the repo's *Settings → Pages*, set *Source* to **Deploy from a branch**, branch
**gh-pages**, folder **/ (root)**. The site appears at `https://<user>.github.io/mta-commute/`.

CI also runs `scripts/live-check.mjs` against the real MTA feeds. It reports HTTP status,
CORS headers, feed sizes and decode times.

### Cloudflare (optional fast mode)

1. Create a free Cloudflare account and note your **Account ID** (*Workers & Pages* overview).
2. *My Profile → API Tokens → Create Token →* template **Edit Cloudflare Workers**.
3. Add repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
   (*Settings → Secrets and variables → Actions*). Pushes to `main` then also deploy the
   Worker to `https://mta-commute.<subdomain>.workers.dev`.

**No GitHub setup?** Run `npm run bundle`. It writes one self-contained file, `dist/worker.js`. In the Cloudflare dashboard, create a Worker from the *Hello World* template, open *Edit code*, replace everything with that file and click *Deploy*.

## Develop

```sh
npm install
npm test                      # decoder + planner tests against synthetic feeds
node scripts/dev-server.mjs   # preview with fake trains, no MTA access needed
node scripts/build-site.mjs   # assemble the static site into _site/
npx wrangler dev              # run the real Worker locally against live feeds
```

`src/stops.js` maps stop ids to station names. It was generated from MTA static GTFS
station data.

## Roadmap

- Service alerts and planned work for your lines (the alerts feed is free too)
- Offline-first PWA with a service worker
- Pick the direction from device location
