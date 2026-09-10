// Handing a card to a settler: starts a real Claude Code session in that settler's
// project folder, working the ticket the way that project works. What the agent is
// told, and which project skill it is pointed at, comes from config.json.
//
// Nothing here runs on its own. A dispatch happens only when the page posts one, which
// means someone clicked "hand it over" and saw the folder, model and prompt first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DATA, ensureData, loadConfig } from './paths.mjs';
import { appendAssignment } from './sprint.mjs';
import { seededName } from './village.mjs';

// The npm shim is a .cmd file, which on Windows only runs through a shell and then
// swallows a detached child's output. The packaged executable behind it does not.
export function resolveClaude() {
  const candidates = [
    process.env.CLAUDE_EXE,
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.statSync(c).isFile()) return { exe: c, shell: false }; } catch { /* keep looking */ }
  }
  return { exe: 'claude', shell: true };   // last resort: let the shell find it
}

export const AGENT_LOGS = path.join(DATA, 'agents');

// Every agent started here runs unattended with full permissions. Without a ceiling,
// fifty clicks are fifty of them, and nothing would ever reap them.
const MAX_LIVE_AGENTS = Number(process.env.SETTLERS_MAX_AGENTS || 4);
const live = new Map();   // pid -> { name, at, child }

export function liveAgents() {
  for (const [pid, a] of live) {
    try { process.kill(pid, 0); } catch { live.delete(pid); void a; }
  }
  return [...live.entries()].map(([pid, a]) => ({ pid, name: a.name, at: a.at }));
}

function claimSlot(name) {
  const running = liveAgents();
  if (running.length >= MAX_LIVE_AGENTS) {
    throw new Error(`${running.length} agents are already at work (${running.map((r) => r.name).join(', ')}). Wait for one to finish, or raise SETTLERS_MAX_AGENTS.`);
  }
}

function track(child, name) {
  if (!child || !child.pid) return;
  live.set(child.pid, { name, at: Date.now(), child });
  child.on('exit', () => live.delete(child.pid));
}

// Called when the island shuts down, so unattended agents do not outlive it silently.
export function stopAllAgents(signal = 'SIGTERM') {
  const stopped = [];
  for (const [pid, a] of live) {
    try { process.kill(pid, signal); stopped.push(a.name); } catch { /* already gone */ }
  }
  live.clear();
  return stopped;
}
const DISPATCH_LOG = path.join(DATA, 'dispatch.log');
const KEY = /^[A-Z][A-Z0-9]+-\d+$/;
const MODEL_OK = /^claude-[a-z0-9.-]+$/;

function log(line) {
  try {
    ensureData();
    fs.appendFileSync(DISPATCH_LOG, `${new Date().toISOString()} ${line}\n`);
  } catch { /* logging must never throw */ }
}

// What an agent is told when it is handed a card.
//
// The wording belongs to your team, not to the island, so it comes from config.json:
//
//   "dispatch": {
//     "opening": "pak {key} op",                        the first line, and the phrase a
//                                                       project skill triggers on
//     "skill": "jira-ticket-oppakken",                  optional, named if you have one
//     "language": "nl"                                  nl or en, for the framing lines
//   }
//
// Placeholders: {key} {summary} {settler} {island}. With no skill configured the agent
// gets a plain instruction to work the ticket and report back.
const DEFAULT_DISPATCH = { opening: 'Pick up {key}', skill: null, language: 'en' };

const FRAMING = {
  nl: {
    handed: (s, island) => `Deze taak is je op het prikbord van ${island} overhandigd, namens kolonist ${s}.`,
    arrived: (s, island) => `Deze taak is je van het prikbord van ${island} meegegeven; je bent net op het eiland aangekomen als ${s}.`,
    skill: (skill) => `Volg de skill ${skill} van begin tot eind en koppel aan het einde terug zoals daar beschreven.`,
    plain: 'Werk het ticket af volgens de werkwijze van dit project en koppel aan het einde terug wat je gedaan hebt.',
    title: (t) => `Titel volgens Jira: ${t}`,
  },
  en: {
    handed: (s, island) => `This was handed to you at the notice board of ${island}, on behalf of ${s}.`,
    arrived: (s, island) => `This came with you from the notice board of ${island}; you have just arrived as ${s}.`,
    skill: (skill) => `Follow the ${skill} skill from beginning to end and report back as it describes.`,
    plain: 'Work the ticket the way this project does, and report back on what you did.',
    title: (t) => `Title in Jira: ${t}`,
  },
};

export function buildPrompt(issue, settler, cfg = {}) {
  const d = { ...DEFAULT_DISPATCH, ...(cfg.dispatch || {}) };
  const island = cfg.islandName || 'the island';
  const words = FRAMING[d.language] || FRAMING.en;
  const fill = (s) => String(s)
    .replace(/\{key\}/g, issue.key)
    .replace(/\{summary\}/g, issue.summary || '')
    .replace(/\{settler\}/g, settler.name || '')
    .replace(/\{island\}/g, island);

  const lines = [
    fill(d.opening),
    '',
    settler.newcomer ? words.arrived(settler.name, island) : words.handed(settler.name, island),
    d.skill ? words.skill(d.skill) : words.plain,
  ];
  if (issue.summary) lines.push('', words.title(issue.summary));
  return lines.join('\n');
}

// A settler who does not exist yet: the session id is chosen first, so the name the
// island will give this newcomer once it sees the transcript is known right now.
export function newcomer({ cwd, model = null }) {
  const sessionId = randomUUID();
  return { id: null, name: seededName(sessionId), cwd, model, district: null, newcomer: true, sessionId };
}

export function pickModel(settler) {
  const m = String(settler.model || '').replace(/\[1m\]$/, '').trim();
  return MODEL_OK.test(m) ? m : null;
}

export function buildCommand({ issue, settler, cwd, permissionMode = 'bypassPermissions' }) {
  const sessionId = settler.sessionId || randomUUID();
  const model = pickModel(settler);
  const args = ['--session-id', sessionId, '--permission-mode', permissionMode];
  if (model) args.push('--model', model);
  args.push('-p', buildPrompt(issue, settler, loadConfig()));
  return { sessionId, args, model, cwd, permissionMode };
}

// Founding a settler: a new session with no ticket attached, started because you asked
// for one. It gets a house and stays, unlike an agent sent out for a single job.
export function found({ cwd, model = null, prompt, permissionMode = 'bypassPermissions' }) {
  if (!cwd || !fs.existsSync(cwd)) throw new Error(`no such folder: ${cwd}`);
  const text = String(prompt || '').trim() || 'Introduce yourself in one sentence and wait for instructions.';
  const person = newcomer({ cwd, model });
  claimSlot(person.name);

  const args = ['--session-id', person.sessionId, '--permission-mode', permissionMode];
  if (person.model && MODEL_OK.test(person.model)) args.push('--model', person.model);
  args.push('-p', text);

  ensureData();
  fs.mkdirSync(AGENT_LOGS, { recursive: true });
  const logFile = path.join(AGENT_LOGS, `settler-${person.sessionId.slice(0, 8)}.log`);
  const out = fs.openSync(logFile, 'a');
  fs.writeSync(out, `\n=== ${new Date().toISOString()} founding ${person.name} in ${cwd} ===\n`);

  const { exe, shell } = resolveClaude();
  const child = spawn(exe, args, {
    cwd, detached: true, windowsHide: true, stdio: ['ignore', out, out], shell,
    env: { ...process.env, SETTLERS_FOUNDED: person.sessionId },
  });
  track(child, person.name);
  const record = {
    id: `settler:${person.sessionId.slice(0, 8)}`,
    type: 'resident',                       // no issueKey, so the island never treats this as a visitor
    settlerName: person.name,
    sessionId: person.sessionId,
    cwd, model: person.model, permissionMode,
    prompt: text.slice(0, 200),
    status: 'running', at: Date.now(),
    logFile,
  };
  child.on('error', (e) => {
    log(`FAILED to found ${person.name}: ${e.message}`);
    appendAssignment({ id: record.id, status: 'failed', error: e.message, at: Date.now() });
  });
  child.unref();
  record.pid = child.pid || null;
  log(`founded ${person.name} (pid ${record.pid}) in ${cwd} model ${person.model || 'default'}`);
  appendAssignment(record);
  return record;
}

export function dispatch({ issue, settler, cwd, permissionMode = 'bypassPermissions', dryRun = false }) {
  if (!issue || !KEY.test(String(issue.key || ''))) throw new Error('that does not look like an issue key');
  if (!cwd || !fs.existsSync(cwd)) throw new Error(`no such folder: ${cwd}`);

  const cmd = buildCommand({ issue, settler, cwd, permissionMode });
  const id = `${issue.key}:${cmd.sessionId.slice(0, 8)}`;
  const record = {
    id,
    issueKey: issue.key,
    issueSummary: issue.summary || null,
    issueUrl: issue.url || null,
    settlerId: settler.id || null,
    settlerName: settler.name || null,
    newcomer: !!settler.newcomer,
    district: settler.district || null,
    cwd,
    model: cmd.model,
    permissionMode,
    sessionId: cmd.sessionId,
    status: dryRun ? 'prepared' : 'running',
    at: Date.now(),
    dryRun: !!dryRun,
  };

  fs.mkdirSync(AGENT_LOGS, { recursive: true });
  const logFile = path.join(AGENT_LOGS, `${issue.key}-${cmd.sessionId.slice(0, 8)}.log`);
  record.logFile = logFile;

  if (dryRun) {
    log(`DRY RUN ${id} in ${cwd} :: claude ${cmd.args.map(quote).join(' ')}`);
    appendAssignment(record);
    return { ...record, command: `claude ${cmd.args.map(quote).join(' ')}` };
  }

  claimSlot(settler.name);   // a dry run costs nothing, a real one takes a slot
  const out = fs.openSync(logFile, 'a');
  fs.writeSync(out, `\n=== ${new Date().toISOString()} ${issue.key} -> ${settler.name} in ${cwd} ===\n`);
  const { exe, shell } = resolveClaude();
  const child = spawn(exe, cmd.args, {
    cwd,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', out, out],
    shell,
    env: { ...process.env, SETTLERS_DISPATCH: id },
  });
  child.on('error', (e) => {
    log(`FAILED ${id}: ${e.message}`);
    try { fs.writeSync(out, `\n[settlers] could not start the agent: ${e.message}\n`); } catch { /* ignore */ }
    appendAssignment({ id, status: 'failed', error: e.message, at: Date.now() });
  });
  track(child, settler.name);
  child.unref();

  record.exe = exe;
  record.pid = child.pid || null;
  log(`START ${id} pid ${record.pid} in ${cwd} model ${cmd.model || 'default'} mode ${permissionMode}`);
  appendAssignment(record);
  return { ...record, command: `claude ${cmd.args.map(quote).join(' ')}` };
}

function quote(a) { return /[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a; }

// Reads the tail of an agent's log so the island can show what it is up to.
export function agentLogTail(file, bytes = 4000) {
  try {
    const st = fs.statSync(file);
    const start = Math.max(0, st.size - bytes);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(st.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch { return ''; }
}
