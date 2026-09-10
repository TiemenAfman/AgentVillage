// Incremental JSONL transcript reader.
//
// Transcripts are append-only, and some are 20 MB+ with single lines over a megabyte,
// so we never re-read what we already folded in: the cache remembers the byte offset
// after the last complete line plus the aggregate so far.
import fs from 'node:fs';

export const AGG_VERSION = 1;

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const MAX_FILES = 300;

export function newAgg(sessionId) {
  return {
    v: AGG_VERSION,
    sessionId,
    lines: 0,
    badLines: 0,
    firstTs: null,
    lastTs: null,
    cwds: {},
    entrypoint: null,
    gitBranch: null,
    version: null,
    slug: null,
    effort: null,
    models: {},
    humanTurns: 0,
    assistantMsgs: 0,
    tools: {},
    files: {},
    filesTouched: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    apiErrors: 0,
    publishes: 0,
    agentSpawns: 0,
    titles: { custom: null, ai: null, firstPrompt: null },
    lastPrompt: null,
    agents: {},
  };
}

function bump(map, key, by = 1) { if (key) map[key] = (map[key] || 0) + by; }

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const b = content.find((x) => x && x.type === 'text' && typeof x.text === 'string');
    return b ? b.text : null;
  }
  return null;
}

function collapseTool(name) {
  if (typeof name !== 'string') return null;
  const m = /^mcp__(.+?)__/.exec(name);
  return m ? `mcp:${m[1]}` : name;
}

// One line of a transcript folded into the aggregate. `state` carries the last seen
// message id, because Claude Code writes one assistant line per content block and all
// of them repeat the same usage numbers -- summing naively overstates tokens ~2.7x.
export function foldLine(agg, o, state) {
  if (!o || typeof o !== 'object') return;
  agg.lines++;
  const type = o.type;

  if (o.timestamp) {
    const t = Date.parse(o.timestamp);
    if (Number.isFinite(t)) {
      if (agg.firstTs == null || t < agg.firstTs) agg.firstTs = t;
      if (agg.lastTs == null || t > agg.lastTs) agg.lastTs = t;
    }
  }
  if (o.cwd) bump(agg.cwds, o.cwd);
  if (o.entrypoint) agg.entrypoint = o.entrypoint;
  if (o.gitBranch) agg.gitBranch = o.gitBranch;
  if (o.version) agg.version = o.version;
  if (o.slug) agg.slug = o.slug;
  if (o.effort) agg.effort = o.effort;

  switch (type) {
    case 'assistant': {
      const msg = o.message;
      if (!msg) break;
      if (msg.id && msg.id !== state.lastMsgId) {
        state.lastMsgId = msg.id;
        agg.assistantMsgs++;
        if (msg.model && msg.model !== '<synthetic>') bump(agg.models, msg.model);
        const u = msg.usage;
        if (u) {
          agg.tokens.input += u.input_tokens || 0;
          agg.tokens.output += u.output_tokens || 0;
          agg.tokens.cacheRead += u.cache_read_input_tokens || 0;
          agg.tokens.cacheCreation += u.cache_creation_input_tokens || 0;
        }
      }
      const content = msg.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (!b || b.type !== 'tool_use') continue;
          const name = collapseTool(b.name);
          bump(agg.tools, name);
          if (b.name === 'Agent' || b.name === 'Task') agg.agentSpawns++;
          if (EDIT_TOOLS.has(b.name)) {
            const f = b.input && (b.input.file_path || b.input.notebook_path);
            if (f && agg.filesTouched < MAX_FILES && !agg.files[f]) { agg.files[f] = 1; agg.filesTouched++; }
          }
        }
      }
      break;
    }
    case 'user': {
      const origin = o.origin && o.origin.kind;
      if (origin === 'human' && !o.isMeta) {
        agg.humanTurns++;
        if (!agg.titles.firstPrompt) {
          const t = textOf(o.message && o.message.content);
          if (t) {
            const clean = t.replace(/\s+/g, ' ').trim();
            if (clean && !clean.startsWith('<')) agg.titles.firstPrompt = clean.slice(0, 100);
          }
        }
      }
      const r = o.toolUseResult;
      if (r && r.agentId) {
        agg.agents[r.agentId] = {
          agentType: r.agentType || null,
          resolvedModel: r.resolvedModel || null,
          status: r.status || null,
          toolUseId: r.toolUseId || o.sourceToolUseID || null,
          description: typeof r.description === 'string' ? r.description.slice(0, 120) : null,
        };
      }
      break;
    }
    case 'system':
      if (o.subtype === 'api_error') agg.apiErrors++;
      break;
    case 'frame-link':
      agg.publishes++;
      break;
    case 'custom-title':
      if (o.customTitle) agg.titles.custom = String(o.customTitle).slice(0, 160);
      break;
    case 'ai-title':
      if (o.aiTitle) agg.titles.ai = String(o.aiTitle).slice(0, 160);
      break;
    case 'last-prompt':
      if (typeof o.lastPrompt === 'string') agg.lastPrompt = o.lastPrompt.replace(/\s+/g, ' ').trim().slice(0, 100);
      break;
    default:
      break;
  }
}

// Reads from `start` and calls onLine for every COMPLETE line. Returns the byte offset
// just after the last newline, so a half-written line is picked up on the next pass.
async function readLines(file, start, onLine) {
  let carry = Buffer.alloc(0);
  let committed = start;
  const stream = fs.createReadStream(file, { start });
  for await (const chunk of stream) {
    const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    let from = 0, nl;
    while ((nl = buf.indexOf(10, from)) !== -1) {
      const end = nl > from && buf[nl - 1] === 13 ? nl - 1 : nl;
      if (end > from) onLine(buf.toString('utf8', from, end));
      from = nl + 1;
    }
    committed += from;
    carry = from ? buf.subarray(from) : buf;
    // keep `carry` from growing without bound if a line is enormous: it is bounded by
    // the longest line in the file, which we know can reach ~1.4 MB. That is fine.
  }
  return committed;
}

export async function parseIncremental(file, sessionId, prev) {
  let st;
  try { st = fs.statSync(file); } catch { return { entry: prev ? { ...prev, missing: true } : null, changed: !!prev }; }

  if (prev && !prev.missing && prev.size === st.size && prev.mtimeMs === st.mtimeMs && prev.agg && prev.agg.v === AGG_VERSION) {
    return { entry: prev, changed: false };
  }

  const resumable = prev && !prev.missing && prev.agg && prev.agg.v === AGG_VERSION && st.size >= prev.offset;
  const agg = resumable ? structuredClone(prev.agg) : newAgg(sessionId);
  const start = resumable ? prev.offset : 0;
  const state = { lastMsgId: resumable && prev.lastMsgId ? prev.lastMsgId : null };

  const offset = await readLines(file, start, (line) => {
    let o;
    try { o = JSON.parse(line); } catch { agg.badLines++; return; }
    try { foldLine(agg, o, state); } catch { agg.badLines++; }
  });

  return {
    entry: { size: st.size, mtimeMs: st.mtimeMs, offset, agg, lastMsgId: state.lastMsgId },
    changed: true,
  };
}

// Small promise pool: this work is I/O bound, four at a time keeps the disk busy
// without opening 143 streams at once.
export async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
