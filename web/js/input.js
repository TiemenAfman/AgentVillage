// Who the controller is talking to, and what each button means there.
//
// `gamepad.js` reads the browser and hands back button numbers; this file turns those
// numbers into named actions and decides which part of the island gets them. A module
// asks `p.hit('interact')` and never learns that interact is button 2 - which is why
// the same `pad()` in walk.js works outdoors and in the tavern, where half those
// actions simply are not in the map and so never fire.
import { BTN, padLabel } from './gamepad.js';
import { padOf, onBindingsChange } from './keybinds.js';

// Who wins when more than one says it is active. A panel covers the room it was opened
// from, so it comes first; the sky is last because it is always true.
const ORDER = ['panel', 'parley', 'build', 'inside', 'walk', 'orbit'];

// The only place left in the codebase that names a button. `hit` fires once per press,
// `down` is held, `label` is what the HUD calls it.
//
// The on-foot buttons (`walk`, and the few of them `inside`) are not written here any more:
// they come out of the player's bindings (keybinds.js, Settings -> Controls) in
// `applyPadBindings` below, whose defaults are the ones this table used to spell out - A jumps,
// B crouches (hold it to lie down), X interacts, LB and RB the tools, LT the destructive one,
// RT the primary, L3 sprints (tap to keep running, hold to run), Y the bicycle, up the dance.
// Back and Start are not bindable: they leave walk mode and open the menu.
export const MAPS = {
  walk: {
    exit:      { hit: BTN.BACK, label: 'BACK' },
    exitAlt:   { hit: BTN.START },
  },
  // Indoors. There is nothing to sow in a tavern and nobody to send off the island from
  // a bar stool, so those actions are left out and the buttons go quiet on their own.
  inside: {
    exit:     { hit: BTN.BACK, label: 'BACK' },
    exitAlt:  { hit: BTN.START },
  },
  // Every overlay: the boards, the chat, the stall, the register. A says yes, B steps back.
  panel: {
    select:    { hit: BTN.A, label: 'A' },
    back:      { hit: BTN.B, label: 'B' },
    alt:       { hit: BTN.X, label: 'X' },
    extra:     { hit: BTN.Y, label: 'Y' },
    navLeft:   { down: BTN.LEFT },
    navRight:  { down: BTN.RIGHT },
    navUp:     { down: BTN.UP },
    navDown:   { down: BTN.DOWN },
  },
  // Face to face with a keeper (main.js speakToKeeper). Walk mode is paused, so its X does
  // nothing, and Esc or E on a keyboard were the only ways out: a pad, and a phone above
  // all, were stuck in the conversation for good. X that started it ends it, and so do B
  // and BACK, the buttons that step back everywhere else.
  parley: {
    leave:   { hit: BTN.X, label: 'X' },
    back:    { hit: BTN.B, label: 'B' },
    exit:    { hit: BTN.BACK, label: 'BACK' },
  },
  // From up in the sky. The sticks fly the camera; see `orbitPad` in main.js.
  orbit: {
    walk:    { hit: BTN.A, label: 'A' },
    menu:    { hit: BTN.START, label: 'START' },   // the menu behind Esc (sysmenu.js)
    back:    { hit: BTN.B, label: 'B' },
  },
  // Reserved. Build mode is being built elsewhere; when it lands it only has to call
  // `input.mode('build', { active, handle })` and it slots in between panel and inside
  // on its own - nothing in this file needs to change.
  build: {
    confirm: { hit: BTN.A, label: 'A' },
    cancel:  { hit: BTN.B, label: 'B' },
    variant: { hit: BTN.X, label: 'X' },
    modify:  { hit: BTN.Y, label: 'Y' },
    place:   { hit: BTN.RT, label: 'RT' },
    remove:  { hit: BTN.LT, label: 'LT' },
    rotateL: { hit: BTN.LB, label: 'LB' },
    rotateR: { hit: BTN.RB, label: 'RB' },
    exit:    { hit: BTN.BACK, label: 'BACK' },
  },
};

// keybinds.js action -> the name walk.js asks the pad for; held ones also fire on `down`.
const FOOT_PAD = [
  ['jump', 'jump'], ['crouch', 'crouch'], ['interact', 'interact'], ['prevSeed', 'prevTool'],
  ['nextSeed', 'nextTool'], ['sendAway', 'secondary'], ['plant', 'primary'], ['run', 'sprint'],
  ['bike', 'bike'], ['dance', 'dance'],
];
const HELD = new Set(['crouch', 'sprint']);
// Indoors only these: nothing to sow at a bar and nobody to send off it.
const INSIDE = new Set(['jump', 'crouch', 'interact', 'sprint', 'dance']);

// Build the on-foot maps from the bindings. Mutates MAPS in place, because everything holds the
// one object; an action with no button is left out, and so simply never fires.
export function applyPadBindings() {
  for (const [action, name] of FOOT_PAD) {
    const b = padOf(action);
    for (const [mode, allowed] of [['walk', null], ['inside', INSIDE]]) {
      if (allowed && !allowed.has(name)) continue;
      const map = MAPS[mode];
      if (b == null) { delete map[name]; continue; }
      map[name] = HELD.has(name) ? { hit: b, down: b, label: padLabel(b) } : { hit: b, label: padLabel(b) };
    }
  }
}
applyPadBindings();
onBindingsChange(applyPadBindings);

// What the HUD prints for an action, or '' when that mode does not have it.
export function padKey(mode, action) {
  const m = MAPS[mode];
  return (m && m[action] && m[action].label) || '';
}

// While Settings waits for a controller button to bind, the pad belongs to it: the same press
// would otherwise close the panel (B is back everywhere) or jump the walker (A).
let suspended = false;
export function suspendPad(on) { suspended = !!on; }

export function createInput(gamepad, { onFirstPad } = {}) {
  const modes = [];
  let seen = false;
  let current = null;

  // Registration order does not matter - ORDER decides who is asked first.
  function mode(id, { active, handle }) {
    if (!MAPS[id]) console.warn(`input: no button map for mode "${id}"`);
    modes.push({ id, active, handle });
    modes.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  }

  // Wraps a polled pad in the map of whichever mode is about to read it.
  function actions(p, map) {
    return {
      move: p.move, look: p.look, lt: p.lt, rt: p.rt,
      hit: (name) => {
        const b = map[name];
        if (!b) return false;
        return b.hit != null ? p.hit(b.hit) : p.hit(b.down);
      },
      down: (name) => {
        const b = map[name];
        if (!b) return false;
        return b.down != null ? p.down(b.down) : p.down(b.hit);
      },
      raw: p,
    };
  }

  // Once per frame, before anything reads the controller.
  function frame(dt) {
    const p = gamepad.poll();
    current = null;
    if (!p) return null;
    if (!seen) { seen = true; onFirstPad && onFirstPad(p.id); }
    if (suspended) return null;
    const m = modes.find((x) => x.active());
    if (!m) return null;
    current = m.id;
    m.handle(actions(p, MAPS[m.id] || {}), dt);
    return m.id;
  }

  return { mode, frame, current: () => current };
}
