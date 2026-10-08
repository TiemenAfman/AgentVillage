// The controls on foot, rebindable (Settings -> Controls): per action two keys, a primary and a
// secondary, and one button on a controller. Per browser, like the other conveniences in
// localStorage (Plans/toetsen-en-bindings.md).
//
// walk.js keeps speaking the default keys: `canon` turns whatever was pressed back into the
// default key of the action it is bound to, so a new binding needs no change in the handler
// itself. Escape is not bindable - it is how the mouse is freed and walk mode left, and a page
// that lost it would be a trap. Ctrl is (as 'control', what KeyboardEvent.key says for it) and
// unbound by default: see `ctrlIsKey` for what walk.js does differently once it is one.
import { BTN } from './gamepad.js';

const STORE = 'promptholm.bindings';
// Version 1 kept `{ action: key }`, one key each, '\u0000' for "none". Still read - as primary
// keys - so nobody's rebinding is lost, and no longer written.
const STORE_V1 = 'promptholm.keys';

// [action, default primary key (KeyboardEvent.key, lower case), what the settings list says,
//  default secondary key or null, default controller button (gamepad.js BTN) or null]
export const ACTIONS = [
  ['forward', 'w', 'walk forward', 'arrowup', null], ['left', 'a', 'walk left', 'arrowleft', null],
  ['back', 's', 'walk back', 'arrowdown', null], ['right', 'd', 'walk right', 'arrowright', null],
  ['run', 'shift', 'run', null, BTN.L3], ['jump', ' ', 'jump', null, BTN.A],
  ['crouch', 'c', 'crouch, hold to lie down', null, BTN.B], ['dance', 'r', 'dance', null, BTN.UP],
  ['bike', 'f', 'bike / horse', null, BTN.Y], ['firstPerson', 'v', 'first person', null, null],
  ['interact', 'e', 'talk / sit down', null, BTN.X], ['sendAway', 'x', 'send away', null, BTN.LT],
  ['plant', 'p', 'sow', null, BTN.RT], ['nextSeed', 'q', 'next seed', null, BTN.RB],
  ['give', 'g', 'give a beer', null, null], ['build', 'b', 'build (debug)', null, null],
  ['inventory', 'i', 'inventory', null, null], ['map', 'm', 'map', null, null],
  ['quests', 'k', 'quest log', null, null],
  // What the arms carry (the treasure statue), set down a step ahead: H for hands, and down on the
  // d-pad, which nothing on foot had (up is the dance).
  ['putDown', 'h', 'set down what you carry', null, BTN.DOWN],
  // From the sky, not on foot (main.js ORBIT_KEYS), but a letter all the same, and one that may
  // not also be somebody's on foot: it was P, which is sow, so it is U - free in the sky, on foot
  // and in the planner itself.
  ['plan', 'u', 'plan (from the sky)', null, null],
];
// A controller's own action, with no key: the previous seed. The sticks walk and look and are not
// buttons; the settings list shows them as fixed text.
export const PAD_ONLY = [['prevSeed', 'previous seed', BTN.LB]];
// What the walk stick and the look stick are called, for the rows that cannot be rebound.
export const STICK_LABEL = { forward: 'Left stick ↑', left: 'Left stick ←', back: 'Left stick ↓', right: 'Left stick →' };

const DEFAULT = Object.fromEntries(ACTIONS.map(([a, k]) => [a, k]));
const DEFAULT2 = Object.fromEntries(ACTIONS.map(([a, , , k]) => [a, k]));
const DEFAULT_PAD = Object.fromEntries([...ACTIONS.map(([a, , , , b]) => [a, b]), ...PAD_ONLY.map(([a, , b]) => [a, b])]);
export const PAD_ACTIONS = Object.keys(DEFAULT_PAD);
// Keys a binding can never be: Escape is how you leave, and a key with Alt or Meta on it is not
// a game key (walk.js onKeyDown), so a bound one would simply never go off. AltGr is the same
// key as ctrl+alt on a Dutch layout.
const REFUSED = new Set(['escape', 'alt', 'altgraph', 'meta', 'os', 'dead', 'unidentified', 'process']);
// Back and Start leave walk mode and open the menu wherever the pad is (input.js).
export const PAD_RESERVED = new Set([BTN.BACK, BTN.START]);

// custom.keys[action] = { primary?, secondary? }: a string is a key, null is "none on purpose",
// absent is the default. custom.pad[action] = a button index, or null for none.
let custom = { keys: {}, pad: {} };
const listeners = new Set();

function load() {
  custom = { keys: {}, pad: {} };
  try {
    const v2 = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (v2 && typeof v2 === 'object') {
      for (const [a, slots] of Object.entries(v2.keys || {})) {
        if (!(a in DEFAULT) || !slots || typeof slots !== 'object') continue;
        const out = {};
        for (const s of ['primary', 'secondary']) if (s in slots && (slots[s] === null || typeof slots[s] === 'string')) out[s] = slots[s];
        if (Object.keys(out).length) custom.keys[a] = out;
      }
      for (const [a, b] of Object.entries(v2.pad || {})) {
        if (a in DEFAULT_PAD && (b === null || (Number.isInteger(b) && b >= 0 && b < 16 && !PAD_RESERVED.has(b)))) custom.pad[a] = b;
      }
      return;
    }
    const v1 = JSON.parse(localStorage.getItem(STORE_V1) || 'null');
    if (v1 && typeof v1 === 'object') {
      for (const [a, k] of Object.entries(v1)) {
        if (a in DEFAULT && typeof k === 'string') custom.keys[a] = { primary: k === '\u0000' ? null : k };
      }
    }
  } catch { custom = { keys: {}, pad: {} }; }
}
load();
// Only what differs from the default stays in the store, so a default changed later reaches everybody
// who never touched it.
function prune() {
  for (const [a, slots] of Object.entries(custom.keys)) {
    if (slots.primary === DEFAULT[a]) delete slots.primary;
    if (slots.secondary === DEFAULT2[a]) delete slots.secondary;
    if (!Object.keys(slots).length) delete custom.keys[a];
  }
  for (const a of Object.keys(custom.pad)) if (custom.pad[a] === DEFAULT_PAD[a]) delete custom.pad[a];
}
function save() {
  prune();
  try { localStorage.setItem(STORE, JSON.stringify(custom)); } catch { /* this page only */ }
  for (const fn of listeners) { try { fn(); } catch { /* a listener's problem */ } }
}
// input.js hears about a changed pad button through this and rebuilds its map.
export function onBindingsChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

const slotOf = (action, slot) => {
  const c = custom.keys[action];
  const name = slot === 0 ? 'primary' : 'secondary';
  if (c && name in c) return c[name];
  return slot === 0 ? DEFAULT[action] : DEFAULT2[action];
};

// The primary key. What the rest of the page means by "the key of an action" (the inventory's
// hint in the wardrobe, say); '\u0000' for none, as before.
export const keyOf = (action) => slotOf(action, 0) ?? '\u0000';
// Both keys, null where there is none.
export const keysOf = (action) => [slotOf(action, 0) ?? null, slotOf(action, 1) ?? null];
export const padOf = (action) => (action in custom.pad ? custom.pad[action] : DEFAULT_PAD[action]);

// Whether Ctrl is somebody's key. Then it is not a shortcut modifier on foot any more: it and
// whatever is pressed while it is held are game keys, and it is the page that cancels the
// browser's shortcut (walk.js onKeyDown) instead of the game ignoring the whole press.
export const ctrlIsKey = () => ACTIONS.some(([a]) => keysOf(a).includes('control'));

function setSlot(action, slot, key) {
  const name = slot === 0 ? 'primary' : 'secondary';
  (custom.keys[action] = custom.keys[action] || {})[name] = key;
}

// Give `key` to `action`'s slot (0 primary, 1 secondary); null clears it. A key is one action's
// alone: whoever held it is handed the key this slot let go of (a swap), or nothing if it held
// none. Returns the action that lost the key, or null.
export function bindKey(action, slot, key) {
  if (!(action in DEFAULT) || (slot !== 0 && slot !== 1)) return null;
  if (key !== null && (typeof key !== 'string' || REFUSED.has(key))) return null;
  const before = slotOf(action, slot) ?? null;
  let displaced = null;
  if (key !== null) {
    for (const [a] of ACTIONS) for (const s of [0, 1]) {
      if (a === action && s === slot) continue;
      if ((slotOf(a, s) ?? null) !== key) continue;
      setSlot(a, s, before);
      displaced = a;
    }
  }
  setSlot(action, slot, key);
  save();
  return displaced;
}
// The one-key form the settings used to call: the primary slot.
export function bind(action, key) { return bindKey(action, 0, key); }

// Give a controller button to an action; null clears it. Same rule: a button is one action's.
export function bindPad(action, button) {
  if (!(action in DEFAULT_PAD)) return null;
  if (button !== null && (!Number.isInteger(button) || button < 0 || button > 15 || PAD_RESERVED.has(button))) return null;
  const before = padOf(action) ?? null;
  let displaced = null;
  if (button !== null) {
    for (const a of PAD_ACTIONS) {
      if (a === action || padOf(a) !== button) continue;
      custom.pad[a] = before;
      displaced = a;
    }
  }
  custom.pad[action] = button;
  save();
  return displaced;
}

export function resetKeys() { custom.keys = {}; save(); }
export function resetPad() { custom.pad = {}; save(); }

// The pressed key as walk.js knows it: the default key of the action it is bound to (in either
// slot), null for a default key whose action has moved elsewhere, anything else unchanged.
export function canon(k) {
  for (const [a] of ACTIONS) if (keysOf(a).includes(k)) return DEFAULT[a];
  for (const [a, d] of ACTIONS) if (d === k || DEFAULT2[a] === k) return null;
  return k;
}

export const keyLabel = (k) => k === ' ' ? 'Space' : !k || k === '\u0000' ? '—' : k === 'control' ? 'Ctrl'
  : k.startsWith('arrow') ? { arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→' }[k] || k
    : k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1);
