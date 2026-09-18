// Things put on the island on purpose: a tree someone asked for, a bridge over a
// stream, a bench by the harbour.
//
// The village is grown from Claude's own transcripts and is thrown away and rebuilt on
// every scan, so nothing placed by hand could survive in village.json. It lives here
// instead, in a file the scanner never touches, and the page draws it on top.
//
// Every mutator takes an options object whose only interesting member is `file`. That is
// what lets a *berth* - somebody else's island parked under data/guests/<id>/ while they
// visit - have hand-placed scenery of its own without either island writing into the
// other's file. The default is this island's own props.json, so a caller that does not
// care (all of serve.mjs and tools/island.mjs) is unchanged.
//
// The reason this file and garden.mjs are the only two that grow a `file` option: they
// are the only two pieces of state a visit can change. scan.mjs is the sole writer of
// village.json and layout.json and it builds them out of Claude transcripts that exist
// only on the owner's machine, so a host is structurally incapable of producing a newer
// village or layout - it can only hold the copy it was handed. props.json and garden.json
// are exactly the two files the scanner never touches, which is why they are exactly the
// two that can travel. (The same sentence, from the other end, is in lib/visits.mjs.)
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA, readJson, writeJsonAtomic, loadConfig } from './paths.mjs';
import { knownShape } from '../shared/shapes.mjs';

export const PROPS_FILE = path.join(DATA, 'props.json');

// The island is `gridSize` cells across and centred on the origin, so the land ends
// around half of that. The slack past it is for a jetty or a buoy sitting out in the
// water. It was a flat sixty, written when the island was eighty cells across; on the
// island as it is now that refused a tree anybody asked for past the sixtieth cell -
// which is most of the island - with "that is off the map".
//
// Deliberately still a function of its argument every single time, and NOT memoised into
// a module-level `let`. Two berths can be two different islands - a 64-cell one and a
// 256-cell one - and a cached edge would let the second island's jetty be refused as "off
// the map" or the first island's be accepted a hundred cells out at sea. The call costs
// one JSON read of config.json, which is nothing next to a prop that lands in the water.
const reach = (gridSize = null) => (Number(gridSize) || loadConfig().gridSize || 64) / 2 + 20;
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

export function listProps({ file = PROPS_FILE } = {}) {
  const on = readJson(file, null);
  const props = (on && Array.isArray(on.props)) ? on.props : [];
  return props;
}

function save(props, file = PROPS_FILE) {
  writeJsonAtomic(file, { v: 1, savedAt: new Date().toISOString(), props }, { pretty: true });
}

// Puts one thing on the island. Throws with a sentence a person can read, because
// every one of these ends up in front of either the reader or an agent.
//
// `gridSize` is the berth's own island size when this is a berth's props file; leaving it
// out means "this island", read from config.json.
export function addProp(spec = {}, { file = PROPS_FILE, gridSize = null } = {}) {
  const kind = String(spec.kind || '').toLowerCase().trim();
  if (!KIND.test(kind)) throw new Error('a kind is lowercase letters, digits and dashes, like "tree" or "watch-tower"');

  const x = Number(spec.x), z = Number(spec.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error('say where it goes: x and z, in world units');
  const edge = reach(gridSize);
  if (Math.abs(x) > edge || Math.abs(z) > edge) throw new Error(`that is off the map; x and z run from -${edge} to ${edge}`);

  const face = spec.face === undefined || spec.face === null || spec.face === ''
    ? null
    : String(spec.face).toLowerCase().trim();
  if (face !== null && !FACE.test(face)) throw new Error('a face is lowercase letters, digits and dashes, like "notice" or "clock"');

  const props = listProps({ file });
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
  save(props, file);
  return prop;
}

// Null for a prop that is not there, rather than a throw. That is what makes replaying a
// visit's journal idempotent for free on this end (see lib/visits.mjs): unbuilding
// something that has already gone is not an error, it is the state you asked for.
export function removeProp(id, { file = PROPS_FILE } = {}) {
  const props = listProps({ file });
  const i = props.findIndex((p) => p.id === String(id));
  if (i < 0) return null;
  const [gone] = props.splice(i, 1);
  save(props, file);
  return gone;
}

export function clearProps({ file = PROPS_FILE } = {}) {
  const n = listProps({ file }).length;
  save([], file);
  return n;
}
