// A controller drawn on the screen, for the app on a phone.
//
// It polls exactly the way gamepad.js does - the same `{ move, look, down, hit }` shape
// with the same button numbers - so input.js hands it to walk mode as if a pad were
// plugged in, and walking, the boat's oars and its tiller all come for free. The other
// road, touch handlers in walk.js, would have been a fourth way of steering (keys, mouse,
// pad, fingers) threaded through every place the first three already meet.
//
// Left half of the screen is a floating stick: where the thumb lands is the middle. Right
// half is looking about by dragging. Two buttons, A and X, because those are the two walk
// mode's HUD already names ("X to board") once it has seen a pad.
import { BTN } from './gamepad.js';

const REACH = 56;        // px from the middle of the stick to its edge
const LOOK = 0.14;       // per px dragged, in the pad's look units (walk.js scales by dt)

export function createTouchPad(root = document.body) {
  const layer = document.createElement('div');
  layer.className = 'touchpad';
  layer.innerHTML = '<div class="tp-stick" hidden><div class="tp-knob"></div></div>'
    + '<div class="tp-buttons"><button class="tp-btn" data-b="X">X</button><button class="tp-btn" data-b="A">A</button></div>';
  root.appendChild(layer);
  const stickEl = layer.querySelector('.tp-stick');
  const knob = layer.querySelector('.tp-knob');

  let seen = false;
  const move = { x: 0, y: 0 };
  const look = { x: 0, y: 0 };
  let stick = null;          // { id, x0, y0 }
  let looker = null;         // { id, x, y }
  const held = new Set();
  const prev = new Set();
  const justPressed = new Set();

  layer.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.tp-btn')) return;
    seen = true;
    if (e.clientX < innerWidth / 2 && !stick) {
      stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
      stickEl.hidden = false;
      stickEl.style.left = `${e.clientX}px`;
      stickEl.style.top = `${e.clientY}px`;
      knob.style.transform = 'translate(-50%, -50%)';
    } else if (!looker) {
      looker = { id: e.pointerId, x: e.clientX, y: e.clientY };
    } else return;
    try { layer.setPointerCapture(e.pointerId); } catch { /* a pointer the browser has already let go of */ }
    e.preventDefault();
  });
  layer.addEventListener('pointermove', (e) => {
    if (stick && e.pointerId === stick.id) {
      let dx = e.clientX - stick.x0, dy = e.clientY - stick.y0;
      const d = Math.hypot(dx, dy);
      if (d > REACH) { dx *= REACH / d; dy *= REACH / d; }
      move.x = dx / REACH;
      move.y = dy / REACH;
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    } else if (looker && e.pointerId === looker.id) {
      // Walk mode turns the camera by `look * rate * dt`, a speed rather than a distance;
      // accumulated here and handed out once per poll, a drag reads as the distance it was.
      look.x += (e.clientX - looker.x) * LOOK;
      look.y += (e.clientY - looker.y) * LOOK;
      looker.x = e.clientX;
      looker.y = e.clientY;
    }
  });
  const end = (e) => {
    if (stick && e.pointerId === stick.id) {
      stick = null;
      move.x = 0; move.y = 0;
      stickEl.hidden = true;
    } else if (looker && e.pointerId === looker.id) {
      looker = null;
    }
  };
  layer.addEventListener('pointerup', end);
  layer.addEventListener('pointercancel', end);

  for (const b of layer.querySelectorAll('.tp-btn')) {
    const n = BTN[b.dataset.b];
    b.addEventListener('pointerdown', (e) => { seen = true; held.add(n); b.classList.add('on'); e.preventDefault(); });
    const up = () => { held.delete(n); b.classList.remove('on'); };
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
      look: { x: look.x, y: look.y },
      lt: 0,
      rt: 0,
      down: (i) => held.has(i),
      hit: (i) => justPressed.has(i),
      anyHit: justPressed.size > 0,
    };
    look.x = 0; look.y = 0;
    return out;
  }

  return { poll, id: () => 'touch', connected: () => seen };
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
