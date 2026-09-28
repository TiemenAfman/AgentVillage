// The gold run: every five hours, a cartload from the mine by way of the goldsmith into the
// gold pit (Plans/goudmijn.md).
//
// The pit holds the keeper's five-hour usage window (goldpit.js) and fills again when the
// window turns over. This is what makes that refill a thing that happens on the island rather
// than a pile that is suddenly whole: when the pit's count goes up - which only a new window
// does - the pit is held at its old count while the miner pushes a cart of ore down the road
// from the mine to the goldsmith's, the goldsmith melts it and casts it, and wheels the bars
// to the pit in a barrow; the pit counts up to its new number while he unloads.
//
// All of it is this page's own, and on purpose. When a window turns over says something about
// how somebody works, and the sea never hears the count in the first place (Plans/goudkuil.md),
// so the run is played from the moment `event: gold` told this page, by the keeper's pages
// only; a visitor's pit is always full and nothing is ever delivered to it. The two figures are
// the player's rig in villagers' clothes (smithy.js's smith is the pattern), nobody's agent, not
// on the wire. Nothing is walked across grass: from door to door the route is the roads'
// (shared/roads.mjs roadBetween, the graph a settler walks), and on each lot a few steps the
// bakes were measured for. Without a mine, a goldsmith, a pit or a road between them, the pit
// fills at once, as it did before any of this.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createClassicAvatar } from './classic-avatar.js';
import { roadBetween } from 'shared/roads.mjs';
import { DOOR_DIR } from 'shared/settlerwalk.mjs';
import { GOLD_BARS } from 'shared/gold.mjs';
import { mineCartGeometry, cartLoadGeometry, CART_AHEAD, MINER_LOOK, MINER_PUSHING, MINER_WORK, MINER_FACE } from './goldmine.js';
import { GOLDSMITH_LOOK, GOLDSMITH_PUSHING, VILLAGER_SCALE, goldsmithPlaces } from './goldsmith.js';
import { barrowGeometry, wheelGeometry, BARROW, TRAY_BARS } from './settler-figures.js';
import { goldBarGeometry } from './goldpit.js';

// A rise smaller than this is a rounding of the same window, not a new one, and is shown at once.
export const MIN_RISE = 5;
export const WALK_SPEED = 0.55;
// No leg of the run takes longer than this: a long road is walked faster rather than watched
// for a minute and a half.
export const LEG_MAX_S = 40;
const LOAD_S = 2.4;       // shovelling ore from the bin into the cart
const TIP_S = 1.6;        // tipping it out at the goldsmith's door
const SMELT_S = 9;        // the furnace roaring
const CAST_S = 2.6;       // at the bench, the mould
const UNLOAD_S = 4;       // the pit counting up
const STACK_S = 5;        // laying the new bars out on the stack in front of the shop
const RELOAD_S = 3.5;     // and taking them off it again into the barrow
const SWING_EVERY = { load: 0.8, smelt: 1.5, cast: 0.9, mine: 2.4, bench: 1.6, stack: 0.7 };
const DUSK = 0.55, DAWN = 0.45;
// Arms out to a cart's rim, lower to a barrow's handles (settler-figures.js BARROW_ARM).
const PUSH_CART = -1.15, PUSH_BARROW = -0.5;
const TURN = 8;           // how briskly a figure turns towards where it is going, per second

// The decks each lot stands its figures on, in the building's own frame: the mine's apron
// (scripts/build-goldmine.py APRON) and the pit's slab (build-goldpit.py). The
// goldsmith's is the porch buildings.js built under him, which it hands back as `porch`.
const MINE_DECK = { x0: -1.35, x1: 1.35, z0: 0.24, z1: 1.42, top: 0.1 };
const PIT_DECK = { x0: -1.25, x1: 1.25, z0: -1.36, z1: 1.36, top: 0.03 };
// On the mine's lot: in front of the bin to load, behind the cart to push it, the mouth.
const MINE_AT = {
  toBin: [[0.3, 0.8], [-0.3, 0.8], [-0.42, 0.97]],
  binFace: [-0.97, 0.93],
  mouth: [0, 0.36],
  out: [0, 1.45],
};
// On the pit's lot: in at the open end, and far enough in that the barrow stands in the aisle
// before the heap, where the settlers park theirs (lib/crowd.mjs GOLD_LOAD_IN, with the
// barrow's own reach in front of the feet).
const PIT_AT = { mouth: [0, 1.45], unload: [0, 0.95], face: [0, -0.5] };
// The stack the goldsmith lays his bars out on before they go (Plans/goudmijn.md): on the
// ground in front of the shop, left of the door and out of the lot's middle column, which is
// where the road comes in - so the barrow can be wheeled up beside it from the street side.
// `pile` is its middle, `stand` where he stacks from (the porch's front edge, porch z1 0.515),
// `load` where the barrow's feet stand to be filled from it, `across` the way over the porch.
export const STACK_AT = { pile: [-0.85, 0.86], stand: [-0.85, 0.5], load: [-0.2, 1.02], across: [0.3, 0.36] };
// How many bars the stack can show: six layers of four, crosswise like a real stack. A
// delivery of any size is drawn as a stack between STACK_MIN and this, a bar for every four.
export const STACK_MAX = 24;
const STACK_MIN = 4;
const STACK_BAR = { l: 0.1, h: 0.032, w: 0.05 };
export function stackSlots() {
  const { l, h, w } = STACK_BAR;
  const out = [];
  for (let layer = 0; out.length < STACK_MAX; layer++) {
    // Four to a layer, two by two: along x on the even layers, turned a quarter on the odd,
    // which is how a stack of ingots is laid so it does not slide.
    const turned = layer % 2 === 1;
    for (const [i, j] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      if (out.length >= STACK_MAX) break;
      const along = i * l * 0.53, side = j * w * 0.56;
      out.push(turned ? [side, layer * h, along, Math.PI / 2] : [along, layer * h, side, 0]);
    }
  }
  return out;
}
export const stackSize = (bars) => Math.max(STACK_MIN, Math.min(STACK_MAX, Math.round(bars / 4)));

const nightOf = (material) => material?.userData?.uniforms?.uNight?.value ?? 0;
const yawTo = (from, to) => Math.atan2(to[0] - from[0], to[1] - from[1]);
function turnTowards(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export function createGoldRun({ scene, material, groundAt, onBars }) {
  const sites = { mine: null, smith: null, pit: null, village: null, terrain: null, sig: '' };
  let truth = null;             // what the pit should hold, as the keeper's page was last told
  let shown = null;             // what it is drawn holding
  let run = null;               // the delivery under way, or null
  let clock = 0;

  // ---- frames -----------------------------------------------------------------------------
  const toWorld = (rec, [lx, lz]) => {
    const g = rec.group, c = Math.cos(g.rotation.y), s = Math.sin(g.rotation.y);
    return [g.position.x + lx * c + lz * s, g.position.z - lx * s + lz * c];
  };
  const toLocal = (rec, [x, z]) => {
    const g = rec.group, c = Math.cos(g.rotation.y), s = Math.sin(g.rotation.y);
    const dx = x - g.position.x, dz = z - g.position.z;
    return [dx * c - dz * s, dx * s + dz * c];
  };
  const deckOf = (key) => (key === 'mine' ? MINE_DECK : key === 'pit' ? PIT_DECK : sites.smith?.built?.porch || null);
  // Where a foot comes down: the ground, or a lot's deck if it stands higher there.
  function standY(x, z) {
    let y = groundAt(x, z);
    for (const key of ['mine', 'smith', 'pit']) {
      const rec = sites[key], deck = deckOf(key);
      if (!rec || !deck) continue;
      const [lx, lz] = toLocal(rec, [x, z]);
      if (lx >= deck.x0 && lx <= deck.x1 && lz >= deck.z0 && lz <= deck.z1) y = Math.max(y, rec.group.position.y + deck.top);
    }
    return y;
  }
  const stepOf = (rec) => {
    const p = rec.spec.plot, [dx, dz] = DOOR_DIR[(p.rot | 0) % 4];
    return [p.gx + 1 + dx * 2, p.gz + 1 + dz * 2];
  };
  const cellAt = ([gx, gz]) => sites.terrain.cellWorld(gx, gz);

  // ---- the two figures, the cart and the barrow --------------------------------------------
  function figureOf(look) {
    const avatar = createClassicAvatar(look, material);
    // Unmirrored, like the smith (smithy.js): his work was placed against that rig, and
    // nobody holds the mouse for him.
    avatar.object.scale.x = 1;
    const group = new THREE.Group();
    group.rotation.order = 'YXZ';
    group.scale.setScalar(VILLAGER_SCALE);
    group.add(avatar.object);
    group.visible = false;
    scene.add(group);
    return { avatar, group, look, pos: [0, 0], yaw: 0, phase: 0, moving: false, push: null, queue: [], step: null,
      inside: false, swingAt: 0, carrying: null, placed: false };
  }
  const miner = figureOf(MINER_LOOK);
  const smith = figureOf(GOLDSMITH_LOOK);
  const dress = (f, look) => { if (f.look !== look) { f.look = look; f.avatar.set(look); } };

  const cart = { group: new THREE.Group(), load: null, pos: null, yaw: 0, loaded: false, tip: 0, by: null };
  const cartGeo = mineCartGeometry();
  const loadGeo = cartLoadGeometry();
  const cartBody = new THREE.Mesh(cartGeo, material);
  cartBody.castShadow = true;
  cart.load = new THREE.Mesh(loadGeo, material);
  cart.group.add(cartBody, cart.load);
  cart.group.visible = false;
  scene.add(cart.group);

  const barrow = { group: new THREE.Group(), wheel: null, bars: null, pos: null, yaw: 0, loaded: false, by: null, rolled: 0 };
  const trayGeo = barrowGeometry();
  const wheelGeo = wheelGeometry();
  const bar = goldBarGeometry({ l: 0.1, h: 0.032, w: 0.05 });
  const barsGeo = mergeGeometries(TRAY_BARS.map(([x, y, z, turn]) => bar.clone().rotateY(turn)
    .translate(x, BARROW.trayY + 0.006 + y, BARROW.trayZ + z)), false);
  bar.dispose();
  const tray = new THREE.Mesh(trayGeo, material);
  tray.castShadow = true;
  barrow.wheel = new THREE.Mesh(wheelGeo, material);
  barrow.wheel.position.set(0, BARROW.r, BARROW.wheelZ);
  barrow.bars = new THREE.Mesh(barsGeo, material);
  barrow.group.add(tray, barrow.wheel, barrow.bars);
  barrow.group.visible = false;
  scene.add(barrow.group);

  // The stack in front of the shop: hung on the goldsmith's group when it has one (setSites),
  // `count` is how many of STACK_MAX show.
  const stackBar = goldBarGeometry(STACK_BAR);
  const stack = new THREE.InstancedMesh(stackBar, material, STACK_MAX);
  stack.castShadow = true;
  stack.count = 0;
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    stackSlots().forEach(([x, y, z, turn], i) => {
      stack.setMatrixAt(i, m.compose(new THREE.Vector3(STACK_AT.pile[0] + x, y, STACK_AT.pile[1] + z), q.setFromAxisAngle(up, turn), new THREE.Vector3(1, 1, 1)));
    });
    stack.instanceMatrix.needsUpdate = true;
  }
  let stackOf = 0;          // how many bars this delivery's stack is, when full

  // ---- where everybody is when nothing is to be carried --------------------------------------
  function idleSpots() {
    const out = {};
    if (sites.mine) {
      out.miner = { at: toWorld(sites.mine, MINER_WORK), face: toWorld(sites.mine, MINER_FACE), door: toWorld(sites.mine, MINE_AT.mouth) };
      out.cart = { at: toWorld(sites.mine, [0, 1.1]), yaw: sites.mine.group.rotation.y };
    }
    const g = sites.smith && goldsmithPlaces();
    if (g) {
      out.smith = { at: toWorld(sites.smith, g.work), face: toWorld(sites.smith, g.workFace),
        door: toWorld(sites.smith, [g.door[0], g.door[2] + 0.04]),
        home: [[0.8, 0.45], [g.door[0], 0.5]].map((p) => toWorld(sites.smith, p)) };
      out.barrow = { at: toWorld(sites.smith, g.barrow), yaw: sites.smith.group.rotation.y + Math.PI };
      out.places = g;
    }
    return out;
  }
  // Everybody back to their place at once: a new layout, a run given up, the first sites.
  // On the goldsmith's group, and on the ground where it lies there - the group stands at the
  // plot's middle, and the street side of a lot on a slope is not at that height. A shop that is
  // built again (a stage, a reload of the buildings) is a new group with the same plot, so this
  // runs on every setSites, not only when the sites change.
  function hangStack() {
    const g = sites.smith?.group;
    if (!g) { stack.parent?.remove(stack); return; }
    if (stack.parent !== g) g.add(stack);
    const [x, z] = toWorld(sites.smith, STACK_AT.pile);
    stack.position.y = groundAt(x, z) - g.position.y;
  }
  function settle() {
    stack.count = 0;
    const spots = idleSpots();
    const night = nightOf(material) > DUSK;
    for (const [f, spot] of [[miner, spots.miner], [smith, spots.smith]]) {
      f.queue = [];
      f.step = null;
      f.push = null;
      f.moving = false;
      if (!spot) { f.group.visible = false; f.placed = false; continue; }
      f.pos = [...spot.at];
      f.yaw = yawTo(spot.at, spot.face);
      f.inside = night;
      f.placed = true;
    }
    dress(miner, MINER_LOOK);
    dress(smith, GOLDSMITH_LOOK);
    if (spots.cart) Object.assign(cart, { pos: [...spots.cart.at], yaw: spots.cart.yaw, loaded: false, tip: 0, by: null });
    else cart.pos = null;
    if (spots.barrow) Object.assign(barrow, { pos: [...spots.barrow.at], yaw: spots.barrow.yaw, loaded: false, by: null });
    else barrow.pos = null;
    sites.smith?.furnace?.melt(false);
  }

  // ---- the delivery ------------------------------------------------------------------------
  // Each figure is handed a list of steps and works through it:
  //   { go: [[x, z], ...], push?, fast? }   walk those points (world), pushing the cart or barrow
  //   { face: [x, z] }                     turn towards a point
  //   { wait: s, swing?: key, tip?, count? } stand, swinging now and then, tipping the cart, or
  //                                        counting the pit up
  //   { until: () => bool }                wait for the other one
  //   { then: () => {} }                   do something at once
  // A route that could not be worked out never gets this far: `plan` returns null, and the pit
  // is simply shown full.
  function plan(from) {
    const { mine, smith: shop, pit, village, terrain } = sites;
    const g = goldsmithPlaces();
    if (!mine || !shop || !pit || !village || !terrain || !g || !cart.pos || !barrow.pos) return null;
    const size = terrain.size;
    const mineStep = stepOf(mine), shopStep = stepOf(shop), pitStep = stepOf(pit);
    const leg1 = roadBetween(village, size, mineStep, shopStep);
    const leg2 = roadBetween(village, size, shopStep, pitStep);
    if (!leg1 || !leg2) return null;
    const road1 = leg1.map(cellAt), road2 = leg2.map(cellAt);
    const M = (p) => toWorld(mine, p), S = (p) => toWorld(shop, p), P = (p) => toWorld(pit, p);
    const signals = { ore: false };
    const spots = idleSpots();

    const minerSteps = [
      ...(miner.inside ? [{ then: () => { miner.inside = false; miner.pos = [...spots.miner.door]; } }] : []),
      { go: MINE_AT.toBin.map(M) },
      { face: M(MINE_AT.binFace) },
      { wait: LOAD_S, swing: 'load' },
      { then: () => { cart.loaded = true; } },
      { go: [M([0, 1.1 - CART_AHEAD])] },
      { face: M([0, 2]) },
      { then: () => { cart.by = miner; dress(miner, MINER_PUSHING); } },
      { go: [M(MINE_AT.out), ...road1], push: PUSH_CART },
      { then: () => { signals.ore = true; } },
      { wait: TIP_S, tip: true },
      { then: () => { cart.loaded = false; cart.tip = 0; } },
      { go: [...[...road1].reverse(), M(MINE_AT.out), M([0, 1.1 + CART_AHEAD])], push: PUSH_CART },
      { then: () => { cart.by = null; dress(miner, MINER_LOOK); } },
      { go: [M([0.3, 1.3]), spots.miner.at] },
      { face: spots.miner.face },
    ];
    const parkAt = S(g.barrow), parkLocal = g.barrow;
    const shopOut = [S([parkLocal[0], 1.25]), S([0.35, 1.72])];
    const smithSteps = [
      ...(smith.inside ? [{ then: () => { smith.inside = false; smith.pos = [...spots.smith.door]; } },
        { go: [...spots.smith.home].reverse().concat([spots.smith.at]) }] : []),
      { until: () => signals.ore },
      { go: [S(g.smelt)] },
      { face: S(g.smeltFace) },
      { then: () => shop.furnace?.melt(true) },
      { wait: SMELT_S, swing: 'smelt' },
      { then: () => shop.furnace?.melt(false) },
      { go: [spots.smith.at] },
      { face: spots.smith.face },
      { wait: CAST_S, swing: 'cast' },
      // The bars go on a stack in front of the shop first, and only then into the barrow: a
      // cast that went straight from the mould to the road read as the goldsmith never
      // having made anything.
      { then: () => { stackOf = stackSize(truth - from); } },
      { go: [S(STACK_AT.across), S(STACK_AT.stand)] },
      { face: S(STACK_AT.pile) },
      { wait: STACK_S, swing: 'stack', stack: 1 },
      { go: [S(STACK_AT.across), S([parkLocal[0] - 0.05, 0.5]), parkAt] },
      { then: () => { barrow.by = smith; dress(smith, GOLDSMITH_PUSHING); } },
      { go: [S([parkLocal[0], 1.02]), S(STACK_AT.load)], push: PUSH_BARROW },
      { face: S(STACK_AT.pile) },
      { then: () => { barrow.loaded = true; } },
      { wait: RELOAD_S, swing: 'stack', stack: -1 },
      { go: [shopOut[1], ...road2, P(PIT_AT.mouth), P(PIT_AT.unload)], push: PUSH_BARROW },
      { face: P(PIT_AT.face) },
      { wait: UNLOAD_S, count: true },
      { then: () => { barrow.loaded = false; shown = truth; onBars(shown); } },
      { go: [P(PIT_AT.mouth), ...[...road2].reverse(), ...[...shopOut].reverse(), parkAt], push: PUSH_BARROW },
      { then: () => { barrow.by = null; dress(smith, GOLDSMITH_LOOK); } },
      { go: [S([parkLocal[0] - 0.12, 0.5]), spots.smith.at] },
      { face: spots.smith.face },
    ];
    return { from, minerSteps, smithSteps, started: clock };
  }

  function begin(from) {
    const p = plan(from);
    if (!p) return false;
    run = p;
    shown = from;
    onBars(shown);
    miner.queue = p.minerSteps;
    smith.queue = p.smithSteps;
    miner.step = smith.step = null;
    return true;
  }
  function abandon() {
    run = null;
    shown = truth;
    if (shown != null) onBars(shown);
    settle();
  }

  // ---- stepping ----------------------------------------------------------------------------
  function speedFor(points, from) {
    let len = 0, prev = from;
    for (const p of points) { len += Math.hypot(p[0] - prev[0], p[1] - prev[1]); prev = p; }
    return Math.max(WALK_SPEED, len / LEG_MAX_S);
  }
  function stepFigure(f, dt) {
    f.moving = false;
    for (let guard = 0; guard < 8; guard++) {
      if (!f.step) {
        f.step = f.queue.shift() || null;
        if (!f.step) return;
        f.step.t = 0;
        if (f.step.go) { f.step.i = 0; f.step.speed = speedFor(f.step.go, f.pos); }
      }
      const s = f.step;
      if (s.then) { s.then(); f.step = null; continue; }
      if (s.until) { if (s.until()) { f.step = null; continue; } return; }
      if (s.face) {
        const want = yawTo(f.pos, s.face);
        f.yaw = turnTowards(f.yaw, want, Math.min(1, dt * TURN));
        if (Math.abs(turnTowards(0, want - f.yaw, 1)) < 0.05) { f.yaw = want; f.step = null; continue; }
        return;
      }
      if (s.wait !== undefined) {
        s.t += dt;
        if (s.swing && clock >= f.swingAt) { f.avatar.attack('rightArm'); f.swingAt = clock + SWING_EVERY[s.swing]; }
        if (s.stack) {
          const k = Math.min(1, s.t / s.wait);
          stack.count = Math.round(stackOf * (s.stack > 0 ? k : 1 - k));
        }
        if (s.tip) cart.tip = Math.min(1, s.t / (TIP_S * 0.5)) * (s.t > TIP_S * 0.7 ? Math.max(0, 1 - (s.t - TIP_S * 0.7) / (TIP_S * 0.3)) : 1);
        if (s.count && run && truth != null) {
          const k = Math.min(1, s.t / UNLOAD_S);
          const n = Math.round(run.from + (truth - run.from) * k);
          if (n !== shown) { shown = n; onBars(shown); }
        }
        if (s.t >= s.wait) { f.step = null; continue; }
        return;
      }
      if (s.go) {
        f.push = s.push ?? null;
        let left = s.speed * dt;
        while (left > 0 && s.i < s.go.length) {
          const to = s.go[s.i];
          const dx = to[0] - f.pos[0], dz = to[1] - f.pos[1];
          const d = Math.hypot(dx, dz);
          if (d > 1e-4) f.yaw = turnTowards(f.yaw, Math.atan2(dx, dz), Math.min(1, dt * TURN));
          if (d <= left) { f.pos = [to[0], to[1]]; left -= d; s.i++; }
          else { f.pos = [f.pos[0] + dx / d * left, f.pos[1] + dz / d * left]; left = 0; }
        }
        f.moving = true;
        f.phase += dt * 9 * (s.speed / WALK_SPEED);
        if (s.i >= s.go.length) { f.step = null; f.push = null; continue; }
        return;
      }
      f.step = null;
    }
  }

  // Idle: at work by day, indoors by night, walking between the two.
  function idleFigure(f, spot, key) {
    if (!spot) return;
    const night = nightOf(material);
    if (!f.inside && night > DUSK && !f.queue.length && !f.step) {
      const home = key === 'smith' ? spot.home : [spot.door];
      f.queue = [{ go: home.concat(key === 'smith' ? [spot.door] : []) }, { then: () => { f.inside = true; } }];
    } else if (f.inside && night < DAWN && !f.queue.length && !f.step) {
      f.pos = [...spot.door];
      f.inside = false;
      f.queue = [{ go: key === 'smith' ? [...spot.home].reverse().concat([spot.at]) : [spot.at] }, { face: spot.face }];
    }
    if (!f.queue.length && !f.step && !f.inside && clock >= f.swingAt) {
      f.avatar.attack('rightArm');
      f.swingAt = clock + SWING_EVERY[key === 'smith' ? 'bench' : 'mine'] * (0.8 + 0.4 * ((clock * 7.3) % 1));
    }
  }

  function draw(f, dt) {
    f.group.visible = f.placed && !f.inside;
    if (!f.group.visible) return;
    f.group.position.set(f.pos[0], standY(f.pos[0], f.pos[1]), f.pos[1]);
    f.group.rotation.y = f.yaw;
    f.avatar.update({ moving: f.moving, grounded: true, phase: f.phase, pushing: f.push ?? undefined }, dt);
  }
  function drawCarried(thing, ahead, dt) {
    if (!thing.pos) { thing.group.visible = false; return; }
    if (thing.by) {
      const f = thing.by;
      const before = thing.pos;
      thing.yaw = f.yaw;
      thing.pos = ahead ? [f.pos[0] + Math.sin(f.yaw) * ahead, f.pos[1] + Math.cos(f.yaw) * ahead] : [f.pos[0], f.pos[1]];
      thing.rolled = (thing.rolled || 0) + Math.hypot(thing.pos[0] - before[0], thing.pos[1] - before[1]);
    }
    thing.group.visible = true;
    thing.group.position.set(thing.pos[0], standY(thing.pos[0], thing.pos[1]), thing.pos[1]);
    thing.group.rotation.y = thing.yaw;
  }

  return {
    // The three buildings, as main.js has them standing, and what the roads between them are
    // read from. A layout that moved any of them gives the run up: its route was the old one.
    setSites({ mine = null, smith: shop = null, pit = null, village = null, terrain = null } = {}) {
      const sig = JSON.stringify([mine?.spec?.plot, shop?.spec?.plot, pit?.spec?.plot, terrain?.size]);
      Object.assign(sites, { mine, smith: shop, pit, village, terrain });
      hangStack();
      if (sig === sites.sig && miner.placed === !!mine && smith.placed === !!shop) return;
      sites.sig = sig;
      if (run) abandon();
      else settle();
    },
    // What the pit should hold. The first word is shown as it is; a rise of MIN_RISE or more
    // after that is a window turned over, and is delivered; anything else is shown at once.
    setGold(bars) {
      const n = Number.isFinite(bars) ? Math.max(0, Math.min(GOLD_BARS, Math.round(bars))) : GOLD_BARS;
      const before = truth;
      truth = n;
      if (run) {
        // Mid-run: a lower number (the new window already being spent) is shown if the pit is
        // above it; a higher one is simply what the barrow now counts up to.
        if (shown > truth) { shown = truth; onBars(shown); }
        return;
      }
      if (before != null && n - (shown ?? before) >= MIN_RISE && begin(shown ?? before)) return;
      shown = n;
      onBars(shown);
    },
    // ?goldrun: a delivery now, from `from` bars to whatever the pit holds.
    play(from = 20) {
      if (run || truth == null) return false;
      return begin(Math.max(0, Math.min(truth, from)));
    },
    busy: () => !!run,
    bars: () => shown,
    update(dt) {
      const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
      clock += step;
      stepFigure(miner, step);
      stepFigure(smith, step);
      if (!run) {
        const spots = idleSpots();
        idleFigure(miner, spots.miner, 'miner');
        idleFigure(smith, spots.smith, 'smith');
      } else if (!miner.queue.length && !miner.step && !smith.queue.length && !smith.step) {
        run = null;
        if (shown !== truth) { shown = truth; onBars(shown); }
      }
      draw(miner, step);
      draw(smith, step);
      drawCarried(cart, cart.by ? CART_AHEAD : 0, step);
      cart.load.visible = cart.loaded;
      cartBody.rotation.x = cart.tip * 0.75;
      cart.load.rotation.x = cartBody.rotation.x;
      drawCarried(barrow, 0, step);
      barrow.bars.visible = barrow.loaded;
      barrow.wheel.rotation.x = (barrow.rolled || 0) / BARROW.r;
    },
    dispose() {
      for (const f of [miner, smith]) { scene.remove(f.group); f.avatar.dispose(); }
      scene.remove(cart.group);
      scene.remove(barrow.group);
      stack.parent?.remove(stack);
      for (const g of [cartGeo, loadGeo, trayGeo, wheelGeo, barsGeo, stackBar]) g.dispose();
    },
  };
}
