#!/usr/bin/env node
// The island's own command line.
//
// It exists for the agent that a thought starts: something standing in this repository
// with a shell, asked to put a bridge where somebody is standing. Quoting JSON through
// curl on Windows is a losing game, so this is the front door instead.
//
// It talks to the running island over HTTP, which is what makes a new tree appear in
// the open page a second later. If nothing is listening it writes the file directly and
// says so, because a build that silently went nowhere is worse than one that waits.
import path from 'node:path';
import { DATA, loadConfig, readJson } from '../lib/paths.mjs';
import { listProps, addProp, removeProp, clearProps } from '../lib/props.mjs';
import { whereIsPlayer } from '../lib/player.mjs';
import { catalogueLines } from '../shared/shapes.mjs';

const PORT = Number(process.env.SETTLERS_PORT || loadConfig().port || 4747);
const BASE = `http://127.0.0.1:${PORT}`;

const USAGE = `The island's command line - ${BASE}

  node tools/island.mjs where
      Where the person walking the island is standing.

  node tools/island.mjs look [--at <x>,<z>] [--range <n>]
      What stands nearby, and where. Around the walker by default.

  node tools/island.mjs kinds
      What can be built.

  node tools/island.mjs build <kind> --at <x>,<z> [options]
  node tools/island.mjs build <kind> --here [--step <n>] [options]
      Put one thing on the island. --here means where they are standing;
      --step pushes it that many units in front of them (2 by default), so it
      does not land on their head.

      --rot <radians>     which way it faces, or runs
      --scale <n>         0.15 to 6, 1 by default
      --length <n>        how far a bridge or a fence reaches
      --label "<text>"    a name for it
      --note "<text>"     why it is there

  node tools/island.mjs list
  node tools/island.mjs remove <id>
  node tools/island.mjs clear
  node tools/island.mjs reload
      Ask every open island to reload the page. Only after changing its code.

What can be built today:
${catalogueLines().join('\n')}

A kind that is not in that list is still placed, as a labelled cairn. To give it a
real shape, add a builder to web/js/props.js and an entry to shared/shapes.mjs.
`;

function parseArgs(argv) {
  const flags = {};
  const loose = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[a.slice(2)] = true;
      else { flags[a.slice(2)] = next; i++; }
    } else loose.push(a);
  }
  return { flags, loose };
}

// Every call goes through here, so "the island is not running" is said once.
async function api(path, { method = 'GET', body = null } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 200) }; }
  if (!res.ok) throw new Error(data.error || data.reason || `the island said ${res.status}`);
  return data;
}

function offline(e) {
  return /ECONNREFUSED|fetch failed|ENOTFOUND|socket hang up/i.test(String(e && e.message));
}

// Where the walker is: from the running island if it is up, from the last note it left
// behind if it is not.
async function here() {
  try { return (await api('/api/where')).at; } catch (e) {
    if (!offline(e)) throw e;
    return whereIsPlayer();
  }
}

function describe(p) {
  const bits = [`${p.id}  ${p.kind}`, `at ${p.x}, ${p.z}`];
  if (p.rot) bits.push(`rot ${p.rot}`);
  if (p.scale && p.scale !== 1) bits.push(`scale ${p.scale}`);
  if (p.length) bits.push(`length ${p.length}`);
  if (p.label) bits.push(`"${p.label}"`);
  if (p.unknown) bits.push('(no shape yet - standing as a cairn)');
  return bits.join('  ');
}

async function main() {
  const { flags, loose } = parseArgs(process.argv.slice(2));
  const cmd = (loose[0] || (flags.help ? 'help' : '')).toLowerCase();

  if (!cmd || cmd === 'help') { process.stdout.write(USAGE); return; }

  if (cmd === 'kinds') {
    process.stdout.write(`${catalogueLines().join('\n')}\n`);
    return;
  }

  if (cmd === 'where') {
    const at = await here();
    if (!at) { process.stdout.write('Nobody has walked the island yet, so there is no "here".\n'); return; }
    const age = Math.round((Date.now() - Date.parse(at.at)) / 1000);
    process.stdout.write(
      `x ${at.x}, z ${at.z}, ground ${at.y} high, facing ${at.yaw}\n`
      + `${at.near ? `beside ${at.near}\n` : ''}`
      + `${at.walking ? 'on foot' : 'last seen on foot'}, ${age < 90 ? `${age} s ago` : `${Math.round(age / 60)} min ago`}\n`,
    );
    return;
  }

  // What is around, with coordinates. Without this an agent asked to put a bench "with
  // its back to the notice board" has to work out the grid from the source first, which
  // is a dozen greps to learn something the island already knows.
  if (cmd === 'look') {
    let x, z;
    if (flags.at) {
      [x, z] = String(flags.at).split(',').map((s) => Number(s.trim()));
      if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error('--at takes two numbers, like --at 12.5,-3.2');
    } else {
      const at = await here();
      if (!at) throw new Error('nobody is walking the island - say --at x,z');
      x = at.x; z = at.z;
    }
    const range = Number(flags.range) || 20;

    const village = readJson(path.join(DATA, 'village.json'), null);
    if (!village) { process.stdout.write('The island has not been scanned yet.\n'); return; }
    // A plot is a block of grid cells; the world puts the origin in the middle of the
    // grid, so a cell at gx is at gx - half. This is the same sum web/js/main.js does.
    const half = (village.grid && village.grid.size ? village.grid.size : 80) / 2;
    const rows = [];
    for (const b of village.buildings || []) {
      if (!b.plot) continue;
      const bx = b.plot.gx + b.plot.w / 2 - half;
      const bz = b.plot.gz + b.plot.d / 2 - half;
      const d = Math.hypot(bx - x, bz - z);
      if (d > range) continue;
      const what = b.kind === 'civic' ? (b.civicType || 'civic') : b.kind;
      rows.push({ d, line: `${d.toFixed(1).padStart(5)} away  ${bx.toFixed(1)}, ${bz.toFixed(1)}  ${what.padEnd(9)} ${b.name}${b.title ? ` - ${b.title}` : ''}` });
    }
    let props = [];
    try { props = (await api('/api/props')).props; } catch (e) { if (!offline(e)) throw e; props = listProps(); }
    for (const p of props) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d > range) continue;
      rows.push({ d, line: `${d.toFixed(1).padStart(5)} away  ${p.x.toFixed(1)}, ${p.z.toFixed(1)}  ${p.kind.padEnd(9)} ${p.label || '(built by hand)'}  ${p.id}` });
    }
    rows.sort((a, b) => a.d - b.d);
    process.stdout.write(rows.length
      ? `Around ${x.toFixed(1)}, ${z.toFixed(1)}, out to ${range}:\n${rows.map((r) => `  ${r.line}`).join('\n')}\n`
      : `Nothing within ${range} of ${x.toFixed(1)}, ${z.toFixed(1)}. Open ground.\n`);
    return;
  }

  if (cmd === 'list') {
    let props = [];
    try { props = (await api('/api/props')).props; } catch (e) {
      if (!offline(e)) throw e;
      props = listProps();
    }
    if (!props.length) { process.stdout.write('Nothing has been built by hand yet.\n'); return; }
    process.stdout.write(`${props.map(describe).join('\n')}\n${props.length} in all\n`);
    return;
  }

  if (cmd === 'build') {
    const kind = loose[1];
    if (!kind) throw new Error('say what to build: node tools/island.mjs build tree --here');

    let x = null, z = null;
    if (flags.at) {
      const [ax, az] = String(flags.at).split(',').map((s) => Number(s.trim()));
      if (!Number.isFinite(ax) || !Number.isFinite(az)) throw new Error('--at takes two numbers, like --at 12.5,-3.2');
      x = ax; z = az;
    } else if (flags.here) {
      const at = await here();
      if (!at) throw new Error('nobody is walking the island, so there is no "here" - use --at x,z');
      // A step in the direction they are facing, so the thing they asked for appears in
      // front of them rather than through them.
      const step = flags.step === undefined ? 2 : Number(flags.step);
      x = at.x + Math.sin(at.yaw) * step;
      z = at.z + Math.cos(at.yaw) * step;
    } else {
      throw new Error('say where: --at x,z or --here');
    }

    const spec = {
      kind,
      x: Math.round(x * 100) / 100,
      z: Math.round(z * 100) / 100,
      rot: flags.rot === undefined ? undefined : Number(flags.rot),
      scale: flags.scale === undefined ? undefined : Number(flags.scale),
      length: flags.length === undefined ? undefined : Number(flags.length),
      label: flags.label === true ? undefined : flags.label,
      note: flags.note === true ? undefined : flags.note,
      by: 'a thought',
    };

    try {
      const r = await api('/api/build', { method: 'POST', body: spec });
      process.stdout.write(`Built. ${describe(r.prop)}\nThe open island has it already.\n`);
    } catch (e) {
      if (!offline(e)) throw e;
      const prop = addProp(spec);
      process.stdout.write(`Built. ${describe(prop)}\nThe island is not running, so this will appear the next time it is opened.\n`);
    }
    return;
  }

  if (cmd === 'remove') {
    const id = loose[1];
    if (!id) throw new Error('which one? node tools/island.mjs list');
    try {
      const r = await api('/api/unbuild', { method: 'POST', body: { id } });
      process.stdout.write(r.removed ? `Gone: ${describe(r.removed)}\n` : `There is no ${id}.\n`);
    } catch (e) {
      if (!offline(e)) throw e;
      const gone = removeProp(id);
      process.stdout.write(gone ? `Gone: ${describe(gone)}\n` : `There is no ${id}.\n`);
    }
    return;
  }

  if (cmd === 'clear') {
    try {
      const r = await api('/api/unbuild', { method: 'POST', body: { clear: true } });
      process.stdout.write(`Cleared ${r.cleared} thing(s) off the island.\n`);
    } catch (e) {
      if (!offline(e)) throw e;
      process.stdout.write(`Cleared ${clearProps()} thing(s) off the island.\n`);
    }
    return;
  }

  if (cmd === 'reload') {
    const r = await api('/api/reload', { method: 'POST' });
    process.stdout.write(`Asked ${r.islands} open island(s) to reload.\n`);
    return;
  }

  throw new Error(`the island does not do "${cmd}". Try: node tools/island.mjs help`);
}

main().catch((e) => {
  process.stderr.write(`${e && e.message ? e.message : e}\n`);
  process.exit(1);
});
