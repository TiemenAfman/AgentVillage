// Talking to a settler: reading the conversation their session already had, and
// carrying it on.
//
// Resuming keeps the same session id, so a conversation you start here lands in the very
// transcript the island reads. Talk to a settler and their house grows.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CLAUDE_HOME } from './paths.mjs';
import { resolveClaude } from './dispatch.mjs';

const TAIL_BYTES = 6 * 1024 * 1024;   // enough for a long conversation, never the whole 20 MB
const UUID = /^[0-9a-f-]{36}$/i;

// An apprentice's transcript lives beside its master's, under that session's folder.
export function findTranscript(sessionId, agentId = null) {
  if (!UUID.test(String(sessionId))) return null;
  if (agentId && !/^[a-z0-9]+$/i.test(String(agentId))) return null;
  const projects = path.join(CLAUDE_HOME, 'projects');
  let dirs = [];
  try { dirs = fs.readdirSync(projects, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return null; }
  for (const d of dirs) {
    const f = agentId
      ? path.join(projects, d.name, sessionId, 'subagents', `agent-${agentId}.jsonl`)
      : path.join(projects, d.name, `${sessionId}.jsonl`);
    try { if (fs.statSync(f).isFile()) return f; } catch { /* keep looking */ }
  }
  return null;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n').trim();
}

// Turns the raw transcript into something a person can read: who said what, which tools
// were used, and nothing of the machinery in between.
export function readTranscript(sessionId, { limit = 80, agentId = null } = {}) {
  const file = findTranscript(sessionId, agentId);
  if (!file) return { ok: false, reason: 'no transcript for that settler yet', messages: [] };

  let text = '';
  let truncated = false;
  try {
    const st = fs.statSync(file);
    const start = Math.max(0, st.size - TAIL_BYTES);
    truncated = start > 0;
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(st.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    text = buf.toString('utf8');
    if (truncated) text = text.slice(text.indexOf('\n') + 1);
  } catch (e) {
    return { ok: false, reason: String(e.message || e), messages: [] };
  }

  const messages = [];
  let lastAssistantId = null;
  let cwd = null;
  let model = null;

  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let o;
    try { o = JSON.parse(s); } catch { continue; }
    if (o.cwd) cwd = o.cwd;

    if (o.type === 'user' && o.message && !o.isMeta) {
      // Desktop sessions tag a prompt with origin.kind; sessions started from the command
      // line do not. What actually marks a prompt is that it carries text and is not the
      // result of a tool call.
      const content = o.message.content;
      const hasToolResult = Array.isArray(content) && content.some((b) => b && b.type === 'tool_result');
      const body = textOf(content);
      const fromNoone = o.origin && o.origin.kind && o.origin.kind !== 'human';
      if (body && !hasToolResult && !fromNoone) {
        messages.push({ role: 'user', text: body, at: o.timestamp || null });
      } else if (o.toolUseResult && Array.isArray(content)) {
        // a tool came back; note it against the last assistant turn rather than as a message
        const last = messages[messages.length - 1];
        if (last && last.role === 'assistant' && last.tools && last.tools.length) {
          last.tools[last.tools.length - 1].done = true;
        }
      }
      continue;
    }

    if (o.type === 'assistant' && o.message) {
      const id = o.message.id;
      if (o.message.model && o.message.model !== '<synthetic>') model = o.message.model;
      let msg = id && id === lastAssistantId ? messages[messages.length - 1] : null;
      if (!msg || msg.role !== 'assistant') {
        msg = { role: 'assistant', text: '', tools: [], at: o.timestamp || null, model: o.message.model || null };
        messages.push(msg);
        lastAssistantId = id;
      }
      for (const b of o.message.content || []) {
        if (b.type === 'text' && b.text) msg.text += (msg.text ? '\n' : '') + b.text;
        else if (b.type === 'tool_use') msg.tools.push({ name: b.name, done: false, hint: toolHint(b) });
      }
      continue;
    }

    if (o.type === 'system' && o.subtype === 'api_error') {
      messages.push({ role: 'note', text: 'The session hit an API error here.', at: o.timestamp || null });
    }
  }

  // Everything a settler says and does between two of your messages is one turn, so it
  // reads as one answer rather than forty fragments.
  const kept = messages.filter((m) => m.text || (m.tools && m.tools.length));
  const turns = [];
  for (const m of kept) {
    const last = turns[turns.length - 1];
    if (m.role === 'assistant' && last && last.role === 'assistant') {
      if (m.text) last.text += (last.text ? '\n\n' : '') + m.text;
      last.tools.push(...(m.tools || []));
      last.at = m.at || last.at;
    } else {
      turns.push({ ...m, tools: [...(m.tools || [])] });
    }
  }

  return {
    ok: true, file, cwd, model, truncated,
    total: turns.length, messages: turns.slice(-limit), canReply: !agentId,
  };
}

// One short line about what a tool call was aimed at, never the whole input.
function toolHint(block) {
  const i = block.input || {};
  const first = i.file_path || i.path || i.pattern || i.command || i.url || i.description || i.prompt || '';
  return String(first).replace(/\s+/g, ' ').slice(0, 90);
}

// Claude resolves --resume against the project the working directory belongs to, so a
// session can only be carried on from the folder it was held in. The transcript says
// which folder that was.
export function sessionCwd(sessionId) {
  const file = findTranscript(sessionId);
  if (!file) return null;
  let head = '';
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(Math.min(65536, fs.statSync(file).size));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    head = buf.toString('utf8');
  } catch { return null; }
  for (const line of head.split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (o && o.cwd) return o.cwd;
    } catch { /* the last line may be cut in half */ }
  }
  return null;
}

export const MODES = {
  full: 'bypassPermissions',
  edits: 'acceptEdits',
  read: 'plan',
};

// Carries the conversation on. The child streams newline-delimited JSON, which the
// server hands straight to the page.
export function talk({ sessionId, cwd, text, mode = 'full', model = null }) {
  if (!UUID.test(String(sessionId))) throw new Error('that is not a session id');
  if (!text || !String(text).trim()) throw new Error('say something first');
  const fallback = sessionCwd(sessionId);
  const dir = (cwd && fs.existsSync(cwd)) ? cwd : (fallback && fs.existsSync(fallback) ? fallback : null);
  if (!dir) throw new Error('cannot tell which folder this settler worked in');

  const args = [
    '--resume', sessionId,
    '--permission-mode', MODES[mode] || MODES.full,
    '--output-format', 'stream-json',
    '--verbose',
  ];
  if (model) args.push('--model', model);
  args.push('-p', String(text));

  const { exe, shell } = resolveClaude();
  const child = spawn(exe, args, {
    cwd: dir,
    windowsHide: true,
    shell,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SETTLERS_CHAT: sessionId },
  });
  return { child, cwd: dir, args };
}
