// Where Blender is, and running it. The island never needs Blender - the shapes are
// baked and committed - so this is only ever reached by someone rebuilding a model set,
// and it may fail with a sentence rather than a stack.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// $BLENDER wins, because a machine with two Blenders has an opinion about which one.
// Then the versioned install this project was authored in, newest first. Then the PATH,
// which is where it is on a Linux or a Homebrew machine.
function candidates() {
  const out = [];
  if (process.env.BLENDER) out.push(process.env.BLENDER);
  for (const base of ['C:/Program Files/Blender Foundation', 'C:/Program Files (x86)/Blender Foundation']) {
    let dirs = [];
    try { dirs = fs.readdirSync(base).filter((d) => d.startsWith('Blender ')).sort().reverse(); } catch { /* no Blender here */ }
    for (const d of dirs) out.push(path.join(base, d, 'blender.exe'));
  }
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const exe of ['blender.exe', 'blender']) out.push(path.join(dir, exe));
  }
  return out;
}

export function findBlender() {
  for (const exe of candidates()) {
    try { if (fs.statSync(exe).isFile()) return exe; } catch { /* next */ }
  }
  return null;
}

// Blender's own exit code is what matters: a script that raises leaves it non-zero, which
// is what makes `npm run models` fail on a model that breaks a rule.
export function runBlender(args, { cwd } = {}) {
  const exe = findBlender();
  if (!exe) {
    console.error('Blender was not found. Install Blender 5.2, or point $BLENDER at blender.exe.');
    console.error('Nothing on the island needs it: web/js/*-mesh.js is committed and is what the page loads.');
    return 127;
  }
  const r = spawnSync(exe, args, { stdio: 'inherit', cwd });
  if (r.error) { console.error(`could not run ${exe}: ${r.error.message}`); return 127; }
  return r.status ?? 1;
}

// `node scripts/blender.mjs --background --python scripts/export-models.py` for a run
// that wants nothing but Blender with arguments, and with no arguments it simply says
// which Blender it would use.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (!args.length) console.log(findBlender() || 'Blender was not found.');
  else process.exit(runBlender(args));
}
