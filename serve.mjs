#!/usr/bin/env node
// Serves the island and keeps it up to date: a rescan on a timer (which is how Cowork
// tasks are noticed) and a server-sent-events stream so an open page updates itself.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { ROOT, DATA, WEB, SHARED, loadConfig, setFounder, setDisplay, setSea, nameplatesVisibleTo, readJson } from './lib/paths.mjs';
import { scan, filesFor } from './scan.mjs';
import { refreshSprint, loadSprint, readAssignments, jiraConfig } from './lib/sprint.mjs';
import { refreshIssues, loadIssues, issueByKey, githubConfig } from './lib/issues.mjs';
import { dispatch, agentLogTail, newcomer, found, liveAgents, stopAllAgents } from './lib/dispatch.mjs';
import { banish, unbanish } from './lib/banish.mjs';
import { readTranscript, talk } from './lib/chat.mjs';
import { listProps, addProp, removeProp, clearProps } from './lib/props.mjs';
import {
  cropsView, gardenView, buySeed, sellCrop, sellEverything, holdSeed, plantBed, harvestBed, digUpBed,
} from './lib/garden.mjs';
import {
  mailView, saveAccount, removeAccount, check as checkAccount, inbox, readMessage, setFlag, send as sendMail,
} from './lib/mail.mjs';
import { rememberPlayer, whereIsPlayer } from './lib/player.mjs';
import { overview, fileDiff, commitDetail, commitDiff, fetch as gitFetch, gitTools, openIn, isRepo, branches as gitBranches, merge as gitMerge, currentBranch } from './lib/git.mjs';
import { catalog } from './lib/catalog.mjs';
import { createAccess, isPublicPath, isLoopback, KEY_COOKIE } from './lib/access.mjs';
import { createNeighbours } from './lib/neighbours.mjs';
import { guestVillage } from './lib/guestview.mjs';
import { buildBundle, parseBundle, packParcel, beaconId } from './lib/islandbundle.mjs';
import { createSea } from './lib/sea.mjs';
import { createSeaClient, mintToken } from './lib/seaclient.mjs';
import { loadPlacements, savePlacements } from './lib/placements.mjs';
import { makeTerrain } from './shared/terrain.mjs';
import os from 'node:os';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const argOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const config = loadConfig();
// The flags win over the file, so you can open an island for an afternoon, or run a
// second one beside the first to test with, without editing config.json for it.
if (has('--public')) config.network = { ...config.network, public: true };
if (argOf('--name', null)) config.multiplayer = { ...config.multiplayer, name: argOf('--name', null) };
if (argOf('--seed', null)) config.seed = Number(argOf('--seed', config.seed));
const ALL = has('--all');
// PORT from the environment sits between the flag and the file so a second island - one
// run out of a worktree, say - can be handed a free port by whatever starts it, without
// that ending up in config.json and without colliding with the island already up.
const PORT = Number(argOf('--port', process.env.PORT || config.port || 4747));
const OPEN = has('--open') && !has('--no-open');
const RESCAN = has('--no-rescan') ? 0 : (config.rescanIntervalMs || 60000);
const VILLAGE_FILE = filesFor({ all: ALL }).village;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

const clients = new Set();
const LOG = path.join(DATA, 'server.log');

// Everything the server says ends up in a file as well, so a crash at three in the
// afternoon can still be explained at five.
function log(line) {
  const msg = `${new Date().toISOString()} ${line}\n`;
  process.stderr.write(msg);
  try {
    fs.mkdirSync(DATA, { recursive: true });
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 2 * 1024 * 1024) fs.renameSync(LOG, `${LOG}.1`);
    fs.appendFileSync(LOG, msg);
  } catch { /* logging must never be the thing that breaks */ }
}

// A vendored addon that is not on disk 404s inside an ES module import, and that takes
// main.js down with it: the island then sits on its boot screen saying nothing. web/vendor
// is gitignored and filled by scripts/vendor.mjs, so a checkout that has not run that
// since the list grew serves an island which cannot start.
//
// The page cannot work this out on its own - the browser fires the error on the <script>
// that owns the module graph, not on the import that 404'd - so the boot watchdog in
// web/index.html asks /api/vendor for this list instead of guessing.
function missingVendor() {
  try {
    const want = new Map([['three', path.join(WEB, 'vendor', 'three.module.js')]]);
    const dir = path.join(WEB, 'js');
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.js')) continue;
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const m of src.matchAll(/from\s+['"]three\/addons\/([^'"]+)['"]/g)) {
        want.set(`three/addons/${m[1]}`, path.join(WEB, 'vendor', 'addons', m[1]));
      }
    }
    return [...want].filter(([, file]) => !fs.existsSync(file)).map(([spec]) => spec);
  } catch { return []; }      // this warning must never be the thing that keeps the island down
}

function checkVendor() {
  const missing = missingVendor();
  if (!missing.length) return;
  log(`web/vendor is missing ${missing.length} file(s) that the island imports:`);
  for (const spec of missing) log(`    ${spec}`);
  log(`    the page will hang on its boot screen until this is fixed. Run: npm run vendor`);
}


// A bad request must never take the island down.
process.on('uncaughtException', (e) => log(`uncaught: ${e && e.stack ? e.stack : e}`));
process.on('unhandledRejection', (e) => log(`rejection: ${e && e.stack ? e.stack : e}`));
function shutdown(why) {
  try { seaClient && seaClient.close(); } catch { /* the line home dies with us regardless */ }
  try { ownSea && ownSea.close(); } catch { /* and so does the sea, if it was ours */ }
  try { neighbours && neighbours.stop(); } catch { /* the beacon dies with us regardless */ }
  const stopped = stopAllAgents();
  const tail = stopped.length ? `, stopping ${stopped.length} agent(s): ${stopped.join(', ')}` : '';
  log(`stopping on ${why}${tail}`);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// What is worth compressing: the text the island is made of. Everything not in here -
// the sheets, the icons, the fonts, a .glb - is already compressed, and packing it again
// spends milliseconds to add bytes.
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.webmanifest', '.ndjson']);
// Below about a packet there is nothing to win: the gzip header and trailer are 18 bytes
// and the response was going to fit in one write either way.
const GZIP_FROM = 1400;

function sendFile(req, res, file, { noStore = false, cache = null } = {}) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    const headers = { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' };
    // three.js is pinned by package.json and never changes under the same name, so let
    // the browser keep it instead of re-downloading 1.2 MB on every open.
    headers['Cache-Control'] = cache || (noStore ? 'no-store' : 'public, max-age=31536000, immutable');

    const send = (body, encoding) => {
      if (encoding) {
        headers['Content-Encoding'] = encoding;
        // Everything of ours is no-store and would not be cached anyway, but the vendor
        // bundle is immutable for a year: without this a proxy could hand the packed copy
        // to a client that never asked for one.
        headers['Vary'] = 'Accept-Encoding';
      }
      // The length of the body that actually goes out. There is no streaming here - the
      // file is already one buffer - so this can be exact rather than left to chunking.
      headers['Content-Length'] = body.length;
      res.writeHead(200, headers);
      res.end(body);
    };

    // web/js/tavern-mesh.js is 386 kB of triangles and goes out as 12. Ours is served
    // no-store, so that is the whole 386 kB on every reload, and the only thing between
    // the page and the island is this function. Compressed per request and not cached:
    // the file is in a buffer already, gzip of 386 kB is a few milliseconds, and a cache
    // here would be a second copy of the disk to keep honest. If gzip fails for any
    // reason the plain bytes still go out - nothing about compression is worth a 500.
    const wants = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (wants && COMPRESSIBLE.has(path.extname(file).toLowerCase()) && buf.length >= GZIP_FROM) {
      zlib.gzip(buf, (gzErr, packed) => send(gzErr ? buf : packed, gzErr ? null : 'gzip'));
      return;
    }
    send(buf, null);
  });
}

function safeJoin(base, rel) {
  const p = path.normalize(path.join(base, rel));
  // the separator matters: without it, a sibling folder named web-x would pass
  return p === base || p.startsWith(base + path.sep) ? p : null;
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('body is not JSON')); }
    });
    req.on('error', reject);
  });
}
// Does this folder carry a project skill by that name? It is what decides whether an
// agent sent there is told to follow the workflow or to be told it in full.
//
// This is asked of every project this machine has ever seen, and a stat of a folder on a
// drive that is asleep costs whole seconds, so the answers are kept: a repository does
// not grow a skill while you are looking at a list of folders.
const skillCache = new Map();
function hasSkill(dir, skill) {
  if (!dir || !skill) return false;
  const key = `${dir}::${skill}`;
  if (skillCache.has(key)) return skillCache.get(key);
  let has = false;
  try { has = fs.statSync(path.join(dir, '.claude', 'skills', skill, 'SKILL.md')).isFile(); } catch { has = false; }
  skillCache.set(key, has);
  return has;
}

// A folder on a drive that has gone away does not answer "no", it answers slowly: a
// single stat of a mapped network drive that is not there costs twenty seconds, and one
// such path among sixty is enough to make picking a folder look broken. So every path is
// asked at once and whatever has not answered shortly is treated as not there.
const STAT_PATIENCE = 400;
function isFolderSoon(p) {
  return Promise.race([
    fs.promises.stat(p).then((s) => s.isDirectory()).catch(() => false),
    new Promise((done) => setTimeout(() => done(false), STAT_PATIENCE)),
  ]);
}

// Everywhere Claude has been used on this machine, newest first, with a note about which
// of them carry a workflow skill: the Jira one, and the island's own issue one. Neither
// is looked for unless the folder has a .claude at all, which most of them do not.
async function skillsOf(dir) {
  if (!(await isFolderSoon(path.join(dir, '.claude', 'skills')))) return { jira: false, issue: false };
  return { jira: hasSkill(dir, 'jira-ticket-oppakken'), issue: hasSkill(dir, 'issue-oppakken') };
}

let folderCache = { at: 0, list: null };
async function projectFolders() {
  if (folderCache.list && Date.now() - folderCache.at < 60000) return folderCache.list;
  const wanted = new Map();
  const add = (dir, source) => {
    if (!dir) return;
    const clean = path.resolve(String(dir));
    const key = clean.toLowerCase();
    if (wanted.has(key)) return;
    if (clean === path.parse(clean).root) return;   // a drive root is nobody's project
    wanted.set(key, { path: clean, source });
  };

  const village = readJson(VILLAGE_FILE, null);
  for (const d of (village && village.districts) || []) add(d.root, 'island');
  const global = readJson(path.join(os.homedir(), '.claude.json'), null);
  for (const dir of Object.keys((global && global.projects) || {})) add(dir, 'claude');

  const found = await Promise.all([...wanted.values()].map(async ({ path: dir, source }) => {
    if (!(await isFolderSoon(dir))) return null;
    return {
      path: dir,
      name: path.basename(dir),
      ...(await skillsOf(dir)),
      source,
      worktree: /[\\/]worktrees?[\\/]|[\\/]_wt[\\/]/i.test(dir),
    };
  }));

  const list = found.filter(Boolean).sort((a, b) => {
    if (a.jira !== b.jira) return a.jira ? -1 : 1;          // repos that know the workflow first
    if (a.worktree !== b.worktree) return a.worktree ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  folderCache = { at: Date.now(), list };
  return list;
}

// The visitors' copy of the island, rebuilt only when the island itself changes. A room
// full of guests refetches this on every scan; redacting it once per scan is enough.
let guestCache = { at: null, body: null };
function guestIsland() {
  const v = readJson(VILLAGE_FILE, null);
  if (!v) return null;
  if (guestCache.at !== v.generatedAt || !guestCache.body) {
    guestCache = { at: v.generatedAt, body: JSON.stringify(guestVillage(v)) };
  }
  return guestCache.body;
}

let scanning = null;
let pending = false;
async function rescan(reason) {
  if (scanning) { pending = true; return scanning; }
  scanning = (async () => {
    try { await scan({ all: ALL, quiet: true }); } catch (e) {
      process.stderr.write(`[settlers] rescan failed (${reason}): ${e && e.message}\n`);
    }
  })();
  await scanning;
  scanning = null;
  if (pending) { pending = false; return rescan('coalesced'); }
  // And tell the world, if the island actually changed. publish() compares what it last
  // sent, so a scan that found nothing costs nothing - and a scan that found a house puts
  // it on everybody else's horizon within the minute rather than whenever they next
  // reload. This is the whole of "live, also between scans" for the shape of an island.
  if (seaClient) seaClient.publish().catch(() => {});
  return null;
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    log(`request failed ${req.method} ${req.url}: ${e && e.stack ? e.stack : e}`);
    try { if (!res.headersSent) json(res, 500, { error: 'the island stumbled on that one' }); else res.end(); } catch { /* client gone */ }
  });
});

// This server can start an unattended agent in any folder on the machine, so the
// dangerous half of it only ever answers this computer. Visitors, when the island is
// open, get the island and each other and nothing else. The reasoning behind the three
// checks that decide this lives in lib/access.mjs.
const access = createAccess({ port: PORT, config });

// Who a request is. It used to be needed twice - once here and once for the WebSocket
// upgrade, which handle() never sees - and now there is only one door: the world's socket
// belongs to the sea, and this server answers nothing but its own machine.
const whoFor = (req) => {
  try { return access.classify(req, new URL(req.url, `http://localhost:${PORT}`)); } catch { return { role: 'refused' }; }
};



// Who else is out there. Only the keeper is told: a list of the other machines on your
// network is not a visitor's to read, so the event goes to local listeners only.
const islanderName = config.multiplayer.name || (() => {
  try { return os.userInfo().username; } catch { return os.hostname(); }
})();
// An island answering on a port of its own is somebody's working copy rather than the
// island of this machine -- `--port`, PORT in the environment and autoPort in
// launch.json all end up here -- and it says so on the horizon, with the branch it is
// serving. Two Promptholms in the distance are then two pieces of work you can tell
// apart, instead of a nameless twin of your own island.
//
// Read once, in the background: a beacon goes out every five seconds and none of them
// deserves to shell out to git, and a server does not change branch under its own feet.
const devPort = PORT !== Number(config.port || 4747);
let devLabel = devPort ? 'development' : null;
if (devPort) currentBranch(ROOT).then((b) => { devLabel = workLabel(b) || devLabel; }).catch(() => {});

// The branches here are named <kind>/<issue>-<slug>, so `feature/25-dev-eiland-label`
// reads back as `#25 dev-eiland-label`. Anything not in that shape is shown as it is.
function workLabel(branch) {
  if (!branch) return null;
  const m = /^[^/]+\/(\d+)-(.+)$/.exec(branch);
  return m ? `#${m[1]} ${m[2]}` : branch;
}

const neighbours = config.multiplayer.discovery ? createNeighbours({
  port: PORT,
  name: islanderName,
  islandName: config.islandName,
  seed: config.seed,
  gridSize: config.gridSize,
  announcing: access.open,
  // Only a sea anybody else can actually reach. Single player's sea is on loopback, so
  // shouting about it across the network would put an address in everybody's server list
  // that resolves, on their machine, to their own browser.
  sea: () => {
    if (!ownSea || (config.multiplayer.sea || {}).mode !== 'host') return null;
    const addr = ownSea.address();
    return addr ? { sea: addr.port, seaName: (config.multiplayer.sea || {}).name || `${config.islandName}'s sea` } : null;
  },
  settlers: () => {
    const v = readJson(VILLAGE_FILE, null);
    return (v && v.buildings ? v.buildings.filter((b) => b.kind !== 'civic').length : 0);
  },
  dev: () => devLabel,
  log,
  onChange: (list) => broadcast({ neighbours: list }, 'neighbours', { localOnly: true }),
}) : null;

// Why a sea did not answer, in words a row in the menu can say. Node's own message for
// everything under the HTTP layer is the bare "fetch failed", which tells a reader nothing
// about whether the address is wrong or the machine is simply off - the code that does say
// it is one level down, in `cause`.
function whyNot(e) {
  if (e && e.name === 'TimeoutError') return 'no answer';
  const code = (e && e.cause && e.cause.code) || (e && e.code) || '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'no such address';
  if (code === 'ECONNREFUSED') return 'nothing listening';
  if (code === 'ECONNRESET' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'could not be reached';
  return 'no answer';
}

async function handle(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = decodeURIComponent(url.pathname);

  const who = access.classify(req, url);
  if (who.role === 'refused') {
    log(`refused ${req.method} ${p} from ${req.socket.remoteAddress} (${who.why})`);
    return json(res, 403, { error: 'the island only answers this computer' });
  }
  if (who.role !== 'islander' && !isPublicPath(p)) {
    log(`visitor refused ${req.method} ${p} from ${req.socket.remoteAddress}`);
    return json(res, 403, { error: 'only the keeper of the island can do that' });
  }
  // A visitor who arrived with a valid code should not have to carry it in every URL.
  if (access.inviteInUrl(req, url)) {
    res.setHeader('Set-Cookie', `${KEY_COOKIE}=${encodeURIComponent(access.invite)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
  }

  // What the page needs to know about itself before it draws anything.
  if (p === '/api/hello') {
    return json(res, 200, {
      role: who.role,
      islandName: config.islandName,
      multiplayer: {
        enabled: !!config.multiplayer.enabled,
        maxPlayers: config.multiplayer.maxPlayers,
        tickMs: config.multiplayer.tickMs,
      },
      // Answered here rather than left to the page: a visitor's browser is not where the
      // decision belongs. The setting itself only goes to the keeper, because it is the
      // keeper's panel that shows it; a visitor gets the yes or no and nothing else.
      signs: nameplatesVisibleTo(config.display.nameplates, who.role),
      display: who.role === 'islander' ? { nameplates: config.display.nameplates } : null,
      // Where the world is, and who this island is in it. The url is what web/js/api.js
      // points sea() and the socket at; absent, the page talks to this server for the
      // world too, which is exactly what it did before there were seas.
      //
      // The token is the keeper's alone. It is what holds this island's claim in the sea,
      // so it goes only to a page on this machine - a visitor who had it could publish
      // over the island from anywhere.
      islandId: ISLAND_ID,
      sea: seaUrlFor(req),
      token: who.role === 'islander' ? ISLAND_TOKEN : null,
      // The key to the sea, for the keeper's own page only.
      //
      // A sea with a key refuses a handshake without one - that is the point of it - and
      // until now only lib/seaclient.mjs had it, so the moment a sea got a key it locked
      // out the browser of the very island publishing to it. A visitor does not get it:
      // with the key they could park an island and wear a name in that world, which is
      // exactly what the key is there to stop.
      //
      // It is not a secret the way ISLAND_TOKEN is - everybody in a world shares it - but
      // it is not public either, and a page on this machine is the only one that has any
      // business having it from here.
      seaKey: who.role === 'islander' ? (config.multiplayer.sea && config.multiplayer.sea.key) || null : null,
    });
  }

  // Changes what the island shows. Not a public path, so only the keeper reaches it -
  // see lib/access.mjs, where the API is deny-by-default.
  if (p === '/api/display' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return json(res, 400, { error: String(e.message || e) }); }
    const { key, value } = body || {};
    let display;
    try { display = setDisplay(String(key), String(value)); } catch (e) { return json(res, 400, { error: String(e.message || e) }); }
    config.display = display;                       // the running server, not only the file
    log(`display.${key} is now ${value}`);
    // Every open island hears it at once, and each hears what it is allowed to: the
    // keeper's window and a visitor's are looking at the same setting from two sides.
    broadcast((c) => ({
      signs: nameplatesVisibleTo(display.nameplates, c.local ? 'islander' : 'guest'),
      display: c.local ? display : null,
    }), 'display');
    return json(res, 200, { ok: true, display });
  }

  // Saves a picture the page took of itself, for the readme. Names are strict and the
  // destination is fixed, so this can only ever write a png into docs/screenshots.
  if (p === '/api/shot' && req.method === 'POST') {
    let body;
    try { body = await readBody(req, 24 * 1024 * 1024); } catch (e) { return json(res, 400, { error: String(e.message || e) }); }
    const name = String(body.name || '');
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(name)) return json(res, 400, { error: 'name must be lowercase letters, digits and dashes' });
    const prefix = 'data:image/png;base64,';
    if (typeof body.dataUrl !== 'string' || !body.dataUrl.startsWith(prefix)) return json(res, 400, { error: 'expected a png data url' });
    const dir = path.join(ROOT, 'docs', 'screenshots');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name}.png`);
    const buf = Buffer.from(body.dataUrl.slice(prefix.length), 'base64');
    fs.writeFileSync(file, buf);
    log(`saved screenshot ${name}.png (${Math.round(buf.length / 1024)} kB)`);
    return json(res, 200, { ok: true, file: path.relative(ROOT, file), bytes: buf.length });
  }


  // Saves what the workbench moved. The page sends whole lines - the one standing in
  // buildings.js now, and the one that takes its place - and every one of them has to be
  // found exactly once or nothing at all is written. That is the whole safety story: no
  // line numbers, no patch format, no guessing at code, and the file named here rather
  // than by the request, so nothing can aim this at somewhere else on the machine.
  // Loopback only, whatever the island's own door policy says, because this writes source.
  if (p === '/api/model-save' && req.method === 'POST') {
    if (!isLoopback(req.socket && req.socket.remoteAddress)) {
      return json(res, 403, { error: 'only this computer may write to the island source' });
    }
    let body;
    try { body = await readBody(req, 256 * 1024); } catch (e) { return json(res, 400, { error: String(e.message || e) }); }
    const edits = Array.isArray(body.edits) ? body.edits : [];
    if (!edits.length) return json(res, 400, { error: 'nothing to save' });
    if (edits.length > 400) return json(res, 400, { error: 'more at once than this was meant for' });

    const file = path.join(WEB, 'js', 'buildings.js');
    const before = fs.readFileSync(file, 'utf8');
    let text = before;
    let count = 0;
    for (const e of edits) {
      const op = String(e.op || '');
      const find = String(e.find || '');
      const line = String(e.line || '');
      if (!find) return json(res, 400, { error: 'an edit arrived with no line to find' });
      if (/[\r\n]/.test(find) || /[\r\n]/.test(line)) return json(res, 400, { error: 'an edit has to be a single line' });
      // Nothing is written unless the line is in there once and once only. Twice and it
      // is not clear which one you moved; never and someone has edited it since.
      const hits = text.split(find).length - 1;
      if (hits !== 1) {
        return json(res, 409, {
          saved: 0,
          error: hits
            ? `this line is in the file ${hits} times, so it is not clear which one you meant: ${find}`
            : `this line is not in the file as it stands, so it has been edited since: ${find}`,
        });
      }
      const at = text.indexOf(find);
      const lineStart = text.lastIndexOf('\n', at) + 1;
      const lineEnd = text.indexOf('\n', at);
      if (op === 'replace') {
        text = text.slice(0, at) + line + text.slice(at + find.length);
      } else if (op === 'remove') {
        text = text.slice(0, lineStart) + text.slice(lineEnd + 1);
      } else if (op === 'insertAfter') {
        const indent = (text.slice(lineStart, at).match(/^\s*/) || [''])[0];
        text = `${text.slice(0, lineEnd)}\n${indent}${line}${text.slice(lineEnd)}`;
      } else {
        return json(res, 400, { error: `the workbench does not do "${op}"` });
      }
      count++;
    }
    if (text === before) return json(res, 200, { ok: true, saved: 0 });
    // Written beside the original and moved into place, so a half-written buildings.js
    // never exists for the page to fetch.
    const tmp = `${file}.workbench`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
    log(`the workbench wrote ${count} line(s) into web/js/buildings.js`);
    return json(res, 200, { ok: true, saved: count });
  }
  // ---- the village office ----------------------------------------------------
  // Everything here is scoped to a district's own folder: the page names a district,
  // never a path, so no request can point git at somewhere else on the machine.
  if (p === '/api/git') {
    const village = readJson(VILLAGE_FILE, null);
    const district = (village && (village.districts || []).find((d) => d.id === url.searchParams.get('district'))) || null;
    if (!district || !district.root) return json(res, 404, { ok: false, reason: 'no such district' });
    const dir = district.root;
    const op = url.searchParams.get('op') || 'overview';
    try {
      if (op === 'overview') {
        const [ov, br] = await Promise.all([overview(dir, { logCount: 30 }), gitBranches(dir)]);
        return json(res, 200, {
          ...ov, district: district.id, name: district.name,
          tools: gitTools().map((t) => ({ id: t.id, name: t.name })),
          branches: br.ok ? br.mergeable : [],
          branchesTruncated: br.ok ? br.truncated || 0 : 0,
        });
      }
      if (op === 'diff') return json(res, 200, await fileDiff(dir, url.searchParams.get('file') || '', { staged: url.searchParams.get('staged') === '1' }));
      if (op === 'commit') return json(res, 200, await commitDetail(dir, url.searchParams.get('sha') || ''));
      if (op === 'commit-diff') return json(res, 200, await commitDiff(dir, url.searchParams.get('sha') || ''));
      return json(res, 400, { ok: false, reason: `the office does not do "${op}"` });
    } catch (e) {
      return json(res, 500, { ok: false, reason: String(e.message || e) });
    }
  }

  if (p === '/api/git-action' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return json(res, 400, { error: String(e.message || e) }); }
    const village = readJson(VILLAGE_FILE, null);
    const district = (village && (village.districts || []).find((d) => d.id === body.district)) || null;
    if (!district || !district.root) return json(res, 404, { error: 'no such district' });
    try {
      if (body.op === 'fetch') { const r = await gitFetch(district.root); log(`fetch in ${district.name}: ${r.message}`); return json(res, 200, r); }
      if (body.op === 'merge') {
        const r = await gitMerge(district.root, String(body.ref || ''), { noff: !!body.noff });
        log(`merge ${body.ref} in ${district.name}: ${r.ok ? r.message : r.reason}`);
        return json(res, 200, r);
      }
      if (body.op === 'open') { const r = openIn(String(body.tool || ''), district.root); log(`opened ${r.tool} at ${r.dir}`); return json(res, 200, { ok: true, ...r }); }
      return json(res, 400, { error: 'the office does not do that' });
    } catch (e) {
      return json(res, 400, { error: String(e.message || e) });
    }
  }

  // What the boot watchdog in web/index.html asks when the island never came up. The API
  // is deny-by-default, which is right here: the state of this checkout is not a
  // visitor's to read, and their boot screen falls back to the generic wording.
  if (p === '/api/vendor') return json(res, 200, { missing: missingVendor() });

  // What the page reports when it hits trouble, so a crash leaves a trace.
  if (p === '/api/log' && req.method === 'POST') {
    let body = {};
    try { body = await readBody(req, 16 * 1024); } catch { /* keep going */ }
    log(`page: ${String(body.message || '').slice(0, 500)}${body.stack ? ` | ${String(body.stack).slice(0, 800)}` : ''}`);
    return json(res, 200, { ok: true });
  }

  if (p === '/events') {
    // Unbounded this would be a way to eat the memory of an open island from a loop.
    if (clients.size >= 64) return json(res, 503, { error: 'too many open islands' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    res.write('event: hello\ndata: {}\n\n');
    // Whether this listener is the keeper matters: some events, the list of neighbouring
    // islands above all, name other machines on the network and are not a visitor's to see.
    const client = { res, local: who.role === 'islander' };
    clients.add(client);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
    req.on('close', () => { clearInterval(ping); clients.delete(client); });
    return;
  }

  // Asks every open island to reload itself. The page's own code changes often while
  // you are working on it, and walking to each window to press F5 gets old.
  if (p === '/api/reload' && req.method === 'POST') {
    const n = clients.size;
    broadcast({ at: Date.now() }, 'reload');
    log(`asked ${n} open island(s) to reload`);
    return json(res, 200, { ok: true, islands: n });
  }

  if (p === '/api/rescan' && req.method === 'POST') {
    if (scanning) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"skipped":true}'); return; }
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end('{"started":true}');
    rescan('api');
    return;
  }

  if (p === '/village.json') {
    if (who.role === 'islander' || config.multiplayer.guestView === 'full') {
      sendFile(req, res, VILLAGE_FILE, { noStore: true });
      return;
    }
    const body = guestIsland();
    if (!body) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
    return;
  }

  // ---- the sprint board ----------------------------------------------------
  if (p === '/api/sprint') {
    const force = url.searchParams.get('refresh') === '1';
    let sprint;
    try { sprint = await refreshSprint({ force }); } catch (e) { sprint = { ...loadSprint(), note: String(e.message || e) }; }
    return json(res, 200, {
      ...sprint,
      configured: jiraConfig().configured,
      // Each board counts its own hand-overs. Records from before there were two boards
      // carry no source and belong to this one.
      assignments: readAssignments().filter((a) => a.source !== 'github').slice(0, 60),
    });
  }

  // ---- the island's own board ----------------------------------------------
  // The GitHub issues of the repository this island is built from. Read through the gh
  // command line, so the board sees exactly what an agent sent out from it would see.
  if (p === '/api/issues') {
    const force = url.searchParams.get('refresh') === '1';
    let issues;
    try { issues = await refreshIssues({ force }); } catch (e) { issues = { ...loadIssues(), note: String(e.message || e) }; }
    const cfg = githubConfig();
    return json(res, 200, {
      ...issues,
      repo: issues.repo || cfg.repo || null,
      url: issues.url || cfg.url || null,
      configured: cfg.configured,
      skill: cfg.dispatch.skill || null,
      islandRoot: ROOT,
      assignments: readAssignments().filter((a) => a.source === 'github').slice(0, 60),
    });
  }

  // The folders a newcomer could be sent to work in: every project this machine has
  // seen Claude used in, plus the districts already on the island.
  if (p === '/api/folders') return json(res, 200, { folders: await projectFolders() });

  if (p === '/api/agents') return json(res, 200, { agents: liveAgents() });

  // Which seas there are to join. Three sources, one list:
  //
  //   the network   islands on this LAN that say they are hosting one (the beacon above)
  //   the known one a fixed address in the config, for the sea that is always up
  //   your own      whatever you have typed in before and kept
  //
  // Each is asked /health, so the list says whether anybody is home before you pick rather
  // than after. A sea that does not answer stays in the list with the reason on it: "gone"
  // and "still looking" are different things and a picker that conflates them is a picker
  // that looks broken every time the wifi hiccups.
  // The renderer telling the island where it actually put things.
  //
  // A building's position is not its plot: housePlacement and yardNudge move it by up to
  // half a cell, and both of them measure the built geometry, which exists nowhere but in
  // a browser. A settler stands outside its own door, so a sea working from the surveyed
  // cell centre would stand apprentices inside their own sheds - measured at a median of
  // 0.35 units off, against a shed's door reach of 0.46.
  //
  // Keeper-only, and not because the numbers are secret: they are scenery, and they go
  // out in every bundle. It is because this is a write, and the API here is deny-by-default
  // for writes. A visitor's browser drew the same island and has nothing to add.
  if (p === '/api/placements' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return json(res, 400, { error: String(e.message || e) }); }
    let saved;
    try { saved = savePlacements(body); } catch (e) { return json(res, 500, { error: String(e.message || e) }); }
    // Worth republishing at once rather than waiting for the next scan: until this arrives
    // the sea has everybody standing a third of a cell out of place.
    if (seaClient) seaClient.publish().catch(() => {});
    return json(res, 200, { ok: true, buildings: Object.keys(saved.at).length, decks: Object.keys(saved.decks).length });
  }

  // Who the sea's roster means, in this island's own names. Not on PUBLIC_API: it is the
  // inverse of the redaction (see crowdIds above), so it never leaves this machine.
  //
  // Rebuilt rather than served from the last publish, because a page may ask before this
  // island has ever sailed - at boot, with the sea still connecting - and an empty map
  // reads to the page as "nobody lives here" rather than as "ask again".
  if (p === '/api/crowd-ids' && req.method === 'GET') {
    if (!Object.keys(crowdIds).length) islandBundle();
    return json(res, 200, { ids: crowdIds });
  }

  if (p === '/api/seas') {
    const cfg = config.multiplayer.sea || {};
    const candidates = new Map();
    const offer = (o) => { if (o && o.url && !candidates.has(o.url)) candidates.set(o.url, o); };

    if (ownSea) {
      const addr = ownSea.address();
      const mode = cfg.mode === 'host' ? 'host' : 'single';
      if (addr) offer({ url: seaUrlFor(req), name: cfg.name || `${config.islandName}'s sea`, from: mode, mine: true });
    }
    for (const n of (neighbours ? neighbours.list() : [])) if (n.sea) offer(n.sea);
    for (const url of cfg.known || []) offer({ url: String(url), name: null, from: 'known' });
    if (cfg.url) offer({ url: String(cfg.url), name: null, from: 'chosen' });

    const asked = await Promise.all([...candidates.values()].map(async (o) => {
      try {
        const r = await fetch(new URL('health', o.url).href, { signal: AbortSignal.timeout(2000) });
        if (!r.ok) return { ...o, up: false, why: `answered ${r.status}` };
        const h = await r.json();
        return { ...o, up: true, name: o.name || h.sea || null, islands: h.islands ?? 0, players: h.players ?? 0, v: h.v };
      } catch (e) {
        return { ...o, up: false, why: whyNot(e) };
      }
    }));
    return json(res, 200, { mode: cfg.mode || 'single', current: cfg.url || null, seas: asked });
  }

  // Move this island to another world. Keeper-only, like every other setting: it writes
  // config.json and then actually does it - closes whatever sea we were in and joins the
  // new one - rather than leaving a file that only takes effect on the next restart.
  //
  // The page reconnects on its own: web/js/net.js has been retrying since the moment the
  // old socket dropped, and the new welcome carries the new fleet.
  if (p === '/api/sea' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return json(res, 400, { error: String(e.message || e) }); }
    let sea;
    try { sea = setSea(body || {}); } catch (e) { return json(res, 400, { error: String(e.message || e) }); }
    config.multiplayer.sea = sea;
    if (seaClient) { seaClient.close(); seaClient = null; }
    if (ownSea) { await ownSea.close().catch(() => {}); ownSea = null; }
    await putToSea();
    if (seaClient) seaClient.publish({ force: true }).catch(() => {});
    log(`this island is now ${sea.mode === 'join' ? `in ${sea.url}` : sea.mode === 'host' ? 'hosting a sea' : 'on its own'}`);
    // Everyone's page is told where to look now, including a visitor's.
    broadcast(() => ({ sea: sea.mode === 'join' ? sea.url : null, mode: sea.mode }), 'sea');
    return json(res, 200, { ok: true, sea: { mode: sea.mode, url: sea.url } });
  }

  if (p === '/api/neighbours') {
    return json(res, 200, { me: neighbours ? neighbours.me() : null, neighbours: neighbours ? neighbours.list() : [] });
  }
  // Hands a card to a settler and starts the agent that works it.
  if (p === '/api/assign' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return json(res, 400, { error: String(e.message || e) }); }
    const { issueKey, buildingId, cwd, model, dryRun, source } = body || {};
    if (!issueKey) return json(res, 400, { error: 'issueKey is required' });
    if (!buildingId && !cwd) return json(res, 400, { error: 'name a settler or a folder for a newcomer' });

    // Two boards stand on the square, and a card comes off one of them.
    const from = source === 'github' ? 'github' : 'jira';
    let issue, wording = null;
    if (from === 'github') {
      issue = issueByKey(issueKey);
      wording = githubConfig().dispatch;
    } else {
      issue = (loadSprint().issues || []).find((i) => i.key === issueKey);
    }
    if (!issue) return json(res, 404, { error: `${issueKey} is not on the board` });

    let settler;
    if (buildingId) {
      const village = readJson(VILLAGE_FILE, null);
      settler = village && (village.buildings || []).find((b) => b.id === buildingId);
      if (!settler) return json(res, 404, { error: 'no such settler' });
      if (!settler.cwd) return json(res, 400, { error: `${settler.name} has no project folder to work in` });
    } else {
      const dir = path.resolve(String(cwd));
      let ok = false;
      try { ok = fs.statSync(dir).isDirectory(); } catch { ok = false; }
      if (!ok) return json(res, 400, { error: `no such folder: ${dir}` });
      settler = newcomer({ cwd: dir, model: model || null });
    }

    // A workflow skill is only worth naming if the folder actually carries it; without
    // it the agent is told the route in full instead of being sent looking for a page
    // that is not there.
    if (wording && wording.skill && !hasSkill(settler.cwd, wording.skill)) wording = { ...wording, skill: null };

    try {
      const r = dispatch({ issue, settler, cwd: settler.cwd, dryRun: !!dryRun, wording, source: from });
      process.stderr.write(`[settlers] ${issueKey} -> ${settler.name} (${r.status}) in ${settler.cwd}\n`);
      setTimeout(() => rescan('assignment'), 1500);
      return json(res, 202, r);
    } catch (e) {
      return json(res, 500, { error: String(e.message || e) });
    }
  }

  // Sends a settler off the island, or asks them back. The transcript is never touched.
  if (p === '/api/banish' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return json(res, 400, { error: String(e.message || e) }); }
    const { buildingId, undo } = body || {};
    if (!buildingId) return json(res, 400, { error: 'buildingId is required' });
    if (String(buildingId).startsWith('civic:')) return json(res, 400, { error: 'the village keeps its own buildings' });

    if (undo) {
      unbanish(buildingId);
      log(`${buildingId} welcomed back`);
    } else {
      const village = readJson(VILLAGE_FILE, null);
      const b = village && (village.buildings || []).find((x) => x.id === buildingId);
      banish({ id: buildingId, sessionId: b && b.sessionId, name: b && b.name, kind: b && b.kind });
      log(`${(b && b.name) || buildingId} sent off the island`);
    }
    await rescan('banish');
    return json(res, 200, { ok: true, buildingId, undo: !!undo });
  }

  // Founding a settler: a new session, started because you asked for one.
  if (p === '/api/found' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return json(res, 400, { error: String(e.message || e) }); }
    const { cwd, model, prompt } = body || {};
    if (!cwd) return json(res, 400, { error: 'pick a folder for them to live in' });
    try {
      const r = found({ cwd: path.resolve(String(cwd)), model: model || null, prompt });
      setTimeout(() => rescan('founded'), 1500);
      return json(res, 202, r);
    } catch (e) {
      return json(res, 400, { error: String(e.message || e) });
    }
  }

  // ---- calling an existing session to the island ---------------------------
  // Every session this machine has recorded, so the town hall can adopt one that
  // started before the island was founded (the way Sybolt digital twin was added).
  if (p === '/api/sessions') {
    const q = String(url.searchParams.get('q') || '').toLowerCase().trim();
    const village = readJson(VILLAGE_FILE, null);
    const onIsland = new Set((village && village.buildings || []).map((b) => b.sessionId).filter(Boolean));
    let rows = catalog({ config: loadConfig(), onIslandIds: onIsland });
    if (q) {
      rows = rows.filter((r) => [r.name, r.title, r.project, r.cwd, r.sessionId, r.model]
        .some((f) => f && String(f).toLowerCase().includes(q)));
    }
    return json(res, 200, { sessions: rows.slice(0, 200), total: rows.length });
  }

  // Adopt (or release) a session: adds its id to config.founders and rescans, so a
  // session from before the founding gets a house. No process is started.
  if (p === '/api/adopt' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return json(res, 400, { error: String(e.message || e) }); }
    const { sessionId, remove } = body || {};
    try {
      const founders = setFounder(sessionId, !remove);
      log(`${remove ? 'released' : 'adopted'} ${sessionId}; founders now ${founders.length}`);
      await rescan('adopt');
      return json(res, 200, { ok: true, sessionId, adopted: !remove, founders: founders.length });
    } catch (e) {
      return json(res, 400, { error: String(e.message || e) });
    }
  }

  // ---- talking to a settler --------------------------------------------------
  if (p === '/api/transcript') {
    const session = url.searchParams.get('session') || '';
    const agentId = url.searchParams.get('agent') || null;
    const limit = Math.min(300, Number(url.searchParams.get('limit') || 80) || 80);
    try { return json(res, 200, readTranscript(session, { limit, agentId })); }
    catch (e) { return json(res, 500, { ok: false, reason: String(e.message || e), messages: [] }); }
  }

  // Carries the conversation on and streams the answer back as it arrives.
  if (p === '/api/say' && req.method === 'POST') {
    let body;
    try { body = await readBody(req, 256 * 1024); } catch (e) { return json(res, 400, { error: String(e.message || e) }); }
    const { sessionId, text, cwd, mode, model } = body || {};

    let started;
    try { started = talk({ sessionId, cwd, text, mode, model }); }
    catch (e) { return json(res, 400, { error: String(e.message || e) }); }

    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    log(`chat ${sessionId} in ${started.cwd}: ${String(text).replace(/\s+/g, ' ').slice(0, 120)}`);

    const { child } = started;
    let carry = '';
    child.stdout.on('data', (chunk) => {
      carry += chunk;
      const lines = carry.split('\n');
      carry = lines.pop();
      for (const line of lines) if (line.trim()) res.write(line.trim() + '\n');
    });
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', (e) => {
      try { res.write(JSON.stringify({ type: 'settlers_error', error: String(e.message || e) }) + '\n'); } catch { /* client gone */ }
    });
    child.on('close', (code) => {
      if (carry.trim()) { try { res.write(carry.trim() + '\n'); } catch { /* client gone */ } }
      if (code !== 0) {
        log(`chat ${sessionId} exited ${code}: ${stderr.slice(0, 400)}`);
        try { res.write(JSON.stringify({ type: 'settlers_error', error: stderr.trim().slice(0, 400) || `claude exited with ${code}` }) + '\n'); } catch { /* gone */ }
      }
      try { res.end(); } catch { /* gone */ }
      setTimeout(() => rescan('chat'), 1200);
    });
    req.on('close', () => { if (!child.killed) child.kill(); });
    return;
  }

  // ---- where you are standing ------------------------------------------------
  // The village knows nothing about the reader, and an agent asked to put a bridge
  // "here" has to be able to find out where here is. The page reports while you walk;
  // tools/island.mjs reads it back.
  if (p === '/api/where') {
    if (req.method === 'POST') {
      let body;
      try { body = await readBody(req, 4 * 1024); } catch (e) { return json(res, 400, { error: String(e.message || e) }); }
      return json(res, 200, { at: rememberPlayer(body, { force: !!body.final }) });
    }
    return json(res, 200, { at: whereIsPlayer() });
  }

  // ---- what has been built by hand ---------------------------------------------
  // Everything here is a shape, a place and a size. Nothing names a file or a folder,
  // so the worst a runaway agent can do is clutter the island, and `clear` sweeps it.
  if (p === '/api/props') return json(res, 200, { props: listProps() });

  if (p === '/api/build' && req.method === 'POST') {
    let body;
    try { body = await readBody(req, 8 * 1024); } catch (e) { return json(res, 400, { error: String(e.message || e) }); }
    try {
      const prop = addProp(body);
      log(`built ${prop.kind} at ${prop.x}, ${prop.z}${prop.unknown ? ' (nothing draws that yet, so it stands as a cairn)' : ''}`);
      broadcast({ at: Date.now(), id: prop.id, kind: prop.kind }, 'props');
      tellTheSea();
      return json(res, 201, { ok: true, prop });
    } catch (e) {
      return json(res, 400, { error: String(e.message || e) });
    }
  }

  if (p === '/api/unbuild' && req.method === 'POST') {
    let body;
    try { body = await readBody(req, 4 * 1024); } catch (e) { return json(res, 400, { error: String(e.message || e) }); }
    if (body.clear) {
      const cleared = clearProps();
      log(`cleared ${cleared} built thing(s) off the island`);
      broadcast({ at: Date.now(), cleared }, 'props');
      tellTheSea();
      return json(res, 200, { ok: true, cleared });
    }
    const removed = removeProp(String(body.id || ''));
    if (removed) {
      log(`took away the ${removed.kind} at ${removed.x}, ${removed.z}`);
      broadcast({ at: Date.now(), id: removed.id }, 'props');
      tellTheSea();
    }
    return json(res, 200, { ok: true, removed });
  }

  // ---- the market garden -------------------------------------------------------
  // Two paths, and the split is the point. The beds are scenery, so anyone walking the
  // island is shown them; the purse, the pouch and every way of changing them belong to
  // whoever lives here, and live at a path a visitor cannot reach at all.
  if (p === '/api/crops') {
    if (req.method !== 'GET') return json(res, 405, { error: 'only GET' });
    return json(res, 200, { crops: cropsView() });
  }

  if (p === '/api/garden') {
    if (req.method === 'GET') return json(res, 200, gardenView());
    if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST' });
    let body;
    try { body = await readBody(req, 8 * 1024); } catch (e) { return json(res, 400, { error: String(e.message || e) }); }
    const op = String(body.op || '');
    try {
      let done;
      if (op === 'buy') {
        done = buySeed(body.kind, body.count);
        log(`bought ${done.count} ${done.kind} seed for ${done.paid} coins, ${done.purse} left`);
      } else if (op === 'hold') {
        done = holdSeed(body.kind === null ? null : body.kind);
      } else if (op === 'plant') {
        done = plantBed(body);
        log(`sowed ${done.bed.kind} at ${done.bed.x}, ${done.bed.z}${done.salt ? ' (salt air)' : ''}`);
      } else if (op === 'harvest') {
        done = harvestBed(body.id);
        log(`pulled ${done.count} ${done.kind}`);
      } else if (op === 'dig') {
        done = digUpBed(body.id);
        log(`dug up the ${done.kind} bed`);
      } else if (op === 'sell') {
        done = sellCrop(body.kind, body.count == null ? 'all' : body.count);
        log(`sold ${done.count} ${done.kind} for ${done.paid} coins, purse now ${done.purse}`);
      } else if (op === 'sellAll') {
        done = sellEverything();
        log(`sold ${done.count} vegetable(s) for ${done.paid} coins, purse now ${done.purse}`);
      } else {
        return json(res, 400, { error: 'op is one of buy, hold, plant, harvest, dig, sell, sellAll' });
      }
      // Only the beds are anybody else's business, and only they change the picture.
      if (['plant', 'harvest', 'dig'].includes(op)) { broadcast({ at: Date.now(), op }, 'garden'); tellTheSea(); }
      return json(res, 200, { ok: true, ...done, garden: gardenView() });
    } catch (e) {
      return json(res, 400, { error: String(e.message || e) });
    }
  }

  // ---- the postbox on the town hall pavement ------------------------------------
  // One path, and it is not on the public list in lib/access.mjs - which is the whole of
  // the access control here, and deliberately so: the API is deny-by-default, so a route
  // added for somebody's mail is local-only without anybody having to remember that it
  // should be. A visitor walking an open island sees a postbox with a flag on it and can
  // no more open it than they could read the post through the slot.
  //
  // The GET is the poll the flag runs on and is answered from a cache; the POST is
  // everything the panel does. No password is ever written into a log line or handed
  // back over the wire - see lib/mail.mjs.
  if (p === '/api/mail') {
    if (req.method === 'GET') {
      try {
        return json(res, 200, await mailView({ force: url.searchParams.get('force') === '1' }));
      } catch (e) {
        return json(res, 500, { error: String(e.message || e) });
      }
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST' });
    let body;
    try { body = await readBody(req, 128 * 1024); } catch (e) { return json(res, 400, { error: String(e.message || e) }); }
    const op = String(body.op || '');
    try {
      if (op === 'save') {
        const account = saveAccount(body.account || {});
        log(`mail: kept the settings for ${account.address}`);
        return json(res, 200, { ok: true, account, ...(await mailView({ force: true })) });
      }
      if (op === 'remove') {
        const gone = removeAccount(body.id);
        if (gone) log(`mail: took ${gone.address} out of the box`);
        return json(res, 200, { ok: true, removed: gone, ...(await mailView()) });
      }
      if (op === 'check') return json(res, 200, { ok: true, ...(await checkAccount(body.account || {})) });
      if (op === 'inbox') return json(res, 200, { ok: true, ...(await inbox(body.id, { limit: body.limit })) });
      if (op === 'read') return json(res, 200, { ok: true, message: await readMessage(body.id, body.uid, { markSeen: !!body.markSeen }) });
      if (op === 'flag') return json(res, 200, { ok: true, ...(await setFlag(body.id, body.uid, body.flag, body.on)) });
      if (op === 'send') {
        const sent = await sendMail(body.id, body.draft || {});
        log(`mail: sent one to ${sent.to.join(', ')}${sent.filed ? ` (filed in ${sent.filed})` : ''}`);
        return json(res, 200, { ok: true, sent });
      }
      return json(res, 400, { error: 'op is one of save, remove, check, inbox, read, flag, send' });
    } catch (e) {
      return json(res, 400, { error: String(e.message || e) });
    }
  }

  if (p === '/api/agent-log') {
    const file = url.searchParams.get('file') || '';
    const safe = path.normalize(file).startsWith(path.join(DATA, 'agents'));
    if (!safe) return json(res, 400, { error: 'not an agent log' });
    return json(res, 200, { tail: agentLogTail(file) });
  }

  if (p.startsWith('/shared/')) {
    const f = safeJoin(SHARED, p.slice('/shared/'.length));
    if (f) return sendFile(req, res, f, { noStore: true });   // our own code: never cached
  }

  // The service worker wants revalidation rather than no-store: browsers refuse to
  // register a worker they were told never to keep at all.
  if (p === '/sw.js') return sendFile(req, res, path.join(WEB, 'sw.js'), { cache: 'no-cache' });

  const rel = p === '/' ? 'index.html'
    : p === '/demo' ? 'demo.html'          // the model sheet: every object on one field
      : p === '/editor' ? 'editor.html'    // the workbench: pick a model apart and nudge it
        : p.replace(/^\//, '');
  const f = safeJoin(WEB, rel);
  if (!f) { res.writeHead(400); res.end('Bad path'); return; }
  sendFile(req, res, f, { noStore: !rel.startsWith('vendor/') && !rel.startsWith('icons/') });
}

// A payload may also be a function of the listener, for the events whose answer is not
// the same for the keeper as for a visitor. Worked out per client rather than once, so
// such an event still goes out in a single pass over the room.
function broadcast(payload, event = 'update', { localOnly = false } = {}) {
  const same = typeof payload === 'function' ? null : `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const c of clients) {
    if (localOnly && !c.local) continue;
    const msg = same || `event: ${event}\ndata: ${JSON.stringify(payload(c))}\n\n`;
    try { c.res.write(msg); } catch { clients.delete(c); }
  }
}

// The scanner replaces village.json by rename, so watch the directory, not the file.
let debounce = null;
function watchData() {
  try {
    fs.watch(DATA, (_e, filename) => {
      if (!filename || path.basename(String(filename)) !== path.basename(VILLAGE_FILE)) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        let generatedAt = null;
        try { generatedAt = JSON.parse(fs.readFileSync(VILLAGE_FILE, 'utf8')).generatedAt; } catch {}
        broadcast({ generatedAt });
      }, 300);
    });
  } catch {
    fs.watchFile(VILLAGE_FILE, { interval: 1000 }, () => broadcast({ generatedAt: null }));
  }
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    process.stderr.write(`[settlers] the island is already being served at http://localhost:${PORT}\n`);
    if (OPEN) openBrowser(`http://localhost:${PORT}/`);
    process.exit(0);
  }
  log(`server error: ${e && e.stack ? e.stack : e}`);
});

function openBrowser(url) {
  try {
    spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch { /* the user can open it themselves */ }
}

// Shut, the island is bound to the loopback address: nobody else on the network gets to
// start agents on this machine. Open, the host is left out entirely rather than set to
// 0.0.0.0 - no host binds dual-stack, while 0.0.0.0 refuses IPv6, and Windows resolves
// localhost to ::1 first, so the keeper's own browser would take a fallback delay on
// every single load.
if (access.open) {
  server.headersTimeout = 10000;
  server.requestTimeout = 30000;
  server.maxConnections = 128;
}
// ---- which world this island lives in --------------------------------------------
//
// One code path for all three answers. Single player starts a sea in this very process,
// bound to loopback, and joins it with one island in it; hosting is that same sea bound to
// the network; joining is somebody else's address. The page cannot tell the three apart and
// does not have to - the difference is how many rows come back in the fleet.
//
// The alternative was an offline mode beside a multiplayer one, and that is two drawing
// paths, two sets of bugs and a "works alone, breaks together" class of failure that only
// ever shows up in front of somebody else.
// Read through config rather than captured, so /api/sea changing it is enough.
const SEA = () => config.multiplayer.sea || {};
const ISLAND_ID = beaconId(PORT);
const ISLAND_TOKEN = mintToken();
let ownSea = null;
let seaClient = null;

// What this island looks like to the world. Built here, on the machine that holds the
// secrets, because that is where the redaction has to run.
// The last bundle's `renamed id -> real id`, for this island's own page.
//
// The sea walks our crowd out of the bundle we published, so the roster it sends back
// names everybody by their redacted id - and this page drew its houses under the real
// ones. Something has to join the two, and it has to be the machine that did the
// renaming: the shed ids in particular cannot be reconstructed from the outside, which
// is the whole point of redacting them.
//
// Deliberately NOT on PUBLIC_API. It is the inverse of the redaction, and handing it to a
// visitor would undo every bit of it in one request.
let crowdIds = {};

// What is standing on this island, out to everybody watching it.
//
// Through the parcel door rather than a republish: nothing about the village has changed,
// and a republish would cost two hundred kilobytes and send every settler on this island
// back to their own front door, for one tree. Fire and forget - the next scan carries the
// same tree in the bundle anyway, so a patch that does not arrive is a minute of somebody
// else not seeing it rather than something to recover from.
function tellTheSea() {
  if (!seaClient) return;
  // Packed here, with the forgiving context, exactly as buildBundle packs the same two
  // lists. A prop in props.json carries only what whoever built it gave it - `scale` is
  // usually not among them - and the sea's side of this door is strict, so raw props are
  // refused whole and the tree never appears on anybody else's island.
  const parcel = packParcel({ props: listProps(), crops: cropsView(), gridSize: config.gridSize });
  seaClient.patch(parcel).catch(() => {});
}

function islandBundle() {
  const village = readJson(VILLAGE_FILE, null);
  if (!village) return null;
  const named = {};
  try {
    const bundle = buildBundle({
      config,
      village,
      props: listProps(),
      crops: cropsView(),
      // Where the buildings really stand, which only a renderer knows - see the header of
      // lib/placements.mjs. Empty until a browser has drawn this island once.
      placements: loadPlacements(),
      id: ISLAND_ID,
      keeper: islanderName,
    }, named);
    crowdIds = named.ids || {};
    return bundle;
  } catch {
    // An island that has never been scanned has no terrain hash, and buildBundle says so
    // rather than sending something the other end is obliged to reject. Nothing to
    // publish yet is a perfectly ordinary state a minute after first run.
    return null;
  }
}

// Where this page should look for the world.
//
// A joined sea is one absolute address and everybody uses it. A sea of our own is on this
// same machine, one port over - and the address has to be built from the Host the page
// actually arrived on, not from localhost. A phone at http://192.168.2.8:4747/ that was
// handed "localhost" would spend the rest of the evening trying to reach its own browser.
function seaUrlFor(req) {
  const mode = SEA().mode === 'host' || SEA().mode === 'join' ? SEA().mode : 'single';
  if (mode === 'join') return SEA().url || null;
  if (!ownSea) return null;
  const port = (ownSea.address() || {}).port;
  if (!port) return null;
  const host = String(req.headers.host || '').trim();
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  return `http://${name || 'localhost'}:${port}/`;
}

async function putToSea() {
  if (!config.multiplayer.enabled) return;
  const cfg = SEA();
  const mode = cfg.mode === 'host' || cfg.mode === 'join' ? cfg.mode : 'single';
  let url = cfg.url;

  if (mode !== 'join') {
    const host = mode === 'host' ? '0.0.0.0' : '127.0.0.1';
    const wanted = Number(cfg.port) || 4750;
    // The configured port first, and any free one if it is taken.
    //
    // Two islands on one machine is the ordinary case here, not an edge: .claude/launch.json
    // has island-worktree on an auto-port precisely so a branch can be previewed beside the
    // island already running. Their seas collided on 4750, the second one threw
    // EADDRINUSE into the uncaughtException handler, and that island then served perfectly
    // while having no world at all - no fleet, no settlers, no socket for the page to join.
    // It logged one line and looked fine, which is the worst way for this to fail.
    //
    // The fixed port is still tried first, because it is the address somebody types to join
    // a host. A fallback only costs the one who was second.
    const open = async (port) => {
      const sea = createSea({
        port,
        host,
        name: cfg.name || `${config.islandName}'s sea`,
        key: cfg.key || null,
        tickMs: config.multiplayer.tickMs,
        maxPlayers: config.multiplayer.maxPlayers,
        log: (m) => log(`sea: ${m}`),
      });
      const addr = await sea.listen();
      return { sea, addr };
    };
    let opened;
    try {
      opened = await open(wanted);
    } catch (e) {
      if (e && e.code !== 'EADDRINUSE') throw e;
      log(`sea: port ${wanted} is taken - another island on this machine has it. Taking any free port instead.`);
      opened = await open(0);
    }
    ownSea = opened.sea;
    const addr = opened.addr;
    url = `http://127.0.0.1:${addr.port}/`;
    if (mode === 'host') {
      log(`hosting a sea on port ${addr.port}. Others join it at:`);
      for (const a of access.addresses()) log(`    http://${a.includes(':') ? `[${a}]` : a}:${addr.port}/`);
    }
  }

  if (!url) { log('no sea to join: set multiplayer.sea.url, or switch the mode back to single'); return; }
  seaClient = createSeaClient({
    url,
    islandId: ISLAND_ID,
    token: ISLAND_TOKEN,
    key: cfg.key || null,
    name: islanderName,
    bundle: islandBundle,
    log: (m) => log(`sea: ${m}`),
  });
}

server.listen(PORT, access.open ? undefined : '127.0.0.1', async () => {
  process.stderr.write(`[settlers] ${config.islandName} is at http://localhost:${PORT}/\n`);
  checkVendor();
  if (access.open) {
    log(`the island is OPEN. Visitors can reach it at:`);
    for (const a of access.addresses()) log(`    http://${a.includes(':') ? `[${a}]` : a}:${PORT}/`);
    log(`    visitors see a ${config.multiplayer.guestView === 'full' ? 'complete' : 'redacted'} island and can walk it;`);
    log(`    tickets, chat and git stay with this computer.`);
    log(`    ${access.invite ? 'From outside your network a key is required.' : 'Nobody outside your own network can get in: no invite code is set.'}`);
    log(`    Windows Firewall will ask about this port the first time.`);
  }
  fs.mkdirSync(DATA, { recursive: true });
  watchData();
  if (neighbours) neighbours.start();
  await rescan('startup');
  // So the island board has the right number of notes pinned to it before anyone walks
  // up to it. refreshIssues throttles itself and hands back the cache untouched when it
  // is still fresh, so this costs one gh call every few minutes and a rescan only when
  // something actually came back.
  const readIssues = async () => {
    const before = loadIssues().fetchedAt;
    const r = await refreshIssues({}).catch(() => null);
    if (r && !r.note && r.fetchedAt && r.fetchedAt !== before) rescan('issues');
  };
  readIssues();
  // Join the world once the first scan has produced an island worth showing.
  await putToSea();
  if (seaClient) seaClient.publish({ force: true }).catch(() => {});
  if (RESCAN) setInterval(() => { readIssues(); rescan('timer'); }, RESCAN).unref?.();
  if (OPEN) openBrowser(`http://localhost:${PORT}/`);
});
