// Things put on the island on purpose: a tree someone asked for, a bridge over a
// stream, a bench by the harbour.
//
// The village is grown from Claude's own transcripts and is thrown away and rebuilt on
// every scan, so nothing placed by hand could survive in village.json. It lives here
// instead, in a file the scanner never touches, and the page draws it on top.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA, readJson, writeJsonAtomic } from './paths.mjs';
import { knownShape } from '../shared/shapes.mjs';

export const PROPS_FILE = path.join(DATA, 'props.json');

// The island is 80 cells across and centred on the origin, so the land ends around
// ±40. The slack past that is for a jetty or a buoy sitting out in the water.
const REACH = 60;
// A ceiling, because an agent in a loop is one `for` away from ten thousand trees and
// every one of them is a draw call.
const MAX_PROPS = 500;
const KIND = /^[a-z][a-z0-9-]{0,23}$/;
// Which page a panel carries. Named like a kind, and for the same reason: it is
// looked up in a register in the browser, so it has to be a small, plain word.
const FACE = KIND;

function num(v, fallback, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

export function listProps() {
  const on = readJson(PROPS_FILE, null);
  const props = (on && Array.isArray(on.props)) ? on.props : [];
  return props;
}

function save(props) {
  writeJsonAtomic(PROPS_FILE, { v: 1, savedAt: new Date().toISOString(), props }, { pretty: true });
}

// Puts one thing on the island. Throws with a sentence a person can read, because
// every one of these ends up in front of either the reader or an agent.
export function addProp(spec = {}) {
  const kind = String(spec.kind || '').toLowerCase().trim();
  if (!KIND.test(kind)) throw new Error('a kind is lowercase letters, digits and dashes, like "tree" or "watch-tower"');

  const x = Number(spec.x), z = Number(spec.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error('say where it goes: x and z, in world units');
  if (Math.abs(x) > REACH || Math.abs(z) > REACH) throw new Error(`that is off the map; x and z run from -${REACH} to ${REACH}`);

  const face = spec.face === undefined || spec.face === null || spec.face === ''
    ? null
    : String(spec.face).toLowerCase().trim();
  if (face !== null && !FACE.test(face)) throw new Error('a face is lowercase letters, digits and dashes, like "notice" or "clock"');

  const props = listProps();
  if (props.length >= MAX_PROPS) throw new Error(`the island already carries ${props.length} of these, which is as many as it will hold`);

  const prop = {
    id: `prop:${randomUUID().slice(0, 8)}`,
    kind,
    x: Math.round(x * 1000) / 1000,
    z: Math.round(z * 1000) / 1000,
    rot: num(spec.rot, 0, -Math.PI * 4, Math.PI * 4),
    scale: num(spec.scale, 1, 0.15, 6),
    length: num(spec.length, 0, 0, 30) || null,
    label: spec.label ? String(spec.label).slice(0, 60) : null,
    // Only a panel reads this; on anything else it is a note in the file and nothing more.
    face: face || null,
    note: spec.note ? String(spec.note).slice(0, 200) : null,
    by: spec.by ? String(spec.by).slice(0, 40) : null,
    at: new Date().toISOString(),
    // Drawn as a cairn until somebody gives the kind a shape in web/js/props.js.
    unknown: !knownShape(kind),
  };

  props.push(prop);
  save(props);
  return prop;
}

export function removeProp(id) {
  const props = listProps();
  const i = props.findIndex((p) => p.id === String(id));
  if (i < 0) return null;
  const [gone] = props.splice(i, 1);
  save(props);
  return gone;
}

export function clearProps() {
  const n = listProps().length;
  save([]);
  return n;
}
