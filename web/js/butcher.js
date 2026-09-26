// The butcher's at work (Plans/slagerij.md). By day a butcher - a passive settler, nobody's
// agent - stands behind the chopping block facing the street and chops, three and a breath: at
// each chop the joint gives, a slice comes off its cut end and pushes the ones before it along,
// and a moment after the third they slide over the far edge into the tub. At nightfall he walks
// round the block to the door and goes in, and the awning rolls in after him; in the morning it
// rolls out and he comes back. Day and night the smokehouse smoulders and smokes, the hams and
// the sausage ring sway on the rack, and the sign swings on its bracket.
//
// Built like smithy.js: the moving parts are baked inside the yard asset with their origins on
// their own axes (scripts/build-butcher.py), buildings.js leaves them out of the merge
// (`isButcherMoving`), and every place the butcher goes - the cut end of the joint, the way
// round the block, the door - and every place a slice goes is read off the bake. The night is
// the shared material's own uNight, the number that lights the windows, so this needs nothing
// handed to it but the frame's dt. Deterministic: its own clock, a seeded rng, and a state
// machine that is a function of those and of the night.
import * as THREE from 'three';
import { makeRng } from 'shared/rng.mjs';
import { mesh, sphere, mergeParts } from './buildings.js';
import * as models from './models.js';
import { createClassicAvatar } from './classic-avatar.js';
import { normalizeAvatar } from './avatar.js';

const HOUSE = 'civic_butcher';
const YARD = 'civic_butcher_yard';
export const PART = {
  awning: `${YARD} awning`,
  sign: `${YARD} sign`,
  hangs: [0, 1, 2].map((i) => `${YARD} hang ${i}`),
  joint: `${YARD} joint`,
  slice: `${YARD} slice`,
  embers: `${YARD} embers`,
  block: `${YARD} block`,
  vent: `${YARD} vent`,
  tub: `${YARD} tub`,
  frame: `${HOUSE} frame`,
};

// The butcher: a settler of the island's own kit in a white apron and a white cap, with a cleaver
// in his right hand. The trim is dark rather than butcher's red: the rig paints its legs with
// it, and red legs under a white apron read as a costume; the shop has the red. The cleaver is a villager's tool and not in HAND_ITEMS,
// so normalizeAvatar would drop it: he is handed it after normalising (classic-avatar.js). The
// same 0.72 of a player as the smith, which fits him under the door and behind the block.
const LOOK = normalizeAvatar({
  skin: 0xe3b08e, tunic: 0xf1ece2, trim: 0x3b3330, hat: 0xf6f3ec, hatShape: 'sailor',
  equip: { backpack: false },
});
export const BUTCHER_LOOK = { ...LOOK, equip: { ...LOOK.equip, rightHandItem: 'cleaver' } };
export const BUTCHER_SCALE = 0.72;
// Where he stands, from the joint's cut end on the block: to its left by as far as his right
// hand is from his middle, and behind it by as far as the cleaver reaches in front of him at the
// bottom of the swing - so the blade comes down across the cut end, which
// tests/butcher.test.mjs measures off the rig rather than trusting these two numbers.
const STAND = [-0.106, -0.1];
const STEP_BACK = 0.08;
export const WALK_SPEED = 0.55;
// Three chops and a breath, the smith's own rhythm.
export const BLOW_S = 0.75;
export const BLOWS = 3;
export const BREATH_S = 1.6;
// When in a swing the blade meets the meat: classic-avatar.js's swingPose reaches STRIKE_ARM at
// 55% of its 0.45 s, after the wind-up.
export const IMPACT_S = 0.25;
export const DUSK = 0.55;
export const DAWN = 0.45;

// The joint gives at each chop and springs back.
const SQUASH = 0.2;
const SQUASH_S = 0.15;
// A slice grows in from the cut rather than appearing; the ones on the block slide along to make
// room. After the round's last chop the slices wait a beat, then go over the edge one after
// another into the tub, shrinking as they drop into it.
const GROW_S = 0.08;
const SLIDE = 12;
const SWEEP_WAIT = 0.35;
const SWEEP_S = 0.9;
const SWEEP_GAP = 0.12;
const SLICES = BLOWS;

// The awning rolls in to this much of itself, into its box, over ROLL_S.
export const ROLLED = 0.08;
const ROLL_S = 2.5;

// The smokehouse: a thin, pale plume out from under the vent's cap, all day and all night.
const SMOKE = 12;
const SMOKE_EVERY = 0.45;
const SMOKE_HEX = 0xbdb8b2;

function slotsOf(name) {
  return models.assetParts(name.startsWith(YARD) ? YARD : HOUSE).filter((n) => n === name || n.startsWith(name + ':'));
}
const atOf = (name) => models.part(slotsOf(name)[0]).at;
// mergeParts, not mergeGeometries: the sign is timber and paint, and only the timber carries a
// sheet, which mergeGeometries refuses to weld.
function geometryOf(name) {
  const names = slotsOf(name);
  return names.length === 1 ? mesh(names[0]) : mergeParts(names.map((n) => mesh(n)));
}
// Where a part's faces reach, in the asset's own frame: its origin plus its baked positions.
function boundsOf(name) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const n of slotsOf(name)) {
    const { positions, at } = models.part(n);
    for (let i = 0; i < positions.length; i++) {
      const a = i % 3, v = positions[i] + at[a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

export function butcherGeometry() {
  if (!models.hasAsset(YARD)) return null;
  const door = models.anchorsOf(HOUSE).door;
  const block = boundsOf(PART.block), joint = boundsOf(PART.joint), slice = boundsOf(PART.slice), tub = boundsOf(PART.tub);
  const top = atOf(PART.block)[1];
  const cut = [joint.max[0], top, atOf(PART.joint)[2]];
  const work = [cut[0] + STAND[0], 0, cut[2] + STAND[1]];
  // A step back from the block, out sideways between it and the smokehouse, down the gap between
  // the house and the block to the front, and along the front to the door: never through the
  // block, the smokehouse or the house wall. Straight out sideways from where he works, his
  // shoulder would brush the block - walking, he is wider than he is deep.
  const lane = (boundsOf(PART.frame).max[0] + block.min[0]) / 2;
  const front = door[2] + 0.02, back = work[2] - STEP_BACK;
  const path = [work, [work[0], 0, back], [lane, 0, back], [lane, 0, front], [door[0] + 0.12, 0, front], [door[0], 0, door[2]]];
  return {
    door, work, path, cut, top,
    block: { min: block.min, max: block.max },
    slice: { width: slice.max[0] - slice.min[0], at: atOf(PART.slice) },
    tub: { at: [(tub.min[0] + tub.max[0]) / 2, tub.max[1], (tub.min[2] + tub.max[2]) / 2], r: (tub.max[0] - tub.min[0]) / 2 },
    awning: atOf(PART.awning), sign: atOf(PART.sign), hangs: PART.hangs.map(atOf),
    joint: atOf(PART.joint), embers: atOf(PART.embers), vent: atOf(PART.vent),
  };
}

const nightOf = (material) => material?.userData?.uniforms?.uNight?.value ?? 0;

// Where along a polyline a walker is after `d` of walking: the point and the heading.
function along(path, d) {
  let left = Math.max(0, d);
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, , az] = path[i], [bx, , bz] = path[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (left <= len || i === path.length - 2) {
      const k = len > 0 ? Math.min(1, left / len) : 1;
      return { x: ax + (bx - ax) * k, z: az + (bz - az) * k, yaw: Math.atan2(bx - ax, bz - az) };
    }
    left -= len;
  }
  const [x, , z] = path[path.length - 1];
  return { x, z, yaw: 0 };
}
const pathLength = (path) => path.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - path[i][0], p[2] - path[i][2]), 0);

export function attachButcher(group, at, material, yaw = 0) {
  const G = butcherGeometry();
  if (!G) return null;
  const root = new THREE.Group();
  root.position.set(...at);
  root.rotation.y = yaw;
  group.add(root);
  const geometries = [];
  const hang = (geometry, where) => {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = true;
    m.position.set(...where);
    root.add(m);
    return m;
  };
  const own = (name) => { const g = geometryOf(name); geometries.push(g); return g; };
  const awning = hang(own(PART.awning), G.awning);
  const sign = hang(own(PART.sign), G.sign);
  const hangs = PART.hangs.map((name, i) => hang(own(name), G.hangs[i]));
  const joint = hang(own(PART.joint), G.joint);
  const embers = hang(own(PART.embers), G.embers);
  // Three slices share one geometry: they are the same cut.
  const sliceGeometry = own(PART.slice);
  const slices = Array.from({ length: SLICES }, () => {
    const m = hang(sliceGeometry, G.slice.at);
    m.visible = false;
    return { mesh: m, state: 'off', slot: 0, x: 0, born: 0, sweepAt: 0, from: 0 };
  });

  // The smoke: a small pool of pale puffs, one draw call.
  const puff = sphere(1, SMOKE_HEX);
  geometries.push(puff);
  const smoke = new THREE.InstancedMesh(puff, material, SMOKE);
  smoke.frustumCulled = false;
  root.add(smoke);

  // The butcher himself.
  const butcher = createClassicAvatar(BUTCHER_LOOK, material);
  const figure = new THREE.Group();
  figure.rotation.order = 'YXZ';
  figure.scale.setScalar(BUTCHER_SCALE);
  figure.add(butcher.object);
  root.add(figure);

  const shop = {
    root, G, material, awning, sign, hangs, joint, embers, slices, smoke, butcher, figure, geometries,
    time: 0, rng: makeRng('butcher'),
    // 'work' at the block, 'in' walking to the door, 'inside', 'out' walking back.
    mode: 'work', walked: 0, blowAt: 0, blows: 0, struck: false, walkPhase: 0,
    swungAt: undefined, squashAt: -Infinity, sweepFrom: Infinity, rolled: 1,
    puffs: Array.from({ length: SMOKE }, () => ({ life: 0, max: 1, p: [0, 0, 0], v: [0, 0, 0] })),
    nextPuff: 0,
    embersBase: new Float32Array(embers.geometry.attributes.aEmissive.array),
    pathLength: pathLength(G.path),
  };
  updateButcher(shop, 0);
  return shop;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const s3 = new THREE.Vector3();
const p3 = new THREE.Vector3();
const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

// Where a slice on the block rests: `slot` places from the cut, the newest nearest it.
const restX = (G, slot) => G.cut[0] + G.slice.width * (slot + 0.5) + 0.004 * slot;

function cutSlice(shop) {
  const s = shop.slices.find((c) => c.state === 'off');
  if (!s) return;
  for (const c of shop.slices) if (c.state === 'rest') c.slot++;
  s.state = 'rest';
  s.slot = 0;
  s.x = restX(shop.G, 0);
  s.born = shop.time;
}

// Off the block, one after another, the one furthest along first.
function sweep(shop, at) {
  const resting = shop.slices.filter((c) => c.state === 'rest').sort((a, b) => b.slot - a.slot);
  resting.forEach((c, i) => { c.state = 'sweep'; c.sweepAt = at + i * SWEEP_GAP; c.from = c.x; });
}

function stepSlices(shop, step) {
  const G = shop.G, t = shop.time;
  const edge = G.block.max[0], [tx, rim, tz] = G.tub.at;
  for (const c of shop.slices) {
    const m = c.mesh;
    m.visible = c.state !== 'off';
    if (c.state === 'off') continue;
    m.rotation.set(0, 0, 0);
    if (c.state === 'rest') {
      c.x += (restX(G, c.slot) - c.x) * Math.min(1, step * SLIDE);
      m.position.set(c.x, G.top, G.slice.at[2]);
      m.scale.setScalar(Math.min(1, (t - c.born) / GROW_S));
      continue;
    }
    const u = Math.max(0, (t - c.sweepAt) / SWEEP_S);
    if (u >= 1) { c.state = 'off'; m.visible = false; continue; }
    if (u < 0.45) {
      // Slid along the block to its edge.
      const k = u / 0.45;
      m.position.set(c.from + (edge - c.from) * k * k * (3 - 2 * k), G.top, G.slice.at[2]);
      m.scale.setScalar(1);
    } else {
      // Over the edge: tipping as it goes, down into the tub, and gone into it.
      const k = (u - 0.45) / 0.55;
      m.position.set(edge + (tx - edge) * k, G.top + (rim - 0.02 - G.top) * k + 0.03 * Math.sin(Math.PI * k), G.slice.at[2] + (tz - G.slice.at[2]) * k);
      m.rotation.z = -1.3 * k;
      m.scale.setScalar(k < 0.5 ? 1 : 1 - (k - 0.5) * 2);
    }
  }
}

function stepSmoke(shop, step) {
  const { puffs, rng, smoke } = shop;
  const [vx, vy, vz] = shop.G.vent;
  shop.nextPuff -= step;
  if (shop.nextPuff <= 0) {
    shop.nextPuff += SMOKE_EVERY * rng.range(0.7, 1.3);
    const c = puffs.find((p) => p.life <= 0);
    if (c) {
      c.life = c.max = rng.range(2.6, 3.4);
      c.p = [vx + rng.range(-0.05, 0.05), vy, vz + rng.range(-0.05, 0.05)];
      c.v = [rng.range(0.02, 0.05), rng.range(0.09, 0.13), rng.range(-0.015, 0.015)];
    }
  }
  puffs.forEach((c, i) => {
    if (c.life <= 0) { smoke.setMatrixAt(i, hidden); return; }
    c.life -= step;
    for (let a = 0; a < 3; a++) c.p[a] += c.v[a] * step;
    const u = 1 - Math.max(0, c.life) / c.max;
    // Swelling as it rises, and thinning out at the end - by shrinking, since the building
    // material is opaque and a puff cannot fade.
    const size = c.life > 0 ? (0.016 + 0.045 * u) * Math.min(1, u / 0.08, (1 - u) / 0.35) : 0;
    m4.compose(p3.set(...c.p), q.identity(), s3.setScalar(size));
    smoke.setMatrixAt(i, m4);
  });
  smoke.instanceMatrix.needsUpdate = true;
}

export function updateButcher(shop, dt) {
  if (!shop) return;
  const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
  shop.time += step;
  const t = shop.time, G = shop.G;
  const night = nightOf(shop.material);

  // ---- where the butcher is -----------------------------------------------------------
  if (shop.mode === 'work' && night > DUSK) {
    shop.mode = 'in';
    shop.walked = 0;
    // Nothing is left lying on the block for the night.
    sweep(shop, t);
    shop.sweepFrom = Infinity;
  } else if (shop.mode === 'inside' && night < DAWN) { shop.mode = 'out'; shop.walked = 0; }
  let moving = false;
  if (shop.mode === 'in' || shop.mode === 'out') {
    shop.walked += WALK_SPEED * step;
    moving = true;
    if (shop.walked >= shop.pathLength) {
      shop.mode = shop.mode === 'in' ? 'inside' : 'work';
      shop.blowAt = t + BREATH_S;
      shop.blows = 0;
      moving = false;
    }
  }
  const working = shop.mode === 'work';
  shop.figure.visible = shop.mode !== 'inside';
  if (working) {
    shop.figure.position.set(G.work[0], 0, G.work[2]);
    shop.figure.rotation.y = 0;                       // facing the street, over the block
  } else if (moving) {
    const back = shop.mode === 'out';
    const pose = along(back ? [...G.path].reverse() : G.path, shop.walked);
    shop.figure.position.set(pose.x, 0, pose.z);
    shop.figure.rotation.y = pose.yaw;
  }

  // ---- the chops ----------------------------------------------------------------------
  if (working && t >= shop.blowAt) {
    shop.butcher.attack('rightArm');
    shop.struck = false;
    shop.blows++;
    shop.swungAt = t;
    shop.blowAt = t + (shop.blows % BLOWS === 0 ? BLOW_S + BREATH_S : BLOW_S);
  }
  if (working && !shop.struck && shop.swungAt !== undefined && t - shop.swungAt >= IMPACT_S) {
    shop.struck = true;
    shop.squashAt = t;
    cutSlice(shop);
    if (shop.blows % BLOWS === 0) shop.sweepFrom = t + SWEEP_WAIT;
  }
  if (!working) shop.struck = true;
  if (t >= shop.sweepFrom) { sweep(shop, shop.sweepFrom); shop.sweepFrom = Infinity; }
  shop.walkPhase += step * (moving ? 9 : 1.5);
  shop.butcher.update({ moving, grounded: true, phase: shop.walkPhase }, step);

  const give = Math.max(0, 1 - (t - shop.squashAt) / SQUASH_S);
  shop.joint.scale.set(1 + 0.3 * SQUASH * give, 1 - SQUASH * give, 1 + 0.3 * SQUASH * give);
  stepSlices(shop, step);

  // ---- the awning ---------------------------------------------------------------------
  // In once he is inside, out as soon as he comes out.
  const target = shop.mode === 'inside' ? ROLLED : 1;
  const roll = step / ROLL_S;
  shop.rolled = target < shop.rolled ? Math.max(target, shop.rolled - roll) : Math.min(target, shop.rolled + roll);
  shop.awning.scale.set(1, shop.rolled, shop.rolled);

  // ---- the smokehouse -----------------------------------------------------------------
  const glow = 0.72 + 0.2 * (0.5 + 0.5 * Math.sin(t * 1.7)) + 0.08 * Math.sin(t * 9.3);
  const emissive = shop.embers.geometry.attributes.aEmissive;
  for (let i = 0; i < emissive.count; i++) emissive.array[i] = shop.embersBase[i] * glow;
  emissive.needsUpdate = true;
  stepSmoke(shop, step);

  // ---- what swings --------------------------------------------------------------------
  shop.sign.rotation.x = 0.09 * Math.sin(t * 1.1) + 0.025 * Math.sin(t * 2.3 + 1);
  shop.hangs.forEach((h, i) => {
    h.rotation.x = 0.07 * Math.sin(t * (0.9 + i * 0.13) + i * 1.7);
    h.rotation.z = 0.015 * Math.sin(t * 1.4 + i * 2.1);
  });
}

export function disposeButcher(shop) {
  if (!shop) return;
  shop.root.parent?.remove(shop.root);
  for (const g of shop.geometries) g.dispose();
  shop.smoke.dispose();
  shop.butcher.dispose();
}
