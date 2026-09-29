// A controller drawn on the screen, for the app on a phone.
//
// It polls exactly the way gamepad.js does - the same `{ move, look, down, hit }` shape
// with the same button numbers - so input.js hands it to walk mode as if a pad were
// plugged in, and walking, the boat's oars and its tiller all come for free. The other
// road, touch handlers in walk.js, would have been a fourth way of steering (keys, mouse,
// pad, fingers) threaded through every place the first three already meet.
//
// One half of the screen is a floating stick: where the thumb lands is the middle, and a
// thumb that runs past the rim drags the middle along. The other half looks about by
// dragging, pinches to zoom and taps to ask what is there. Which half is which is the
// player's (phoneprefs.js `lefty`). The buttons are laid out the way Xbox Cloud Gaming lays
// out its touch controls: a faint circle where the thumb rests, with what the thumb does
// most inside it (A jumps, Run keeps you running, Y gets on the bike) and the rest on an arc
// round it (X does whatever the prompt says, B crouches, and the two hands). Each is an
// outline icon of what it does, with the pad's own letter as a small coloured badge - so a
// player who later plugs in a controller already knows which button is which. B, Y and the
// hands are shown only on foot.
//
// Two things a pad cannot say ride along in the poll, and only walk mode reads them:
// `drag`, how far the look finger went since the last poll in pixels (a distance, turned
// like the mouse, where a stick's `look` is a speed walk mode multiplies by dt - multiplying
// a drag by dt made the look speed follow the frame rate), and `zoom`, the pinch since the
// last poll as a factor on the camera's distance.
import { BTN } from './gamepad.js';
import { prefs } from './phoneprefs.js';

export const REACH = 56;       // px from the middle of the stick to its edge
export const DEAD = 0.12;      // of REACH: a thumb resting on the glass wobbles about this much
const TAP_MS = 280;            // a look touch this short and this still is a tap
const TAP_PX = 10;

// The stick's push, from where the thumb is relative to the middle, in px. Round rather
// than per axis (a diagonal is as easy as straight ahead), no push inside the dead zone,
// and a gentle curve outside it the way gamepad.js has one: fine control near the middle,
// all of it at the rim.
export function stickOut(dx, dy) {
  const d = Math.hypot(dx, dy);
  const m = Math.min(1, d / REACH);
  if (m <= DEAD) return { x: 0, y: 0 };
  // The direction the thumb is in, times how hard: the push, never the distance, so a thumb
  // past the rim or on a diagonal is full and not more.
  const k = Math.pow((m - DEAD) / (1 - DEAD), 1.5);
  return { x: (dx / d) * k, y: (dy / d) * k };
}

// Outline icons, stroked in currentColor on a 24 grid, like the ones they are modelled on.
const ICONS = {
  jump: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/>',
  run: '<path d="M4 6l6 6-6 6M12 6l6 6-6 6"/>',
  talk: '<path d="M4 5h16v10H10l-5 4v-4H4z"/>',
  crouch: '<path d="M12 4v10M7 9l5 5 5-5"/><path d="M5 20h14"/>',
  bike: '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-7h5l3 7M10 9l3 7M14 6h2"/>',
  sword: '<path d="M19 4l1 1-10.5 10.5-2-2zM6 12l6 6M4.5 19.5l3-3"/>',
  shield: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/>',
  mug: '<path d="M6 8h9v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zM15 11h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2M6 8c0-2 2-3 4-2 1-2 5-2 5 1"/>',
};

export function createTouchPad(root = document.body, { onTap = null, onHand = null } = {}) {
  const layer = document.createElement('div');
  layer.className = 'touchpad';
  // Where each button sits, as px from the middle of the thumb's circle: `x` towards the
  // screen's edge is mirrored for the left-handed (CSS, `--flip`), `y` down.
  const btn = (cls, attrs, x, y, icon, badge) => `<button class="tp-btn ${cls}" ${attrs} style="--x:${x}px;--y:${y}px">`
    + `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`
    + (badge ? `<i class="tp-badge tp-badge-${badge}">${badge}</i>` : '') + '</button>';
  layer.innerHTML = '<div class="tp-stick" hidden><div class="tp-knob"></div></div>'
    + '<div class="tp-cluster"><div class="tp-ring"></div>'
    + btn('', 'data-b="A" aria-label="Jump"', -6, 26, ICONS.jump, 'A')
    + btn('tp-run', 'data-b="L3" aria-label="Run"', 30, -26, ICONS.run, 'LS')
    + btn('tp-foot', 'data-b="Y" aria-label="Bicycle" hidden', -32, -24, ICONS.bike, 'Y')
    + btn('tp-foot', 'data-b="B" aria-label="Crouch" hidden', 84, -44, ICONS.crouch, 'B')
    + btn('tp-x', 'data-b="X" aria-label="Interact"', -72, 70, ICONS.talk, 'X').replace('</button>', '<span class="tp-say"></span></button>')
    + btn('tp-hand tp-foot', 'data-hand="leftArm" aria-label="Left hand" hidden', 92, 26, '', null)
    + btn('tp-hand tp-foot', 'data-hand="rightArm" aria-label="Right hand" hidden', 40, 86, '', null)
    + '</div>';
  root.appendChild(layer);
  const stickEl = layer.querySelector('.tp-stick');
  const knob = layer.querySelector('.tp-knob');
  const say = layer.querySelector('.tp-say');
  const onFoot = layer.querySelectorAll('.tp-foot');

  let seen = false;
  const move = { x: 0, y: 0 };
  const drag = { x: 0, y: 0 };
  let zoom = 1;
  let stick = null;            // { id, x0, y0 }
  const lookers = new Map();   // pointer id -> { x, y, x0, y0, t0, far }
  let pinch = null;            // the distance between two look fingers, last seen
  const held = new Set();
  const prev = new Set();
  const justPressed = new Set();

  const stickSide = (x) => (prefs().lefty ? x >= innerWidth / 2 : x < innerWidth / 2);
  const apart = () => { const [a, b] = [...lookers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };

  layer.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.tp-btn')) return;
    seen = true;
    if (stickSide(e.clientX) && !stick) {
      stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
      stickEl.hidden = false;
      stickEl.style.left = `${e.clientX}px`;
      stickEl.style.top = `${e.clientY}px`;
      knob.style.transform = 'translate(-50%, -50%)';
    } else if (lookers.size < 2) {
      lookers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), far: false });
      pinch = lookers.size === 2 ? apart() : null;
    } else return;
    try { layer.setPointerCapture(e.pointerId); } catch { /* a pointer the browser has already let go of */ }
    e.preventDefault();
  });
  layer.addEventListener('pointermove', (e) => {
    if (stick && e.pointerId === stick.id) {
      let dx = e.clientX - stick.x0, dy = e.clientY - stick.y0;
      const d = Math.hypot(dx, dy);
      // Past the rim the middle follows the thumb, so turning round from full ahead to full
      // astern is one slide and not a lift, a reach and a second press.
      if (d > REACH) {
        stick.x0 += dx * (1 - REACH / d);
        stick.y0 += dy * (1 - REACH / d);
        dx = e.clientX - stick.x0; dy = e.clientY - stick.y0;
        stickEl.style.left = `${stick.x0}px`;
        stickEl.style.top = `${stick.y0}px`;
      }
      const out = stickOut(dx, dy);
      move.x = out.x;
      move.y = out.y;
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      return;
    }
    const l = lookers.get(e.pointerId);
    if (!l) return;
    const dx = e.clientX - l.x, dy = e.clientY - l.y;
    l.x = e.clientX; l.y = e.clientY;
    if (Math.hypot(l.x - l.x0, l.y - l.y0) > TAP_PX) l.far = true;
    if (lookers.size === 2) {
      // Two fingers pinch: apart pulls the camera in, together pushes it out.
      const now = apart();
      if (pinch && now > 0) zoom *= pinch / now;
      pinch = now;
      return;
    }
    const p = prefs();
    drag.x += dx * p.look;
    drag.y += dy * p.look * (p.invert ? -1 : 1);
  });
  const end = (e) => {
    if (stick && e.pointerId === stick.id) {
      stick = null;
      move.x = 0; move.y = 0;
      stickEl.hidden = true;
      return;
    }
    const l = lookers.get(e.pointerId);
    if (!l) return;
    lookers.delete(e.pointerId);
    const wasPinch = pinch != null;
    pinch = null;
    // A short, still touch on its own is a question - who is that, what is that sign -
    // rather than a look. Not after a pinch: lifting one of two fingers is not a tap.
    if (!wasPinch && e.type === 'pointerup' && !l.far && performance.now() - l.t0 < TAP_MS && onTap) onTap(e.clientX, e.clientY);
  };
  layer.addEventListener('pointerup', end);
  layer.addEventListener('pointercancel', end);

  for (const b of layer.querySelectorAll('.tp-btn[data-b]')) {
    const n = BTN[b.dataset.b];
    b.addEventListener('pointerdown', (e) => { seen = true; held.add(n); b.classList.add('on'); e.preventDefault(); });
    const up = () => { held.delete(n); b.classList.remove('on'); };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
  }
  // The hands are not buttons on a pad - a mouse has them - so they go straight to walk
  // mode's own press and release (walk.hand), the way a mouse button does.
  for (const b of layer.querySelectorAll('.tp-hand')) {
    const side = b.dataset.hand;
    b.addEventListener('pointerdown', (e) => { seen = true; b.classList.add('on'); onHand && onHand(side, true); e.preventDefault(); });
    const up = () => { if (!b.classList.contains('on')) return; b.classList.remove('on'); onHand && onHand(side, false); };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
  }
  // A long press on a phone asks for a context menu, which would take the whole screen.
  layer.addEventListener('contextmenu', (e) => e.preventDefault());

  function poll() {
    justPressed.clear();
    if (!seen) return null;
    for (const i of held) if (!prev.has(i)) justPressed.add(i);
    prev.clear();
    for (const i of held) prev.add(i);
    const out = {
      id: 'touch',
      connected: true,
      move: { x: move.x, y: move.y },
      look: { x: 0, y: 0 },
      drag: { x: drag.x, y: drag.y },
      zoom,
      lt: 0,
      rt: 0,
      down: (i) => held.has(i),
      hit: (i) => justPressed.has(i),
      anyHit: justPressed.size > 0,
    };
    drag.x = 0; drag.y = 0; zoom = 1;
    return out;
  }

  // What X would do right now, under the letter: "board", "ashore", "talk". Empty hides it.
  function caption(text) { say.textContent = text || ''; }
  // The two hands, when there is something to do with them: `{ leftArm, rightArm }` of
  // 'attack' / 'block' / 'drink', or null - not on foot - to put them away, and B and Y
  // with them: there is no crouching at the tiller and no bicycle in a boat.
  const HAND = { attack: ICONS.sword, block: ICONS.shield, drink: ICONS.mug };
  // `swimming` keeps B: in the water it is "swim down" (walk.js reads it as C, and A as the way
  // back up), so it stays although the hands and the bike are put away.
  function setHands(what, swimming = false) {
    for (const b of onFoot) b.hidden = !what && !(swimming && b.dataset.b === 'B');
    const dive = layer.querySelector('[data-b="B"]');
    if (dive) dive.setAttribute('aria-label', swimming && !what ? 'Dive' : 'Crouch');
    if (!what) return;
    for (const b of layer.querySelectorAll('.tp-hand')) {
      const a = what[b.dataset.hand];
      b.querySelector('svg').innerHTML = HAND[a] || '';
      b.setAttribute('aria-label', a || '');
    }
  }
  // The side the stick is on, again, after the setting changed.
  function relayout() { layer.classList.toggle('lefty', prefs().lefty); }
  relayout();

  return { poll, id: () => 'touch', connected: () => seen, caption, setHands, relayout };
}

// A real pad when one is plugged in, the screen otherwise. Both are polled every frame
// regardless, so the touch layer's per-poll state (the look drag, which buttons were just
// pressed) never piles up while the other one is winning.
export function eitherPad(a, b) {
  return {
    poll() { const pa = a.poll(); const pb = b.poll(); return pa || pb; },
    id: () => (a.connected() ? a.id() : b.id()),
    connected: () => a.connected() || b.connected(),
  };
}
