// The chronicle house, the ladder's last rung (Plans/DONE/kroniekhuis.md): where the island's
// history is asked for.
//
// What it opens is not a view of its own. The chronicle already is one: the bar along the
// bottom of the sky view (the scrubber, ▶, the speed and Live in web/index.html), moved by
// main.js's setChronicleTime and advanceChronicle, with web/js/history.js projecting the village
// onto the moment. The house is a second way to press ▶ - from the founding day, at whatever
// speed the bar is set to - because a second history panel beside that bar would be a second
// description of the past to keep in step with the first, and the first is the one every other
// part of the island (the landscape, the traces, the crowd, the animals) already follows.
//
// Only our own chronicle house offers it. The chronicle is our village's: chronicleBounds reads
// our founding day, applyVisibility rewinds `state.byId` and nothing else, and the guests are
// hidden while it is scrubbed back (web/js/crowd-view.js). A neighbour's house is drawn by
// web/js/guest-island.js from their bundle, under a `guest:<region>:<id>` id and never in
// `state.byId`, so it gets no prompt and a click on it is the click on nothing every guest
// building gets - showing somebody else's history would need a projection of their bundle and
// a second set of records to rewind, which is a feature, not a door.
//
// DOM-free and three-free, so tests/chronicle.test.mjs can hold where the door is.

export const CHRONICLE = 'chronicle';
export const LABEL = 'the chronicle house';
export const PROMPT = 'read the chronicle';
// Under its name when the pointer is on it (after the "Unlocked at 200 settlers" every milestone
// carries), because the click does not open a dossier the way a click on every other building
// does, and a click that does something new should say so first.
export const HOVER = 'click to read the chronicle';

// Where the prompt is measured from: a step out from the foot of the portico, which is as close
// as a walker gets (the house's solid ends there), and how near that has to be. 1.2 answers from
// anywhere in front of the portico and the front corners, and not from along the sides, where the
// doorway is out of sight.
export const STEP_OUT = 0.3;
export const REACH = 1.2;
// The foot of the portico as baked (scripts/build-chronicle.py), for a record built without the
// anchor - a checkout whose bake went missing still asks at the front, not in the middle.
const DOOR_FALLBACK = [0, 0, 0.86];

export const isChronicle = (spec) => !!spec && spec.kind === 'civic' && spec.civicType === CHRONICLE;

// One of our own records that opens the chronicle. The `guest:` test is belt and braces: no guest
// record reaches `state.byId`, but a record handed in from anywhere else still has to be ours.
export function opensChronicle(rec) {
  return !!rec && isChronicle(rec.spec) && !String(rec.id).startsWith('guest:');
}

// The point the prompt answers from, in scene coordinates: the door anchor, `out` further along
// the house's own +z, turned by the group's yaw the same way three turns it
// (x' = x cos + z sin, z' = -x sin + z cos) - the arithmetic guest-island.js's blockers use.
export function chronicleDoor(rec, out = STEP_OUT) {
  const p = rec.group.position;
  const yaw = rec.group.rotation.y || 0;
  const at = (rec.built && rec.built.anchors && rec.built.anchors.door) || DOOR_FALLBACK;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const x = at[0], z = at[2] + out;
  return [p.x + x * c + z * s, p.z - x * s + z * c];
}

// What walk mode is handed for it: E at the door. Null for anything that is not our own
// standing chronicle house, so the caller can push it without a second test.
export function chronicleInteractable(rec) {
  if (!opensChronicle(rec) || !rec.group.visible) return null;
  const [x, z] = chronicleDoor(rec);
  return { id: rec.id, kind: 'chronicle', x, z, r: REACH, label: LABEL, prompt: PROMPT };
}
