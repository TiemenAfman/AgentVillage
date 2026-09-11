// The picture on the desk display.
//
// A .star applet is a pixlet program: 64 by 32, usually animated, and free to go and
// fetch whatever it means to show. `pixlet render` turns one into a WebP, and a WebP is
// the whole of what the island needs - the thing on the desk is a box of wood with a
// texture on the front of it.
//
// Nothing here reads the applet. It is handed to pixlet as a path and pixlet does the
// rest, which is why the folder is fixed and the name is checked before it is joined on:
// which applet to draw is the only part of this a browser gets to choose, and a name
// that is only letters, digits and dashes cannot climb out of star/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from './paths.mjs';

export const STAR_DIR = path.join(ROOT, 'star');

const NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const TIMEOUT_MS = 20000;
// A panel this size renders to a couple of kilobytes. Anything near this is an applet
// that has misunderstood what it is drawing on.
const MAX_BYTES = 4 * 1024 * 1024;

// pixlet ships as one binary that people drop wherever suits them, so look where it
// usually lands and then walk PATH by hand. Resolving it here rather than handing the
// name to a shell keeps the island's own path - which has a space in it on this machine
// - out of a command line nobody quoted.
export function resolvePixlet(cfg = {}) {
  const candidates = [cfg.pixlet, process.env.PIXLET_EXE].filter(Boolean);
  for (const dir of [path.join(os.homedir(), 'pixlet'), '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin']) {
    candidates.push(path.join(dir, 'pixlet.exe'), path.join(dir, 'pixlet'));
  }
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (dir) for (const ext of exts) candidates.push(path.join(dir, `pixlet${ext}`));
  }
  for (const c of candidates) {
    try { if (fs.statSync(c).isFile()) return c; } catch { /* keep looking */ }
  }
  return null;
}

// What config.json says about the display. Every field is optional: an island with no
// `star` block at all still shows the applet that ships with it.
export function starConfig(config = {}) {
  const s = (config && typeof config.star === 'object' && config.star) || {};
  return {
    pixlet: s.pixlet ? String(s.pixlet) : null,
    app: NAME.test(String(s.app || '')) ? String(s.app) : 'promptholm',
    // How long a rendered frame is worth keeping. An applet that tells the time wants
    // this short; one that draws a logo could keep it for an hour.
    refreshMs: Math.min(3600000, Math.max(2000, Number(s.refreshMs) || 60000)),
  };
}

// star/<name>.star, or star/<name>/ for an applet that comes with its own files.
export function appletPath(name) {
  const n = String(name || '').toLowerCase();
  if (!NAME.test(n)) return null;
  const file = path.join(STAR_DIR, `${n}.star`);
  try { if (fs.statSync(file).isFile()) return file; } catch { /* try the folder */ }
  const dir = path.join(STAR_DIR, n);
  try {
    if (fs.statSync(dir).isDirectory() && fs.readdirSync(dir).some((f) => f.endsWith('.star'))) return dir;
  } catch { /* neither */ }
  return null;
}

export function listApplets() {
  let entries = [];
  try { entries = fs.readdirSync(STAR_DIR, { withFileTypes: true }); } catch { return []; }
  const out = new Set();
  for (const e of entries) {
    const n = e.name.toLowerCase();
    if (e.isFile() && n.endsWith('.star') && NAME.test(n.slice(0, -5))) out.add(n.slice(0, -5));
    else if (e.isDirectory() && NAME.test(n) && appletPath(n)) out.add(n);
  }
  return [...out].sort();
}

// The newest thing in the applet, so saving a file redraws the panel instead of waiting
// out the refresh.
function stampOf(p) {
  try {
    const st = fs.statSync(p);
    if (st.isFile()) return st.mtimeMs;
    let newest = st.mtimeMs;
    for (const f of fs.readdirSync(p)) {
      try { newest = Math.max(newest, fs.statSync(path.join(p, f)).mtimeMs); } catch { /* skip */ }
    }
    return newest;
  } catch { return 0; }
}

const cache = new Map();      // name -> { buf, at, stamp }
const inFlight = new Map();   // name -> the render everyone else is already waiting on

function runPixlet(file, cfg, params) {
  return new Promise((resolve, reject) => {
    const exe = resolvePixlet(cfg);
    if (!exe) {
      reject(new Error('pixlet is not installed, or not where the island looked. Put the binary on PATH, or name it in config.json under star.pixlet.'));
      return;
    }
    const out = path.join(os.tmpdir(), `settlers-star-${process.pid}-${Date.now()}.webp`);
    const args = ['render', file, '-o', out, '--silent'];
    // An applet reads its settings as key=value pairs on the command line. Only plain
    // names get through, because these are arguments to somebody else's program.
    for (const [k, v] of Object.entries(params || {})) {
      if (/^[A-Za-z0-9_]{1,32}$/.test(k)) args.push(`${k}=${String(v).slice(0, 200)}`);
    }
    const child = spawn(exe, args, { windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    const timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } }, TIMEOUT_MS);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`pixlet would not start: ${e.code || e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        try { fs.unlinkSync(out); } catch { /* never written */ }
        const tail = err.trim().split('\n').slice(-3).join(' ').slice(0, 300);
        reject(new Error(tail || `pixlet exited ${code}`));
        return;
      }
      fs.readFile(out, (e, buf) => {
        try { fs.unlinkSync(out); } catch { /* it will keep */ }
        if (e) reject(new Error('pixlet said it worked but left no image behind'));
        else if (buf.length > MAX_BYTES) reject(new Error('that applet rendered far more than a 64x32 panel can hold'));
        else resolve(buf);
      });
    });
  });
}

// The rendered applet, from the cache while it is still fresh and from pixlet when it is
// not. Two pages looking at the same display wait on one render rather than starting two.
export function renderApplet(name, { config = {}, params = {} } = {}) {
  const file = appletPath(name);
  if (!file) return Promise.reject(new Error(`there is no applet called "${name}" in star/`));

  const cfg = starConfig(config);
  const stamp = stampOf(file);
  const hit = cache.get(name);
  if (hit && hit.stamp === stamp && Date.now() - hit.at < cfg.refreshMs) return Promise.resolve(hit);
  if (inFlight.has(name)) return inFlight.get(name);

  const job = runPixlet(file, cfg, params)
    .then((buf) => {
      const rec = { buf, at: Date.now(), stamp };
      cache.set(name, rec);
      return rec;
    })
    .catch((e) => {
      // An applet that has just been broken should not blank the panel: keep showing the
      // last frame that worked, and only pass the error on when there is nothing to show.
      if (hit) return hit;
      throw e;
    });
  inFlight.set(name, job);
  job.finally(() => inFlight.delete(name)).catch(() => { /* the caller has it */ });
  return job;
}
