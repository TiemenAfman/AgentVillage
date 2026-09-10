#!/usr/bin/env node
// Reads every Claude session record on this machine and writes data/village.json,
// the single file the island viewer consumes.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, ROOT, ensureData, loadConfig, writeJsonAtomic, iso } from './lib/paths.mjs';
import { discover } from './lib/sources.mjs';
import { parseIncremental, mapPool } from './lib/parse.mjs';
import { loadCache, saveCache, fileKey } from './lib/cache.mjs';
import { buildVillage, readArrivals, MILESTONES } from './lib/village.mjs';
import { loadSprint, readAssignments } from './lib/sprint.mjs';
import { readBanished } from './lib/banish.mjs';
import { loadLayout, saveLayout, placeAll } from './lib/layout.mjs';
import { withScanLock } from './lib/lock.mjs';

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
  };
}

export async function scan(opts = {}) {
  const o = { all: false, quiet: true, persistLayout: true, ...opts };
  return withScanLock(() => runScan(o));
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
  const { terrain, unplaced } = placeAll(layout, model, { seed: config.seed, size });

  const village = assemble({ config, model, layout, terrain, size, all: o.all });
  writeJsonAtomic(files.village, village);
  saveCache(files.cache, cache);
  if (o.persistLayout) saveLayout(files.layout, layout);

  const result = {
    settlers: model.stats.settlers, apprentices: model.stats.apprentices,
    districts: model.stats.districts, files: jobs.length, changedFiles,
    unplaced: unplaced.length, ms: Date.now() - t0, out: files.village,
  };
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
      skills: { jira: hasJiraSkill(b.cwd) },
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
      plot: townPlot, door: doorOf(townPlot), name: `${config.islandName} Town Hall`,
      title: `Founded ${new Date(config.foundedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
      label: 'Town Hall', startedAt: iso(new Date(config.foundedAt).getTime()), lastAt: null,
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
      name: m.label, title: `Unlocked at ${m.at} settlers`, label: m.label,
      startedAt: iso(m.unlockedAt), lastAt: null, style: 'unknown', model: null, models: {},
      tier: 'civic', ornaments: [], active: false, archived: false,
      stats: { humanTurns: 0, assistantMsgs: 0, toolCalls: 0, filesTouched: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, apiErrors: 0, publishes: 0, durationMs: 0 },
      tools: {}, sheds: [],
    });
  }

  const districts = model.districts.map((d) => {
    const l = layout.districts[d.id];
    return {
      id: d.id, kind: d.kind, name: d.name, root: d.root, hue: d.hue,
      center: l ? l.centre : null, square: l ? l.square : null, pier: (l && l.pier) || [],
      firstSeenAt: iso(d.firstSeenAt), population: d.population,
      outposts: d.outposts || [],
    };
  }).filter((d) => d.center);

  const all2 = [...buildings, ...civics];
  return {
    v: 1,
    generatedAt: new Date().toISOString(),
    all: !!all,
    island: {
      name: config.islandName,
      seed: config.seed,
      foundedAt: config.foundedAt,
      terrainHash: terrain.hash,
      landing: layout.landing,
      town: layout.town,
    },
    grid: { size },
    districts,
    buildings: all2,
    paths: layout.paths,
    cleared: layout.cleared,
    polders: layout.polders,
    milestones: model.milestones.map((m) => ({ ...m, unlockedAt: iso(m.unlockedAt) })),
    active: all2.filter((b) => b.active).map((b) => b.id),
    assignments: assignments.slice(0, 60),
    stats: { ...model.stats, nextMilestone: nextMilestone(model.stats.settlers) },
  };
}

// Can this settler's project work a Jira ticket the house way? The skill lives in the repo.
const skillCache = new Map();
function hasJiraSkill(cwd) {
  if (!cwd) return false;
  if (skillCache.has(cwd)) return skillCache.get(cwd);
  let has = false;
  try { has = fs.statSync(path.join(cwd, '.claude', 'skills', 'jira-ticket-oppakken', 'SKILL.md')).isFile(); } catch { has = false; }
  skillCache.set(cwd, has);
  return has;
}

function nextMilestone(count) {
  const m = MILESTONES.find((x) => x.at > count);
  return m ? { id: m.id, at: m.at, label: m.label, remaining: m.at - count } : null;
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
