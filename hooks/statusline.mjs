#!/usr/bin/env node
// Claude Code statusLine command. The one place the five-hour usage window is available:
// Claude Code pipes it here as `rate_limits` on every new message, and nowhere else - not
// to a hook, not into a transcript (Plans/goudkuil.md). So this writes it down for the gold
// pit by the square (data/usage.json, lib/usage.mjs) and prints a status line.
//
//   node hooks/statusline.mjs            record, and print the island's own line
//   node hooks/statusline.mjs --pass     record, and hand stdin on untouched - for putting
//                                        in front of a status line somebody already had:
//                                        node ".../statusline.mjs" --pass | their-command
//
// The session hook's two rules hold here too, in a status line's version of them:
//   - always exit 0, and never with nothing said: a status line that fails leaves a blank
//     line in somebody's terminal, and in --pass mode it would blank *their* line as well,
//     so stdin goes back out before anything that could fail is attempted.
//   - never hang: stdin is given up on after a moment, and recording is one small file.
import path from 'node:path';

const PASS = process.argv.includes('--pass');

function readStdin(timeoutMs = 1500) {
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

let raw = '';
process.on('uncaughtException', () => { if (PASS) process.stdout.write(raw); process.exit(0); });
process.on('unhandledRejection', () => { if (PASS) process.stdout.write(raw); process.exit(0); });

// Local time, because this line is read by the person at this keyboard - the one place in
// the project where the machine's own zone is the right answer.
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const main = async () => {
  raw = await readStdin();
  // Handed on first, so whatever goes wrong below costs the island a reading and never
  // costs anybody their own status line.
  if (PASS) process.stdout.write(raw);

  let payload = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch { /* not JSON: nothing to record */ }

  let gold = null;
  try {
    // Imported here rather than at the top: lib/paths.mjs works out where the island lives
    // (and moves one in on a first run, like the session hook does), and none of that may
    // stand between stdin and stdout in --pass mode.
    const { readingOf, writeUsage, readUsage } = await import('../lib/usage.mjs');
    const { goldOf } = await import('../shared/gold.mjs');
    const reading = payload ? readingOf(payload) : null;
    if (reading) {
      try { writeUsage(reading); } catch { /* EPERM while the islander reads it: next message */ }
    }
    gold = goldOf(reading || readUsage(), Date.now());
  } catch { /* no island to write to: the line below still prints */ }

  if (PASS) process.exit(0);

  if (gold && gold.known) {
    const when = gold.resetsAt ? ` · full again at ${clock(gold.resetsAt)}` : '';
    process.stdout.write(`⛏ ${gold.bars}/${gold.max} gold${when}\n`);
  } else {
    // No window to show - an API key, or the first moment of a session. Say something
    // useful rather than nothing: which model, and where.
    const model = payload && payload.model && (payload.model.display_name || payload.model.id);
    const dir = payload && (payload.workspace?.current_dir || payload.cwd);
    process.stdout.write(`${[model, dir ? path.basename(dir) : null].filter(Boolean).join(' · ') || 'Promptholm'}\n`);
  }
  process.exit(0);
};

main();
