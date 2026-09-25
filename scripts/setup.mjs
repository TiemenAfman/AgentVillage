#!/usr/bin/env node
// One command to go from a fresh clone to a working island.
//
//   node scripts/setup.mjs              install
//   node scripts/setup.mjs --uninstall  take the hook back out
//   node scripts/setup.mjs --dry-run    say what it would do and change nothing
//
// The only things that touch anything outside this folder are the session hook and the
// status line, which are added to ~/.claude/settings.json. That file is backed up first and
// every other setting in it is left exactly as it was - a status line that was already
// there included: ours goes in front of it in a pipe (see lib/statusline.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG_FILE, FOUNDING } from '../lib/paths.mjs';
import { installStatusLine, uninstallStatusLine } from '../lib/statusline.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const SETTINGS = path.join(CLAUDE_HOME, 'settings.json');
const HOOK = path.join(ROOT, 'hooks', 'on-session.mjs');
// The gold pit's reading: Claude Code gives the five-hour usage window to a status line and
// to nothing else (Plans/goudkuil.md).
const STATUS_LINE = path.join(ROOT, 'hooks', 'statusline.mjs');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const UNINSTALL = argv.includes('--uninstall');
// What promptholm-island.exe passes on the first start of an unpacked release. The one
// difference: a hook that is already there is left alone, because on a machine that also
// has a checkout it points at that checkout's island, and quietly moving it to a copy
// somebody unpacked on the desktop to try would take the sessions away from the real one.
const FIRST_RUN = argv.includes('--first-run');

const say = (s) => process.stdout.write(`${s}\n`);
const step = (s) => say(`  ${s}`);

// Forward slashes on purpose: the hook command is run through Git Bash on Windows.
const hookCommand = `node "${HOOK.replace(/\\/g, '/')}"`;
const hookEntry = { type: 'command', command: hookCommand, async: true, timeout: 20 };
const isOurs = (h) => h && typeof h.command === 'string'
  && /on-session\.mjs/.test(h.command);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  if (DRY) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------- config
function ensureConfig() {
  // CONFIG_FILE, not ROOT: the island keeps its config in ~/.promptholm (see HOME in
  // lib/paths.mjs, which has already moved an existing island in by the time this runs),
  // and this has to write where the server will read.
  const file = CONFIG_FILE;
  if (fs.existsSync(file)) {
    const cfg = readJson(file, {});
    step(`config.json is already there (island "${cfg.islandName || 'unnamed'}"${cfg.foundedAt ? `, founded ${new Date(cfg.foundedAt).toLocaleDateString()}` : ', not yet founded'})`);
    return;
  }
  const example = readJson(path.join(ROOT, 'config.example.json'), {});
  // Founded today, so founded small: FOUNDING in lib/paths.mjs, and why it is not the example.
  const cfg = { ...example, ...FOUNDING, foundedAt: new Date().toISOString() };
  writeJson(file, cfg);
  step(`config.json created; the island is founded as of now, so it starts empty and grows`);
  step(`  rename it or pick another seed in config.json for a different island`);
}

// ---------------------------------------------------------------- the hook
function currentHooks(settings) {
  const hooks = settings.hooks && typeof settings.hooks === 'object' ? { ...settings.hooks } : {};
  for (const event of ['SessionStart', 'SessionEnd']) {
    if (!Array.isArray(hooks[event])) hooks[event] = [];
  }
  return hooks;
}

function installHook() {
  if (!fs.existsSync(HOOK)) throw new Error(`the hook is missing at ${HOOK}`);
  const settings = readJson(SETTINGS, {});
  const before = JSON.stringify(settings);
  const hooks = currentHooks(settings);
  if (FIRST_RUN && ['SessionStart', 'SessionEnd'].some((e) => hooks[e].some((g) => (g.hooks || []).some(isOurs)))) {
    step('a Promptholm hook is already installed; left as it is (run setup by hand to point it here)');
    return;
  }

  let added = 0;
  let updated = 0;
  for (const event of ['SessionStart', 'SessionEnd']) {
    // drop any earlier copy of ours, wherever it sits, then add one clean entry
    const groups = [];
    for (const group of hooks[event]) {
      const kept = (group.hooks || []).filter((h) => !isOurs(h));
      if (kept.length !== (group.hooks || []).length) updated++;
      if (kept.length) groups.push({ ...group, hooks: kept });
      else if (!group.hooks) groups.push(group);
    }
    groups.push({ hooks: [hookEntry] });
    added++;
    hooks[event] = groups;
  }
  settings.hooks = hooks;

  if (JSON.stringify(settings) === before) { step('the hook was already installed and up to date'); return; }
  backup();
  writeJson(SETTINGS, settings);
  step(updated ? `hook updated on SessionStart and SessionEnd (${updated} old entr${updated === 1 ? 'y' : 'ies'} replaced)` : `hook added to SessionStart and SessionEnd`);
  step(`  ${hookCommand}`);
  void added;
}

function uninstallHook() {
  const settings = readJson(SETTINGS, null);
  if (!settings || !settings.hooks) { step('no hooks in settings.json; nothing to remove'); return; }
  let removed = 0;
  for (const event of Object.keys(settings.hooks)) {
    if (!Array.isArray(settings.hooks[event])) continue;
    settings.hooks[event] = settings.hooks[event]
      .map((group) => {
        const kept = (group.hooks || []).filter((h) => !isOurs(h));
        removed += (group.hooks || []).length - kept.length;
        return { ...group, hooks: kept };
      })
      .filter((group) => (group.hooks || []).length);
    if (!settings.hooks[event].length) delete settings.hooks[event];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  if (!removed) { step('the island hook was not installed'); return; }
  backup();
  writeJson(SETTINGS, settings);
  step(`removed ${removed} hook entr${removed === 1 ? 'y' : 'ies'}; every other setting was left alone`);
}

// ---------------------------------------------------------------- the status line
function installStatus() {
  if (!fs.existsSync(STATUS_LINE)) throw new Error(`the status line is missing at ${STATUS_LINE}`);
  const settings = readJson(SETTINGS, {});
  const { settings: next, did } = installStatusLine(settings, STATUS_LINE);
  if (did === 'unchanged') { step('the status line was already installed and up to date'); return; }
  if (did === 'kept') {
    step('you have a status line that is not a command, so it was left alone; the gold pit');
    step(`  gets no reading until one runs: node "${STATUS_LINE.replace(/\\/g, '/')}" --pass | <yours>`);
    return;
  }
  backup();
  writeJson(SETTINGS, next);
  step(did === 'wrapped'
    ? 'status line put in front of your own (it still prints exactly what it did), for the gold pit'
    : did === 'updated' ? 'status line pointed here' : 'status line added, for the gold pit by the square');
  step(`  ${next.statusLine.command}`);
}

function uninstallStatus() {
  const settings = readJson(SETTINGS, null);
  if (!settings) return;
  const { settings: next, did } = uninstallStatusLine(settings);
  if (did === 'absent') { step('the island status line was not installed'); return; }
  backup();
  writeJson(SETTINGS, next);
  step(did === 'unwrapped' ? 'status line taken out; yours is back as it was' : 'status line removed');
}

function backup() {
  if (DRY || !fs.existsSync(SETTINGS)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const to = `${SETTINGS}.${stamp}.bak`;
  fs.copyFileSync(SETTINGS, to);
  step(`backed up settings.json to ${path.basename(to)}`);
}

// ---------------------------------------------------------------- checks
function checks() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) say(`  ! Node ${process.versions.node} is older than the 20 this needs`);
  if (!fs.existsSync(path.join(ROOT, 'web', 'vendor', 'three.module.js'))) {
    say('  ! three.js is not vendored yet: run npm install (or npm run vendor)');
  }
  const jira = process.env.JIRA_BASE_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN;
  step(jira
    ? 'Jira is configured, so the sprint board will fill itself'
    : 'Jira is not configured; the board stays empty until JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN are set');
}

// ---------------------------------------------------------------- go
try {
  say(DRY ? '\nPromptholm setup (dry run, nothing will change)\n' : '\nPromptholm setup\n');
  if (UNINSTALL) {
    uninstallHook();
    uninstallStatus();
    say('\nThe island itself is untouched. Delete the folder to remove it entirely.\n');
  } else {
    ensureConfig();
    installHook();
    installStatus();
    checks();
    // On a first run the islander is about to start the island itself, and there is no
    // npm in an unpacked release to point anybody at.
    if (FIRST_RUN) say('\nReady.\n');
    else {
      say('\nReady. Start it with:  npm run dev');
      say('Or, with Rust installed, npm run app for its own window.\n');
    }
  }
} catch (e) {
  process.stderr.write(`\nsetup failed: ${e.message}\n`);
  process.exit(1);
}
