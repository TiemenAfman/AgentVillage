// The roll of every session this machine has recorded, named the way the island would
// name them, so the town hall can offer any of them a place. Read-only: it never starts
// anything, it only lists what already exists.
import path from 'node:path';
import { DATA, readJson } from './paths.mjs';
import { discover } from './sources.mjs';
import { loadCache } from './cache.mjs';
import { settlerName, styleOf, tierOf } from './village.mjs';

const CACHE_FILE = path.join(DATA, 'cache.json');

function projectName(cwd) {
  if (!cwd) return null;
  const parts = String(cwd).replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || null;
}

// Mirrors the title precedence in buildVillage so the catalogue reads the same as a house.
function titleOf(agg, desktop, cowork) {
  return (agg && agg.titles && agg.titles.custom)
    || (desktop && desktop.titleSource === 'user' ? desktop.title : null)
    || (agg && agg.titles && agg.titles.ai)
    || (cowork && cowork.title)
    || (desktop && desktop.title)
    || (agg && agg.titles && agg.titles.firstPrompt)
    || (agg && agg.lastPrompt)
    || null;
}

// Everything the machine has seen, newest first. `onIsland` marks the sessions that
// already appear in the village (founded, or started after the island was), so the
// town hall can grey those out.
export function catalog({ config, onIslandIds = new Set() } = {}) {
  const sources = discover();
  const cache = loadCache(CACHE_FILE);
  const files = cache.files || {};
  const founders = new Set((config && config.founders) || []);
  const foundedAt = config && config.foundedAt ? Date.parse(config.foundedAt) : 0;

  // one aggregate per session id, from the parse cache
  const aggBySession = new Map();
  for (const entry of Object.values(files)) {
    const agg = entry && entry.agg;
    if (agg && agg.sessionId) aggBySession.set(agg.sessionId, agg);
  }

  const rows = [];
  const seen = new Set();
  for (const t of sources.transcripts) {
    if (seen.has(t.sessionId)) continue;
    seen.add(t.sessionId);
    const agg = aggBySession.get(t.sessionId) || null;
    const desktop = sources.desktop.get(t.sessionId) || null;
    const cowork = sources.cowork.get(t.sessionId) || null;

    const cwd = (agg && mostFrequent(agg.cwds)) || (desktop && desktop.cwd) || (cowork && cowork.cwd) || null;
    const startedAt = (agg && agg.firstTs) || (desktop && desktop.createdAt) || (cowork && cowork.createdAt) || null;
    const lastAt = (agg && agg.lastTs) || (desktop && desktop.lastActivityAt) || (cowork && cowork.lastActivityAt) || null;
    const model = (agg && topKey(agg.models)) || (desktop && desktop.model) || (cowork && cowork.model) || null;
    const turns = (agg && agg.humanTurns) || (desktop && desktop.completedTurns) || 0;

    rows.push({
      sessionId: t.sessionId,
      name: settlerName({ slug: agg && agg.slug, processName: cowork && cowork.processName, sessionId: t.sessionId }),
      title: titleOf(agg, desktop, cowork),
      cwd,
      project: projectName(cwd),
      kind: t.origin === 'cowork' ? 'cowork' : 'code',
      startedAt: startedAt ? new Date(startedAt).toISOString() : null,
      lastAt: lastAt ? new Date(lastAt).toISOString() : null,
      model,
      style: styleOf(model),
      tier: tierOf(turns),
      turns,
      founder: founders.has(t.sessionId),
      // a session already shows up on the island if it is a founder or started after founding
      onIsland: onIslandIds.has(t.sessionId) || founders.has(t.sessionId) || (startedAt != null && startedAt >= foundedAt),
    });
  }

  rows.sort((a, b) => (Date.parse(b.startedAt || 0) || 0) - (Date.parse(a.startedAt || 0) || 0));
  return rows;
}

function mostFrequent(counts) {
  let best = null, n = -1;
  for (const [k, v] of Object.entries(counts || {})) if (v > n) { n = v; best = k; }
  return best;
}
const topKey = mostFrequent;
