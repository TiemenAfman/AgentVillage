// Turns raw session aggregates into settlers, districts, sheds and milestones.
// This is where the story lives: what a house looks like, who lives in it, and why.
import fs from 'node:fs';
import path from 'node:path';
import { ms, iso } from './paths.mjs';
import { cwdKey, prettyPath, isWorktreeCwd } from './sources.mjs';
import { hash32 } from '../shared/rng.mjs';
import { ADJECTIVES, NOUNS, titleCase } from './words.mjs';

export const TIERS = [
  { id: 'tent', min: 0, label: 'Tent' },
  { id: 'hut', min: 3, label: 'Hut' },
  { id: 'cottage', min: 9, label: 'Cottage' },
  { id: 'house', min: 21, label: 'House' },
  { id: 'manor', min: 51, label: 'Manor' },
  { id: 'keep', min: 121, label: 'Keep' },
];

export const MILESTONES = [
  { id: 'well', at: 5, civicType: 'well', label: 'The village well' },
  { id: 'market', at: 10, civicType: 'market', label: 'Market stalls' },
  { id: 'clocktower', at: 20, civicType: 'clocktower', label: 'The clock tower' },
  { id: 'windmill', at: 30, civicType: 'windmill', label: 'The windmill' },
  { id: 'lighthouse', at: 50, civicType: 'lighthouse', label: 'The lighthouse' },
  { id: 'castle', at: 100, civicType: 'castle', label: 'The castle' },
];

const SHED_TYPES = {
  explore: 'Explore', plan: 'Plan', general: 'general-purpose', guide: 'claude-code-guide', other: 'Other',
};

export function styleOf(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('fable')) return 'fable';
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  return 'unknown';
}

export function tierOf(turns) {
  let out = TIERS[0].id;
  for (const t of TIERS) if (turns >= t.min) out = t.id;
  return out;
}

export function shedTypeOf(agentType) {
  const a = String(agentType || '').toLowerCase();
  if (a === 'explore') return 'explore';
  if (a === 'plan') return 'plan';
  if (a === 'general-purpose') return 'general';
  if (a.includes('guide')) return 'guide';
  return 'other';
}

export function seededName(sessionId) {
  const h = hash32(sessionId);
  return `${ADJECTIVES[h % ADJECTIVES.length]} ${NOUNS[(h >>> 8) % NOUNS.length]}`;
}

export function settlerName({ slug, processName, sessionId }) {
  if (processName) return titleCase(processName);
  if (slug) {
    const parts = String(slug).split('-').filter(Boolean);
    if (parts.length >= 2) return titleCase(parts.slice(-2).join(' '));
    if (parts.length === 1) return titleCase(parts[0]);
  }
  return seededName(sessionId);
}

function topN(obj, n) {
  return Object.fromEntries(Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, n));
}
function argmax(obj) {
  let best = null, bv = -1;
  for (const [k, v] of Object.entries(obj || {})) if (v > bv) { bv = v; best = k; }
  return best;
}
function sum(obj) { return Object.values(obj || {}).reduce((a, b) => a + b, 0); }
function pick(obj, keys) { return keys.reduce((a, k) => a + (obj[k] || 0), 0); }

export function ornamentsOf(agg) {
  const tools = agg.tools || {};
  const total = sum(tools);
  const out = [];
  const share = (keys) => (total ? pick(tools, keys) / total : 0);
  if (pick(tools, ['Bash', 'PowerShell']) >= 5 && share(['Bash', 'PowerShell']) >= 0.3) out.push('forge');
  if (pick(tools, ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) >= 3 && share(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) >= 0.25) out.push('lumber');
  if (pick(tools, ['Read', 'Grep', 'Glob']) >= 3 && share(['Read', 'Grep', 'Glob']) >= 0.3) out.push('lantern');
  if (pick(tools, ['mcp:claude-in-chrome', 'mcp:Claude_Browser']) >= 3) out.push('weathervane');
  if (pick(tools, ['WebSearch', 'WebFetch']) >= 3) out.push('pigeons');
  if ((agg.publishes || 0) >= 1) out.push('banner');
  if ((agg.apiErrors || 0) >= 3) out.push('lightningrod');
  return out;
}

export function readArrivals(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const o = JSON.parse(s);
      if (o && o.sessionId) out.push(o);
    } catch { /* a torn last line is fine */ }
  }
  return out;
}

function districtOfCwd(cwd) {
  const wt = isWorktreeCwd(cwd);
  const root = wt ? wt.parent : cwd;
  const key = cwdKey(root);
  return {
    id: `p:${key}`,
    kind: 'project',
    name: path.basename(prettyPath(root) || 'Somewhere') || prettyPath(root),
    root: prettyPath(root),
    hue: hash32(key) % 360,
    // A district that is a git repository gets an office on its square.
    gitRepo: isGitRepo(root),
    outpost: wt ? { name: wt.name } : null,
  };
}

function isGitRepo(dir) {
  try { fs.statSync(path.join(dir, '.git')); return true; } catch { return false; }
}

// Scratch and temp folders are where throwaway sessions run. They are real sessions,
// but they are not work, so they do not get a house.
const DEFAULT_EXCLUDES = ['\\appdata\\local\\temp\\', '\\scratch-workspaces\\', '\\scratchpad\\'];

function isExcluded(s, sources, arr, lock, desktop, cw, patterns) {
  const agg = s.agg;
  const paths = [
    ...(agg ? Object.keys(agg.cwds || {}) : []),
    arr && arr.cwd, lock && lock.cwd, desktop && desktop.cwd, cw && cw.cwd,
  ].filter(Boolean).map(cwdKey);
  if (!paths.length) return false;
  return paths.every((p) => patterns.some((x) => p.includes(x)));
}

// An agent the island sent out itself is a visitor: it comes for one job and goes home
// again. Anything else is a resident and keeps its house.
const VISITOR_GRACE_MS = 30 * 60 * 1000;

export function buildVillage({
  sources, cache, arrivals, config, all = false, now = Date.now(),
  banished = new Map(), dispatched = new Set(),
}) {
  const foundedAt = ms(config.foundedAt) || 0;
  const founders = new Set(config.founders || []);
  const exclude = (config.excludeCwd || DEFAULT_EXCLUDES).map((p) => String(p).toLowerCase());
  const dropped = [];   // sessions that get no house, so the layout can free their land
  const grace = config.visitorGraceMs || VISITOR_GRACE_MS;
  const aggOf = (file) => {
    const e = cache.files[file.replace(/\//g, '\\').toLowerCase()];
    return e && e.agg ? e.agg : null;
  };

  const liveSessions = new Set(sources.locks.filter((l) => l.alive).map((l) => l.sessionId));
  const lockBySession = new Map(sources.locks.filter((l) => l.alive).map((l) => [l.sessionId, l]));

  // Arrivals recorded by the session hook, grouped per session.
  const arrivalBySession = new Map();
  for (const a of arrivals) {
    const cur = arrivalBySession.get(a.sessionId) || { firstAt: a.at, lastAt: a.at, cwd: a.cwd, lastEvent: a.event, ended: false };
    cur.firstAt = Math.min(cur.firstAt, a.at);
    cur.lastAt = Math.max(cur.lastAt, a.at);
    if (a.cwd) cur.cwd = a.cwd;
    cur.lastEvent = a.event;
    if (a.event === 'SessionEnd') cur.ended = true; else cur.ended = false;
    arrivalBySession.set(a.sessionId, cur);
  }

  // ---- sessions -------------------------------------------------------------
  const sessions = new Map();
  for (const t of sources.transcripts) {
    const agg = aggOf(t.file);
    if (!agg) continue;
    sessions.set(t.sessionId, { sessionId: t.sessionId, agg, origin: t.origin, file: t.file });
  }
  for (const [sid, arr] of arrivalBySession) {
    if (sessions.has(sid)) continue;
    sessions.set(sid, { sessionId: sid, agg: null, origin: 'hook', arrival: arr });
  }

  const settlers = [];
  for (const s of sessions.values()) {
    const agg = s.agg;
    const desktop = sources.desktop.get(s.sessionId) || null;
    const cw = sources.cowork.get(s.sessionId) || null;
    const arr = arrivalBySession.get(s.sessionId) || null;
    const lock = lockBySession.get(s.sessionId) || null;

    const startedAt = (agg && agg.firstTs) || (arr && arr.firstAt) || (cw && cw.createdAt) || (desktop && desktop.createdAt) || (lock && lock.startedAt) || null;
    if (startedAt == null) continue;
    if (!all && startedAt < foundedAt && !founders.has(s.sessionId)) continue;
    if (isExcluded(s, sources, arr, lock, desktop, cw, exclude)) { dropped.push(`house:${s.sessionId}`); continue; }

    const lastAt = Math.max(
      (agg && agg.lastTs) || 0,
      (arr && arr.lastAt) || 0,
      (cw && cw.lastActivityAt) || 0,
      (desktop && desktop.lastActivityAt) || 0,
      startedAt,
    );

    const isCowork = s.origin === 'cowork' || !!cw || (agg && agg.entrypoint === 'local-agent');
    const rawCwd = (agg && argmax(agg.cwds)) || (arr && arr.cwd) || (lock && lock.cwd) || (desktop && desktop.cwd) || (cw && cw.cwd) || '';
    const district = isCowork
      ? { id: 'quay', kind: 'quay', name: 'The Quay', root: null, hue: 205, outpost: null }
      : districtOfCwd(rawCwd);

    const model = (agg && argmax(agg.models)) || (cw && cw.model) || (desktop && desktop.model) || null;
    const humanTurns = (agg && agg.humanTurns) || (desktop && desktop.completedTurns) || 0;
    const camp = !agg || agg.lines === 0;

    // A session that started and stopped again without ever writing a line said nothing
    // and did nothing. Plenty of those come and go in a day; they are not settlers.
    if (camp && !founders.has(s.sessionId)) {
      const alive = lock && lock.alive;
      const ended = arr && arr.ended;
      const stale = !arr || (now - (arr.lastAt || 0)) > 15 * 60 * 1000;
      if (!alive && (ended || stale)) { dropped.push(`house:${s.sessionId}`); continue; }
    }

    // A visitor pitches a tent, does the job it was sent for, and packs up again.
    const visiting = dispatched.has(s.sessionId);
    if (visiting) {
      const lastSeen = (agg && agg.lastTs) || (arr && arr.lastAt) || startedAt;
      const stillHere = (lock && lock.alive) || (now - lastSeen) < grace;
      if (!stillHere) { dropped.push(`house:${s.sessionId}`); continue; }
    }

    let title = null;
    if (isCowork) title = (cw && cw.title) || (agg && agg.titles.firstPrompt) || null;
    if (!title) {
      title = (agg && agg.titles.custom)
        || (desktop && desktop.titleSource === 'user' ? desktop.title : null)
        || (agg && agg.titles.ai)
        || (desktop && desktop.title)
        || (agg && agg.titles.firstPrompt)
        || (agg && agg.lastPrompt)
        || null;
    }
    if (!title) title = camp ? 'A new settler is unpacking' : 'Untitled session';

    const active = liveSessions.has(s.sessionId)
      || (camp && arr && !arr.ended && now - arr.lastAt < 10 * 60 * 1000);

    const tools = agg ? agg.tools : {};
    const tokens = agg ? agg.tokens : { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

    settlers.push({
      id: `house:${s.sessionId}`,
      sessionId: s.sessionId,
      kind: camp ? 'camp' : 'house',
      visitor: visiting,
      district,
      name: settlerName({ slug: agg && agg.slug, processName: cw && cw.processName, sessionId: s.sessionId }),
      title: String(title).slice(0, 120),
      founder: founders.has(s.sessionId),
      startedAt, lastAt, active,
      archived: sources.released.has(s.sessionId) || !!(desktop && desktop.isArchived) || !!(cw && cw.isArchived),
      source: isCowork ? 'cowork' : (agg ? 'code' : 'hook'),
      entrypoint: (agg && agg.entrypoint) || (lock && lock.entrypoint) || (isCowork ? 'local-agent' : null),
      style: styleOf(model),
      model,
      models: agg ? topN(agg.models, 4) : {},
      tier: camp || visiting ? 'tent' : tierOf(humanTurns),
      ornaments: agg ? ornamentsOf(agg) : [],
      harbour: isCowork,
      outpost: district.outpost,
      cwd: prettyPath(rawCwd) || null,
      gitBranch: (agg && agg.gitBranch) || null,
      stats: {
        humanTurns,
        assistantMsgs: (agg && agg.assistantMsgs) || 0,
        toolCalls: sum(tools),
        filesTouched: (agg && agg.filesTouched) || 0,
        tokens,
        apiErrors: (agg && agg.apiErrors) || 0,
        publishes: (agg && agg.publishes) || 0,
        durationMs: Math.max(0, lastAt - startedAt),
      },
      tools: topN(tools, 12),
      sheds: [],
      agents: (agg && agg.agents) || {},
    });
  }

  // Anyone sent off the island stays off it until they are asked back.
  const exiled = settlers.filter((s) => banished.has(s.id));
  const stayed = settlers.filter((s) => !banished.has(s.id));
  settlers.length = 0;
  settlers.push(...stayed);

  const byId = new Map(settlers.map((s) => [s.id, s]));

  // ---- sheds (subagents) ----------------------------------------------------
  const sheds = [];
  for (const sa of sources.subagents) {
    const master = byId.get(`house:${sa.sessionId}`);
    if (!master) continue;                                   // master gone, apprentice goes too
    if (banished.has(`shed:${sa.sessionId}:${sa.agentId}`)) continue;
    const agg = aggOf(sa.file);
    const meta = sa.meta || {};
    const fromParent = master.agents[sa.agentId] || {};
    const agentType = meta.agentType || fromParent.agentType || 'Agent';
    const model = (agg && argmax(agg.models)) || fromParent.resolvedModel || null;
    const startedAt = (agg && agg.firstTs) || master.startedAt;
    const lastAt = Math.max((agg && agg.lastTs) || 0, startedAt);
    const description = meta.description || fromParent.description || null;
    const tools = agg ? agg.tools : {};
    const id = `shed:${sa.sessionId}:${sa.agentId}`;
    master.sheds.push(id);
    sheds.push({
      id,
      sessionId: sa.sessionId,
      kind: 'shed',
      district: master.district,
      master: master.id,
      shedType: shedTypeOf(agentType),
      agentType,
      description: description ? String(description).slice(0, 100) : null,
      name: `${master.name}'s ${agentType} apprentice`,
      title: description ? String(description).slice(0, 100) : `${agentType} subagent`,
      startedAt, lastAt,
      active: master.active && now - lastAt < 120000,
      archived: master.archived,
      source: master.source,
      entrypoint: master.entrypoint,
      style: styleOf(model),
      model,
      tier: 'shed',
      ornaments: [],
      harbour: false,
      outpost: null,
      stats: {
        humanTurns: 0,
        assistantMsgs: (agg && agg.assistantMsgs) || 0,
        toolCalls: sum(tools),
        filesTouched: (agg && agg.filesTouched) || 0,
        tokens: agg ? agg.tokens : { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
        apiErrors: (agg && agg.apiErrors) || 0,
        publishes: 0,
        durationMs: Math.max(0, lastAt - startedAt),
      },
      tools: topN(tools, 12),
      spawnDepth: meta.spawnDepth || 1,
    });
  }

  for (const s of settlers) delete s.agents;

  // ---- districts ------------------------------------------------------------
  const districts = new Map();
  for (const s of settlers) {
    const d = districts.get(s.district.id) || { ...s.district, firstSeenAt: s.startedAt, population: 0 };
    d.firstSeenAt = Math.min(d.firstSeenAt, s.startedAt);
    d.population++;
    if (s.district.outpost && !d.outposts) d.outposts = [];
    if (s.district.outpost) d.outposts.push(s.district.outpost.name);
    districts.set(d.id, d);
  }
  for (const s of settlers) s.district = s.district.id;
  for (const s of sheds) s.district = s.district.id;
  const districtList = [...districts.values()].sort((a, b) => a.firstSeenAt - b.firstSeenAt || a.id.localeCompare(b.id));

  // ---- milestones -----------------------------------------------------------
  const ordered = [...settlers].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  const milestones = MILESTONES.map((m) => {
    const nth = ordered[m.at - 1];
    return {
      id: m.id, at: m.at, civicType: m.civicType, label: m.label,
      unlocked: !!nth, unlockedAt: nth ? nth.startedAt : null,
      building: nth ? `civic:${m.civicType}` : null,
    };
  });

  const buildings = [...settlers, ...sheds];
  const bricks = buildings.reduce((a, b) => a + (b.stats.tokens.output || 0), 0);

  return {
    buildings,
    districts: districtList,
    dropped,
    milestones,
    stats: {
      settlers: settlers.length,
      apprentices: sheds.length,
      quayArrivals: settlers.filter((s) => s.harbour).length,
      districts: districtList.length,
      founded: iso(foundedAt),
      exiles: exiled.length,
      bricks,
      toolCalls: buildings.reduce((a, b) => a + b.stats.toolCalls, 0),
      filesTouched: buildings.reduce((a, b) => a + b.stats.filesTouched, 0),
    },
  };
}
