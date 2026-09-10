#!/usr/bin/env node
// Serves the island and keeps it up to date: a rescan on a timer (which is how Cowork
// tasks are noticed) and a server-sent-events stream so an open page updates itself.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, DATA, WEB, SHARED, loadConfig, setFounder, readJson } from './lib/paths.mjs';
import { scan, filesFor } from './scan.mjs';
import { refreshSprint, loadSprint, readAssignments, jiraConfig } from './lib/sprint.mjs';
import { dispatch, agentLogTail, newcomer, found, liveAgents, stopAllAgents } from './lib/dispatch.mjs';
import { banish, unbanish } from './lib/banish.mjs';
import { readTranscript, talk } from './lib/chat.mjs';
import { listProps, addProp, removeProp, clearProps } from './lib/props.mjs';
import { rememberPlayer, whereIsPlayer } from './lib/player.mjs';
import { think } from './lib/think.mjs';
import { overview, fileDiff, commitDetail, commitDiff, fetch as gitFetch, gitTools, openIn, isRepo, branches as gitBranches, merge as gitMerge } from './lib/git.mjs';
import { catalog } from './lib/catalog.mjs';
import { createAccess, isPublicPath, KEY_COOKIE } from './lib/access.mjs';
import { createWsServer } from './lib/ws.mjs';
import { createRoster } from './lib/players.mjs';
import { createNeighbours } from './lib/neighbours.mjs';
import { guestVillage } from './lib/guestview.mjs';
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
const PORT = Number(argOf('--port', config.port || 4747));
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

// A bad request must never take the island down.
process.on('uncaughtException', (e) => log(`uncaught: ${e && e.stack ? e.stack : e}`));
process.on('unhandledRejection', (e) => log(`rejection: ${e && e.stack ? e.stack : e}`));
function shutdown(why) {
  try { ws && ws.close(); } catch { /* the sockets go with the process anyway */ }
  try { neighbours && neighbours.stop(); } catch { /* the beacon dies with us regardless */ }
  const stopped = stopAllAgents();
  const tail = stopped.length ? `, stopping ${stopped.length} agent(s): ${stopped.join(', ')}` : '';
  log(`stopping on ${why}${tail}`);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

function sendFile(res, file, { noStore = false, cache = null } = {}) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    const headers = { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' };
    // three.js is pinned by package.json and never changes under the same name, so let
    // the browser keep it instead of re-downloading 1.2 MB on every open.
    headers['Cache-Control'] = cache || (noStore ? 'no-store' : 'public, max-age=31536000, immutable');
    res.writeHead(200, headers);
    res.end(buf);
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

// Everywhere Claude has been used on this machine, newest first, with a note about
// which of them carry the Jira workflow skill.
function projectFolders() {
  const out = new Map();
  const add = (dir, source) => {
    if (!dir) return;
    const clean = path.resolve(String(dir));
    const key = clean.toLowerCase();
    if (out.has(key)) return;
    if (clean === path.parse(clean).root) return;   // a drive root is nobody's project
    let ok = false;
    try { ok = fs.statSync(clean).isDirectory(); } catch { ok = false; }
    if (!ok) return;
    let jira = false;
    try { jira = fs.statSync(path.join(clean, '.claude', 'skills', 'jira-ticket-oppakken', 'SKILL.md')).isFile(); } catch { jira = false; }
    out.set(key, { path: clean, name: path.basename(clean), jira, source, worktree: /[\\/]worktrees?[\\/]|[\\/]_wt[\\/]/i.test(clean) });
  };

  const village = readJson(VILLAGE_FILE, null);
  for (const d of (village && village.districts) || []) add(d.root, 'island');
  const global = readJson(path.join(os.homedir(), '.claude.json'), null);
  for (const dir of Object.keys((global && global.projects) || {})) add(dir, 'claude');

  return [...out.values()].sort((a, b) => {
    if (a.jira !== b.jira) return a.jira ? -1 : 1;          // repos that know the workflow first
    if (a.worktree !== b.worktree) return a.worktree ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
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

// Everyone who opens the page gets a body to walk around in. The upgrade event is a
// second front door - handle() below never sees it - so the same classification has to
// be made again here, by hand, or the socket would be the way around the whole gate.
const roster = createRoster({ maxPlayers: config.multiplayer.maxPlayers, log });
const whoFor = (req) => {
  try { return access.classify(req, new URL(req.url, `http://localhost:${PORT}`)); } catch { return { role: 'refused' }; }
};
const ws = config.multiplayer.enabled ? createWsServer(server, {
  path: '/ws',
  maxSockets: Math.max(8, Number(config.multiplayer.maxPlayers || 16) * 2),
  isAllowed: (req) => whoFor(req).role !== 'refused',
  onOpen: (conn, req) => roster.attach(conn, { keeper: whoFor(req).role === 'islander' }),
  onMessage: (conn, text) => roster.message(conn, text),
  onClose: (conn) => roster.detach(conn),
  log,
}) : null;
if (ws) setInterval(() => roster.tick(), Math.max(33, Number(config.multiplayer.tickMs) || 66)).unref?.();

// Who else is out there. Only the keeper is told: a list of the other machines on your
// network is not a visitor's to read, so the event goes to local listeners only.
const islanderName = config.multiplayer.name || (() => {
  try { return os.userInfo().username; } catch { return os.hostname(); }
})();
const neighbours = config.multiplayer.discovery ? createNeighbours({
  port: PORT,
  name: islanderName,
  islandName: config.islandName,
  seed: config.seed,
  gridSize: config.gridSize,
  settlers: () => {
    const v = readJson(VILLAGE_FILE, null);
    return (v && v.buildings ? v.buildings.filter((b) => b.kind !== 'civic').length : 0);
  },
  log,
  onChange: (list) => broadcast({ neighbours: list }, 'neighbours', { localOnly: true }),
}) : null;

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
    });
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
      sendFile(res, VILLAGE_FILE, { noStore: true });
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
      assignments: readAssignments().slice(0, 60),
    });
  }

  // The folders a newcomer could be sent to work in: every project this machine has
  // seen Claude used in, plus the districts already on the island.
  if (p === '/api/folders') return json(res, 200, { folders: projectFolders() });

  if (p === '/api/agents') return json(res, 200, { agents: liveAgents() });

  if (p === '/api/neighbours') {
    return json(res, 200, { me: neighbours ? neighbours.me() : null, neighbours: neighbours ? neighbours.list() : [] });
  }

  // Hands a card to a settler and starts the agent that works it.
  if (p === '/api/assign' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return json(res, 400, { error: String(e.message || e) }); }
    const { issueKey, buildingId, cwd, model, dryRun } = body || {};
    if (!issueKey) return json(res, 400, { error: 'issueKey is required' });
    if (!buildingId && !cwd) return json(res, 400, { error: 'name a settler or a folder for a newcomer' });

    const sprint = loadSprint();
    const issue = (sprint.issues || []).find((i) => i.key === issueKey);
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

    try {
      const r = dispatch({ issue, settler, cwd: settler.cwd, dryRun: !!dryRun });
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
      return json(res, 200, { ok: true, cleared });
    }
    const removed = removeProp(String(body.id || ''));
    if (removed) {
      log(`took away the ${removed.kind} at ${removed.x}, ${removed.z}`);
      broadcast({ at: Date.now(), id: removed.id }, 'props');
    }
    return json(res, 200, { ok: true, removed });
  }

  // ---- a thought, had while standing somewhere ---------------------------------
  // Starts a session in this very repository and streams what it says back, the same
  // way /api/say does for a settler. It is told where you are standing, which is what
  // lets it act on "here".
  if (p === '/api/think' && req.method === 'POST') {
    let body;
    try { body = await readBody(req, 64 * 1024); } catch (e) { return json(res, 400, { error: String(e.message || e) }); }
    const { text, sessionId, at, model } = body || {};

    // Whatever the page says it knows about where you are is worth writing down, so
    // the command line agrees with the prompt even if you have not moved in a while.
    if (at && Number.isFinite(Number(at.x))) rememberPlayer({ ...at, walking: true }, { force: true });

    let started;
    try { started = think({ text, at: whereIsPlayer(), sessionId, model }); }
    catch (e) { return json(res, 400, { error: String(e.message || e) }); }

    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // The page needs the session id to carry the next thought on, and the stream's own
    // init line does not always arrive first. Say it before anything else.
    res.write(`${JSON.stringify({ type: 'settlers_thought', sessionId: started.sessionId, resumed: started.resumed })}\n`);
    log(`thought ${started.resumed ? 'continued' : 'started'} ${started.sessionId}: ${String(text).replace(/\s+/g, ' ').slice(0, 120)}`);

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
        log(`thought ${started.sessionId} exited ${code}: ${stderr.slice(0, 400)}`);
        try { res.write(JSON.stringify({ type: 'settlers_error', error: stderr.trim().slice(0, 400) || `claude exited with ${code}` }) + '\n'); } catch { /* gone */ }
      }
      try { res.end(); } catch { /* gone */ }
    });
    req.on('close', () => { if (!child.killed) child.kill(); });
    return;
  }

  if (p === '/api/agent-log') {
    const file = url.searchParams.get('file') || '';
    const safe = path.normalize(file).startsWith(path.join(DATA, 'agents'));
    if (!safe) return json(res, 400, { error: 'not an agent log' });
    return json(res, 200, { tail: agentLogTail(file) });
  }

  if (p.startsWith('/shared/')) {
    const f = safeJoin(SHARED, p.slice('/shared/'.length));
    if (f) return sendFile(res, f, { noStore: true });   // our own code: never cached
  }

  // The service worker wants revalidation rather than no-store: browsers refuse to
  // register a worker they were told never to keep at all.
  if (p === '/sw.js') return sendFile(res, path.join(WEB, 'sw.js'), { cache: 'no-cache' });

  const rel = p === '/' ? 'index.html' : p.replace(/^\//, '');
  const f = safeJoin(WEB, rel);
  if (!f) { res.writeHead(400); res.end('Bad path'); return; }
  sendFile(res, f, { noStore: !rel.startsWith('vendor/') && !rel.startsWith('icons/') });
}

function broadcast(payload, event = 'update', { localOnly = false } = {}) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const c of clients) {
    if (localOnly && !c.local) continue;
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
server.listen(PORT, access.open ? undefined : '127.0.0.1', async () => {
  process.stderr.write(`[settlers] ${config.islandName} is at http://localhost:${PORT}/\n`);
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
  if (RESCAN) setInterval(() => rescan('timer'), RESCAN).unref?.();
  if (OPEN) openBrowser(`http://localhost:${PORT}/`);
});
