#!/usr/bin/env node
// Restarts the running island when its own server-side code changes, but never without
// asking first: a silent restart would drop the socket under whoever is standing on the
// island mid-conversation with no warning. No dependency beyond node:fs/child_process/
// readline - the rest of this project has none either, and this is a dev tool, not a
// reason to start.
//
// Watches lib/, shared/ and the three entry points a code change can land in
// (serve.mjs, scan.mjs, sea.mjs); web/js/ is deliberately not here, because the running
// browser already refetches that on its own SSE `reload` (see /api/reload in serve.mjs) -
// restarting the Node process for a client-only change would kill a connection nothing
// asked to drop.
import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WATCH_DIRS = ['lib', 'shared'];
const WATCH_FILES = ['serve.mjs', 'scan.mjs', 'sea.mjs'];
const forwardedArgs = process.argv.slice(2);

let child = null;
let restarting = false;
let awaitingAnswer = false;
let debounce = null;

function startServer() {
  child = spawn(process.execPath, ['serve.mjs', ...forwardedArgs], { cwd: ROOT, stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    if (restarting) return;                 // this exit is the one we asked for
    console.log(`\n[watch-island] serve.mjs exited on its own (code ${code}, signal ${signal}) - not restarting it for you.`);
  });
}

function askRestart(file) {
  if (awaitingAnswer) return;                // one prompt at a time; more changes just wait
  awaitingAnswer = true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(`\n[watch-island] ${file} changed - restart the island? [Y/n] `, (answer) => {
    rl.close();
    awaitingAnswer = false;
    if (answer.trim().toLowerCase() === 'n') { console.log('[watch-island] left running.'); return; }
    console.log('[watch-island] restarting...');
    restarting = true;
    const old = child;
    old.once('exit', () => { restarting = false; startServer(); });
    old.kill();
  });
}

function onChange(label) {
  clearTimeout(debounce);
  // A save often touches a file twice (editor write + a metadata update); one prompt per
  // burst of changes, not one per fs event.
  debounce = setTimeout(() => askRestart(label), 300);
}

for (const dir of WATCH_DIRS) {
  watch(path.join(ROOT, dir), { recursive: true }, (_, f) => { if (f) onChange(path.join(dir, f)); });
}
for (const file of WATCH_FILES) {
  watch(path.join(ROOT, file), () => onChange(file));
}

process.on('SIGINT', () => { if (child) child.kill(); process.exit(0); });

console.log(`[watch-island] watching ${[...WATCH_DIRS, ...WATCH_FILES].join(', ')} for changes.`);
startServer();
