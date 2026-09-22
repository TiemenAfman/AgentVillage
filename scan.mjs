#!/usr/bin/env node
// Reads every Claude session record on this machine and writes data/village.json,
// the single file the island viewer consumes.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, ROOT, ensureData, loadConfig, islandNameOf, readJson, writeJsonAtomic, iso } from './lib/paths.mjs';
import { discover } from './lib/sources.mjs';
import { parseIncremental, mapPool } from './lib/parse.mjs';
import { loadCache, saveCache, fileKey } from './lib/cache.mjs';
import { buildVillage, readArrivals, MILESTONES } from './lib/village.mjs';
import { loadSprint, readAssignments } from './lib/sprint.mjs';
import { loadIssues, githubConfig } from './lib/issues.mjs';
import { readBanished } from './lib/banish.mjs';
import {
  loadLayout, saveLayout, placeAll, clearRoads, POLDER_AT, POLDER_EVERY, FAIRWAY_AT, BRIDGE_AT, SQUARE_STEPS, MIN_HAMLET, TOWN_CORE_R,
} from './lib/layout.mjs';
import { hash32 } from './shared/rng.mjs';
import { withScanLock } from './lib/lock.mjs';
import { runPlan } from './lib/plan.mjs';

export function parseArgs(argv) {
  const o = { all: false, quiet: false, persistLayout: true, out: null, layoutFile: null, cacheFile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') o.all = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--no-layout-persist') o.persistLayout = false;
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--layout-file') o.layoutFile = argv[++i];
    else if (a === '--cache-file') o.cacheFile = argv[++i];
  }
  return o;
}

export function filesFor(opts) {
  const suffix = opts.all ? '.all' : '';
  return {
    village: opts.out || path.join(DATA, `village${suffix}.json`),
    layout: opts.layoutFile || path.join(DATA, `layout${suffix}.json`),
    cache: opts.cacheFile || path.join(DATA, 'cache.json'),
    arrivals: path.join(DATA, 'arrivals.jsonl'),
    // Beside the layout, wherever that is: the real island's is data/placements.json, and a
    // test that scans a copy in a scratch directory must never forget the real island's.
    placements: path.join(path.dirname(opts.layoutFile || path.join(DATA, `layout${suffix}.json`)), 'placements.json'),
  };
}

export async function scan(opts = {}) {
  const o = { all: false, quiet: true, persistLayout: true, ...opts };
  return withScanLock(() => runScan(o));
}

// A real deletion, unlike scan({ clearRoads: true }): this never calls placeAll, so
// nothing heals what it removes - it writes layout.json and village.json straight to
// disk and stops. It lasts exactly until the next scan, whether that is the timer or
// /roads redraw/reroute, because placeAll never leaves a house without a road; that is
// not a bug this works around, it is what makes /roads delete mean something different
// from /roads reroute for however long it lasts.
export async function deleteRoads(opts = {}) {
  const o = { all: false, ...opts };
  return withScanLock(() => runDeleteRoads(o));
}

async function runDeleteRoads(o) {
  ensureData();
  const config = loadConfig();
  const files = filesFor(o);
  const size = config.gridSize || 64;

  const layout = loadLayout(files.layout, config.seed, size);
  clearRoads(layout);
  saveLayout(files.layout, layout);

  const village = readJson(files.village, null);
  if (village) {
    village.paths = [];
    village.generatedAt = new Date().toISOString();
    writeJsonAtomic(files.village, village);
  }

  return { ok: true, paths: 0 };
}

async function runScan(o) {
  const t0 = Date.now();
  ensureData();
  const config = loadConfig();
  const files = filesFor(o);
  const size = config.gridSize || 64;

  const sources = discover();
  const cache = loadCache(files.cache);

  const jobs = [
    ...sources.transcripts.map((t) => ({ file: t.file, sessionId: t.sessionId })),
    ...sources.subagents.map((s) => ({ file: s.file, sessionId: s.sessionId })),
  ];
  let changedFiles = 0;
  const seen = new Set();
  await mapPool(jobs, 4, async (j) => {
    const key = fileKey(j.file);
    seen.add(key);
    const { entry, changed } = await parseIncremental(j.file, j.sessionId, cache.files[key]);
    if (entry) cache.files[key] = entry;
    if (changed) changedFiles++;
  });
  // A transcript that vanished keeps its aggregate: houses never disappear.
  for (const key of Object.keys(cache.files)) {
    if (!seen.has(key)) cache.files[key].missing = true;
  }

  const arrivals = readArrivals(files.arrivals);
  const banished = readBanished();
  const dispatched = new Set(readAssignments().filter((a) => a.sessionId && !a.dryRun && a.issueKey).map((a) => a.sessionId));
  const model = buildVillage({ sources, cache, arrivals, config, all: o.all, now: Date.now(), banished, dispatched });

  const layout = loadLayout(files.layout, config.seed, size);
  // /roads delete: the same reset a ROAD_VERSION bump does, run once on this scan rather
  // than gated behind the version number. placeAll below lays everything fresh from it.
  if (o.clearRoads) clearRoads(layout);
  // An empty plot is land again: give it back so the next settler can use it.
  for (const id of banished.keys()) delete layout.plots[id];

  // Same for a session that never wrote a transcript and is not in the village any
  // more. No transcript, no claim on land. Anyone with a transcript keeps their plot
  // for good, even when they are archived.
  for (const id of model.dropped || []) delete layout.plots[id];

  const present = new Set(model.buildings.map((b) => b.id));
  const hasTranscript = new Set();
  for (const [, entry] of Object.entries(cache.files || {})) {
    if (entry && entry.agg && entry.agg.sessionId && entry.agg.lines > 0) hasTranscript.add(entry.agg.sessionId);
  }
  for (const id of Object.keys(layout.plots)) {
    if (id.startsWith('civic:') || present.has(id)) continue;
    const sid = String(id).split(':')[1];
    if (!hasTranscript.has(sid)) delete layout.plots[id];
  }
  layout.paths = layout.paths.filter((p) => !banished.has(String(p.id).replace(/^path:/, '')));

  // A district whose last session was dropped stops being a place, and its land goes back
  // to being countryside. The quay is the exception: its planks are real construction.
  {
    const live = new Set(model.districts.map((d) => d.id));
    for (const [id, rec] of Object.entries(layout.districts)) {
      if (live.has(id) || (rec.pier || []).length) continue;
      delete layout.districts[id];
      layout.paths = layout.paths.filter((p) => !String(p.id).startsWith(`road:${id}:`));
    }
  }
  // The keeper's plan, if this scan carries one (POST /api/plan in serve.mjs). Same slot as
  // `clearRoads` and for the same reason: it wants the model built and the layout loaded,
  // and it wants `placeAll` to run after it to lay whatever it left unlaid. `runPlan` tries
  // the whole plan on a copy first and only touches `layout` when every step passed - so a
  // refused plan, or a dry run, changes nothing on disk, not even the cache: the return
  // below is the only thing that leaves this function. A layout with a plan applied is
  // written by the ordinary lines further down, exactly as any other scan's is.
  let plan = null, terrain, unplaced;
  const tp = Date.now();
  if (o.plan) {
    plan = runPlan(layout, model, o.plan, {
      seed: config.seed, size, dryRun: !!o.dryRun, layoutFile: files.layout, placementsFile: files.placements, now: o.now,
    });
    if (!plan.ok || o.dryRun) {
      return { plan, settlers: model.stats.settlers, districts: model.stats.districts, files: jobs.length, changedFiles, ms: Date.now() - t0 };
    }
    ({ terrain, unplaced } = plan);
  } else {
    ({ terrain, unplaced } = placeAll(layout, model, { seed: config.seed, size }));
  }
  const placeMs = Date.now() - tp;

  const village = assemble({ config, model, layout, terrain, size, all: o.all });
  writeJsonAtomic(files.village, village);
  saveCache(files.cache, cache);
  if (o.persistLayout) saveLayout(files.layout, layout);

  const result = {
    settlers: model.stats.settlers, apprentices: model.stats.apprentices,
    districts: model.stats.districts, files: jobs.length, changedFiles,
    unplaced: unplaced.length, ms: Date.now() - t0, placeMs, out: files.village,
  };
  if (plan) result.plan = { ...plan, terrain: undefined, unplaced: plan.unplaced };
  if (!o.quiet) {
    process.stderr.write(
      `[settlers] ${result.settlers} settlers, ${result.apprentices} apprentices, ${result.districts} districts` +
      ` | ${result.changedFiles}/${result.files} transcripts read | ${result.ms} ms` +
      (result.unplaced ? ` | ${result.unplaced} unplaced` : '') + `\n`,
    );
  }
  return result;
}

function assemble({ config, model, layout, terrain, size, all }) {
  const plot = (id) => {
    const p = layout.plots[id];
    return p ? { gx: p.gx, gz: p.gz, w: p.w, d: p.d, rot: p.rot } : null;
  };
  const doorOf = (p) => {
    if (!p || p.w !== 3) return null;
    if (p.rot === 0) return [p.gx + 1, p.gz];
    if (p.rot === 1) return [p.gx + 2, p.gz + 1];
    if (p.rot === 2) return [p.gx + 1, p.gz + 2];
    return [p.gx, p.gz + 1];
  };

  // Work handed out at the sprint board, so a house can show what its settler took on.
  const assignments = readAssignments();
  const openBySettler = new Map();
  for (const a of assignments) {
    if (a.status === 'done' || a.status === 'failed') continue;
    if (!a.settlerId) continue;
    if (!openBySettler.has(a.settlerId)) openBySettler.set(a.settlerId, []);
    openBySettler.get(a.settlerId).push({ issueKey: a.issueKey, summary: a.issueSummary, at: a.at, status: a.status });
  }
  const bySession = new Map(assignments.filter((a) => a.sessionId).map((a) => [a.sessionId, a]));

  const buildings = [];
  for (const b of model.buildings) {
    const p = plot(b.id);
    if (!p) continue;
    const commission = bySession.get(b.sessionId) || null;
    buildings.push({
      ...b,
      plot: p,
      door: doorOf(p),
      startedAt: iso(b.startedAt),
      lastAt: iso(b.lastAt),
      workOrders: openBySettler.get(b.id) || [],
      skills: { jira: hasSkill(b.cwd, 'jira-ticket-oppakken'), issue: hasSkill(b.cwd, 'issue-oppakken') },
      commission: commission
        ? { issueKey: commission.issueKey, summary: commission.issueSummary, from: commission.settlerName, url: commission.issueUrl }
        : null,
    });
  }

  // civic buildings, including the founding stone on the town square
  const civics = [];
  const townPlot = plot('civic:townhall');
  if (townPlot) {
    civics.push({
      id: 'civic:townhall', kind: 'civic', civicType: 'townhall', district: model.districts[0] ? model.districts[0].id : null,
      plot: townPlot, door: doorOf(townPlot), name: `${islandNameOf(config)} Town Hall`,
      title: `Founded ${new Date(config.foundedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
      label: 'Town Hall', startedAt: iso(new Date(config.foundedAt).getTime()), lastAt: null,
      style: 'unknown', model: null, models: {}, tier: 'civic', ornaments: [], active: false, archived: false,
      stats: { humanTurns: 0, assistantMsgs: 0, toolCalls: 0, filesTouched: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, apiErrors: 0, publishes: 0, durationMs: 0 },
      tools: {}, sheds: [],
    });
  }
  // The postbox on the town hall's pavement. It stands as soon as the hall does and holds
  // nothing of the village's: what is in it is read live over IMAP when somebody opens it,
  // so nothing about anybody's mail is written into village.json, which is a file the
  // scanner rewrites every minute and a visitor may be shown.
  const boxPlot = plot('civic:mailbox');
  if (boxPlot) {
    civics.push({
      id: 'civic:mailbox', kind: 'civic', civicType: 'mailbox', district: null,
      plot: boxPlot, door: null, name: 'The postbox', label: 'Postbox',
      title: 'Mail from off the island',
      startedAt: config.foundedAt, lastAt: null,
      style: 'unknown', model: null, models: {}, tier: 'civic', ornaments: [], active: false, archived: false,
      stats: { humanTurns: 0, assistantMsgs: 0, toolCalls: 0, filesTouched: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, apiErrors: 0, publishes: 0, durationMs: 0 },
      tools: {}, sheds: [],
    });
  }

  // The sprint board on the town square, with one pinned card per open issue.
  const boardPlot = plot('civic:board');
  if (boardPlot) {
    const sprint = loadSprint();
    const open = (sprint.issues || []).filter((i) => !i.done);
    civics.push({
      id: 'civic:board', kind: 'civic', civicType: 'board', district: null,
      plot: boardPlot, door: null, name: 'The sprint board', label: 'Sprint board',
      title: `${sprint.sprintName || 'Sprint'} — ${open.length} open of ${(sprint.issues || []).length}`,
      cards: open.length,
      sprintName: sprint.sprintName || null,
      openIssues: open.length,
      totalIssues: (sprint.issues || []).length,
      startedAt: config.foundedAt, lastAt: null,
      style: 'unknown', model: null, models: {}, tier: 'civic', ornaments: [],
      active: false, archived: false,
      stats: { humanTurns: 0, assistantMsgs: 0, toolCalls: 0, filesTouched: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, apiErrors: 0, publishes: 0, durationMs: 0 },
      tools: {}, sheds: [],
    });
  }

  // The island's own board, facing the sprint board across the square: the open issues
  // of the repository Promptholm is built from.
  const issuePlot = plot('civic:issues');
  if (issuePlot) {
    const gh = loadIssues();
    const open = (gh.issues || []).filter((i) => !i.done);
    const repo = gh.repo || githubConfig().repo || null;
    civics.push({
      id: 'civic:issues', kind: 'civic', civicType: 'issues', district: null,
      plot: issuePlot, door: null, name: 'The island board', label: 'Island board',
      title: repo ? `${repo} — ${open.length} open of ${(gh.issues || []).length}` : 'No repository to read',
      cards: open.length,
      repo,
      repoUrl: gh.url || null,
      openIssues: open.length,
      totalIssues: (gh.issues || []).length,
      startedAt: config.foundedAt, lastAt: null,
      style: 'unknown', model: null, models: {}, tier: 'civic', ornaments: [],
      active: false, archived: false,
      stats: { humanTurns: 0, assistantMsgs: 0, toolCalls: 0, filesTouched: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, apiErrors: 0, publishes: 0, durationMs: 0 },
      tools: {}, sheds: [],
    });
  }

  // An office on the square of every district that is a git repository.
  for (const d of model.districts) {
    const id = `civic:office:${d.id}`;
    const op = plot(id);
    if (!d.gitRepo || !op) continue;
    civics.push({
      id, kind: 'civic', civicType: 'office', district: d.id,
      plot: op, door: doorOf(op),
      name: `${d.name} office`, label: 'Office', repoName: d.name,
      title: `The register of ${d.name}`,
      startedAt: iso(d.firstSeenAt), lastAt: null,
      style: 'unknown', model: null, models: {}, tier: 'civic', ornaments: [],
      active: false, archived: false,
      stats: { humanTurns: 0, assistantMsgs: 0, toolCalls: 0, filesTouched: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, apiErrors: 0, publishes: 0, durationMs: 0 },
      tools: {}, sheds: [],
    });
  }

  for (const m of model.milestones) {
    const id = `civic:${m.civicType}`;
    const p = plot(id);
    if (!m.unlocked || !p) continue;
    civics.push({
      id, kind: 'civic', civicType: m.civicType, district: null, plot: p, door: doorOf(p),
      name: m.label, title: `Unlocked at ${m.at} ${m.on === 'apprentices' ? 'apprentices' : 'settlers'}`, label: m.label,
      startedAt: iso(m.unlockedAt), lastAt: null, style: 'unknown', model: null, models: {},
      tier: 'civic', ornaments: [], active: false, archived: false,
      stats: { humanTurns: 0, assistantMsgs: 0, toolCalls: 0, filesTouched: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, apiErrors: 0, publishes: 0, durationMs: 0 },
      tools: {}, sheds: [],
    });
  }

  // what stands on the square: earned by the apprentices, not the settlers
  for (const f of model.furniture || []) {
    const p = plot(f.id);
    if (!p) continue;
    civics.push({
      id: f.id, kind: 'civic', civicType: f.kind, district: null, plot: p, door: null,
      name: f.label, title: `Unlocked at ${f.at} apprentices`, label: f.label,
      startedAt: config.foundedAt, lastAt: null, style: 'unknown', model: null, models: {},
      tier: 'civic', ornaments: [], active: false, archived: false,
      stats: { humanTurns: 0, assistantMsgs: 0, toolCalls: 0, filesTouched: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, apiErrors: 0, publishes: 0, durationMs: 0 },
      tools: {}, sheds: [],
    });
  }

  // A parcel goes over the wire as a bounding box of super-cells plus one bitstring per
  // row, which is a couple of hundred bytes for the largest hamlet against the forty
  // kilobytes a list of cells would cost. The viewer turns a super-cell back into its
  // sixteen ground cells with `island.lattice`, and derives everything else from that:
  // the boundary runs along an owned cell with a missing neighbour, the gardens are owned
  // cells with no house on them, and the countryside is the land nobody owns.
  const rleParcel = (cells) => {
    if (!cells || !cells.length) return null;
    let i0 = Infinity, j0 = Infinity, i1 = -Infinity, j1 = -Infinity;
    for (const [i, j] of cells) {
      i0 = Math.min(i0, i); i1 = Math.max(i1, i);
      j0 = Math.min(j0, j); j1 = Math.max(j1, j);
    }
    const w = i1 - i0 + 1, h = j1 - j0 + 1;
    const rows = Array.from({ length: h }, () => new Array(w).fill('0'));
    for (const [i, j] of cells) rows[j - j0][i - i0] = '1';
    return { i0, j0, w, h, rows: rows.map((r) => r.join('')) };
  };

  const districts = model.districts.map((d) => {
    const l = layout.districts[d.id];
    const lobes = ((l && l.lobes) || []).map((lo) => ({
      green: lo.centre, size: lo.green, paved: lo.paved || [], parcel: rleParcel(lo.cells),
    }));
    return {
      id: d.id, kind: d.kind, name: d.name, root: d.root, hue: d.hue,
      center: (l && l.centre) || null, square: (l && l.square) || null, pier: (l && l.pier) || [],
      // The cell the ramp stands on, which is behind the first plank and is not in `pier`.
      // shared/quay.mjs can work it out from a run of two or more, and cannot from a run of
      // one - and the layout has known it all along, so it may as well say so.
      shore: (l && l.shore) || null,
      firstSeenAt: iso(d.firstSeenAt), population: d.population,
      outposts: d.outposts || [],
      tier: (l && l.tier) || 'farmstead',
      guest: !!(l && l.guest),
      paved: (l && l.paved) || [],
      lobes,
      folders: d.folders || {},
      branches: d.branches || {},
    };
  });

  const all2 = [...buildings, ...civics];
  return {
    v: 1,
    generatedAt: new Date().toISOString(),
    all: !!all,
    island: {
      name: islandNameOf(config),
      seed: config.seed,
      foundedAt: config.foundedAt,
      terrainHash: terrain.hash,
      landing: layout.landing,
      town: {
        ...layout.town, commons: undefined, parcel: rleParcel(layout.town.commons), coreR: TOWN_CORE_R,
        // When the square reached each of its widths. The chronicle needs this to lay the
        // plaza as it was rather than as it is, and the thresholds belong here with the
        // rule that applies them.
        sizeSteps: [{ size: 3, at: 1 }, ...SQUARE_STEPS]
          .map(({ size, at }) => ({ size, at, unlockedAt: iso(model.arrivals[at - 1] || null) }))
          .filter((s) => s.unlockedAt),
      },
      lattice: layout.lattice,
    },
    grid: { size },
    // How many sessions earn a project a green and a sign. The viewer needs it to know
    // that a hamlet was still a lone farmstead at some earlier moment.
    hamletAt: MIN_HAMLET,
    districts,
    // One number that changes whenever the land register does, so the viewer can tell in
    // a single comparison that a parcel grew - a length check cannot, because growth
    // changes cells inside an entry that already existed.
    districtsRev: hash32(JSON.stringify(districts.map((d) => [d.id, d.tier, d.hue, d.lobes]))),
    buildings: all2,
    paths: layout.paths,
    // A crossing is built, so it is dated, the same as a polder and for the same reason:
    // the chronicle draws the land as it was, and a bridge standing over the river on the
    // founding day is a road the village had not built yet. `markRoad` names a bridge
    // after whatever laid it, so the name is the date - the milestone rung for the one
    // the village put up on purpose, and the district's own arrival for one a hamlet road
    // threw up on its way to town. An undated bridge is one whose road has since gone,
    // and it stands from the first day, which is what every bridge did before this.
    bridges: (layout.bridges || []).map((b) => ({ ...b, ...bridgeDate(b, model) })),
    cleared: layout.cleared,
    // Ground the keeper has said no to, in super-cells (lib/plan.mjs). For the keeper's own
    // page to draw; the island bundle does not carry it, so a zone costs no publish and no
    // rebuild on anybody else's screen - it changes nothing a neighbour can see.
    zones: layout.zones || [],
    // Each polder carries the moment it was drained, the way a milestone carries
    // `unlockedAt`. The list is append-only and polder k was earned at POLDER_AT +
    // k * POLDER_EVERY settlers, so the index is the date - but the viewer should not
    // have to know the ladder to replay the coast, and the arithmetic belongs here.
    //
    // A polder the keeper drained by hand (lib/plan.mjs) is not on the ladder: it carries
    // its own `at` and `dugAt`, and the planned ones are counted around it - otherwise the
    // chronicle would show it standing from the founding day, and the first planned one
    // would be dated a rung late.
    polders: (() => {
      let rung = 0;
      return layout.polders.map((p) => {
        if (p.manual) return { ...p, at: p.at || null, unlockedAt: p.dugAt || null };
        const at = POLDER_AT + (rung++) * POLDER_EVERY;
        return { ...p, at, unlockedAt: iso(model.arrivals[at - 1] || null) };
      });
    })(),
    // The dredged river mouth, on the same terms as a polder: the cells decide the ground
    // and the date is worked out here rather than in the layout, because the layout stores
    // decisions and not the ladder that earned them.
    fairway: layout.fairway
      ? { ...layout.fairway, at: FAIRWAY_AT, unlockedAt: iso(model.arrivals[FAIRWAY_AT - 1] || null) }
      : null,
    milestones: model.milestones.map((m) => ({ ...m, unlockedAt: iso(m.unlockedAt) })),
    active: all2.filter((b) => b.active).map((b) => b.id),
    assignments: assignments.slice(0, 60),
    stats: { ...model.stats, nextMilestone: nextMilestone(model.stats) },
  };
}

// When a crossing was built, worked out from the name it is recorded under. Here rather
// than in the layout for the same reason a polder's date is: the layout stores decisions,
// not the ladder that earned them.
function bridgeDate(b, model) {
  if (b.id === 'civic:bridge') {
    return { at: BRIDGE_AT, unlockedAt: iso(model.arrivals[BRIDGE_AT - 1] || null) };
  }
  const road = /^road:(.+):\d+$/.exec(String(b.id));
  const district = road && model.districts.find((d) => d.id === road[1]);
  return district ? { unlockedAt: iso(district.firstSeenAt) } : {};
}

// Can this settler's project work a ticket the house way? The skills live in the repo:
// jira-ticket-oppakken for a card from the sprint board, issue-oppakken for one from the
// island's own board.
const skillCache = new Map();
function hasSkill(cwd, skill) {
  if (!cwd) return false;
  const key = `${cwd}::${skill}`;
  if (skillCache.has(key)) return skillCache.get(key);
  let has = false;
  try { has = fs.statSync(path.join(cwd, '.claude', 'skills', skill, 'SKILL.md')).isFile(); } catch { has = false; }
  skillCache.set(key, has);
  return has;
}

// Milestones no longer all count the same heads, so the nearest one wins rather than
// the first one in the list.
function nextMilestone(stats) {
  let best = null;
  for (const m of MILESTONES) {
    const on = m.on === 'apprentices' ? 'apprentices' : 'settlers';
    const have = on === 'apprentices' ? stats.apprentices : stats.settlers;
    if (m.at <= have) continue;
    const remaining = m.at - have;
    if (!best || remaining < best.remaining) best = { id: m.id, at: m.at, on, label: m.label, remaining };
  }
  return best;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(path.join(ROOT, 'scan.mjs'));
if (invokedDirectly) {
  const o = parseArgs(process.argv.slice(2));
  scan(o).then((r) => {
    if (r && r.skipped) process.stderr.write(`[settlers] skipped: ${r.reason}\n`);
  }).catch((e) => {
    process.stderr.write(`[settlers] scan failed: ${e && e.stack ? e.stack : e}\n`);
    process.exit(1);
  });
}
