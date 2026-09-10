// The island's own noticeboard: the GitHub issues of the repository Promptholm is
// built from.
//
// Read through the `gh` command line rather than the REST API, so there is no token to
// keep here and no second login to arrange: the board reads as whoever `gh auth status`
// says is logged in. That is also the account the issue-oppakken skill uses, so what the
// board can see is exactly what an agent sent out from it can see.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { DATA, ROOT, readJson, writeJsonAtomic, loadConfig } from './paths.mjs';

export const ISSUES_FILE = path.join(DATA, 'issues.json');

const LIMIT = 120;
const TIMEOUT = 15000;
const FIELDS = 'number,title,state,stateReason,labels,assignees,author,milestone,updatedAt,createdAt,url,body';
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
// Work that is being done right now says so with a label, because this repository has no
// project board to drag a card across. The skill puts it on and takes it off again.
const WORKING = /^(in progress|wip|bezig)$/i;
const TYPE_OF = [
  [/^bug$/i, 'Bug'],
  [/^enhancement$/i, 'Enhancement'],
  [/^documentation$/i, 'Documentation'],
  [/^question$/i, 'Question'],
];

// The wording an agent gets when an issue is handed to it. The Jira board has its own in
// config.dispatch; this is the same idea for the island's own repository, and the opening
// line is the phrase the issue-oppakken skill triggers on. `plain` is what an agent is
// told when the folder it works in does not carry that skill: the same route, spelled out,
// so a hand-over still lands somewhere sensible.
const DEFAULT_DISPATCH = {
  opening: 'Pick up issue #{number}',
  skill: 'issue-oppakken',
  where: 'GitHub',
  plain: 'Read it with `gh issue view {number}`, branch from origin/main as <type>/{number}-<slug>, '
    + 'say on the issue that you have picked it up, and when the work is done push the branch and '
    + 'close the issue as completed, naming the branch in the closing comment.',
};

// gh is a real executable, not a shim, so it can be found the same way claude.exe is.
let ghPath = null;
function resolveGh() {
  if (ghPath) return ghPath;
  const candidates = [
    process.env.GH_EXE,
    'C:\\Program Files\\GitHub CLI\\gh.exe',
    'C:\\Program Files (x86)\\GitHub CLI\\gh.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'GitHubCLI', 'bin', 'gh.exe'),
    '/usr/local/bin/gh',
    '/usr/bin/gh',
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.statSync(c).isFile()) { ghPath = c; return ghPath; } } catch { /* keep looking */ }
  }
  ghPath = 'gh';                     // on the PATH, we hope
  return ghPath;
}

function gh(args, { timeout = TIMEOUT } = {}) {
  return new Promise((resolve) => {
    execFile(resolveGh(), args, { cwd: ROOT, timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, out: String(stdout || ''), err: firstLine(stderr || err.message) });
      resolve({ ok: true, out: String(stdout), err: '' });
    });
  });
}

function firstLine(s) {
  return String(s || '').split('\n').map((l) => l.trim()).filter(Boolean)[0] || 'no reason given';
}

// Which repository the island belongs to. Nothing needs configuring: the island is
// served out of a checkout, and that checkout knows its own origin. One synchronous git
// read is cheaper than threading a promise through the config, and the answer cannot
// change while the island is running.
let repoCache = null;
function repoFromRemote() {
  if (repoCache !== null) return repoCache;
  repoCache = '';
  try {
    const url = String(execFileSync('git', ['config', '--get', 'remote.origin.url'], { cwd: ROOT, timeout: 5000, windowsHide: true }));
    const m = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\s*$/i.exec(url);
    if (m) repoCache = m[1];
  } catch { /* not a checkout, or its origin is not GitHub */ }
  return repoCache;
}

export function githubConfig() {
  const island = loadConfig();
  const cfg = island.github || {};
  const repo = String(cfg.repo || process.env.SETTLERS_GITHUB_REPO || repoFromRemote() || '').trim();
  return {
    repo: REPO.test(repo) ? repo : '',
    url: REPO.test(repo) ? `https://github.com/${repo}` : null,
    dispatch: { ...DEFAULT_DISPATCH, language: (island.dispatch || {}).language || 'en', ...(cfg.dispatch || {}) },
    configured: REPO.test(repo),
  };
}

// ---------------------------------------------------------------- the issues
function labelNames(issue) {
  return (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name)).filter(Boolean);
}

function normalise(raw) {
  const labels = labelNames(raw);
  const working = labels.some((l) => WORKING.test(l));
  const assignees = (raw.assignees || []).map((a) => a.login).filter(Boolean);
  const closed = String(raw.state || '').toUpperCase() === 'CLOSED';
  const planned = String(raw.stateReason || '').toUpperCase() !== 'NOT_PLANNED';
  const status = closed
    ? (planned ? 'Done' : 'Set aside')
    : working ? 'In progress' : assignees.length ? 'Taken' : 'Open';
  return {
    key: `#${raw.number}`,
    number: raw.number,
    summary: String(raw.title || '').slice(0, 220),
    description: String(raw.body || '').replace(/\r/g, '').slice(0, 2000),
    type: (TYPE_OF.find(([re]) => labels.some((l) => re.test(l))) || [null, 'Issue'])[1],
    status,
    statusCategory: closed ? 'done' : (working || assignees.length) ? 'indeterminate' : 'new',
    done: closed,
    completed: closed && planned,
    working,
    assignee: assignees[0] || null,
    assignees,
    author: (raw.author && raw.author.login) || null,
    labels,
    milestone: (raw.milestone && raw.milestone.title) || null,
    url: raw.url || null,
    updated: raw.updatedAt || null,
    createdAt: raw.createdAt || null,
  };
}

export function loadIssues() {
  const cached = readJson(ISSUES_FILE, null);
  if (cached && Array.isArray(cached.issues)) return cached;
  return { source: 'empty', repo: null, me: null, fetchedAt: null, issues: [], note: null };
}

export function saveIssues(data) { writeJsonAtomic(ISSUES_FILE, data, { pretty: true }); }

export function issueByKey(key) {
  return loadIssues().issues.find((i) => i.key === String(key)) || null;
}

// Who gh is logged in as, and whether that account may write here. The skill leans on
// this: an account with only `pull` can comment on an issue but cannot label it, and the
// board says so rather than letting a hand-over fail silently later.
async function whoAmI(repo) {
  const [user, perms] = await Promise.all([
    gh(['api', 'user', '--jq', '.login'], { timeout: 8000 }),
    gh(['api', `repos/${repo}`, '--jq', '.permissions.push'], { timeout: 8000 }),
  ]);
  return {
    me: user.ok ? user.out.trim() || null : null,
    canWrite: perms.ok ? perms.out.trim() === 'true' : null,
  };
}

export async function refreshIssues({ force = false, maxAgeMs = 3 * 60 * 1000 } = {}) {
  const cfg = githubConfig();
  const current = loadIssues();
  if (!cfg.configured) {
    return { ...current, note: 'No GitHub repository to read. Set "github": { "repo": "owner/name" } in config.json.' };
  }
  const age = current.fetchedAt ? Date.now() - Date.parse(current.fetchedAt) : Infinity;
  if (!force && age < maxAgeMs && current.issues.length && current.repo === cfg.repo) return current;

  const r = await gh(['issue', 'list', '--repo', cfg.repo, '--state', 'all', '--limit', String(LIMIT), '--json', FIELDS]);
  if (!r.ok) {
    const why = /not found|command not found|ENOENT|is not recognized/i.test(r.err)
      ? 'the gh command line is not installed, or not on the PATH'
      : /auth|logged in|token/i.test(r.err) ? `gh is not logged in: ${r.err}` : r.err;
    return { ...current, repo: cfg.repo, note: `Could not read the issues of ${cfg.repo}: ${why}` };
  }
  let rows;
  try { rows = JSON.parse(r.out); } catch { return { ...current, note: 'gh answered with something that is not JSON.' }; }
  if (!Array.isArray(rows)) return { ...current, note: 'gh answered with something unexpected.' };

  const who = await whoAmI(cfg.repo).catch(() => ({ me: current.me || null, canWrite: null }));
  const next = {
    source: 'github',
    repo: cfg.repo,
    url: cfg.url,
    me: who.me || current.me || null,
    canWrite: who.canWrite,
    fetchedAt: new Date().toISOString(),
    issues: rows.map(normalise).sort((a, b) => a.number - b.number),
    note: null,
  };
  saveIssues(next);
  return next;
}
