// Which version and which commit a tree of this code is, worked out from the tree alone.
//
// A release says so itself: scripts/pack-release.mjs writes both into app/release.json,
// because an unpacked release has no .git to ask. A checkout has package.json for the
// version and .git for the commit, read by hand rather than by running git, which is not
// on every machine this runs on - and not in the Docker stage that stamps the sea.
// src-tauri/src/island.rs `build_label` is the same rule in Rust, for the tray; keep the two
// agreeing, or the tray and the island's own page name different code.
import fs from 'node:fs';
import path from 'node:path';

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const readText = (file) => { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return null; } };

// The commit HEAD points at, shortened to the seven characters `git log --oneline` shows.
// Follows a worktree's `.git` file to its real git dir, a symbolic ref to its branch, and a
// branch that has been packed into packed-refs. Null when there is no repository at all.
export function gitCommit(root) {
  let dir = path.join(root, '.git');
  const pointer = readText(dir);
  if (pointer && pointer.startsWith('gitdir:')) dir = path.resolve(root, pointer.slice(7).trim());
  const head = readText(path.join(dir, 'HEAD'));
  if (!head) return null;
  if (!head.startsWith('ref:')) return /^[0-9a-f]{40}$/.test(head) ? head.slice(0, 7) : null;
  const ref = head.slice(4).trim();
  // A worktree keeps HEAD of its own but shares the refs with the main repository.
  const common = readText(path.join(dir, 'commondir'));
  const refsDir = common ? path.resolve(dir, common) : dir;
  const loose = readText(path.join(refsDir, ref));
  if (loose && /^[0-9a-f]{40}$/.test(loose)) return loose.slice(0, 7);
  const packed = readText(path.join(refsDir, 'packed-refs')) || '';
  for (const line of packed.split('\n')) {
    const [hash, name] = line.trim().split(' ');
    if (name === ref && /^[0-9a-f]{40}$/.test(hash)) return hash.slice(0, 7);
  }
  return null;
}

export function readBuildInfo(root) {
  const release = readJson(path.join(root, 'release.json'));
  if (release) return { version: release.version || null, commit: release.commit || null };
  const pkg = readJson(path.join(root, 'package.json'));
  return { version: (pkg && pkg.version) || null, commit: gitCommit(root) };
}

// "0.1.1 · 9eac940", or as much of it as is known.
export function buildLabel(b) {
  return [b && b.version, b && b.commit].filter(Boolean).join(' · ') || 'unknown build';
}
