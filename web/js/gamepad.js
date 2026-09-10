// USB controller support. Reads the browser Gamepad API and hands back a plain state
// object, so both the orbit camera and the walking mode can use the same sticks.
//
// Browsers only reveal a pad after a button is pressed on it, so the first press also
// counts as "connected".
const DEAD = 0.16;

function curve(v) {
  const a = Math.abs(v);
  if (a < DEAD) return 0;
  const t = (a - DEAD) / (1 - DEAD);
  return Math.sign(v) * t * t;   // gentle near the centre, full at the edge
}

// Standard mapping, as reported by XInput pads.
export const BTN = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9, L3: 10, R3: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
};

export function createGamepad({ onConnect } = {}) {
  const prev = new Set();
  const justPressed = new Set();
  let padIndex = null;
  let padId = null;
  let announced = false;

  addEventListener('gamepadconnected', (e) => { padIndex = e.gamepad.index; padId = e.gamepad.id; });
  addEventListener('gamepaddisconnected', (e) => {
    if (padIndex === e.gamepad.index) { padIndex = null; padId = null; announced = false; }
  });

  function pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (padIndex != null && pads[padIndex]) return pads[padIndex];
    for (const p of pads) if (p && p.connected) { padIndex = p.index; padId = p.id; return p; }
    return null;
  }

  // Call once per frame, before anything reads the state.
  function poll() {
    justPressed.clear();
    const p = pad();
    if (!p) { prev.clear(); return null; }
    if (!announced) { announced = true; onConnect && onConnect(p.id); }

    const buttons = p.buttons.map((b) => (typeof b === 'object' ? b.value : b));
    const pressed = new Set();
    buttons.forEach((v, i) => { if (v > 0.5) pressed.add(i); });
    for (const i of pressed) if (!prev.has(i)) justPressed.add(i);
    prev.clear();
    for (const i of pressed) prev.add(i);

    const ax = p.axes;
    return {
      id: p.id,
      connected: true,
      move: { x: curve(ax[0] || 0), y: curve(ax[1] || 0) },
      look: { x: curve(ax[2] || 0), y: curve(ax[3] || 0) },
      lt: buttons[BTN.LT] || 0,
      rt: buttons[BTN.RT] || 0,
      down: (i) => pressed.has(i),
      hit: (i) => justPressed.has(i),
      anyHit: justPressed.size > 0,
    };
  }

  return { poll, id: () => padId, connected: () => pad() != null };
}
