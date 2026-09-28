// The keyboard on foot, rebindable (Settings -> Controls). Per browser, like the other
// conveniences in localStorage. walk.js keeps speaking the default keys: `canon` turns
// whatever was pressed back into the default key of the action it is bound to, so a new
// binding needs no change in the handler itself. Escape is not bindable - it is how the
// mouse is freed and walk mode left, and a page that lost it would be a trap.

const STORE = 'promptholm.keys';

// [action, default key (KeyboardEvent.key, lower case), what the settings list says]
export const ACTIONS = [
  ['forward', 'w', 'walk forward'], ['left', 'a', 'walk left'],
  ['back', 's', 'walk back'], ['right', 'd', 'walk right'],
  ['run', 'shift', 'run'], ['jump', ' ', 'jump'],
  ['crouch', 'c', 'crouch, hold to lie down'], ['dance', 'r', 'dance'],
  ['bike', 'f', 'bike'], ['firstPerson', 'v', 'first person'],
  ['interact', 'e', 'talk / sit down'], ['sendAway', 'x', 'send away'],
  ['plant', 'p', 'sow'], ['nextSeed', 'q', 'next seed'],
  ['give', 'g', 'give a beer'], ['build', 'b', 'build (debug)'],
  ['inventory', 'i', 'inventory'], ['map', 'm', 'map'],
];
const DEFAULT = Object.fromEntries(ACTIONS.map(([a, k]) => [a, k]));

let custom = {};
try { custom = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { custom = {}; }

export const keyOf = (action) => custom[action] || DEFAULT[action];

export function bind(action, key) {
  if (!(action in DEFAULT) || key === 'escape') return;
  // One key, one action: whoever had it gets their default back (or nothing, if that
  // default is the key being taken - then they are unbound until given another).
  for (const [a] of ACTIONS) if (a !== action && keyOf(a) === key) custom[a] = DEFAULT[a] === key ? '\u0000' : DEFAULT[a];
  if (key === DEFAULT[action]) delete custom[action]; else custom[action] = key;
  for (const a of Object.keys(custom)) if (custom[a] === DEFAULT[a]) delete custom[a];
  save();
}
export function resetKeys() { custom = {}; save(); }
function save() { try { localStorage.setItem(STORE, JSON.stringify(custom)); } catch { /* this page only */ } }

// The pressed key as walk.js knows it: the default key of the action it is bound to,
// null for a default key whose action has moved elsewhere, anything else unchanged.
export function canon(k) {
  for (const [a] of ACTIONS) if (keyOf(a) === k) return DEFAULT[a];
  for (const [a, d] of ACTIONS) if (d === k) return null;
  return k;
}

export const keyLabel = (k) => k === ' ' ? 'Space' : !k || k === '\u0000' ? '—'
  : k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1);
