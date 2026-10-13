// The keeper's Mixamo library, for the motion workbench's catalogue (/avatar-motion.html,
// web/js/mixamo-catalogue.js). scripts/mixamo-fetch.mjs fills <dir>/anims/y-bot/ with every clip on
// Y Bot (a <name>.fbx and a <name>.json manifest beside it); this only reads that folder and hands
// its files to the keeper's own page. The FBX are Adobe's: allowed inside a game once baked
// (scripts/bake-mixamo-gait.py), not as files handed out - so the two routes that use this are
// keeper-only (not on PUBLIC_API), and nothing here goes into a bundle, a release or the sea.
// The folder also holds the keeper's Mixamo token (<dir>/token.txt): nothing outside
// anims/y-bot/ is ever read, and only a bare `<word>.fbx` there is served.
import fs from 'node:fs';
import path from 'node:path';

// scripts/mixamo-fetch.mjs's own default (DEFAULT_OUT), so the two agree with no config at all.
export const MIXAMO_DEFAULT = 'D:\\Mixamo';
// Which skeleton's clips: Y Bot (the same 65 mixamorig bones as X Bot and the Mannequin).
export const MIXAMO_RIG = 'y-bot';

// The library's root: config.mixamo.dir when it is a whole path, else MIXAMO_OUT, else the default.
export function mixamoDirOf(config, env = process.env) {
  const dir = config && config.mixamo && config.mixamo.dir;
  if (typeof dir === 'string' && path.isAbsolute(dir)) return path.resolve(dir);
  return env.MIXAMO_OUT || MIXAMO_DEFAULT;
}

export function clipsDirOf(root) {
  return path.join(root, 'anims', MIXAMO_RIG);
}

// A file name the route will serve: one word of letters, digits, dashes and underscores, then
// .fbx - no separator, no dot before the extension, so nothing can climb out of the folder.
const FILE = /^[a-z0-9][a-z0-9_-]{0,120}\.fbx$/i;
export function isClipName(name) {
  return typeof name === 'string' && FILE.test(name);
}

// The path of one clip, or null: a bare name that is an .fbx actually in the folder.
export function clipPath(root, name) {
  if (!isClipName(name)) return null;
  const dir = clipsDirOf(root), file = path.join(dir, name);
  if (path.dirname(file) !== dir) return null;
  try { if (!fs.statSync(file).isFile()) return null; } catch { return null; }
  return file;
}

// Every clip: { file, name, id, description, inPlace, seconds }. Manifests are small, but 2419 of
// them are a quarter of a second, so the list is kept until the folder's mtime moves (a fetch adds
// files, which moves it). Read with readFileSync, never a stream (the EPERM pitfall in CLAUDE.md).
let cached = null;
export function listClips(root) {
  const dir = clipsDirOf(root);
  let stat;
  try { stat = fs.statSync(dir); } catch { return { dir, clips: [], missing: true }; }
  if (cached && cached.dir === dir && cached.mtime === stat.mtimeMs) return cached.out;
  const clips = [];
  for (const f of fs.readdirSync(dir)) {
    if (!isClipName(f)) continue;
    const stem = f.slice(0, -4);
    let m = null;
    try { m = JSON.parse(fs.readFileSync(path.join(dir, stem + '.json'), 'utf8')); } catch {}
    const seconds = m && Number.isFinite(m.seconds) ? m.seconds : null;
    clips.push({
      file: f,
      name: m && typeof m.name === 'string' ? m.name : stem,
      id: m && typeof m.id === 'string' ? m.id : null,
      description: m && typeof m.description === 'string' ? m.description : '',
      inPlace: !!(m && m.settings && m.settings.inplace),
      seconds,
    });
  }
  clips.sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file));
  const out = { dir, clips, missing: false };
  cached = { dir, mtime: stat.mtimeMs, out };
  return out;
}
