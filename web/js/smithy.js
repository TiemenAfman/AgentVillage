// The smithy at work (Plans/smidse.md). By day a smith - a passive settler, nobody's agent -
// stands at the anvil and strikes, three blows and a breath, and sparks fly off each one; the
// bellows pump and the oven's mouth breathes with them. At nightfall he walks to the door and
// goes in, the bellows stop, and the fire dies back slowly to an afterglow that lights the
// lean-to until morning, when he comes out again. The lantern swings a little all the while.
//
// Built like sawmill.js: the moving parts are baked inside the yard asset with their origins on
// their own axes (scripts/build-smithy.py), buildings.js leaves them out of the merge
// (`isSmithyMoving`), and every place the smith goes - the anvil's face, the door - is read off
// the bake. The night is the shared material's own uNight, the number that lights the windows,
// so this needs nothing handed to it but the frame's dt. Deterministic: its own clock, a seeded
// rng, and a state machine that is a function of those and of the night.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng } from 'shared/rng.mjs';
import { mesh, box } from './buildings.js';
import * as models from './models.js';
import { createClassicAvatar } from './classic-avatar.js';
import { normalizeAvatar } from './avatar.js';

const YARD = 'civic_smithy_yard';
export const PART = {
  bellows: `${YARD} bellows`,
  coals: `${YARD} coals`,
  lantern: `${YARD} lantern`,
  anvil: `${YARD} anvil`,
};

// The smith: a settler of the island's own kit, in a leather apron and a flat cap, with a hammer
// in his right hand. Villagers stand smaller than the figure a player walks (RESIDENT_HEAD_Y in
// villager.js), and at this size he also fits under the smithy's door and the lean-to.
export const SMITH_LOOK = normalizeAvatar({
  skin: 0xd9a47e, tunic: 0x6b4a33, trim: 0x2f2a26, hat: 0x3a2e26, hatShape: 'cap',
  equip: { backpack: false, rightHandItem: 'hammer' },
});
export const SMITH_SCALE = 0.72;
// Where he stands, from the anvil's face: back and to the left of it, turned towards it, so
// the blow lands on the anvil and the front of the smithy sees him side on.
const STAND = [-0.12, -0.1];
export const WALK_SPEED = 0.55;
// Three blows and a breath.
export const BLOW_S = 0.75;
export const BLOWS = 3;
export const BREATH_S = 1.6;
// When in a swing the hammer meets the iron: classic-avatar.js's swingPose reaches STRIKE_ARM
// at 55% of its 0.45 s, after the wind-up.
const IMPACT_S = 0.25;
// Dusk and dawn, with a gap between so a night slider held at half does not have him in
// and out of the door every frame.
export const DUSK = 0.55;
export const DAWN = 0.45;

// The fire. While he works it is hot and breathes with the bellows; once he has gone in it
// cools towards an afterglow over AFTERGLOW_S and never quite goes out.
export const PUMP_S = 1.6;
export const AFTERGLOW = 0.22;
const AFTERGLOW_S = 20;
const WARM_S = 3;
// Out in front of the mouth and a little up: close to it, the light burns the oven's own face white.
const FIRE_LIGHT = { color: 0xff8a3a, intensity: 1.1, distance: 1.8, ahead: 0.32, up: 0.12 };

const SPARKS = 24;
const EMBERS = 10;
const SPARK_HEX = 0xffb347;

function slotsOf(name) {
  return models.assetParts(YARD).filter((n) => n === name || n.startsWith(name + ':'));
}
const atOf = (name) => models.part(slotsOf(name)[0]).at;
function geometryOf(name) {
  const names = slotsOf(name);
  return names.length === 1 ? mesh(names[0]) : mergeGeometries(names.map((n) => mesh(n)), false);
}

export function smithyGeometry() {
  if (!models.hasAsset(YARD)) return null;
  const anvil = atOf(PART.anvil);
  const door = models.anchorsOf('civic_smithy').door;
  const work = [anvil[0] + STAND[0], 0, anvil[2] + STAND[1]];
  // Out of the lean-to at the front, along the house and in at the door: never through the
  // oven or the house wall.
  const path = [work, [work[0], 0, door[2] + 0.02], [door[0] + 0.12, 0, door[2] + 0.02], [door[0], 0, door[2]]];
  return { anvil, door, work, path, bellows: atOf(PART.bellows), coals: atOf(PART.coals), lantern: atOf(PART.lantern) };
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

export function attachSmithy(group, at, material, yaw = 0) {
  const G = smithyGeometry();
  if (!G) return null;
  const root = new THREE.Group();
  root.position.set(...at);
  root.rotation.y = yaw;
  group.add(root);
  const geometries = [];
  const hang = (name, where) => {
    const geometry = geometryOf(name);
    geometries.push(geometry);
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = true;
    m.position.set(...where);
    root.add(m);
    return m;
  };
  const bellows = hang(PART.bellows, G.bellows);
  const coals = hang(PART.coals, G.coals);
  const lantern = hang(PART.lantern, G.lantern);
  // The fire's light, in front of the mouth. In the scene from the start at zero, as the torch's
  // is: three recompiles every material when the number of lights changes.
  const light = new THREE.PointLight(FIRE_LIGHT.color, 0, FIRE_LIGHT.distance, 2);
  light.position.set(G.coals[0], G.coals[1] + FIRE_LIGHT.up, G.coals[2] + FIRE_LIGHT.ahead);
  root.add(light);

  // Sparks off the anvil and embers out of the oven's mouth: two small pools of glowing chips.
  const chip = (size, n) => {
    const g = box(size, size, size, SPARK_HEX, { emissive: 1 });
    geometries.push(g);
    const im = new THREE.InstancedMesh(g, material, n);
    im.frustumCulled = false;
    root.add(im);
    return { im, pool: Array.from({ length: n }, () => ({ life: 0, max: 1, p: [0, 0, 0], v: [0, 0, 0] })) };
  };
  const sparks = chip(0.01, SPARKS);
  const embers = chip(0.008, EMBERS);

  // The smith himself.
  const smith = createClassicAvatar(SMITH_LOOK, material);
  const figure = new THREE.Group();
  figure.rotation.order = 'YXZ';
  figure.scale.setScalar(SMITH_SCALE);
  figure.add(smith.object);
  root.add(figure);

  const smithy = {
    root, G, material, bellows, coals, lantern, light, sparks, embers, smith, figure, geometries,
    time: 0, heat: 1, rng: makeRng('smithy'),
    // 'work' at the anvil, 'in' walking to the door, 'inside', 'out' walking back.
    mode: 'work', walked: 0, blowAt: 0, blows: 0, struck: false, walkPhase: 0,
    coalsBase: new Float32Array(coals.geometry.attributes.aEmissive.array),
    pathLength: pathLength(G.path),
  };
  updateSmithy(smithy, 0);
  return smithy;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const s3 = new THREE.Vector3();
const p3 = new THREE.Vector3();
const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

function stepChips({ im, pool }, dt, fall) {
  pool.forEach((c, i) => {
    if (c.life <= 0) { im.setMatrixAt(i, hidden); return; }
    c.life -= dt;
    c.v[1] -= fall * dt;
    for (let a = 0; a < 3; a++) c.p[a] += c.v[a] * dt;
    if (c.p[1] < 0.004) c.life = 0;
    const size = c.life > 0 ? Math.min(1, c.life / (c.max * 0.4)) : 0;
    m4.compose(p3.set(...c.p), q.identity(), s3.setScalar(size));
    im.setMatrixAt(i, m4);
  });
  im.instanceMatrix.needsUpdate = true;
}

function spawn({ pool }, n, make) {
  for (const c of pool) {
    if (n <= 0) break;
    if (c.life > 0) continue;
    make(c);
    c.max = c.life;
    n--;
  }
}

export function updateSmithy(smithy, dt) {
  if (!smithy) return;
  const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
  smithy.time += step;
  const t = smithy.time, G = smithy.G, rng = smithy.rng;
  const night = nightOf(smithy.material);

  // ---- where the smith is -------------------------------------------------------------
  if (smithy.mode === 'work' && night > DUSK) { smithy.mode = 'in'; smithy.walked = 0; }
  else if (smithy.mode === 'inside' && night < DAWN) { smithy.mode = 'out'; smithy.walked = 0; }
  let moving = false;
  if (smithy.mode === 'in' || smithy.mode === 'out') {
    smithy.walked += WALK_SPEED * step;
    moving = true;
    if (smithy.walked >= smithy.pathLength) {
      smithy.mode = smithy.mode === 'in' ? 'inside' : 'work';
      smithy.blowAt = t + BREATH_S;
      smithy.blows = 0;
      moving = false;
    }
  }
  const working = smithy.mode === 'work';
  smithy.figure.visible = smithy.mode !== 'inside';
  if (smithy.mode === 'work') {
    const [ax, , az] = G.anvil;
    smithy.figure.position.set(G.work[0], 0, G.work[2]);
    smithy.figure.rotation.y = Math.atan2(ax - G.work[0], az - G.work[2]);
  } else if (moving) {
    const back = smithy.mode === 'out';
    const pose = along(back ? [...G.path].reverse() : G.path, smithy.walked);
    smithy.figure.position.set(pose.x, 0, pose.z);
    smithy.figure.rotation.y = pose.yaw;
  }

  // ---- the blows ----------------------------------------------------------------------
  if (working && t >= smithy.blowAt) {
    smithy.smith.attack('rightArm');
    smithy.struck = false;
    smithy.blows++;
    smithy.swungAt = t;
    smithy.blowAt = t + (smithy.blows % BLOWS === 0 ? BLOW_S + BREATH_S : BLOW_S);
  }
  if (working && !smithy.struck && smithy.swungAt !== undefined && t - smithy.swungAt >= IMPACT_S) {
    smithy.struck = true;
    const [ax, ay, az] = G.anvil;
    spawn(smithy.sparks, 7, (c) => {
      c.life = rng.range(0.25, 0.5);
      c.p = [ax + rng.range(-0.02, 0.02), ay + 0.012, az + rng.range(-0.02, 0.02)];
      const a = rng.range(0, Math.PI * 2), s = rng.range(0.4, 0.9);
      c.v = [Math.cos(a) * s, rng.range(0.5, 1.1), Math.sin(a) * s];
    });
  }
  if (!working) smithy.struck = true;
  smithy.walkPhase += step * (moving ? 9 : 1.5);
  smithy.smith.update({ moving, grounded: true, phase: smithy.walkPhase }, step);

  // ---- the fire -----------------------------------------------------------------------
  const pump = working ? 0.5 - 0.5 * Math.cos((t / PUMP_S) * Math.PI * 2) : 0;
  smithy.bellows.rotation.z = -0.22 * pump;
  if (working) smithy.heat += (1 - smithy.heat) * Math.min(1, step / WARM_S);
  else smithy.heat += (AFTERGLOW - smithy.heat) * Math.min(1, step / AFTERGLOW_S);
  const breath = working ? 0.82 + 0.18 * pump : 1;
  const glow = smithy.heat * breath;
  const emissive = smithy.coals.geometry.attributes.aEmissive;
  for (let i = 0; i < emissive.count; i++) emissive.array[i] = smithy.coalsBase[i] * glow;
  emissive.needsUpdate = true;
  smithy.coals.scale.setScalar(0.94 + 0.06 * glow);
  const flicker = 0.9 + 0.07 * Math.sin(t * 17) + 0.03 * Math.sin(t * 6.1);
  smithy.light.intensity = FIRE_LIGHT.intensity * glow * flicker * (0.15 + 0.85 * night);
  // Embers out of the mouth, more when the fire is hot.
  if (rng.chance(glow * glow * step * 6)) {
    const [cx, cy, cz] = G.coals;
    spawn(smithy.embers, 1, (c) => {
      c.life = rng.range(0.8, 1.4);
      c.p = [cx + rng.range(-0.04, 0.04), cy + 0.03, cz + 0.02];
      c.v = [rng.range(-0.03, 0.03), rng.range(0.12, 0.22), rng.range(0.04, 0.1)];
    });
  }
  stepChips(smithy.sparks, step, 3.5);
  stepChips(smithy.embers, step, -0.05);

  // ---- the lantern ----------------------------------------------------------------------
  smithy.lantern.rotation.z = 0.1 * Math.sin(t * 1.3) + 0.03 * Math.sin(t * 2.9 + 1);
  smithy.lantern.rotation.x = 0.04 * Math.sin(t * 1.7 + 0.5);
}

export function disposeSmithy(smithy) {
  if (!smithy) return;
  smithy.root.parent?.remove(smithy.root);
  for (const g of smithy.geometries) g.dispose();
  smithy.sparks.im.dispose();
  smithy.embers.im.dispose();
  smithy.smith.dispose();
}
