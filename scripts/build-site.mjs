// Assembles the static site (GitHub Pages) into _site/. No bundling: the
// browser loads the same ES modules the Worker uses.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const out = new URL('../_site/', import.meta.url);
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const f of ['index.html', 'setup.html', 'manifest.webmanifest', 'icon.svg',
  'gtfsrt.js', 'planner.js', 'plan.js', 'stops.js']) {
  cpSync(new URL('../src/' + f, import.meta.url), new URL(f, out));
}
writeFileSync(new URL('.nojekyll', out), '');
console.log('Built _site/');
