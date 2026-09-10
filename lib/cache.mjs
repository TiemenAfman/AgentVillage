// Per-transcript parse cache: transcripts are append-only, so we remember how far we
// read and the aggregate so far, and only fold in the new bytes next time.
import { readJson, writeJsonAtomic } from './paths.mjs';
import { AGG_VERSION } from './parse.mjs';

export const CACHE_VERSION = 1;

export function fileKey(file) { return file.split('/').join('\\').toLowerCase(); }

export function loadCache(file) {
  const c = readJson(file, null);
  if (!c || c.version !== CACHE_VERSION || c.aggVersion !== AGG_VERSION || typeof c.files !== 'object') {
    return { version: CACHE_VERSION, aggVersion: AGG_VERSION, files: {} };
  }
  return c;
}

export function saveCache(file, cache) { writeJsonAtomic(file, cache); }
