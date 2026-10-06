// Moving the island to a folder of the keeper's choosing (Settings, *Move…*;
// Plans/eiland-op-eigen-schijf.md). What it does, in this order, and why the order:
//
//   1. judge the target (`checkTarget`): empty or not there yet, not inside the island it
//      comes from, not in a git checkout (a worktree is a sandbox with an island of its own,
//      and a home in one would become one), not in AppData (Claude desktop's MSIX package
//      redirects every write there, Plans/DONE/een-thuis-voor-het-eiland.md), not on top of
//      ~/.promptholm, and on a drive with room for it;
//   2. copy everything the island is (`copyHome`) - config, data, the HD pack, the keeper's
//      models and music, characters - but no log being written to, no lock naming this
//      process and no half-written file, as settleHome leaves them behind;
//   3. compare every file it copied (`verifyCopy`). A scan or a journal entry that landed
//      during the copy shows up here, and the move is called off rather than leaving that
//      write behind in the old folder;
//   4. only then write ~/.promptholm/home.txt (`writePointer`), by rename, so a reader sees
//      the old pointer or the new one and never half of one.
//
// The old folder is left as it was, with a MOVED.txt in it; throwing it away is the keeper's.
// No import from lib/paths.mjs: importing that decides HOME, and this module has to be usable
// on two folders handed to it, which is what lets tests/home-move.test.mjs run on scratch ones.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// What a move leaves behind: the same rule as settleHome's (lib/paths.mjs moveIn), plus the
// two files that belong to ~/.promptholm itself rather than to the island.
const LEFT_BEHIND = /^(server\.log(\.\d+)?|hook\.log(\.\d+)?|.*\.lock|.*\.tmp|MOVED\.txt|home\.txt|checkout\.txt)$/i;

const lower = (p) => path.resolve(p).toLowerCase();
function inside(child, parent) {
  const r = path.relative(lower(parent), lower(child));
  return r === '' || (!!r && !r.startsWith('..') && !path.isAbsolute(r));
}

// The folder as it really is, through any junction on the way (a home that is itself a
// junction, like the keeper's ~/.promptholm on 2 October 2026). Falls back to the nearest
// parent that exists, for a target that has not been made yet.
function real(p) {
  let at = path.resolve(p);
  const rest = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(at), ...rest.reverse()); } catch { /* not there yet */ }
    const up = path.dirname(at);
    if (up === at) return path.resolve(p);
    rest.push(path.basename(at));
    at = up;
  }
}

function gitAbove(dir) {
  for (let at = path.resolve(dir); ; at = path.dirname(at)) {
    if (fs.existsSync(path.join(at, '.git'))) return at;
    if (path.dirname(at) === at) return null;
  }
}

// How much a move would copy, in bytes, following what copyHome follows.
export function sizeOf(from) {
  let bytes = 0;
  walk(from, (rel, st) => { if (st.isFile()) bytes += st.size; });
  return bytes;
}

// Throws with a sentence a keeper can act on; returns the resolved target when it may be used.
export function checkTarget(to, { from, shared, appdata = [] }) {
  const raw = String(to == null ? '' : to).trim();
  if (!raw || !path.isAbsolute(raw)) throw new Error('the new folder has to be a whole path, like D:\\Promptholm');
  const target = path.resolve(raw);
  const there = real(target), here = real(from), stub = real(shared);
  if (inside(there, here) || inside(here, there)) throw new Error('the new folder cannot be inside the island, or the island inside it');
  if (inside(there, stub) || inside(stub, there)) throw new Error(`${shared} is where the pointer to the island lives; pick a folder outside it`);
  for (const a of appdata) {
    if (a && inside(there, real(a))) throw new Error('not in AppData: the Claude desktop app keeps its own copy of everything written there');
  }
  const git = gitAbove(target);
  if (git) throw new Error(`that folder is inside the git checkout ${git}; pick one outside any repository`);
  const root = path.parse(target).root;
  if (!fs.existsSync(root)) throw new Error(`there is no drive ${root} on this computer`);
  if (fs.existsSync(target)) {
    if (!fs.statSync(target).isDirectory()) throw new Error('that is a file, not a folder');
    if (fs.readdirSync(target).length) throw new Error('that folder is not empty; pick an empty or a new one');
  }
  if (typeof fs.statfsSync === 'function') {
    try {
      const fsStat = fs.statfsSync(root);
      const free = Number(fsStat.bavail) * Number(fsStat.bsize);
      const need = sizeOf(from);
      if (Number.isFinite(free) && free < need * 1.1 + 64 * 1024 * 1024) {
        throw new Error(`there is not enough room on ${root}: the island is ${mb(need)} and ${mb(free)} is free`);
      }
    } catch (e) { if (/not enough room/.test(e.message)) throw e; /* no answer about the drive: try anyway */ }
  }
  return target;
}

const mb = (n) => `${Math.round(n / 1048576)} MB`;

// Every entry under `dir` with its path relative to it, depth first; a junction or a symlink
// is reported and not walked into (`link`).
function walk(dir, visit, rel = '') {
  let names;
  try { names = fs.readdirSync(path.join(dir, rel)); } catch { return; }
  for (const name of names.sort()) {
    const r = rel ? path.join(rel, name) : name;
    if (LEFT_BEHIND.test(name)) continue;
    let st;
    try { st = fs.lstatSync(path.join(dir, r)); } catch { continue; }
    if (st.isSymbolicLink()) { visit(r, st, true); continue; }
    visit(r, st, false);
    if (st.isDirectory()) walk(dir, visit, r);
  }
}

// Copies the island. A junction (an HD pack kept on another drive, say) is made again as a
// junction to the same place, not copied through: what it points at is not the island's.
export function copyHome(from, to) {
  fs.mkdirSync(to, { recursive: true });
  let files = 0, bytes = 0;
  const copied = [];
  walk(from, (rel, st, link) => {
    const src = path.join(from, rel), dst = path.join(to, rel);
    if (link) {
      const target = fs.readlinkSync(src);
      fs.symlinkSync(path.resolve(path.dirname(src), target), dst, 'junction');
      return;
    }
    if (st.isDirectory()) { fs.mkdirSync(dst, { recursive: true }); return; }
    if (!st.isFile()) return;
    fs.copyFileSync(src, dst);
    try { fs.utimesSync(dst, st.atime, st.mtime); } catch { /* the time is a courtesy */ }
    files++; bytes += st.size; copied.push(rel);
  });
  return { files, bytes, copied };
}

const hashOf = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');

// Every file copied against its original: what differs or went missing. Empty is a good copy.
export function verifyCopy(from, to, copied) {
  const bad = [];
  for (const rel of copied) {
    try {
      if (hashOf(path.join(from, rel)) !== hashOf(path.join(to, rel))) bad.push(rel);
    } catch { bad.push(rel); }
  }
  return bad;
}

export function writePointer(shared, to) {
  fs.mkdirSync(shared, { recursive: true });
  const file = path.join(shared, 'home.txt');
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${path.resolve(to)}\n`);
  fs.renameSync(tmp, file);
  return file;
}

// The whole move. Returns what it did; throws, with nothing pointed anywhere new, when any
// step fails. A copy that failed is left in the target for the keeper to look at - it is
// never read, since no pointer names it.
export function moveHome({ from, to, shared, appdata = [], now = new Date() }) {
  const target = checkTarget(to, { from, shared, appdata });
  if (!fs.existsSync(path.join(from, 'config.json'))) throw new Error(`there is no island at ${from} to move`);
  const { files, bytes, copied } = copyHome(from, target);
  const bad = verifyCopy(from, target, copied);
  if (bad.length) {
    throw new Error(`the copy differs from the island in ${bad.length} file(s) (${bad.slice(0, 3).join(', ')}): `
      + 'something wrote while it was being copied. Nothing has moved; try again.');
  }
  const pointer = writePointer(shared, target);
  try {
    fs.writeFileSync(path.join(from, 'MOVED.txt'),
      `This island moved to ${target} on ${now.toISOString()}.\n`
      + `What is here is the copy it was moved from; nothing reads it any more, and it may be thrown away.\n`);
  } catch { /* a note, not a requirement */ }
  return { from: path.resolve(from), to: target, files, bytes, pointer };
}
