// Who the controller is talking to, and what each button means there.
//
// `gamepad.js` reads the browser and hands back button numbers; this file turns those
// numbers into named actions and decides which part of the island gets them. A module
// asks `p.hit('interact')` and never learns that interact is button 2 - which is why
// the same `pad()` in walk.js works outdoors and in the tavern, where half those
// actions simply are not in the map and so never fire.
import { BTN } from './gamepad.js';

// Who wins when more than one says it is active. A panel covers the room it was opened
// from, so it comes first; the sky is last because it is always true.
const ORDER = ['panel', 'build', 'inside', 'walk', 'orbit'];

// The only place left in the codebase that names a button. `hit` fires once per press,
// `down` is held, `label` is what the HUD calls it.
export const MAPS = {
  // On foot, outdoors. A confirms and jumps, the way a console expects it.
  walk: {
    jump:      { hit: BTN.A, label: 'A' },
    crouch:    { hit: BTN.B, down: BTN.B, label: 'B' },      // hold it to lie down
    interact:  { hit: BTN.X, label: 'X' },
    think:     { hit: BTN.Y, label: 'Y' },
    prevTool:  { hit: BTN.LB, label: 'LB' },
    nextTool:  { hit: BTN.RB, label: 'RB' },
    secondary: { hit: BTN.LT, label: 'LT' },                 // the destructive one
    primary:   { hit: BTN.RT, label: 'RT' },
    sprint:    { hit: BTN.L3, down: BTN.L3, label: 'L3' },   // tap to keep running, hold to run
    exit:      { hit: BTN.BACK, label: 'BACK' },
    exitAlt:   { hit: BTN.START },
  },
  // Indoors. There is nothing to sow in a tavern and nobody to send off the island from
  // a bar stool, so those actions are left out and the buttons go quiet on their own.
  inside: {
    jump:     { hit: BTN.A, label: 'A' },
    crouch:   { hit: BTN.B, down: BTN.B, label: 'B' },
    interact: { hit: BTN.X, label: 'X' },
    sprint:   { hit: BTN.L3, down: BTN.L3, label: 'L3' },
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
  // From up in the sky. The sticks fly the camera; see `orbitPad` in main.js.
  orbit: {
    walk:    { hit: BTN.A, label: 'A' },
    walkAlt: { hit: BTN.START },
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

// What the HUD prints for an action, or '' when that mode does not have it.
export function padKey(mode, action) {
  const m = MAPS[mode];
  return (m && m[action] && m[action].label) || '';
}

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
    const m = modes.find((x) => x.active());
    if (!m) return null;
    current = m.id;
    m.handle(actions(p, MAPS[m.id] || {}), dt);
    return m.id;
  }

  return { mode, frame, current: () => current };
}
