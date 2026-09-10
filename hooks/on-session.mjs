#!/usr/bin/env node
// SessionStart / SessionEnd hook. Records that a settler arrived (or went quiet) and
// refreshes the island. Two hard rules:
//   - never write to stdout: a SessionStart hook's stdout is injected into the model's context.
//   - always exit 0: the island must never be able to disturb a session.
const realWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = () => true;
console.log = console.info = console.debug = console.warn = () => {};
void realWrite;

import fs from 'node:fs';
import path from 'node:path';
import { DATA, ensureData } from '../lib/paths.mjs';

const LOG = path.join(DATA, 'hook.log');

function log(msg) {
  try {
    ensureData();
    try { if (fs.statSync(LOG).size > 1024 * 1024) fs.renameSync(LOG, LOG + '.1'); } catch {}
    fs.appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch { /* logging must never throw */ }
}

process.on('uncaughtException', (e) => { log(`uncaught: ${e && e.stack}`); process.exit(0); });
process.on('unhandledRejection', (e) => { log(`rejection: ${e && (e.stack || e)}`); process.exit(0); });

function readStdin(timeoutMs = 2000) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(data); } };
    const timer = setTimeout(finish, timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => { clearTimeout(timer); finish(); });
    process.stdin.on('error', () => { clearTimeout(timer); finish(); });
  });
}

const main = async () => {
  const raw = await readStdin();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { log(`unparsable stdin (${raw.length} bytes)`); }

  const record = {
    sessionId: payload.session_id || null,
    cwd: payload.cwd || process.cwd(),
    event: payload.hook_event_name || 'unknown',
    source: payload.source || null,
    reason: payload.reason || null,
    at: Date.now(),
  };

  if (record.sessionId) {
    ensureData();
    fs.appendFileSync(path.join(DATA, 'arrivals.jsonl'), JSON.stringify(record) + '\n');
    log(`${record.event}${record.source ? `/${record.source}` : ''}${record.reason ? `/${record.reason}` : ''} ${record.sessionId} ${record.cwd}`);
  } else {
    log(`${record.event} without a session id, nothing recorded`);
  }

  try {
    const { scan } = await import('../scan.mjs');
    let r = await scan({ quiet: true });
    // The island server may be mid-scan; wait a moment so the new settler still
    // shows up straight away instead of at the next sweep.
    for (let attempt = 0; r && r.skipped && attempt < 3; attempt++) {
      await new Promise((res) => setTimeout(res, 1200));
      r = await scan({ quiet: true });
    }
    if (r && r.skipped) log(`scan skipped: ${r.reason}`);
    else if (r) log(`scan: ${r.settlers} settlers, ${r.apprentices} apprentices, ${r.ms} ms`);
  } catch (e) {
    log(`scan failed: ${e && (e.stack || e)}`);
  }
  process.exit(0);
};

main();
