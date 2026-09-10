// Which project a session belongs to. A cwd is not a project: `D:\git\Sybolt_PLC`,
// `...\TrayMagazijn` and `...\_Scam\SCM_TrayFill_Coordinator` are three folders and one
// piece of work. So we walk up to the repository the folder lives in, and then fold the
// leftovers together with the rules in `foldKeys` below.
//
// Two things make this delicate. The walk touches the disk, and a scan asks about
// hundreds of cwds - so every answer is cached. And a folder can be renamed or deleted
// long after its sessions are over (`D:\git\PlcLabNet` already is), so a cached answer
// that once said "repo" is never asked again: a hamlet that loses its folder keeps its
// name rather than quietly becoming a different place.
import fs from 'node:fs';
import path from 'node:path';
import { cwdKey, prettyPath, isWorktreeCwd } from './sources.mjs';

const MAX_WALK = 40;                          // deeper than any real checkout
const RECHECK_NONE_MS = 6 * 60 * 60 * 1000;   // a folder can gain a .git later

// Folder names that say nothing about the project, so the parent comes along on the sign.
const GENERIC = new Set(['src', 'source', 'app', 'code', 'lib', 'main', 'trunk', 'repo', 'project', 'packages', 'test', 'tests']);

function statSafe(f) {
  try { return fs.statSync(f, { throwIfNoEntry: false }) || null; } catch { return null; }
}

// A `.git` file instead of a directory points somewhere else: a linked worktree, or a
// submodule inside its superproject. The pointer is often relative - a submodule writes
// `gitdir: ../.git/modules/<name>` - so it is resolved against the folder it sits in,
// or you end up with a project called `..`.
function readGitdir(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8').slice(0, 1024); } catch { return null; }
  const m = /^gitdir:\s*(.+)$/m.exec(text);
  if (!m) return null;
  const raw = m[1].trim().replace(/\//g, '\\');
  const abs = path.isAbsolute(raw) ? raw : path.resolve(path.dirname(file), raw);
  return abs.replace(/\//g, '\\');
}

function fromGitdir(gitdir) {
  const wt = /^(.*?)\\\.git\\worktrees\\([^\\]+)/i.exec(gitdir);
  if (wt) return { root: wt[1], kind: 'worktree', worktree: wt[2] };
  const sub = /^(.*?)\\\.git\\modules\\/i.exec(gitdir);
  if (sub) return { root: sub[1], kind: 'repo', worktree: null };   // a submodule is one project
  return null;
}

// The repository a path belongs to, walking up. Case is taken from the path as given,
// because the folder name is what ends up on the hamlet's sign.
function findRoot(raw, { submodules = 'fold' } = {}) {
  let cur = String(raw).replace(/\//g, '\\').replace(/\\+$/, '');
  for (let i = 0; i < MAX_WALK && cur; i++) {
    const st = statSafe(path.join(cur, '.git'));
    if (st && st.isDirectory()) return { root: cur, kind: 'repo', worktree: null };
    if (st && st.isFile()) {
      const g = readGitdir(path.join(cur, '.git'));
      const from = g && fromGitdir(g);
      if (from && (from.kind === 'worktree' || submodules === 'fold')) return from;
      return { root: cur, kind: 'repo', worktree: null };
    }
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return null;
}

export function createRepoResolver({ cache = null, now = Date.now(), config = {} } = {}) {
  const store = cache ? (cache.repoRoots = cache.repoRoots || {}) : {};
  const memo = new Map();
  const stats = { hits: 0, walks: 0 };
  const submodules = config.submodules || 'fold';

  function resolve(cwd) {
    if (!cwd) return { key: '', root: '', kind: 'none', worktree: null };
    const key = cwdKey(cwd);
    if (memo.has(key)) return memo.get(key);

    // The `.claude/worktrees/<name>` convention first: those folders hold a real .git
    // file, which the walk above would otherwise resolve to the worktree itself.
    const conv = isWorktreeCwd(cwd);
    if (conv) {
      const out = { ...resolve(conv.parent), worktree: conv.name };
      memo.set(key, out);
      return out;
    }

    // A cwd that *is* a git directory belongs to the checkout around it.
    const stripped = /^(.*?)[\\/]\.git(?:[\\/]|$)/i.exec(String(cwd));
    if (stripped && stripped[1]) {
      const out = resolve(stripped[1]);
      memo.set(key, out);
      return out;
    }

    const hit = store[key];
    if (hit && (hit.kind !== 'none' || now - (hit.at || 0) < RECHECK_NONE_MS)) {
      stats.hits++;
      const out = { key: cwdKey(hit.root), root: hit.root, kind: hit.kind, worktree: hit.wt || null };
      memo.set(key, out);
      return out;
    }

    stats.walks++;
    const found = findRoot(cwd, { submodules });
    const rec = found
      ? { root: found.root, kind: found.kind, wt: found.worktree || null, at: now }
      : { root: prettyPath(cwd), kind: 'none', wt: null, at: now };
    store[key] = rec;
    const out = { key: cwdKey(rec.root), root: rec.root, kind: rec.kind, worktree: rec.wt };
    memo.set(key, out);
    return out;
  }

  return { resolve, stats };
}

// ---- folding the leftovers ---------------------------------------------------
// Walking up to a `.git` is not enough, because plenty of real projects have none.
// `D:\git\plclab` has no repository but `D:\git\plclab\src` does; `...\HomeAssistant`
// and `...\HomeAssistant\tools` have neither. These rules put such folders together.
//
// The guard that matters is `container`: a folder holding two or more separate projects
// is a region, not a hamlet, and it never absorbs its children. Without it `D:\git\Martijn`
// - which is not a repository - swallows Claude, HomeAssistant, WhatsappBot, telegram,
// Artemis and four others into one meaningless block of sixty houses.
//
// `entries` maps a lowercased key to `{ kind }`. The result maps every key to the key it
// belongs to, or to null for "this is not a project" (which becomes the hinterland).
export function foldKeys(entries, { noProject = new Set() } = {}) {
  const keys = [...entries.keys()];
  const kindOf = (k) => (entries.get(k) || {}).kind || 'none';
  const isRepo = (k) => kindOf(k) === 'repo' || kindOf(k) === 'worktree';
  const under = (a, b) => a !== b && b !== '' && a.startsWith(b + '\\');
  const depthBelow = (a, b) => a.slice(b.length + 1).split('\\').length;

  // How many distinct child projects sit below a plain folder.
  const childSegs = new Map();
  for (const f of keys) {
    if (isRepo(f)) continue;
    const segs = new Set();
    for (const k of keys) if (under(k, f)) segs.add(k.slice(f.length + 1).split('\\')[0]);
    childSegs.set(f, segs);
  }
  const container = (f) => (childSegs.get(f) || new Set()).size >= 2;

  // A repository is a project wherever it lives, so R1 is settled before we start
  // calling folders junk - otherwise a checkout under `Downloads` would be disowned.
  const junk = (f) => !isRepo(f) && (noProject.has(f) || isShelfPath(f));

  const step = new Map();
  for (const f of keys) {
    if (isRepo(f)) { step.set(f, f); continue; }                         // R1
    if (junk(f)) { step.set(f, null); continue; }                        // not a project at all

    // R2: exactly one repository below us, close by - the project lives there.
    const below = keys.filter((k) => isRepo(k) && under(k, f) && depthBelow(k, f) <= 2);
    if (below.length === 1) { step.set(f, below[0]); continue; }

    // R3: absorbed by the shallowest plain-folder ancestor that is not a container.
    const anc = keys
      .filter((g) => g !== f && under(f, g) && !isRepo(g) && !container(g) && !junk(g))
      .sort((a, b) => a.length - b.length || a.localeCompare(b));
    if (anc.length) { step.set(f, anc[0]); continue; }

    // R4: a folder full of unrelated projects is a region, not a place.
    if (container(f)) { step.set(f, null); continue; }

    step.set(f, f);                                                      // R5
  }

  // Follow each chain to its end, so a folder whose target was itself absorbed lands in
  // the right place. Chains only ever shorten, so eight hops is plenty.
  const out = new Map();
  for (const f of keys) {
    let cur = f;
    for (let i = 0; i < 8; i++) {
      const next = step.get(cur);
      if (next === null || next === undefined) { cur = next === null ? null : cur; break; }
      if (next === cur) break;
      cur = next;
    }
    out.set(f, cur);
  }
  return out;
}

// Folders that hold projects but are not one: a drive root, `D:\git`, a user's home,
// a Desktop. Measured need: `C:\Users\Martijn` turned up in the key set because one
// session ran there, and then absorbed `...\Desktop\pixelart` under R3. A shelf never
// absorbs anyone and never becomes a hamlet - but only when it has no repository of its
// own, because a checkout is a project wherever it happens to live.
const SHELF_LEAF = new Set(['users', 'desktop', 'documents', 'downloads', 'onedrive', 'temp', 'appdata', 'local', 'roaming']);

export function isShelfPath(key) {
  const parts = String(key || '').split('\\').filter(Boolean);
  if (parts.length <= 2) return true;                                  // `c:`, `d:\git`
  if (parts.length === 3 && parts[1] === 'users') return true;         // `c:\users\martijn`
  return SHELF_LEAF.has(parts[parts.length - 1]);
}

// The name on the sign. A folder called `src` says nothing, so it brings its parent.
export function districtNameOf(root) {
  const pretty = prettyPath(root) || 'Somewhere';
  const parts = pretty.split('\\').filter(Boolean);
  const base = parts[parts.length - 1] || pretty;
  if (parts.length >= 2 && GENERIC.has(base.toLowerCase())) return `${parts[parts.length - 2]}/${base}`;
  return base;
}
