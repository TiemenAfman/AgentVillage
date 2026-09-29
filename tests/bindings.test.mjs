// The controls on foot (web/js/keybinds.js, input.js's applyPadBindings, gamepad.js's names,
// Plans/toetsen-en-bindings.md): two keys and one controller button per action, kept per browser.
// The promises: nothing anybody rebound under the old one-key store is lost; a key or a button is
// one action's alone (the loser is handed what the winner let go of); the defaults are what the
// on-foot map always spelled out; and the panel that shows it dims its controller column until a
// pad is there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k),
};
const kb = await import('../web/js/keybinds.js');
const { BTN, padName, padFamily, padLabel } = await import('../web/js/gamepad.js');
const { MAPS, applyPadBindings, padKey } = await import('../web/js/input.js');
const { ACTIONS, keysOf, keyOf, padOf, canon, bindKey, bindPad, resetKeys, resetPad, onBindingsChange, PAD_ONLY, STICK_LABEL, PAD_RESERVED } = kb;

const clean = () => { resetKeys(); resetPad(); store.clear(); };
const stored = () => JSON.parse(store.get('promptholm.bindings') || 'null');

// ---- the defaults ---------------------------------------------------------------------------

test('the defaults: the keys as they were, the arrow keys as walking\'s second key, no Ctrl anywhere', () => {
  clean();
  assert.deepEqual(keysOf('forward'), ['w', 'arrowup']);
  assert.deepEqual(keysOf('left'), ['a', 'arrowleft']);
  assert.deepEqual(keysOf('crouch'), ['c', null]);
  assert.deepEqual(keysOf('jump'), [' ', null]);
  assert.equal(keyOf('run'), 'shift');
  assert.equal(kb.ctrlIsKey(), false);
  // one key, one action, from the very start
  const all = ACTIONS.flatMap(([a]) => keysOf(a)).filter(Boolean);
  assert.equal(new Set(all).size, all.length, 'a default key is bound twice');
});

test('the default buttons are the ones the on-foot map always spelled out', () => {
  clean();
  const want = {
    jump: BTN.A, crouch: BTN.B, interact: BTN.X, bike: BTN.Y, prevSeed: BTN.LB, nextSeed: BTN.RB,
    sendAway: BTN.LT, plant: BTN.RT, run: BTN.L3, dance: BTN.UP,
  };
  for (const [a, b] of Object.entries(want)) assert.equal(padOf(a), b, a);
  assert.equal(padOf('give'), null);
  const all = kb.PAD_ACTIONS.map(padOf).filter((b) => b != null);
  assert.equal(new Set(all).size, all.length, 'a default button is bound twice');
  for (const b of all) assert.ok(!PAD_RESERVED.has(b), `button ${b} is Back or Start`);
  assert.deepEqual(PAD_ONLY.map(([a]) => a), ['prevSeed']);
});

test('canon: the arrow keys arrive as W A S D, and a key an action has left is nobody\'s', () => {
  clean();
  assert.equal(canon('arrowup'), 'w');
  assert.equal(canon('w'), 'w');
  assert.equal(canon('h'), 'h', 'a key nobody binds is left alone');
  bindKey('forward', 1, null);
  assert.equal(canon('arrowup'), null, 'the second key was emptied, so the arrow is dead');
  bindKey('forward', 1, 'z');
  assert.equal(canon('z'), 'w');
  assert.equal(canon('arrowup'), null);
});

// ---- two keys ---------------------------------------------------------------------------------

test('a secondary key is a second way to do the same thing', () => {
  clean();
  assert.equal(bindKey('jump', 1, 'z'), null);
  assert.deepEqual(keysOf('jump'), [' ', 'z']);
  assert.equal(canon('z'), ' ');
  assert.equal(canon(' '), ' ');
  assert.deepEqual(stored().keys, { jump: { secondary: 'z' } }, 'only the difference is kept');
});

test('a key is one action\'s alone, and the loser is handed what the winner let go of', () => {
  clean();
  assert.equal(bindKey('jump', 0, 'e'), 'interact');
  assert.equal(keysOf('jump')[0], 'e');
  assert.equal(keysOf('interact')[0], ' ', 'interact took jump\'s Space');
  // and where the winner let go of nothing, the loser is left with nothing
  clean();
  assert.equal(bindKey('crouch', 1, 'x'), 'sendAway');
  assert.deepEqual(keysOf('crouch'), ['c', 'x']);
  assert.deepEqual(keysOf('sendAway'), [null, null]);
  const all = ACTIONS.flatMap(([a]) => keysOf(a)).filter(Boolean);
  assert.equal(new Set(all).size, all.length);
});

test('a slot can be emptied on purpose, and it stays empty', () => {
  clean();
  bindKey('crouch', 0, null);
  assert.deepEqual(keysOf('crouch'), [null, null]);
  assert.equal(canon('c'), null);
  assert.equal(keyOf('crouch'), '\u0000');
  assert.equal(kb.keyLabel(keyOf('crouch')), '—');
});

test('Escape, Alt, AltGr and Meta cannot be bound; Ctrl can, and is called Ctrl', () => {
  clean();
  for (const k of ['escape', 'alt', 'altgraph', 'meta']) {
    assert.equal(bindKey('jump', 1, k), null);
    assert.deepEqual(keysOf('jump'), [' ', null], k);
  }
  bindKey('jump', 1, 'control');
  assert.equal(kb.ctrlIsKey(), true);
  assert.equal(kb.keyLabel('control'), 'Ctrl');
  assert.equal(kb.keyLabel('arrowup'), '↑');
  assert.equal(kb.keyLabel(' '), 'Space');
});

test('unknown actions and slots are ignored', () => {
  clean();
  bindKey('nonsense', 0, 'k');
  bindKey('jump', 2, 'k');
  bindKey('jump', 0, 5);
  assert.equal(stored(), null);
});

// ---- the store --------------------------------------------------------------------------------

test('the old one-key store is read as primary keys, "none" included, and not written again', () => {
  clean();
  store.set('promptholm.keys', JSON.stringify({ crouch: 'z', jump: '\u0000', bogus: 'k' }));
  // the module reads its store at import; a fresh copy of it stands in for a fresh page
  return import('../web/js/keybinds.js?migrate').then((m) => {
    assert.deepEqual(m.keysOf('crouch'), ['z', null]);
    assert.deepEqual(m.keysOf('jump'), [null, null]);
    assert.deepEqual(m.keysOf('forward'), ['w', 'arrowup']);
    assert.equal(m.canon('z'), 'c');
    m.bindKey('bike', 1, 'k');
    assert.ok(store.get('promptholm.bindings'), 'saved in the new form');
    assert.equal(JSON.parse(store.get('promptholm.bindings')).keys.crouch.primary, 'z', 'the old rebinding survives into it');
    store.delete('promptholm.keys');
    store.delete('promptholm.bindings');
  });
});

test('a damaged store is the defaults, not a crash', () => {
  clean();
  store.set('promptholm.bindings', '{"keys":{"jump":{"primary":5},"crouch":7},"pad":{"jump":99,"nope":1}}');
  return import('../web/js/keybinds.js?damaged').then((m) => {
    assert.deepEqual(m.keysOf('jump'), [' ', null]);
    assert.equal(m.padOf('jump'), BTN.A);
    store.delete('promptholm.bindings');
  });
});

test('resetting brings the defaults back and takes them out of the store', () => {
  clean();
  bindKey('jump', 1, 'z');
  bindPad('jump', BTN.RB);
  resetKeys();
  assert.deepEqual(keysOf('jump'), [' ', null]);
  assert.equal(padOf('jump'), BTN.RB, 'resetting the keys leaves the buttons alone');
  resetPad();
  assert.equal(padOf('jump'), BTN.A);
  assert.deepEqual(stored(), { keys: {}, pad: {} });
});

test('anybody who listens hears of a change', () => {
  clean();
  let n = 0;
  const off = onBindingsChange(() => n++);
  bindKey('jump', 1, 'z');
  bindPad('jump', null);
  assert.equal(n, 2);
  off();
  bindKey('jump', 1, null);
  assert.equal(n, 2);
});

// ---- the controller ---------------------------------------------------------------------------

test('a button is one action\'s alone, and Back and Start cannot be bound', () => {
  clean();
  assert.equal(bindPad('jump', BTN.X), 'interact');
  assert.equal(padOf('jump'), BTN.X);
  assert.equal(padOf('interact'), BTN.A, 'interact took jump\'s A');
  assert.equal(bindPad('jump', BTN.BACK), null);
  assert.equal(bindPad('jump', BTN.START), null);
  assert.equal(padOf('jump'), BTN.X);
  assert.equal(bindPad('jump', 16), null);
  assert.equal(bindPad('jump', 1.5), null);
  assert.equal(bindPad('nonsense', BTN.A), null);
  bindPad('jump', null);
  assert.equal(padOf('jump'), null);
});

test('input.js builds the on-foot map from the buttons, and rebuilds it on a change', () => {
  clean();
  applyPadBindings();
  assert.equal(MAPS.walk.jump.hit, BTN.A);
  assert.equal(padKey('walk', 'jump'), 'A');
  assert.deepEqual([MAPS.walk.crouch.hit, MAPS.walk.crouch.down], [BTN.B, BTN.B], 'crouch is held');
  assert.deepEqual([MAPS.walk.sprint.hit, MAPS.walk.sprint.down], [BTN.L3, BTN.L3], 'sprint is held');
  assert.equal(MAPS.walk.interact.down, undefined);
  assert.equal(MAPS.walk.exit.hit, BTN.BACK, 'leaving walk mode is not up to anybody');
  assert.equal(MAPS.walk.exitAlt.hit, BTN.START);
  bindPad('jump', BTN.RB);
  assert.equal(MAPS.walk.jump.hit, BTN.RB, 'no reload needed');
  assert.equal(MAPS.walk.nextTool.hit, BTN.A, 'and the swap went into the map too');
  assert.equal(padKey('walk', 'jump'), 'RB');
  bindPad('dance', null);
  assert.equal(MAPS.walk.dance, undefined);
  assert.equal(padKey('walk', 'dance'), '');
});

test('indoors only the buttons that mean something in a tavern', () => {
  clean();
  applyPadBindings();
  assert.deepEqual(Object.keys(MAPS.inside).sort(), ['crouch', 'dance', 'exit', 'exitAlt', 'interact', 'jump', 'sprint']);
  bindPad('plant', BTN.Y);
  assert.equal(MAPS.inside.primary, undefined, 'nothing to sow at a bar');
  assert.equal(MAPS.walk.primary.hit, BTN.Y);
});

test('the other modes keep their fixed buttons', () => {
  assert.equal(MAPS.panel.select.hit, BTN.A);
  assert.equal(MAPS.orbit.menu.hit, BTN.START);
  assert.equal(MAPS.parley.leave.hit, BTN.X);
});

// ---- what the pad is called ---------------------------------------------------------------------

test('the name of the pad, out of the string the browser makes up', () => {
  assert.equal(padName('Xbox 360 Controller (XInput STANDARD GAMEPAD)'), 'Xbox 360 Controller');
  assert.equal(padName('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'), 'DualSense Wireless Controller');
  assert.equal(padName('045e-028e-Xbox 360 Controller'), 'Xbox 360 Controller');
  assert.equal(padName('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)'), 'Xbox Wireless Controller');
  assert.equal(padName(''), 'Controller');
  assert.equal(padName(null), 'Controller');
});

test('a PlayStation pad shows its own symbols; the rest show the Xbox ones', () => {
  const ps = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';
  const xbox = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)';
  assert.equal(padFamily(ps), 'sony');
  assert.equal(padFamily('054c-09cc-Wireless Controller'), 'sony');
  assert.equal(padFamily(xbox), 'xbox', 'Xbox says "Wireless Controller" too');
  assert.equal(padFamily(null), 'xbox');
  assert.equal(padLabel(BTN.A, ps), '✕');
  assert.equal(padLabel(BTN.LB, ps), 'L1');
  assert.equal(padLabel(BTN.A, xbox), 'A');
  assert.equal(padLabel(BTN.UP, xbox), '↑');
  assert.equal(padLabel(99, xbox), '#99');
});

// ---- the panel --------------------------------------------------------------------------------

test('Settings: three columns, the controller\'s dimmed and dead without a pad, its name in the head with one', () => {
  const ui = readFileSync(new URL('../web/js/ui.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../web/css/harbour.css', import.meta.url), 'utf8');
  assert.match(ui, /<span>Primary<\/span><span>Secondary<\/span>/);
  assert.match(ui, /const off = slot === 'pad' && !pad;/, 'a pad cell is off without a pad');
  assert.match(ui, /off \? ' disabled title="No controller connected"' : ''/);
  assert.match(ui, /pad \? esc\(padName\(pad\.id\)\) : 'Controller'/, 'the head says which pad it is');
  assert.match(ui, /addEventListener\('gamepadconnected'/);
  assert.match(ui, /addEventListener\('gamepaddisconnected'/);
  assert.match(ui, /suspendPad\(true\)/, 'the pad belongs to Settings while a button is awaited');
  assert.match(ui, /suspendPad\(false\)/);
  assert.match(ui, /PAD_RESERVED\.has\(i\)/);
  assert.match(css, /\.bind\.off, \.bindrow\.head span\.off, \.chip\.off \{ opacity/);
  assert.match(css, /\.bind\.off, \.chip\.off \{ pointer-events: none/);
  // the rows that cannot be rebound: the sticks
  assert.deepEqual(Object.keys(STICK_LABEL).sort(), ['back', 'forward', 'left', 'right']);
});
