// What every page without an islander is made of, for scripts/pack-android.mjs (the app) and
// scripts/pack-web.mjs (the browser, Plans/spelen-in-de-browser.md): a copy of web/ with shared/
// beside it where the import map looks, less the sets only a room of one's own island is drawn
// from, and `window.PROMPTHOLM_STANDALONE` written into the head of index.html.
//
// Imports node: only - not lib/paths.mjs, which moves an island into ~/.promptholm the moment it
// is imported (settleHome) and has no business doing that in a Docker build stage. The two
// callers hand in the folders.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Less the sets only a room of one's own island is drawn from (models.js LAZY: the Salty Kraken's
// hall and ship's parts, 47 MB): a page with no island has no rooms, and they are only ever
// imported on the way into one.
export const ROOM_ONLY = new Set(['krakenkit-mesh.js', 'piratetavern_room-mesh.js']);

export function copyPage({ web, shared, out }) {
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(web, out, { recursive: true, filter: (src) => !ROOM_ONLY.has(path.basename(src)) });
  fs.cpSync(shared, path.join(out, 'shared'), { recursive: true });
}

// Ahead of every other script in the head, so it is there before main.js's graph starts.
// JSON.stringify of plain strings, with `<` escaped so nothing in it can close the tag.
export function withStandalone(html, standalone) {
  const inline = JSON.stringify(standalone).replace(/</g, '\\u003c');
  const at = html.indexOf('<script');
  if (at < 0) throw new Error('web/index.html has no <script> to go in front of');
  return `${html.slice(0, at)}<script>window.PROMPTHOLM_STANDALONE = ${inline};</script>\n${html.slice(at)}`;
}

export function writeStandalone(out, standalone) {
  const index = path.join(out, 'index.html');
  fs.writeFileSync(index, withStandalone(fs.readFileSync(index, 'utf8'), standalone));
}

// ---- the web's shelves (scripts/pack-web.mjs) ------------------------------------------------

// The name of one build's shelf: its version and commit, as the folder play/<id>/. Not the version
// alone - two builds of one version are different modules, and a browser cache that knew both under
// one path would mix them; and deploy/play/shelf.sh keeps a shelf that is already there, so a second
// build under the same name would never be put out at all. Where there is no commit to say - a
// Portainer git stack clones without a usable .git (measured: the sea's /health says commit null) -
// `stamp`, a hash of what is packed, says it instead. Only what is safe in a path survives.
export function shelfId(build, stamp = null) {
  const clean = (s) => String(s || '').replace(/[^0-9A-Za-z.-]/g, '');
  const version = clean(build && build.version) || 'dev';
  const suffix = clean(build && build.commit).slice(0, 7) || clean(stamp).slice(0, 7);
  return suffix ? `${version}-${suffix}` : version;
}

// That hash: every file under the folders, by path and content, in a fixed order - so the same tree
// gives the same name on any machine, and any change gives another.
export function contentStamp(dirs, skip = () => false) {
  const hash = crypto.createHash('sha256');
  const walk = (root, dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const p = path.join(dir, e.name);
      if (skip(p)) continue;
      if (e.isDirectory()) { walk(root, p); continue; }
      hash.update(`${path.relative(root, p).split(path.sep).join('/')}\0`);
      hash.update(fs.readFileSync(p));
      hash.update('\0');
    }
  };
  for (const d of dirs) walk(path.dirname(d), d);
  return hash.digest('hex').slice(0, 7);
}

// play/index.html, the door: always to the newest shelf, with the query and the hash along
// (?stats, ?dive). Served no-cache; it is the one page whose answer changes.
export function doorHtml(id) {
  const to = JSON.stringify(`./${id}/`);   // shelfId lets nothing through that could close the tag
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<title>Promptholm</title>\n'
    + `<script>location.replace(${to} + location.search + location.hash);</script>\n`
    + '</head><body style="background:#0d1420;color:#e8e2d4;font:16px system-ui,sans-serif">\n'
    + `<p><a href="./${id}/" style="color:#e8b45c">Play Promptholm</a></p>\n</body></html>\n`;
}

// play/version.json: what the door leads to, which every open page asks (web/js/update.js webNotice).
export function shelfJson(build, id) {
  return `${JSON.stringify({ version: (build && build.version) || null, commit: (build && build.commit) || null, path: id })}\n`;
}

// An installed page starts at the door, never on the shelf it was installed from - or it would
// open on that day's version for as long as the shelf stood, and then not at all.
export function webManifest(text) {
  const m = JSON.parse(text);
  return `${JSON.stringify({ ...m, start_url: '../', scope: '../' }, null, 2)}\n`;
}

// What is worth compressing ahead of time: text and the GLBs, not the PNGs (already compressed).
export const GZIP_EXT = new Set(['.js', '.mjs', '.json', '.html', '.css', '.svg', '.webmanifest', '.txt', '.glb', '.wasm']);
