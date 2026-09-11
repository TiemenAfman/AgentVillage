// The village office: what git has to say about a district's repository.
//
// Reading only. Anything that changes history belongs in a real git client, and the
// office has a button that opens one. The single exception is fetch, which touches
// remote-tracking refs and nothing of yours.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const TIMEOUT = 15000;
const MAX_BRANCHES = 200;      // enough for any repository worth picking from by eye
const MAX_BUFFER = 8 * 1024 * 1024;
const SEP = '';   // unit separator: safe inside commit messages
const REC = '';   // record separator

export function isRepo(dir) {
  try { return fs.statSync(path.join(dir, '.git')).isDirectory() || fs.statSync(path.join(dir, '.git')).isFile(); }
  catch { return false; }
}

function git(dir, args, { timeout = TIMEOUT } = {}) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: dir, timeout, maxBuffer: MAX_BUFFER, windowsHide: true }, (err, stdout, stderr) => {
      if (err && !stdout) return resolve({ ok: false, out: '', err: String(stderr || err.message).trim() });
      resolve({ ok: !err, out: String(stdout), err: String(stderr || '').trim() });
    });
  });
}

// ---------------------------------------------------------------- overview
export async function overview(dir, { logCount = 25 } = {}) {
  if (!isRepo(dir)) return { ok: false, reason: 'that folder is not a git repository' };

  const [head, statusRaw, logRaw, remoteRaw, stashRaw] = await Promise.all([
    git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(dir, ['status', '--porcelain=v1', '--branch', '--untracked-files=normal']),
    git(dir, ['log', `--max-count=${Math.min(200, logCount)}`, '--date=iso-strict',
      `--format=%H${SEP}%h${SEP}%an${SEP}%ad${SEP}%s${SEP}%D${SEP}%p${REC}`]),
    git(dir, ['remote', 'get-url', 'origin']),
    git(dir, ['stash', 'list']),
  ]);

  const status = parseStatus(statusRaw.out);
  return {
    ok: true,
    dir,
    branch: head.out.trim() || status.branch || 'detached',
    ...status,
    commits: parseLog(logRaw.out),
    remote: remoteRaw.ok ? remoteRaw.out.trim() : null,
    browseUrl: browseUrl(remoteRaw.ok ? remoteRaw.out.trim() : null),
    stashes: stashRaw.out.split('\n').filter((l) => l.trim()).length,
  };
}

// `## main...origin/main [ahead 2, behind 1]` followed by one line per changed file.
function parseStatus(out) {
  const lines = out.split('\n').filter((l) => l.length);
  let branch = null, upstream = null, ahead = 0, behind = 0;
  const files = [];
  for (const line of lines) {
    if (line.startsWith('## ')) {
      const b = line.slice(3);
      const m = /^(?<local>[^.]+?)(?:\.\.\.(?<up>\S+))?(?:\s\[(?<counts>.+)\])?$/.exec(b);
      if (m && m.groups) {
        branch = m.groups.local === 'HEAD (no branch)' ? null : m.groups.local;
        upstream = m.groups.up || null;
        const c = m.groups.counts || '';
        ahead = Number((/ahead (\d+)/.exec(c) || [])[1] || 0);
        behind = Number((/behind (\d+)/.exec(c) || [])[1] || 0);
      }
      continue;
    }
    const x = line[0], y = line[1];
    let file = line.slice(3);
    let from = null;
    if (file.includes(' -> ')) { const [a, b2] = file.split(' -> '); from = a; file = b2; }
    files.push({
      file: unquote(file),
      from: from ? unquote(from) : null,
      staged: x !== ' ' && x !== '?',
      unstaged: y !== ' ' && y !== '?',
      untracked: x === '?',
      conflicted: x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D'),
      code: `${x}${y}`,
      label: label(x, y),
    });
  }
  return { branch, upstream, ahead, behind, files, clean: files.length === 0 };
}

function unquote(s) {
  if (!s.startsWith('"')) return s;
  try { return JSON.parse(s); } catch { return s.slice(1, -1); }
}

function label(x, y) {
  if (x === '?') return 'new, untracked';
  if (x === 'U' || y === 'U') return 'conflict';
  const of = (c) => ({ M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', T: 'type changed' }[c]);
  if (x !== ' ' && y !== ' ') return `${of(x)}, then ${of(y)}`;
  return of(x !== ' ' ? x : y) || 'changed';
}

function parseLog(out) {
  return out.split(REC).map((rec) => rec.trim()).filter(Boolean).map((rec) => {
    const [sha, short, author, date, subject, refs, parents] = rec.split(SEP);
    return {
      sha, short, author, date, subject,
      refs: (refs || '').split(', ').filter(Boolean),
      merge: (parents || '').trim().split(' ').filter(Boolean).length > 1,
    };
  });
}

// Turns a remote into something you can open in a browser, for the common hosts.
function browseUrl(remote) {
  if (!remote) return null;
  let m = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(remote);
  if (m) return `https://${m[1]}/${m[2]}`;
  m = /^https?:\/\/(.+?)(?:\.git)?$/.exec(remote);
  if (m) return `https://${m[1]}`;
  return null;                         // a file or network share: nothing to open
}

// ---------------------------------------------------------------- details
export async function fileDiff(dir, file, { staged = false, context = 3 } = {}) {
  if (!isRepo(dir)) return { ok: false, reason: 'not a repository' };
  const args = ['diff', `--unified=${Math.max(0, Math.min(20, context))}`, '--no-color'];
  if (staged) args.push('--cached');
  args.push('--', file);
  const r = await git(dir, args);
  if (r.out.trim()) return { ok: true, diff: r.out, untracked: false };
  // an untracked file has nothing to diff against, so show what it holds
  const show = await git(dir, ['show', `:0:${file}`]);
  if (!show.ok) {
    try {
      const body = fs.readFileSync(path.join(dir, file), 'utf8');
      return { ok: true, untracked: true, diff: body.split('\n').slice(0, 400).map((l) => `+${l}`).join('\n') };
    } catch { /* binary or gone */ }
  }
  return { ok: true, diff: '', untracked: false, empty: true };
}

export async function commitDetail(dir, sha) {
  if (!/^[0-9a-f]{4,40}$/i.test(String(sha))) return { ok: false, reason: 'that is not a commit' };
  const [body, stat] = await Promise.all([
    git(dir, ['show', '--no-patch', `--format=%H${SEP}%an${SEP}%ae${SEP}%ad${SEP}%s${SEP}%b`, '--date=iso-strict', sha]),
    git(dir, ['show', '--stat=200', '--format=', '--no-color', sha]),
  ]);
  const [full, author, email, date, subject, message] = body.out.split(SEP);
  return {
    ok: true,
    sha: (full || '').trim(), author, email, date, subject,
    message: (message || '').trim(),
    stat: stat.out.trim(),
  };
}

export async function commitDiff(dir, sha) {
  if (!/^[0-9a-f]{4,40}$/i.test(String(sha))) return { ok: false, reason: 'that is not a commit' };
  const r = await git(dir, ['show', '--no-color', '--format=', sha]);
  return { ok: true, diff: r.out.slice(0, 400 * 1024) };
}

// ---------------------------------------------------------------- handing over
// Staging, rebasing and merge conflicts belong in a real client. The office knows
// which ones are installed and opens them at the right repository.
const TOOLS = [
  { id: 'gitextensions', name: 'Git Extensions', args: (dir) => ['browse', dir],
    paths: ['%ProgramFiles%/GitExtensions/GitExtensions.exe', '%ProgramFiles(x86)%/GitExtensions/GitExtensions.exe'] },
  { id: 'fork', name: 'Fork', args: (dir) => [dir], paths: ['%LOCALAPPDATA%/Fork/Fork.exe'] },
  { id: 'sourcetree', name: 'SourceTree', args: (dir) => ['-f', dir], paths: ['%LOCALAPPDATA%/SourceTree/SourceTree.exe'] },
  { id: 'githubdesktop', name: 'GitHub Desktop', args: (dir) => [dir], paths: ['%LOCALAPPDATA%/GitHubDesktop/GitHubDesktop.exe'] },
  { id: 'vscode', name: 'VS Code', args: (dir) => [dir],
    paths: ['%LOCALAPPDATA%/Programs/Microsoft VS Code/Code.exe', '%ProgramFiles%/Microsoft VS Code/Code.exe'] },
  { id: 'explorer', name: 'File Explorer', args: (dir) => [dir], paths: ['%WINDIR%/explorer.exe'] },
];

function expand(p) {
  return p.replace(/%([^%]+)%/g, (_, v) => process.env[v] || '').replace(/\//g, path.sep);
}

export function gitTools() {
  const found = [];
  for (const t of TOOLS) {
    for (const raw of t.paths) {
      const exe = expand(raw);
      try { if (fs.statSync(exe).isFile()) { found.push({ id: t.id, name: t.name, exe }); break; } } catch { /* next */ }
    }
  }
  return found;
}

export function openIn(toolId, dir) {
  const spec = TOOLS.find((t) => t.id === toolId);
  if (!spec) throw new Error('the office does not know that tool');
  const tool = gitTools().find((t) => t.id === toolId);
  if (!tool) throw new Error(`${spec.name} is not installed`);
  if (!isRepo(dir) && toolId !== 'explorer' && toolId !== 'vscode') throw new Error('not a repository');
  const child = execFile(tool.exe, spec.args(dir), { windowsHide: false, detached: true }, () => {});
  child.unref();
  return { tool: tool.name, dir };
}

// The one thing the office may change without asking: remote-tracking refs. Never your work.
export async function fetch(dir) {
  if (!isRepo(dir)) return { ok: false, reason: 'not a repository' };
  const r = await git(dir, ['fetch', '--all', '--prune'], { timeout: 60000 });
  return { ok: r.ok, message: (r.err || r.out).trim() || 'up to date' };
}

// ---------------------------------------------------------------- branch, alone
// Which branch a checkout is on, and nothing else. The office reads this as part of a
// whole overview; the island wants it on startup, to say which piece of work a
// development server belongs to, and paying for a status and a log to find that out
// would be silly. A detached worktree has no branch name, so it gets its short hash.
export async function currentBranch(dir) {
  if (!isRepo(dir)) return null;
  const head = await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const name = head.out.trim();
  if (name && name !== 'HEAD') return name;
  const sha = await git(dir, ['rev-parse', '--short', 'HEAD']);
  return sha.out.trim() || null;
}

// ---------------------------------------------------------------- branches
export async function branches(dir) {
  if (!isRepo(dir)) return { ok: false, reason: 'not a repository' };
  const [head, localR, remoteR] = await Promise.all([
    git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(dir, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads']),
    git(dir, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/remotes']),
  ]);
  const current = head.out.trim();
  const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);
  const local = lines(localR.out);
  const remote = lines(remoteR.out)
    .filter((r) => !/\/HEAD$/.test(r))    // origin/HEAD is a pointer, not a branch
    .filter((r) => r.includes('/'));      // a bare "origin" is the remote itself

  // Both lists come back newest-committed first, so the branch you actually want is
  // near the top. A repository with hundreds of them would otherwise be a wall of names.
  const mergeable = [...local, ...remote].filter((b) => b !== current);
  return {
    ok: true, current, local, remote,
    mergeable: mergeable.slice(0, MAX_BRANCHES),
    truncated: Math.max(0, mergeable.length - MAX_BRANCHES),
  };
}

// ---------------------------------------------------------------- merging
// The office may merge a branch into the one you are on, but only when the result is
// clean. A merge with conflicts is aborted and left for a real client, so the office
// can never strand you halfway through one.
export async function merge(dir, ref, { noff = false } = {}) {
  if (!isRepo(dir)) return { ok: false, reason: 'not a repository' };

  const b = await branches(dir);
  if (!b.ok) return b;
  if (!ref) return { ok: false, reason: 'name a branch to merge' };
  if (ref === b.current) return { ok: false, reason: 'that is the branch you are already on' };
  // Check the whole list, not the shortened one the picker shows: a branch further down
  // than the office lists is still a branch, and typing its name should work.
  if (![...b.local, ...b.remote].includes(ref)) return { ok: false, reason: 'this repository has no branch by that name' };

  // A dirty tree makes a merge unpredictable; ask for a clean one first.
  const status = parseStatus((await git(dir, ['status', '--porcelain=v1', '--branch'])).out);
  if (!status.clean) return { ok: false, reason: 'commit or stash your changes first — the office only merges into a clean tree' };

  const args = ['merge', '--no-edit'];
  if (noff) args.push('--no-ff');
  args.push(ref);
  const r = await git(dir, args, { timeout: 60000 });

  if (r.ok) {
    const out = `${r.out}\n${r.err}`;
    return {
      ok: true, current: b.current, ref,
      fastForward: /fast-forward/i.test(out),
      upToDate: /already up to date/i.test(out),
      message: out.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4).join(' · ').slice(0, 300) || 'merged',
    };
  }

  // Failed: if a merge is genuinely in progress, roll it back so the tree is clean again.
  const conflict = /conflict|automatic merge failed|needs merge|would be overwritten/i.test(`${r.err}${r.out}`);
  const midMerge = await git(dir, ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD']);
  if (midMerge.ok) await git(dir, ['merge', '--abort']);
  return {
    ok: false,
    conflict,
    reason: conflict
      ? `${ref} conflicts with ${b.current}. Nothing was changed — open a git client to resolve it.`
      : (r.err || r.out || 'git refused the merge').split('\n')[0].slice(0, 200),
  };
}
