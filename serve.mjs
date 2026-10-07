#!/usr/bin/env node
// The distillate's islander (Plans/destillaat-eiland.md in the AgentVillage repo): the island's
// own serve.mjs with everything but watching it grow taken out. What is left is the scan on a
// timer, the files the page draws from, the events that tell it the island changed, the
// planner's three routes, and a sea of its own on loopback that walks the settlers - since the
// browser simulates nobody any more, a settler only walks if a sea walks them.
//
// Gone, on purpose: agents, mail, the noticeboards, git, chat, building by hand, the garden,
// the treasure, music and sound files, the HD pack, local models, self-update, the gold pit's
// status line, the story animals, Codex, moving HOME, joining or hosting a sea. Start it
// through start.mjs, which gives it a home of its own before lib/paths.mjs is imported.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { ROOT, DATA, WEB, SHARED, loadConfig, fillConfig, islandNameOf, seaNameOf, nameplatesVisibleTo, readJson, HOME_MISSING, missingHome } from './lib/paths.mjs';
import { readBuildInfo } from './lib/buildinfo.mjs';
import { scan, filesFor } from './scan.mjs';
import { createAccess, isPublicPath } from './lib/access.mjs';
import { buildBundle, beaconId } from './lib/islandbundle.mjs';
import { createSea } from './lib/sea.mjs';
import { createSeaClient, mintToken } from './lib/seaclient.mjs';
import { loadPlacements, savePlacements } from './lib/placements.mjs';
import { parsePlan, isSnapshotName, listSnapshots } from './lib/plan.mjs';
import { buildSurvey } from './lib/survey.mjs';
import { loadLayout } from './lib/layout.mjs';

const BUILD = readBuildInfo(ROOT);
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const argOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

if (HOME_MISSING) {
  process.stderr.write(`[destillaat] ${missingHome()}\n`);
  process.exit(3);
}

fillConfig();
const config = loadConfig();
// Never on the network, whatever the seeded config said: the distillate is single player.
config.network = { ...config.network, public: false };
const PORT = Number(argOf('--port', process.env.PORT || 4848));
const OPEN = has('--open') && !has('--no-open');
const RESCAN = has('--no-rescan') ? 0 : (config.rescanIntervalMs || 60000);
const VILLAGE_FILE = filesFor({}).village;

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
  '.txt': 'text/plain; charset=utf-8',
};

const clients = new Set();
const LOG = path.join(DATA, 'server.log');
function log(line) {
  const msg = `${new Date().toISOString()} ${line}\n`;
  process.stderr.write(msg);
  try {
    fs.mkdirSync(DATA, { recursive: true });
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 2 * 1024 * 1024) fs.renameSync(LOG, `${LOG}.1`);
    fs.appendFileSync(LOG, msg);
  } catch { /* logging must never be the thing that breaks */ }
}

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
  } catch { return []; }
}

// The planner's survey (lib/survey.mjs), baked once per scan - see the island's serve.mjs.
let surveyCache = { key: null, body: null };
function survey() {
  const files = filesFor({});
  let key = null;
  try { key = `${fs.statSync(files.layout).mtimeMs}|${fs.statSync(files.village).mtimeMs}`; } catch { return null; }
  if (surveyCache.key === key) return surveyCache.body;
  const layout = loadLayout(files.layout, config.seed, config.gridSize || 64, { minSize: config.minGridSize });
  const village = readJson(files.village, null);
  const body = buildSurvey({ layout, village, seed: config.seed, size: layout.size });
  surveyCache = { key, body };
  return body;
}

process.on('uncaughtException', (e) => log(`uncaught: ${e && e.stack ? e.stack : e}`));
process.on('unhandledRejection', (e) => log(`rejection: ${e && e.stack ? e.stack : e}`));
function shutdown(why) {
  try { seaClient && seaClient.close(); } catch { /* the line home dies with us regardless */ }
  try { ownSea && ownSea.close(); } catch { /* and so does the sea */ }
  log(`stopping on ${why}`);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt']);
const GZIP_FROM = 1400;
// readFileSync, never a stream: a scan replaces village.json by a synchronous rename, which
// fails with EPERM on Windows while any handle has it open (the island's serve.mjs says more).
function sendFile(req, res, file, { noStore = false } = {}) {
  let buf;
  try { buf = fs.readFileSync(file); } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
  const headers = { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' };
  headers['Cache-Control'] = noStore ? 'no-store' : 'public, max-age=31536000, immutable';
  const send = (body, encoding) => {
    if (encoding) { headers['Content-Encoding'] = encoding; headers['Vary'] = 'Accept-Encoding'; }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(body);
  };
  const wants = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (wants && COMPRESSIBLE.has(path.extname(file).toLowerCase()) && buf.length >= GZIP_FROM) {
    zlib.gzip(buf, (gzErr, packed) => send(gzErr ? buf : packed, gzErr ? null : 'gzip'));
    return;
  }
  send(buf, null);
}

function safeJoin(base, rel) {
  const p = path.normalize(path.join(base, rel));
  return p === base || p.startsWith(base + path.sep) ? p : null;
}

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
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

// One scan at a time, in order; a scan with opts (a plan) always runs as its own job, plain
// rescans coalesce - the island's serve.mjs has the history of why.
let chain = Promise.resolve();
let busy = 0;
let plainWaiting = null;
function exclusive(fn) {
  busy++;
  const run = chain.then(fn, fn).finally(() => { busy--; });
  chain = run.catch(() => {});
  return run;
}
async function rescan(reason, opts = {}) {
  const job = async () => {
    try { return await scan({ quiet: true, ...opts }); } catch (e) {
      process.stderr.write(`[destillaat] rescan failed (${reason}): ${e && e.message}\n`);
      return null;
    }
  };
  let run;
  if (Object.keys(opts).length) run = exclusive(job);
  else {
    if (plainWaiting) return plainWaiting;
    const w = exclusive(() => { if (plainWaiting === w) plainWaiting = null; return job(); });
    plainWaiting = w;
    run = w;
  }
  const r = await run;
  if (seaClient) seaClient.publish().catch(() => {});
  return r;
}
async function scanNow(opts) {
  let r = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    r = await exclusive(() => scan({ quiet: true, ...opts }));
    if (!r || !r.skipped) return r;
    await new Promise((done) => setTimeout(done, 400));
  }
  return r;
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    log(`request failed ${req.method} ${req.url}: ${e && e.stack ? e.stack : e}`);
    try { if (!res.headersSent) json(res, 500, { error: 'the island stumbled on that one' }); else res.end(); } catch { /* client gone */ }
  });
});

// The planner is a write route, so the island's three checks stay: a loopback socket, a known
// Host and a matching Origin (lib/access.mjs).
const access = createAccess({ port: PORT, config });
const islanderName = config.multiplayer.name || (() => {
  try { return os.userInfo().username; } catch { return os.hostname(); }
})();

async function handle(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = decodeURIComponent(url.pathname);
  const who = access.classify(req, url);
  if (who.role === 'refused') return json(res, 403, { error: 'the island only answers this computer' });
  if (who.role !== 'islander' && !isPublicPath(p)) return json(res, 403, { error: 'only the keeper of the island can do that' });

  if (p === '/api/hello') {
    return json(res, 200, {
      role: who.role,
      islandName: islandNameOf(config),
      multiplayer: { enabled: true, maxPlayers: 1, tickMs: config.multiplayer.tickMs },
      signs: nameplatesVisibleTo(config.display.nameplates, who.role),
      display: { nameplates: config.display.nameplates },
      islandId: ISLAND_ID,
      sea: seaUrlFor(req),
      seaMode: 'single',
      seaOpen: false,
      seaHost: false,
      token: ISLAND_TOKEN,
      seaKey: null,
      build: BUILD,
      distill: true,
    });
  }

  if (p === '/api/vendor') return json(res, 200, { missing: missingVendor() });

  if (p === '/api/log' && req.method === 'POST') {
    let body = {};
    try { body = await readBody(req, 16 * 1024); } catch { /* keep going */ }
    log(`page: ${String(body.message || '').slice(0, 500)}${body.stack ? ` | ${String(body.stack).slice(0, 800)}` : ''}`);
    return json(res, 200, { ok: true });
  }

  if (p === '/events') {
    if (clients.size >= 16) return json(res, 503, { error: 'too many open islands' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\nevent: hello\ndata: {}\n\n');
    const client = { res, local: true };
    clients.add(client);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
    req.on('close', () => { clearInterval(ping); clients.delete(client); });
    return;
  }

  if (p === '/api/reload' && req.method === 'POST') {
    broadcast({ at: Date.now() }, 'reload');
    return json(res, 200, { ok: true, islands: clients.size });
  }

  if (p === '/api/rescan' && req.method === 'POST') {
    if (busy) return json(res, 200, { skipped: true });
    json(res, 202, { started: true });
    rescan('api');
    return;
  }

  if (p === '/village.json') return sendFile(req, res, VILLAGE_FILE, { noStore: true });

  // Where the renderer put things, which only a browser knows; the sea stands settlers by it.
  if (p === '/api/placements' && req.method === 'POST') {
    let body;
    try { body = await readBody(req, 1024 * 1024); } catch (e) { return json(res, 400, { error: String(e.message || e) }); }
    let saved;
    try { saved = savePlacements(body); } catch (e) { return json(res, 500, { error: String(e.message || e) }); }
    if (seaClient) seaClient.publish().catch(() => {});
    return json(res, 200, { ok: true, buildings: Object.keys(saved.at).length, decks: Object.keys(saved.decks).length });
  }

  // ---- the planner (lib/plan.mjs): the one door through which the layout moves by hand.
  if (p === '/api/plan' && req.method === 'GET') {
    const files = filesFor({});
    const layout = readJson(files.layout, null);
    return json(res, 200, {
      zones: (layout && layout.zones) || [], lattice: (layout && layout.lattice) || null,
      snapshots: listSnapshots(files.layout), busy: busy > 0,
    });
  }
  if (p === '/api/plan/survey' && req.method === 'GET') {
    const out = survey();
    if (!out) return json(res, 503, { error: 'no island to survey yet' });
    return json(res, 200, out);
  }
  if (p === '/api/plan' && req.method === 'POST') {
    let body;
    try { body = await readBody(req, 256 * 1024); } catch (e) { return json(res, 400, { ok: false, error: String(e.message || e) }); }
    let plan;
    try { plan = parsePlan(body); } catch (e) { return json(res, 400, { ok: false, error: String(e.message || e) }); }
    const dryRun = !!(body && body.dryRun);
    let r;
    try { r = await scanNow({ plan, dryRun }); } catch (e) {
      log(`plan refused: ${e && e.message}`);
      return json(res, 400, { ok: false, error: String(e.message || e) });
    }
    if (!r || r.skipped) return json(res, 423, { ok: false, error: 'scanning', detail: r && r.reason });
    const out = r.plan;
    if (!out) return json(res, 500, { ok: false, error: 'the scan ran but carried no plan' });
    if (!out.ok) return json(res, dryRun ? 200 : 409, out);
    if (!dryRun) {
      log(`plan applied: ${plan.ops.length} op(s), ${out.diff.plots.moved.length} plot(s) moved, snapshot ${out.snapshot}`);
      broadcast({ at: Date.now(), ops: plan.ops.length, snapshot: out.snapshot }, 'plan');
      if (seaClient) seaClient.publish().catch(() => {});
    }
    return json(res, 200, out);
  }
  if (p === '/api/plan/undo' && req.method === 'POST') {
    let body;
    try { body = await readBody(req, 4 * 1024); } catch (e) { return json(res, 400, { ok: false, error: String(e.message || e) }); }
    const name = body && body.snapshot;
    if (!isSnapshotName(name)) return json(res, 400, { ok: false, error: 'that is not a snapshot' });
    const files = filesFor({});
    const dir = path.dirname(files.layout);
    const from = path.join(dir, name);
    if (!fs.existsSync(from)) return json(res, 404, { ok: false, error: 'no such snapshot' });
    let r;
    try {
      r = await exclusive(async () => {
        const was = readJson(files.layout, null);
        if (fs.existsSync(files.layout)) fs.copyFileSync(files.layout, path.join(dir, `layout.before-undo-${Date.now()}.json`));
        fs.copyFileSync(from, files.layout);
        const scanned = await scan({ quiet: true });
        const now = readJson(files.layout, null);
        const replaced = was && now
          ? Object.keys(was.plots).filter((id) => now.plots[id] && (was.plots[id].gx !== now.plots[id].gx || was.plots[id].gz !== now.plots[id].gz))
          : [];
        return { scanned, replaced };
      });
    } catch (e) { return json(res, 500, { ok: false, error: String(e.message || e) }); }
    if (!r.scanned || r.scanned.skipped) return json(res, 423, { ok: false, error: 'scanning' });
    log(`plan undone: ${name} restored, ${r.replaced.length} plot(s) placed again`);
    if (seaClient) seaClient.publish().catch(() => {});
    return json(res, 200, { ok: true, restored: name, replaced: r.replaced });
  }

  // Who the sea's roster means, in this island's own names (the inverse of the redaction).
  if (p === '/api/crowd-ids' && req.method === 'GET') {
    if (!Object.keys(crowdIds).length) islandBundle();
    return json(res, 200, { ids: crowdIds });
  }

  if (p.startsWith('/shared/')) {
    const f = safeJoin(SHARED, p.slice('/shared/'.length));
    if (f) return sendFile(req, res, f, { noStore: true });
  }

  const rel = p === '/' ? 'index.html' : p.replace(/^\//, '');
  const f = safeJoin(WEB, rel);
  if (!f) { res.writeHead(400); res.end('Bad path'); return; }
  sendFile(req, res, f, { noStore: !rel.startsWith('vendor/') && !rel.startsWith('icons/') });
}

function broadcast(payload, event = 'update') {
  const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const c of clients) { try { c.res.write(msg); } catch { clients.delete(c); } }
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
    process.stderr.write(`[destillaat] already being served at http://localhost:${PORT}\n`);
    if (OPEN) openBrowser(`http://localhost:${PORT}/`);
    process.exit(0);
  }
  log(`server error: ${e && e.stack ? e.stack : e}`);
});

function openBrowser(url) {
  try { spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { /* open it yourself */ }
}

// ---- the sea: our own, on loopback, with nobody but us in it.
//
// No volcano and no starters: the page draws no other island, so the sea walks our crowd and
// keeps the clock and the weather, and with no volcano at [0, 0] our island holds the origin
// itself, so the page needs no translation of the world at all.
const ISLAND_ID = beaconId(PORT);
const TOKEN_FILE = path.join(DATA, 'sea-token.json');
function keptToken() {
  const kept = readJson(TOKEN_FILE, null) || {};
  if (typeof kept.home === 'string' && /^[0-9a-f]{48}$/.test(kept.home)) return kept.home;
  const token = mintToken();
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(TOKEN_FILE, JSON.stringify({ ...kept, home: token }, null, 2)); } catch { /* this process still holds it */ }
  return token;
}
const ISLAND_TOKEN = keptToken();
let ownSea = null;
let seaClient = null;
let crowdIds = {};

function islandBundle() {
  const village = readJson(VILLAGE_FILE, null);
  if (!village) return null;
  const named = {};
  try {
    const bundle = buildBundle({
      config, village, props: [], crops: [],
      placements: loadPlacements(), id: ISLAND_ID, keeper: islanderName,
    }, named);
    crowdIds = named.ids || {};
    return bundle;
  } catch {
    return null;   // never scanned yet: no terrain hash, nothing to publish
  }
}

function seaUrlFor(req) {
  if (!ownSea) return null;
  const port = (ownSea.address() || {}).port;
  if (!port) return null;
  const host = String(req.headers.host || '').trim();
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  return `http://${name || 'localhost'}:${port}/`;
}

async function putToSea() {
  // Any free port: the live island's own sea may well be on 4750 beside us.
  ownSea = createSea({
    port: 0,
    host: '127.0.0.1',
    name: seaNameOf(config),
    build: BUILD,
    tickMs: config.multiplayer.tickMs,
    maxPlayers: 4,
    volcano: false,
    starters: false,
    log: (m) => log(`sea: ${m}`),
  });
  const addr = await ownSea.listen();
  seaClient = createSeaClient({
    url: `http://127.0.0.1:${addr.port}/`,
    islandId: ISLAND_ID,
    token: ISLAND_TOKEN,
    key: null,
    name: islanderName,
    bundle: islandBundle,
    codex: () => null,
    animals: () => null,
    log: (m) => log(`sea: ${m}`),
  });
}

server.listen(PORT, '127.0.0.1', async () => {
  process.stderr.write(`[destillaat] ${islandNameOf(config)} is at http://localhost:${PORT}/\n`);
  const missing = missingVendor();
  if (missing.length) log(`web/vendor is missing ${missing.join(', ')} - run: npm install`);
  fs.mkdirSync(DATA, { recursive: true });
  watchData();
  await rescan('startup');
  await putToSea();
  if (seaClient) seaClient.publish({ force: true }).catch(() => {});
  if (RESCAN) setInterval(() => rescan('timer'), RESCAN).unref?.();
  if (OPEN) openBrowser(`http://localhost:${PORT}/`);
});
