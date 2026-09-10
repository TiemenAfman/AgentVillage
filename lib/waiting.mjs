// Which settlers are standing still, waiting for you.
//
// A session that is working writes to its transcript every few seconds: an assistant
// message with a tool call, then the result of that call. A session that has finished
// its turn stops writing and waits. That difference is the whole signal here - no new
// bookkeeping, nothing for the agent to remember to do.
//
// A settler is waiting when the last thing in the transcript is an assistant message
// with text in it, every tool it started has come back, and nothing has happened since.
// If that text ends in a question, the settler has asked you something, which is worth
// more of your attention than one that has merely run out of work.
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_HOME } from './paths.mjs';

// Long enough that a pause between two tool calls is never mistaken for a question.
const QUIET_MS = 20 * 1000;
const TAIL_BYTES = 512 * 1024;

export function findTranscript(sessionId, home = CLAUDE_HOME) {
  const projects = path.join(home, 'projects');
  let dirs = [];
  try { dirs = fs.readdirSync(projects, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return null; }
  for (const d of dirs) {
    const f = path.join(projects, d.name, `${sessionId}.jsonl`);
    try { if (fs.statSync(f).isFile()) return f; } catch { /* keep looking */ }
  }
  return null;
}

function tailLines(file, bytes = TAIL_BYTES) {
  let st;
  try { st = fs.statSync(file); } catch { return []; }
  const start = Math.max(0, st.size - bytes);
  let text = '';
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(st.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    text = buf.toString('utf8');
  } catch { return []; }
  if (start > 0) text = text.slice(text.indexOf('\n') + 1);   // drop the half line at the front
  const out = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* a torn last line is fine */ }
  }
  return out;
}

// The last thing said, and whether anything is still owed to the session.
function readTail(file, now) {
  const lines = tailLines(file);
  // Only these two carry a turn. The rest - attachments, titles, latches - are bookkeeping
  // and some of them have no timestamp at all, which would read as "quiet since 1970".
  const turns = lines.filter((o) => o.type === 'assistant' || o.type === 'user');
  if (!turns.length) return null;

  const pending = new Set();
  for (const o of turns) {
    if (o.type === 'assistant') {
      for (const b of (o.message && o.message.content) || []) if (b && b.type === 'tool_use') pending.add(b.id);
    } else if (Array.isArray(o.message && o.message.content)) {
      for (const b of o.message.content) if (b && b.type === 'tool_result') pending.delete(b.tool_use_id);
    }
  }

  const last = turns[turns.length - 1];
  const stamped = [...turns].reverse().find((o) => o.timestamp);
  const at = stamped ? Date.parse(stamped.timestamp) : NaN;
  const text = last.type === 'assistant'
    ? ((last.message && last.message.content) || []).filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n').trim()
    : '';

  return {
    finished: last.type === 'assistant' && Boolean(text) && pending.size === 0,
    quietFor: Number.isFinite(at) ? now - at : null,
    since: Number.isFinite(at) ? at : null,
    text,
  };
}

// What to write on the sign. A question if there is one, otherwise the closing thought.
export function askedWhat(text) {
  const clean = String(text || '').replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return { question: null, asked: false };
  // Sentences, keeping their punctuation, so the last question can be picked out.
  const sentences = clean.match(/[^.!?]+[.!?]?/g) || [clean];
  const questions = sentences.filter((s) => s.trim().endsWith('?'));
  if (questions.length) {
    const q = questions[questions.length - 1].trim();
    return { question: q.length > 240 ? `…${q.slice(-238)}` : q, asked: true };
  }
  const tail = clean.length > 200 ? `…${clean.slice(-198)}` : clean;
  return { question: tail, asked: false };
}

// locks: the live sessions, as lib/sources.mjs reports them.
export function waitingSessions(locks, { now = Date.now(), home = CLAUDE_HOME, quietMs = QUIET_MS } = {}) {
  const out = new Map();
  for (const lock of locks || []) {
    if (!lock || !lock.alive || !lock.sessionId) continue;
    const file = findTranscript(lock.sessionId, home);
    if (!file) continue;
    let tail;
    try { tail = readTail(file, now); } catch { continue; }
    if (!tail || !tail.finished) continue;
    if (tail.quietFor == null || tail.quietFor < quietMs) continue;
    const { question, asked } = askedWhat(tail.text);
    out.set(lock.sessionId, {
      since: tail.since,
      quietFor: tail.quietFor,
      asked,                       // true when it ends on a question mark
      question,
      name: lock.name || null,
    });
  }
  return out;
}
