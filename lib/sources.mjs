// Where the settlers come from: every place on this machine that records a Claude session.
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_HOME, DESKTOP_DIR, readJson } from './paths.mjs';
import { isPidAlive } from './lock.mjs';

const SID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function cwdKey(p) {
  if (!p) return '';
  return String(p).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

export function prettyPath(p) {
  if (!p) return p;
  const s = String(p).replace(/\//g, '\\').replace(/\\+$/, '');
  return s.replace(/^([a-z]):/, (m, d) => d.toUpperCase() + ':');
}

export function isWorktreeCwd(cwd) {
  const m = /^(.*?)[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)/i.exec(String(cwd || ''));
  return m ? { parent: m[1], name: m[2] } : null;
}

function readdirSafe(dir, opts) {
  try { return fs.readdirSync(dir, opts); } catch { return []; }
}
function statSafe(f) {
  try { return fs.statSync(f); } catch { return null; }
}

export function discover({ claudeHome = CLAUDE_HOME, desktopDir = DESKTOP_DIR } = {}) {
  const transcripts = [];
  const subagents = [];
  const locks = [];
  const desktop = new Map();
  const cowork = new Map();
  const released = new Map();

  // 1. Claude Code transcripts and their subagent sidecars.
  const projects = path.join(claudeHome, 'projects');
  for (const slugDir of readdirSafe(projects, { withFileTypes: true })) {
    if (!slugDir.isDirectory()) continue;
    const dir = path.join(projects, slugDir.name);
    for (const ent of readdirSafe(dir, { withFileTypes: true })) {
      if (ent.isFile()) {
        const rel = /^(.+)\.desktop-released\.json$/i.exec(ent.name);
        if (rel) {
          const info = readJson(path.join(dir, ent.name), null);
          if (info) released.set(rel[1], info);
          continue;
        }
        const m = /^(.+)\.jsonl$/i.exec(ent.name);
        if (!m || !SID.test(m[1])) continue;
        const file = path.join(dir, ent.name);
        const st = statSafe(file);
        if (!st) continue;
        transcripts.push({
          sessionId: m[1], file, size: st.size, mtimeMs: st.mtimeMs,
          origin: 'code', slugDir: slugDir.name,
        });
      } else if (ent.isDirectory() && SID.test(ent.name)) {
        const subDir = path.join(dir, ent.name, 'subagents');
        for (const f of readdirSafe(subDir)) {
          const am = /^agent-(.+)\.jsonl$/i.exec(f);
          if (!am) continue;
          const file = path.join(subDir, f);
          const st = statSafe(file);
          if (!st) continue;
          subagents.push({
            sessionId: ent.name, agentId: am[1], file, size: st.size, mtimeMs: st.mtimeMs,
            meta: readJson(path.join(subDir, `agent-${am[1]}.meta.json`), null),
          });
        }
      }
    }
  }

  // 2. Live session locks (one per running Claude Code process).
  const sessionsDir = path.join(claudeHome, 'sessions');
  for (const f of readdirSafe(sessionsDir)) {
    if (!/^\d+\.json$/.test(f)) continue;
    const info = readJson(path.join(sessionsDir, f), null);
    if (!info || !info.sessionId) continue;
    const pid = Number(f.slice(0, -5));
    locks.push({ ...info, pid, alive: isPidAlive(pid) });
  }

  // 3. The Desktop app's own index: titles, models, turn counts.
  const codeSessions = path.join(desktopDir, 'claude-code-sessions');
  for (const acct of readdirSafe(codeSessions, { withFileTypes: true })) {
    if (!acct.isDirectory()) continue;
    for (const ws of readdirSafe(path.join(codeSessions, acct.name), { withFileTypes: true })) {
      if (!ws.isDirectory()) continue;
      const dir = path.join(codeSessions, acct.name, ws.name);
      for (const f of readdirSafe(dir)) {
        if (!/^local_.*\.json$/i.test(f)) continue;
        const r = readJson(path.join(dir, f), null);
        if (!r || !r.cliSessionId) continue;
        const prev = desktop.get(r.cliSessionId);
        if (prev && (prev.lastActivityAt || 0) > (r.lastActivityAt || 0)) continue;
        desktop.set(r.cliSessionId, {
          title: r.title || null, titleSource: r.titleSource || null, model: r.model || null,
          cwd: r.cwd || r.originCwd || null, createdAt: r.createdAt || null,
          lastActivityAt: r.lastActivityAt || null, completedTurns: r.completedTurns || 0,
          isArchived: !!r.isArchived,
        });
      }
    }
  }

  // 4. Cowork tasks. Their transcript lives in a private Claude home per task; we look
  //    it up by name instead of walking the task folder (which holds a plugin payload).
  const agentSessions = path.join(desktopDir, 'local-agent-mode-sessions');
  for (const acct of readdirSafe(agentSessions, { withFileTypes: true })) {
    if (!acct.isDirectory()) continue;
    for (const ws of readdirSafe(path.join(agentSessions, acct.name), { withFileTypes: true })) {
      if (!ws.isDirectory()) continue;
      const dir = path.join(agentSessions, acct.name, ws.name);
      for (const f of readdirSafe(dir)) {
        const m = /^(local_[0-9a-f-]{36})\.json$/i.exec(f);
        if (!m) continue;
        const r = readJson(path.join(dir, f), null);
        if (!r || !r.cliSessionId) continue;
        let transcript = null;
        const projDir = path.join(dir, m[1], '.claude', 'projects');
        for (const sub of readdirSafe(projDir, { withFileTypes: true })) {
          if (!sub.isDirectory()) continue;
          const cand = path.join(projDir, sub.name, `${r.cliSessionId}.jsonl`);
          const st = statSafe(cand);
          if (st) { transcript = { file: cand, size: st.size, mtimeMs: st.mtimeMs }; break; }
        }
        cowork.set(r.cliSessionId, {
          taskId: m[1], processName: r.processName || r.vmProcessName || null,
          title: r.title || null, model: r.model || null, cwd: r.cwd || null,
          createdAt: r.createdAt || null, lastActivityAt: r.lastActivityAt || null,
          isArchived: !!r.isArchived, transcript,
        });
        if (transcript) {
          transcripts.push({
            sessionId: r.cliSessionId, file: transcript.file, size: transcript.size,
            mtimeMs: transcript.mtimeMs, origin: 'cowork', taskId: m[1],
          });
        }
      }
    }
  }

  return { transcripts, subagents, locks, desktop, cowork, released };
}
