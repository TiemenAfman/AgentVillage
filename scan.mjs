#!/usr/bin/env node
// Reads every Claude session record on this machine and writes data/village.json,
// the single file the island viewer consumes.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, ROOT, ensureData, loadConfig, fillConfig, islandNameOf, readJson, writeJsonAtomic, iso, islandCap } from './lib/paths.mjs';
import { discover } from './lib/sources.mjs';
import { discoverCodex, foldCodex } from './lib/codex-sources.mjs';
import { parseIncremental, mapPool } from './lib/parse.mjs';
import { loadCache, saveCache, fileKey } from './lib/cache.mjs';
import { buildVillage, readArrivals, civicIdOf, yardStage, reachedOf, nextMilestone } from './lib/village.mjs';
import { loadSprint, readAssignments } from './lib/sprint.mjs';
import { loadIssues, githubConfig } from './lib/issues.mjs';
import { readBanished } from './lib/banish.mjs';
import {
  loadLayout, saveLayout, placeAll, clearRoads, plotDoor, kadehaven, YARD_ID, PIRATE_ID, TREASURE_ID, POLDER_AT, POLDER_EVERY, FAIRWAY_AT, BRIDGE_AT, SQUARE_STEPS, MIN_HAMLET, TOWN_CORE_R,
} from './lib/layout.mjs';
import { hash32 } from './shared/rng.mjs';
import { GOLDPIT_ID, GOLDMINE_ID, GOLDSMITH_ID } from './shared/gold.mjs';
import { withScanLock } from './lib/lock.mjs';
import { runPlan, pruneUnreachable } from './lib/plan.mjs';
import { builtBoats } from './lib/boatyard.mjs';
import { loadTreasure, viewOf as treasureView } from './lib/treasure.mjs';
import { fleetOf, earnedBoats } from './shared/quay.mjs';

export function parseArgs(argv) {
  const o = { all: false, quiet: false, persistLayout: true, out: null, layoutFile: null, cacheFile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') o.all = true;
    else if (a === '--codex') o.codex = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--no-layout-persist') o.persistLayout = false;
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--layout-file') o.layoutFile = argv[++i];
    else if (a === '--cache-file') o.cacheFile = argv[++i];
  }
  return o;
}

export function filesFor(opts) {
  if (opts.codex) return {
    village: opts.out || path.join(DATA, 'codex', 'village.json'),
    layout: opts.layoutFile || path.join(DATA, 'codex', 'layout.json'),
    cache: opts.cacheFile || path.join(DATA, 'codex', 'cache.json'),
    arrivals: path.join(DATA, 'codex', 'arrivals.jsonl'),
  };
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
  return withScanLock(() => runScan(o), o.codex ? { file: path.join(DATA, 'codex', 'scan.lock') } : undefined);
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
  const layout = loadLayout(files.layout, config.seed, config.gridSize || 64, { minSize: o.codex ? null : config.minGridSize });
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

const CODEX_SCAN = Object.freeze({ name: 'Codex', seed: 7331 });

async function runScan(o) {
  const t0 = Date.now();
  ensureData();
  const base = loadConfig();
  // The Codex scan keeps the name and seed its layout was founded on. They were settings
  // while the Codex village was an island of its own on the sea; it is not any more (the sea
  // houses those settlers on its volcano), so they are constants here that an old config.json
  // may still override - and must be allowed to, or a layout founded on another seed would be
  // thrown away by the next scan.
  const codexOf = base.codexIsland || {};
  const config = o.codex ? {
    ...base, islandName: codexOf.name || CODEX_SCAN.name, seed: Number.isFinite(codexOf.seed) ? codexOf.seed : CODEX_SCAN.seed,
    foundedAt: null, founders: [],
    multiplayer: { ...base.multiplayer, sea: { ...base.multiplayer.sea, mode: 'single' } },
  } : base;
  const files = filesFor(o);
  // The most this island may grow to (maxGridSize); the grid it stands on is the layout's
  // own, below; and a brand-new one is founded on gridSize.
  const cap = islandCap(config);

  const sources = o.codex ? discoverCodex(o.codexHome) : discover();
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
    const { entry, changed } = await parseIncremental(j.file, j.sessionId, cache.files[key], o.codex ? foldCodex : undefined);
    if (entry) cache.files[key] = entry;
    if (changed) changedFiles++;
  });
  // A transcript that vanished keeps its aggregate: houses never disappear.
  for (const key of Object.keys(cache.files)) {
    if (!seen.has(key)) cache.files[key].missing = true;
  }

  if (o.codex) {
    for (const t of sources.transcripts) {
      const a = cache.files[fileKey(t.file)]?.agg;
      if (a?.codexRunning && Date.now() - a.lastTs < 10 * 60 * 1000) sources.locks.push({ sessionId: t.sessionId, alive: true });
    }
  }
  const arrivals = o.codex ? [] : readArrivals(files.arrivals);
  const banished = o.codex ? new Map() : readBanished();
  const dispatched = new Set((o.codex ? [] : readAssignments()).filter((a) => a.sessionId && !a.dryRun && a.issueKey).map((a) => a.sessionId));
  // The layout before the model, for one thing in it: who the keeper has given a hamlet of
  // their own (`layout.rehomed`, lib/plan.mjs's `rehome`). That is a word about the village,
  // not about the ground, and buildVillage has to hear it before it counts the hamlets.
  const layout = loadLayout(files.layout, config.seed, config.gridSize || 64, { minSize: o.codex ? null : config.minGridSize });
  let size = layout.size;
  // `layout.ladder` is the other: the most settlers the village has ever had at once, which
  // the model counts its milestones in (Plans/DONE/tenten-vertrekken.md). Read on every survey
  // rather than captured once, so a plan's re-survey sees the one written back below.
  //
  // The model also carries `treasure` ({ placed, found }, lib/treasure.mjs): whether the treasure
  // statue has been set down is the keeper's word in data/treasure.json, not something
  // the transcripts say, and `placeAll` gives the statue its cell when it reads `placed`. On the
  // model rather than an option of `placeAll`, so the planner's re-survey and its trial scans
  // (lib/plan.mjs) see the same word. The Codex scan has no statue.
  const survey = (rehomed) => Object.assign(buildVillage({
    sources, cache, arrivals, config, all: o.all, now: Date.now(), banished, dispatched, rehomed,
    ladder: layout.ladder || null,
  }), o.codex ? {} : { treasure: treasureView(loadTreasure()) });
  let model = survey(layout.rehomed || null);
  // Written back straight away, and moved only when the village sets a new most-ever or on
  // the first scan that has one at all: a scan of an unchanged island leaves it as it was.
  layout.ladder = model.ladder;
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
  // A settler sent away takes their front path with them, and so does a tent that packed up:
  // the path was theirs, and a neighbour's that leaned on it is laid again by the lines below
  // (`pruneUnreachable`, then the front paths `placeAll` relays for any door left without).
  {
    const left = new Set((model.departed || []).map((sid) => `house:${sid}`));
    layout.paths = layout.paths.filter((p) => {
      const of = String(p.id).replace(/^path:/, '');
      return !banished.has(of) && !left.has(of);
    });
  }

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
  // And every stretch that only led to what was just taken up. A path records only the cells
  // it paved itself, so a hamlet road that braided onto a neighbour's lane walks over cells
  // that are on the neighbour's record - and when that neighbour's district goes, its road
  // goes with it and everything that joined the island through it is left ending in the
  // grass, every stone of its own still in place. Measured on 25 September 2026: the
  // deskdisplay hamlet went quiet overnight, its 24-cell road went, and 45 houses in four
  // hamlets could no longer walk to the square. It is the planner's own cure for the same
  // thing after a move (lib/plan.mjs): drop whatever the square cannot reach, give the
  // ground back to the forest, and let placeAll below lay it again from the doors that
  // need it. On every scan rather than only when a district goes, because it costs one
  // flood fill and an island that is already cut - that one was - heals on its next scan;
  // on an island in one piece it drops nothing and the layout is byte for byte what it was.
  if (pruneUnreachable(layout, size).length) layout.cleared = [];
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
      seed: config.seed, size, cap, dryRun: !!o.dryRun, layoutFile: files.layout, placementsFile: files.placements, now: o.now,
      remodel: survey,
    });
    if (!plan.ok || o.dryRun) {
      return { plan, settlers: model.stats.settlers, districts: model.stats.districts, files: jobs.length, changedFiles, ms: Date.now() - t0 };
    }
    ({ terrain, unplaced } = plan);
    // A `rehome` changed who lives where, and the village is assembled from the model the
    // plan placed the island against.
    if (plan.model) model = plan.model;
  } else {
    ({ terrain, unplaced } = placeAll(layout, model, { seed: config.seed, size, cap }));
  }
  // A growth step may have enlarged the grid under it (growCanvas).
  size = layout.size;
  const placeMs = Date.now() - tp;

  const village = assemble({ config, model, layout, terrain, size, all: o.all, boats: o.codex ? {} : builtBoats() });
  writeJsonAtomic(files.village, village);
  saveCache(files.cache, cache);
  if (o.persistLayout) saveLayout(files.layout, layout);

  const result = {
    settlers: model.stats.settlers, apprentices: model.stats.apprentices,
    districts: model.stats.districts, files: jobs.length, changedFiles,
    unplaced: unplaced.length, ms: Date.now() - t0, placeMs, out: files.village,
  };
  if (plan) result.plan = { ...plan, terrain: undefined, model: undefined, unplaced: plan.unplaced };
  if (!o.quiet) {
    process.stderr.write(
      `[promptholm] ${result.settlers} settlers, ${result.apprentices} apprentices, ${result.districts} districts` +
      ` | ${result.changedFiles}/${result.files} transcripts read | ${result.ms} ms` +
      (result.unplaced ? ` | ${result.unplaced} unplaced` : '') + `\n`,
    );
  }
  return result;
}

function assemble({ config, model, layout, terrain, size, all, boats = {} }) {
  const plot = (id) => {
    const p = layout.plots[id];
    return p ? { gx: p.gx, gz: p.gz, w: p.w, d: p.d, rot: p.rot, quay: p.quay || undefined } : null;
  };
  // lib/layout.mjs's own door, not a copy of it: the castle's seven-wide lot has its gate
  // three cells in, and a copy that only knew three by three said one. Asked by id as well as
  // plot since the ladder went past a hundred: a ship has no door, and the yard's is at its
  // landward end rather than on its front.
  const doorOf = (id, p) => { const d = plotDoor(id, p); return d ? d.door : null; };

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
      door: doorOf(b.id, p),
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
      plot: townPlot, door: doorOf('civic:townhall', townPlot), name: `${islandNameOf(config)} Town Hall`,
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

  // The pirate's sea chest on the tavern's pavement, and the keeper it gives the tavern a second
  // one of (KEEPERS.pirate in shared/palette.mjs). It stands as soon as the tavern and a free cell
  // beside its door do (lib/layout.mjs); like the postbox it holds nothing of the village's.
  const piratePlot = plot(PIRATE_ID);
  if (piratePlot) {
    civics.push({
      id: PIRATE_ID, kind: 'civic', civicType: 'pirate', district: null,
      plot: piratePlot, door: null, name: 'The pirate’s chest', label: 'Pirate’s chest',
      title: 'A sea chest by the tavern door',
      startedAt: config.foundedAt, lastAt: null,
      style: 'unknown', model: null, models: {}, tier: 'civic', ornaments: [], active: false, archived: false,
      stats: { humanTurns: 0, assistantMsgs: 0, toolCalls: 0, filesTouched: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, apiErrors: 0, publishes: 0, durationMs: 0 },
      tools: {}, sheds: [],
    });
  }

  // The treasure statue in the town centre: in the village only once the keeper has set it down
  // (`model.treasure.placed`, lib/treasure.mjs). Its cell stays in the layout either way - a plot
  // is never taken back - so a statue that stops being placed (data/treasure.json deleted) is out
  // of the village and comes back on the same cell if it is placed again. The count on its plaque
  // is `village.treasure.found`, not a field of this record: a bundle carries the count once.
  const statuePlot = model.treasure && model.treasure.placed === true ? plot(TREASURE_ID) : null;
  if (statuePlot) {
    civics.push({
      id: TREASURE_ID, kind: 'civic', civicType: 'treasure', district: null,
      plot: statuePlot, door: null, name: 'The treasure statue', label: 'Treasure statue',
      title: 'Golden treasure, dug up and carried home',
      startedAt: config.foundedAt, lastAt: null,
      style: 'unknown', model: null, models: {}, tier: 'civic', ornaments: [], active: false, archived: false,
      stats: { humanTurns: 0, assistantMsgs: 0, toolCalls: 0, filesTouched: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, apiErrors: 0, publishes: 0, durationMs: 0 },
      tools: {}, sheds: [],
    });
  }

  // The gold pit (Plans/DONE/goudkuil.md). The spec says where it stands and nothing more: how
  // much gold is in it is the keeper's usage window, which is read live by their own page
  // (/api/gold) and is never written in here - village.json is a file a visitor may be
  // shown, and the bundle made from it goes to the sea.
  const pitPlot = plot(GOLDPIT_ID);
  if (pitPlot) {
    civics.push({
      id: GOLDPIT_ID, kind: 'civic', civicType: 'goldpit', district: null,
      plot: pitPlot, door: doorOf(GOLDPIT_ID, pitPlot), name: 'The gold pit', label: 'Gold pit',
      title: 'The five-hour usage window, one bar a percent',
      startedAt: config.foundedAt, lastAt: null,
      style: 'unknown', model: null, models: {}, tier: 'civic', ornaments: [], active: false, archived: false,
      stats: { humanTurns: 0, assistantMsgs: 0, toolCalls: 0, filesTouched: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, apiErrors: 0, publishes: 0, durationMs: 0 },
      tools: {}, sheds: [],
    });
  }

  // The goldsmith and the gold mine (Plans/DONE/goudmijn.md), on the pit's terms: where they
  // stand and nothing more. How much ore is in the mine is the keeper's week, read live by
  // their own page with the pit's count, and the cart that runs between the three when the
  // five-hour window turns over is the page's alone.
  for (const [id, civicType, name, label, title] of [
    [GOLDSMITH_ID, 'goldsmith', 'The goldsmith', 'Goldsmith', 'Where the ore becomes bars for the pit'],
    [GOLDMINE_ID, 'goldmine', 'The gold mine', 'Gold mine', 'The seven-day usage window, one lump of ore a percent'],
  ]) {
    const p = plot(id);
    if (!p) continue;
    civics.push({
      id, kind: 'civic', civicType, district: null,
      plot: p, door: doorOf(id, p), name, label, title,
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
      plot: op, door: doorOf(id, op),
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
    const id = civicIdOf(m);
    const p = plot(id);
    if (!m.unlocked || !p) continue;
    civics.push({
      id, kind: 'civic', civicType: m.civicType, district: null, plot: p, door: doorOf(id, p),
      // What stands on the yard's slipway (lib/village.mjs yardStage), 0 to 4. On the record
      // because a bundle carries no settler count, so a visitor could not work it out.
      // On the ladder like the ships it launches, or a village that shrank below a launch would
      // take her back up the slipway while she lies on the rede.
      ...(id === YARD_ID ? { stage: yardStage(reachedOf(model)) } : {}),
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
      center: (l && l.centre) || null, square: (l && l.square) || null,
      pier: (l && l.pier) || [],
      // The quay's boardwalk: its streets, its front decks and the walk out to the pier, as
      // one set of cells. Derived on every scan rather than recorded once, because a run of
      // boards is not land in the register and grows when the parcel or its paths do - see
      // the note in lib/layout.mjs. Sending it is what makes the browser, the walking graph
      // and the drawing consume the exact same cells.
      deck: (l && l.deck) || [],
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

  // The boats at each harbour: however many the keeper has built there (lib/boatyard.mjs)
  // or the village has earned (shared/quay.mjs earnedBoats, from FLEET_AT settlers),
  // whichever is more - so B builds ahead of the count and never below it. Worked out on
  // the walk mooringsFor takes (fleetOf), so the earned ones are dealt only to harbours
  // that draw a boat, and the one holding the island's first boat - the galleon, which
  // counts towards its three - is dealt one fewer. `first` marks that harbour for the
  // boatyard's count of how many more fit there (serve.mjs); the bundle leaves it out
  // (lib/islandbundle.mjs `harbour`), since every other machine derives it the same way.
  const harbourList = (layout.harbours || []).filter(Boolean);
  const fleet = fleetOf(terrain, { island: { landing: layout.landing, harbours: harbourList }, districts });
  // Dealt from the kadehaven, where the plan puts the harbour's life; the harbour holding the
  // first boat is still the one that takes one fewer.
  // Earned on the ladder: a boat the village had does not sink when a tent packs up.
  const earned = earnedBoats(reachedOf(model), fleet.harbours, fleet.first, kadehaven(layout, terrain)?.side ?? fleet.first);

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
      // How big the island may grow, which the sea keeps room for round its berth - or a
      // ring of new coast would reach a neighbour and the island be given another berth.
      room: Math.max(size, islandCap(config)),
      landing: layout.landing,
      // The island's harbours (lib/layout.mjs planHarbours): side, the shore cell the
      // planks start from, and the planks. The sides with none are left out; `side` says
      // which is which. The quay's own planks are one of these.
      // `boats` is how many lie there besides the first boat: built by the keeper
      // (lib/boatyard.mjs, its own file) or earned, whichever is more - see `fleet` above.
      harbours: harbourList.map((h) => ({
        side: h.side, shore: h.shore, pier: h.pier,
        boats: Math.max(boats[h.side] || 0, earned[h.side] || 0),
        ...(fleet.first === h.side ? { first: true } : {}),
      })),
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
    // The ways in the keeper set, per hamlet and side (`gate` in lib/plan.mjs): for the page to stand a
    // gateway on and the planner to draw. Like the zones it is not in the island bundle - nobody else
    // draws a gateway over our roads.
    gates: layout.gates || {},
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
    // How the island has grown. Every page and the sea build the ground from it, exactly as
    // they do from the polders, so it travels as the layout keeps it.
    grow: layout.grow || null,
    // The treasure statue and its tally (lib/treasure.mjs, data/treasure.json - its own file and
    // its own writer, like the boatyard's count). Just `{ placed, found }`: which way the statue
    // is being carried is the carrier's business and is not written here.
    treasure: treasureView(loadTreasure()),
    milestones: model.milestones.map((m) => ({ ...m, unlockedAt: iso(m.unlockedAt) })),
    // The tents that packed up for want of anything to do (lib/village.mjs), by session: the
    // town hall's register offers them an invitation back instead of saying they live here.
    // The keeper's file only - the bundle is built field by field and never carries it.
    departed: model.departed || [],
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

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(path.join(ROOT, 'scan.mjs'));
if (invokedDirectly) {
  // Same check serve.mjs does, and only when the scanner is the process rather than a
  // rescan inside a running island: that one comes round every 60 s, and there is nothing
  // to fill in the second time.
  const filledIn = fillConfig();
  if (filledIn.added.length) {
    const how = filledIn.written ? 'added to config.json' : 'missing from config.json (it could not be written)';
    process.stderr.write(`[promptholm] ${filledIn.added.length} new setting(s) ${how}: ${filledIn.added.join(', ')}\n`);
  }
  const o = parseArgs(process.argv.slice(2));
  scan(o).then((r) => {
    if (r && r.skipped) process.stderr.write(`[promptholm] skipped: ${r.reason}\n`);
  }).catch((e) => {
    process.stderr.write(`[promptholm] scan failed: ${e && e.stack ? e.stack : e}\n`);
    process.exit(1);
  });
}
