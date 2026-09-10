// The sprint board's contents, read from Jira.
//
// Follows the house convention from the jira-ticket-oppakken skill: REST v2, not v3,
// because v2 hands back plain text instead of Atlassian document JSON.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, ROOT, readJson, writeJsonAtomic, loadConfig } from './paths.mjs';

export const SPRINT_FILE = path.join(DATA, 'sprint.json');
export const ASSIGNMENTS_FILE = path.join(DATA, 'assignments.jsonl');

const DONE = /^(done|closed|resolved|cancelled|canceled|afgerond|gereed)$/i;
const FIELDS = 'summary,status,issuetype,priority,assignee,labels,updated,description,parent';

export function jiraConfig() {
  const env = { ...readEnvFile(path.join(ROOT, '.env')), ...process.env };
  const site = (env.JIRA_BASE_URL || env.JIRA_SITE || '').replace(/\/+$/, '');
  const island = loadConfig();
  const jira = island.jira || {};
  const cfg = {
    site,
    email: env.JIRA_EMAIL || '',
    token: env.JIRA_API_TOKEN || env.JIRA_TOKEN || '',
    jql: env.JIRA_JQL || jira.jql || '',
    project: env.JIRA_PROJECT || jira.project || '',
    board: env.JIRA_BOARD_ID || jira.board || null,
  };
  cfg.configured = Boolean(cfg.site && cfg.email && cfg.token);
  return cfg;
}

function readEnvFile(file) {
  const out = {};
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return out; }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, eq).trim()] = v;
  }
  return out;
}

function authHeader(cfg) {
  return 'Basic ' + Buffer.from(`${cfg.email}:${cfg.token}`).toString('base64');
}

async function getJson(cfg, url, timeoutMs = 12000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Authorization: authHeader(cfg), Accept: 'application/json' },
      signal: ctl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { ok: res.ok, status: res.status, json, text };
  } catch (e) {
    return { ok: false, status: 0, json: null, text: e.name === 'AbortError' ? 'timed out' : String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

function normalise(issue, site) {
  const f = issue.fields || {};
  const status = (f.status && f.status.name) || 'To Do';
  const desc = typeof f.description === 'string' ? f.description : '';
  return {
    key: issue.key,
    summary: (f.summary || '').slice(0, 220),
    description: desc.replace(/\r/g, '').slice(0, 2000),
    type: (f.issuetype && f.issuetype.name) || 'Task',
    status,
    statusCategory: (f.status && f.status.statusCategory && f.status.statusCategory.key) || 'new',
    done: DONE.test(status),
    priority: (f.priority && f.priority.name) || null,
    assignee: (f.assignee && f.assignee.displayName) || null,
    labels: f.labels || [],
    parent: f.parent ? f.parent.key : null,
    url: site ? `${site}/browse/${issue.key}` : null,
    updated: f.updated || null,
  };
}

// Jira Cloud has moved the search endpoint more than once; try them in order and
// remember nothing, so a future move only costs one failed request.
export async function searchIssues(cfg, jql, max = 60) {
  const q = encodeURIComponent(jql);
  const urls = [
    `${cfg.site}/rest/api/2/search/jql?jql=${q}&maxResults=${max}&fields=${FIELDS}`,
    `${cfg.site}/rest/api/3/search/jql?jql=${q}&maxResults=${max}&fields=${FIELDS}`,
    `${cfg.site}/rest/api/2/search?jql=${q}&maxResults=${max}&fields=${FIELDS}`,
  ];
  let last = 'no attempt';
  for (const url of urls) {
    const r = await getJson(cfg, url);
    if (r.ok && r.json && Array.isArray(r.json.issues)) {
      return { ok: true, issues: r.json.issues.map((i) => normalise(i, cfg.site)) };
    }
    last = r.status ? `HTTP ${r.status}` : r.text;
  }
  return { ok: false, reason: last };
}

// The board name is a nicety; if the agile API is not reachable we just say "open sprint".
async function activeSprintName(cfg, projectKey) {
  let boardId = cfg.board;
  if (!boardId) {
    if (!projectKey) return null;
    const b = await getJson(cfg, `${cfg.site}/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectKey)}&maxResults=5`, 8000);
    const board = b.ok && b.json && (b.json.values || [])[0];
    if (!board) return null;
    boardId = board.id;
  }
  const s = await getJson(cfg, `${cfg.site}/rest/agile/1.0/board/${boardId}/sprint?state=active&maxResults=5`, 8000);
  const sprint = s.ok && s.json && (s.json.values || [])[0];
  return sprint ? sprint.name : null;
}

export function loadSprint() {
  const cached = readJson(SPRINT_FILE, null);
  if (cached && Array.isArray(cached.issues)) return cached;
  return { source: 'empty', sprintName: 'No sprint loaded', fetchedAt: null, issues: [], note: null };
}

export function saveSprint(data) { writeJsonAtomic(SPRINT_FILE, data, { pretty: true }); }

export async function refreshSprint({ force = false, maxAgeMs = 3 * 60 * 1000 } = {}) {
  const cfg = jiraConfig();
  const current = loadSprint();
  if (!cfg.configured) {
    return { ...current, note: 'Jira is not configured. Set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN.' };
  }
  const age = current.fetchedAt ? Date.now() - Date.parse(current.fetchedAt) : Infinity;
  if (!force && age < maxAgeMs && current.issues.length) return current;

  const jql = cfg.jql
    || (cfg.project
      ? `project = ${cfg.project} AND sprint in openSprints() ORDER BY status, priority DESC`
      : 'sprint in openSprints() ORDER BY status, priority DESC');
  const r = await searchIssues(cfg, jql);
  if (!r.ok) return { ...current, note: `Could not reach Jira: ${r.reason}` };

  const projectKey = cfg.project || (r.issues[0] && r.issues[0].key.split('-')[0]) || null;
  const name = await activeSprintName(cfg, projectKey).catch(() => null);
  // who is looking at the board? The default assignee filter is that person.
  let me = current.me || null;
  try {
    const m = await getJson(cfg, `${cfg.site}/rest/api/2/myself`, 8000);
    if (m.ok && m.json && m.json.displayName) me = m.json.displayName;
  } catch { /* keep what we had */ }
  const next = {
    source: 'jira',
    site: cfg.site,
    project: projectKey,
    me,
    sprintName: name || 'Open sprint',
    jql,
    fetchedAt: new Date().toISOString(),
    issues: r.issues,
    note: null,
  };
  saveSprint(next);
  return next;
}

// ---------------------------------------------------------------- assignments
// Append-only: every hand-over and every status change is a line, and the latest
// line per assignment id wins.
export function readAssignments() {
  let text;
  try { text = fs.readFileSync(ASSIGNMENTS_FILE, 'utf8'); } catch { return []; }
  const byId = new Map();
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const o = JSON.parse(s);
      if (o && o.id) byId.set(o.id, { ...(byId.get(o.id) || {}), ...o });
    } catch { /* a torn last line is fine */ }
  }
  return [...byId.values()].sort((a, b) => (b.at || 0) - (a.at || 0));
}

export function appendAssignment(record) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.appendFileSync(ASSIGNMENTS_FILE, JSON.stringify(record) + '\n');
  return record;
}
