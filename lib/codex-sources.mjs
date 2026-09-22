// Codex rollouts are a separate population. Only transcript metadata and aggregate
// counters survive parsing; instructions, tool arguments and tool output stay on disk.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const CODEX_HOME = process.env.SETTLERS_CODEX_HOME || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

export function discoverCodex(home = CODEX_HOME) {
  const found = new Map(), desktop = new Map(), released = new Map();
  function walk(dir, archived = false) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const file = path.join(dir, e.name);
      if (e.isDirectory()) { walk(file, archived); continue; }
      const match = /^rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(e.name);
      if (!match) continue;
      const st = fs.statSync(file), sessionId = match[1];
      if (archived) released.set(sessionId, true);
      const prev = found.get(sessionId);
      if (!prev || st.mtimeMs > prev.mtimeMs) found.set(sessionId,
        { sessionId, file, size: st.size, mtimeMs: st.mtimeMs, origin: 'codex' });
    }
  }
  walk(path.join(home, 'sessions'));
  walk(path.join(home, 'archived_sessions'), true);
  try {
    for (const line of fs.readFileSync(path.join(home, 'session_index.jsonl'), 'utf8').split('\n')) {
      try {
        const r = JSON.parse(line);
        if (r.id && r.thread_name) desktop.set(r.id, { title: r.thread_name, titleSource: 'user' });
      } catch { /* incomplete index tail */ }
    }
  } catch { /* CLI-only homes need no desktop index */ }
  return { transcripts: [...found.values()], subagents: [], locks: [], desktop, cowork: new Map(), released };
}

export function foldCodex(agg, row) {
  agg.lines++;
  const p = row.payload || {};
  const time = Date.parse(row.timestamp || p.timestamp);
  if (Number.isFinite(time)) {
    agg.firstTs = agg.firstTs == null ? time : Math.min(agg.firstTs, time);
    agg.lastTs = agg.lastTs == null ? time : Math.max(agg.lastTs, time);
  }
  const bump = (map, key) => { if (key) map[key] = (map[key] || 0) + 1; };
  if (row.type === 'session_meta' || row.type === 'turn_context') {
    bump(agg.cwds, p.cwd);
    bump(agg.models, p.model);
    agg.entrypoint = 'codex';
    if (p.git?.branch) agg.gitBranch = p.git.branch;
    if (p.cli_version) agg.version = p.cli_version;
  }
  if (row.type === 'event_msg') {
    if (p.type === 'task_started') agg.codexRunning = true;
    if (p.type === 'task_complete' || p.type === 'turn_aborted') agg.codexRunning = false;
    // Totals are cumulative, repeated on multiple events; summing counts every token
    // many times. Keep the latest total, including across incremental reads.
    const u = p.type === 'token_count' && p.info?.total_token_usage;
    if (u) {
      agg.tokens.input = Math.max(0, (u.input_tokens || 0) - (u.cached_input_tokens || 0));
      agg.tokens.cacheRead = u.cached_input_tokens || 0;
      agg.tokens.output = u.output_tokens || 0;
    }
  }
  if (row.type !== 'response_item') return;
  if (p.type === 'message' && p.role === 'user') {
    const text = (p.content || []).filter(x => x.type === 'input_text').map(x => x.text || '').join('\n').trim();
    // These are session context records, not turns spoken by the person.
    if (!text || /^(?:<|# AGENTS\.md)/.test(text)) return;
    agg.humanTurns++;
    const title = text.replace(/\s+/g, ' ').slice(0, 100);
    agg.titles.firstPrompt ||= title;
    agg.lastPrompt = title;
  }
  if (p.type === 'message' && p.role === 'assistant') agg.assistantMsgs++;
  if (p.type === 'function_call' || p.type === 'custom_tool_call') {
    bump(agg.tools, p.name);
    if (/spawn_agent$/.test(p.name || '')) agg.agentSpawns++;
  }
}
