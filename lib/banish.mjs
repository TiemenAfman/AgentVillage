// Sending a settler off the island.
//
// This removes a building from the village, nothing else. The session transcript it was
// read from is never touched, so a banishment can always be undone and no history is
// lost by tidying up the island.
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from './paths.mjs';

export const BANISHED_FILE = path.join(DATA, 'banished.jsonl');

// Append-only, latest line per building wins, so the file doubles as a history.
export function readBanished() {
  let text;
  try { text = fs.readFileSync(BANISHED_FILE, 'utf8'); } catch { return new Map(); }
  const byId = new Map();
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const o = JSON.parse(s);
      if (!o || !o.id) continue;
      if (o.action === 'return') byId.delete(o.id);
      else byId.set(o.id, o);
    } catch { /* a torn last line is fine */ }
  }
  return byId;
}

export function banish(record) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.appendFileSync(BANISHED_FILE, JSON.stringify({ ...record, action: 'banish', at: Date.now() }) + '\n');
}

export function unbanish(id) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.appendFileSync(BANISHED_FILE, JSON.stringify({ id, action: 'return', at: Date.now() }) + '\n');
}
