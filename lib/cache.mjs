// Per-transcript parse cache: transcripts are append-only, so we remember how far we
// read and the aggregate so far, and only fold in the new bytes next time.
import { readJson, writeJsonAtomic } from './paths.mjs';
import { AGG_VERSION } from './parse.mjs';

export const CACHE_VERSION = 1;

export function fileKey(file) { return file.split('/').join('\\').toLowerCase(); }

export function loadCache(file) {
  const c = readJson(file, null);
  if (!c || c.version !== CACHE_VERSION || c.aggVersion !== AGG_VERSION || typeof c.files !== 'object') {
    // The parsed aggregates are worth throwing away when their format changes - they can
    // always be read again. `repoRoots` cannot: it remembers which repository a folder
    // belonged to, and plenty of those folders have since been renamed or deleted. Losing
    // it would silently move whole hamlets, so it comes along across the bump.
    return { version: CACHE_VERSION, aggVersion: AGG_VERSION, files: {}, repoRoots: (c && c.repoRoots) || {} };
  }
  c.repoRoots = c.repoRoots || {};
  return c;
}

export function saveCache(file, cache) { writeJsonAtomic(file, cache); }
