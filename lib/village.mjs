// Turns raw session aggregates into settlers, districts, sheds and milestones.
// This is where the story lives: what a house looks like, who lives in it, and why.
import fs from 'node:fs';
import path from 'node:path';
import { ms, iso } from './paths.mjs';
import { cwdKey, prettyPath } from './sources.mjs';
import { createRepoResolver, foldKeys, districtNameOf } from './repos.mjs';
import { hash32 } from '../shared/rng.mjs';
import { ADJECTIVES, NOUNS, titleCase } from './words.mjs';
import { waitingSessions } from './waiting.mjs';

export const TIERS = [
  { id: 'tent', min: 0, label: 'Tent' },
  { id: 'hut', min: 3, label: 'Hut' },
  { id: 'cottage', min: 9, label: 'Cottage' },
  { id: 'house', min: 21, label: 'House' },
  { id: 'manor', min: 51, label: 'Manor' },
  { id: 'keep', min: 121, label: 'Keep' },
];

// `on` says which population a milestone counts. Everything is measured in settlers
// except the school, which is where the apprentices are taught and so waits for them.
export const MILESTONES = [
  { id: 'well', at: 5, civicType: 'well', label: 'The village well' },
  { id: 'market', at: 10, civicType: 'market', label: 'Market stalls' },
  { id: 'tavern', at: 15, civicType: 'tavern', label: 'The tavern' },
  { id: 'clocktower', at: 20, civicType: 'clocktower', label: 'The clock tower' },
  { id: 'tables', at: 25, civicType: 'tables', label: 'Tables on the square' },
  { id: 'school', at: 25, on: 'apprentices', civicType: 'school', label: 'The school' },
  { id: 'windmill', at: 30, civicType: 'windmill', label: 'The windmill' },
  { id: 'chapel', at: 40, civicType: 'chapel', label: 'The chapel' },
  { id: 'fountain', at: 45, civicType: 'fountain', label: 'The fountain' },
  { id: 'lighthouse', at: 50, civicType: 'lighthouse', label: 'The lighthouse' },
  { id: 'statue', at: 70, civicType: 'statue', label: 'The statue' },
  { id: 'castle', at: 100, civicType: 'castle', label: 'The castle' },
];

// What stands on the square, as opposed to what is built around it. The milestones
// above are the town's standing: a hall, a chapel, a castle, one of each, earned by
// the settlers who have lived here. This is the town's life, and it is earned by the
// apprentices, because a crowd is what makes a square worth furnishing. It arrives a
// piece at a time rather than all at once, and the square fills up as the work does.
export const FURNITURE = [
  { kind: 'planter', label: 'Flower beds', per: 30, max: 6 },
  { kind: 'lamp', label: 'Street lamps', per: 45, max: 6 },
  { kind: 'bench', label: 'Benches', per: 60, max: 5 },
  { kind: 'terrace', label: 'Terraces', per: 110, max: 3 },
];

function furnitureFor(apprentices) {
  const out = [];
  for (const f of FURNITURE) {
    const n = Math.min(f.max, Math.floor(apprentices / f.per));
    for (let i = 0; i < n; i++) {
      out.push({
        id: `civic:${f.kind}:${i + 1}`,
        kind: f.kind,
        label: f.label,
        at: f.per * (i + 1),
      });
    }
  }
  return out;
}

// Above this many apprentices a session stops putting up sheds and builds a tower.
const HOTEL_AT = 10;
const ROOMS_PER_FLOOR = 5;

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

// A district is the repository a session's folder belongs to - see lib/repos.mjs for the
// walk and the folding rules. The hue is hashed from the key, so a hamlet keeps its
// colour for as long as it keeps its repository.
function districtOfKey(key, root, outpost, gitRepo) {
  return {
    id: `p:${key}`,
    kind: 'project',
    name: districtNameOf(root),
    root: prettyPath(root),
    hue: hash32(key) % 360,
    // A district that is a git repository gets an office on its square. The resolver
    // already walked up to find the repository and cached the answer, so it knows this
    // without another look at the disk.
    gitRepo: !!gitRepo,
    outpost: outpost ? { name: outpost } : null,
  };
}

// Where sessions live that are not work on a project: a cwd in System32, in Downloads,
// or a folder that is only a shelf for other projects. They are real sessions and keep
// their houses; they just do not found a hamlet.
const OUTLANDS = { id: 'outlands', kind: 'outlands', name: 'The Outlands', root: null, hue: 95, outpost: null };

// Where inside the repository a session actually worked, for the label on its house.
function relativeCwd(root, cwd) {
  if (!root || !cwd) return null;
  const a = cwdKey(root), b = cwdKey(cwd);
  if (b === a || !b.startsWith(`${a}\\`)) return null;
  return prettyPath(cwd).slice(prettyPath(root).length + 1).split(path.sep).join('/');
}

// Scratch and temp folders are where throwaway sessions run. They are real sessions,
// but they are not work, so they do not get a house.
const DEFAULT_EXCLUDES = ['\\appdata\\local\\temp\\', '\\scratch-workspaces\\', '\\scratchpad\\'];

// A milder verdict than the list above: these are real sessions doing real work from a
// silly working directory. They get a house, but no hamlet of their own.
const DEFAULT_NO_PROJECT = [
  '\\windows\\system32', '\\windows\\syswow64', '\\program files',
  '\\downloads', '\\onedrive\\desktop',
];

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
  const noProjectPatterns = (config.noProjectCwd || DEFAULT_NO_PROJECT).map((p) => String(p).toLowerCase());
  const repos = createRepoResolver({ cache, now, config });
  const repoKinds = new Map();          // key -> { kind }, the input to foldKeys
  const repoRootOf = new Map();         // key -> the folder name as it is on disk
  const dropped = [];   // sessions that get no house, so the layout can free their land
  const grace = config.visitorGraceMs || VISITOR_GRACE_MS;
  const aggOf = (file) => {
    const e = cache.files[file.replace(/\//g, '\\').toLowerCase()];
    return e && e.agg ? e.agg : null;
  };

  const liveSessions = new Set(sources.locks.filter((l) => l.alive).map((l) => l.sessionId));
  const lockBySession = new Map(sources.locks.filter((l) => l.alive).map((l) => [l.sessionId, l]));
  // Of the sessions that are running, which have stopped and are waiting on you.
  const waitingBySession = waitingSessions(sources.locks, { now });

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
    let district;
    if (isCowork) {
      district = { id: 'quay', kind: 'quay', name: 'The Quay', root: null, hue: 205, outpost: null };
    } else {
      const res = repos.resolve(rawCwd);
      repoKinds.set(res.key, { kind: res.kind });
      if (!repoRootOf.has(res.key)) repoRootOf.set(res.key, res.root);
      district = districtOfKey(res.key, res.root, res.worktree, res.kind !== 'none');
    }

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
      // Set when the session is running but has stopped and is waiting on a person.
      // `asked` marks the ones that ended on a question, which is the flag worth walking to.
      waiting: waitingBySession.get(s.sessionId) || null,
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

  // ---- one hamlet per repository --------------------------------------------
  // Walking up to a `.git` leaves folders over that have none, and folders that are
  // only a shelf for other projects. `foldKeys` decides where each of those belongs;
  // this is where the verdict is applied. It runs before the sheds, so an apprentice
  // inherits the district its master ended up in.
  {
    const noProject = new Set();
    for (const key of repoKinds.keys()) {
      if (noProjectPatterns.some((p) => key.includes(p))) noProject.add(key);
    }
    const folded = foldKeys(repoKinds, { noProject });
    const cacheOf = new Map();
    for (const s of settlers) {
      if (s.district.kind !== 'project') continue;
      const key = s.district.id.slice(2);
      const to = folded.has(key) ? folded.get(key) : key;
      if (to === key) continue;                      // stayed where it was
      if (to === null || to === undefined) { s.district = OUTLANDS; continue; }
      let d = cacheOf.get(to);
      if (!d) {
        const kind = (repoKinds.get(to) || {}).kind;
        d = districtOfKey(to, repoRootOf.get(to) || to, null, kind && kind !== 'none');
        cacheOf.set(to, d);
      }
      // A worktree is a property of the session, not of the hamlet it moved into.
      s.district = s.district.outpost ? { ...d, outpost: s.district.outpost } : d;
    }
  }

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
      run: sa.run || null,          // the workflow run this one belonged to, if any
    });
  }

  // ---- lodgings ---------------------------------------------------------------
  // One apprentice is a shed in the yard. A hundred of them are not a hundred sheds:
  // there is no room for that around a single house, and it would not read as anything
  // if there were. Past a dozen the session builds upward instead. Its apprentices take
  // the rooms, one window each, and the session itself keeps the penthouse.
  const byMaster = new Map();
  for (const s of sheds) {
    const a = byMaster.get(s.master);
    if (a) a.push(s); else byMaster.set(s.master, [s]);
  }
  for (const s of settlers) {
    const rooms = byMaster.get(s.id);
    if (!rooms || rooms.length < HOTEL_AT) continue;
    const runs = new Set(rooms.map((r) => r.run).filter(Boolean));
    s.hotel = {
      rooms: rooms.length,
      floors: Math.max(2, Math.min(14, Math.ceil(rooms.length / ROOMS_PER_FLOOR))),
      busy: rooms.filter((r) => r.active).length,
      runs: [...runs],
    };
    for (const r of rooms) r.roomed = true;      // lodged indoors, so no shed of its own
  }

  for (const s of settlers) delete s.agents;

  // ---- districts ------------------------------------------------------------
  // A hamlet is one repository, so the subfolder and the branch a session worked in are
  // no longer visible in where its house stands. Tally them here instead, so the sign
  // stays the project and the detail reappears on the house that earned it.
  const districts = new Map();
  const subCounts = new Map();      // district id -> { folders: {rel: n}, branches: {name: n} }
  for (const s of settlers) {
    const d = districts.get(s.district.id) || { ...s.district, firstSeenAt: s.startedAt, population: 0 };
    d.firstSeenAt = Math.min(d.firstSeenAt, s.startedAt);
    d.population++;
    if (s.district.outpost && !d.outposts) d.outposts = [];
    if (s.district.outpost) d.outposts.push(s.district.outpost.name);
    districts.set(d.id, d);

    const sub = subCounts.get(d.id) || { folders: {}, branches: {} };
    const rel = relativeCwd(d.root, s.cwd);
    if (rel) sub.folders[rel] = (sub.folders[rel] || 0) + 1;
    const br = s.gitBranch;
    if (br && br !== 'main' && br !== 'master') sub.branches[br] = (sub.branches[br] || 0) + 1;
    subCounts.set(d.id, sub);
  }
  for (const d of districts.values()) {
    const sub = subCounts.get(d.id);
    if (!sub) continue;
    d.folders = topN(sub.folders, 4);
    d.branches = topN(sub.branches, 4);
  }
  for (const s of settlers) s.district = s.district.id;
  for (const s of sheds) s.district = s.district.id;
  const districtList = [...districts.values()].sort((a, b) => a.firstSeenAt - b.firstSeenAt || a.id.localeCompare(b.id));

  // ---- milestones -----------------------------------------------------------
  const byArrival = (a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id);
  const ordered = [...settlers].sort(byArrival);
  const orderedSheds = [...sheds].sort(byArrival);
  const milestones = MILESTONES.map((m) => {
    const on = m.on === 'apprentices' ? 'apprentices' : 'settlers';
    const nth = (on === 'apprentices' ? orderedSheds : ordered)[m.at - 1];
    return {
      id: m.id, at: m.at, on, civicType: m.civicType, label: m.label,
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
    furniture: furnitureFor(sheds.length),
    stats: {
      settlers: settlers.length,
      apprentices: sheds.length,
      quayArrivals: settlers.filter((s) => s.harbour).length,
      waiting: settlers.filter((s) => s.waiting).length,
      asked: settlers.filter((s) => s.waiting && s.waiting.asked).length,
      districts: districtList.length,
      founded: iso(foundedAt),
      exiles: exiled.length,
      bricks,
      toolCalls: buildings.reduce((a, b) => a + b.stats.toolCalls, 0),
      filesTouched: buildings.reduce((a, b) => a + b.stats.filesTouched, 0),
    },
  };
}
