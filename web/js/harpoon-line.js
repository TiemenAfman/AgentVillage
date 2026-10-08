// One harpoon's line on the page (Plans/harpoen.md): the bolt in flight, what it hooks, the reel that
// brings it home, and the rope drawn between the gun's mouth and wherever the bolt is. The arithmetic
// is shared/harpoon.mjs; this is the state around it and the one mesh it draws, and it moves nothing
// but its own bolt - who is pulled where by a hooked line (a statue, a player, a ship) is the caller's,
// through `line.reel` / `line.hooked()`, because each of those bodies is stepped by somebody else
// (walk mode, stepBoat, the treasure hunt).
//
//   stowed   the bolt is in the barrel and nothing is drawn
//   flying   fired: stepped as a bolt on a line from the gun's mouth, tested against the world
//   hooked   it struck something it holds: land (`kind: 'land'`) or a target the caller listed - the
//            hook keeps its offset from that target, asked again every frame (`target.at(out)`)
//   home     it struck water, or was let go of: it is reeled back in and stowed when it gets there
//
// Steps are fixed ticks (TICK) taken off the frame's time, like the settlers' walk, so the same shot
// flies the same way on every frame rate. Nothing here touches the network or the sound: a fire, a
// hook and every REEL_TICK of line wound in count up in `cues`, which soundSnapshot() reads.
import * as THREE from 'three';
import {
  BOLT_SPEED, REEL_SPEED, REEL_MIN, ROPE_MAX, ROPE_SEGS, stepBolt, boltHit, ropeShape,
} from 'shared/harpoon.mjs';

export const TICK = 1 / 60;
// Line wound in per click of the reel's ratchet (the sound's beat).
export const REEL_TICK = 0.5;
// The rope as drawn: a square tube this thick, round the points ropeShape gives.
const ROPE_R = 0.012;
const SIDES = 4;

// `world.ground(x, z)` and `world.targets()` as boltHit takes them; a target is { id, kind, x, y, z, r,
// at(out) } - `at` where it is now, for a target that moves (a floating statue, a swimmer, a hull).
export function createHarpoonLine({ material = null, world = {} } = {}) {
  const bolt = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  const from = { x: 0, y: 0, z: 0 };
  const prev = { x: 0, y: 0, z: 0 };
  const line = {
    state: 'stowed',
    bolt,
    // The line's length: paid out while flying, the reel's to shorten after.
    L: 0,
    reeling: true,
    // How short the reel draws the line on what it holds: REEL_MIN for a statue brought to the gun's
    // mouth, more for a ship drawn to a rock or another ship (main.js sets it when it hooks).
    minL: REEL_MIN,
    taut: false,
    hook: null,                 // { kind, id, target, off: [x, y, z] } while hooked
    cues: { fired: 0, hooked: 0, clicks: 0, tension: 0 },
  };
  let acc = 0;
  let wound = 0;

  const points = new Array((ROPE_SEGS + 1) * 3).fill(0);
  const geometry = new THREE.BufferGeometry();
  const pos = new Float32Array((ROPE_SEGS + 1) * SIDES * 3);
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const index = [];
  for (let i = 0; i < ROPE_SEGS; i++) {
    for (let k = 0; k < SIDES; k++) {
      const a = i * SIDES + k, b = i * SIDES + (k + 1) % SIDES, c = a + SIDES, d = b + SIDES;
      index.push(a, c, b, b, c, d);
    }
  }
  geometry.setIndex(index);
  const mesh = new THREE.Mesh(geometry, material || new THREE.MeshLambertMaterial({ color: 0x8a7350 }));
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.name = 'harpoon line';

  // Fire from the gun's mouth `at` along the unit `dir`, with the ship's own velocity `carry` (the bolt
  // leaves a moving deck moving). Only from the barrel: a line out is reeled in before it is fired again.
  line.fire = (at, dir, carry = null) => {
    if (line.state !== 'stowed') return false;
    Object.assign(bolt, { x: at.x, y: at.y, z: at.z, vx: dir.x * BOLT_SPEED, vy: dir.y * BOLT_SPEED, vz: dir.z * BOLT_SPEED });
    if (carry) { bolt.vx += carry.x || 0; bolt.vz += carry.z || 0; }
    Object.assign(from, at);
    line.state = 'flying';
    line.L = 0;
    line.hook = null;
    line.minL = REEL_MIN;
    line.cues.fired++;
    return true;
  };

  // Let go of whatever it holds: the line goes slack and is reeled home.
  line.release = () => {
    if (line.state === 'hooked' || line.state === 'flying') line.state = 'home';
    line.hook = null;
  };

  function hookOn(hit) {
    const t = hit.kind === 'land' ? null : (world.targets ? world.targets() : []).find((o) => o.id === hit.id) || null;
    const ref = t && t.at ? t.at({ x: 0, y: 0, z: 0 }) : t;
    line.hook = { kind: hit.kind, id: hit.id ?? null, target: t, off: ref ? [hit.x - ref.x, hit.y - ref.y, hit.z - ref.z] : [0, 0, 0] };
    Object.assign(bolt, { x: hit.x, y: hit.y, z: hit.z, vx: 0, vy: 0, vz: 0 });
    line.state = 'hooked';
    line.cues.hooked++;
  }

  const here = { x: 0, y: 0, z: 0 };
  function tick(dt) {
    if (line.state === 'flying') {
      Object.assign(prev, bolt);
      stepBolt(bolt, from, dt);
      const dx = bolt.x - from.x, dy = bolt.y - from.y, dz = bolt.z - from.z;
      line.L = Math.min(ROPE_MAX, Math.sqrt(dx * dx + dy * dy + dz * dz));
      const hit = boltHit(prev, bolt, { ground: world.ground, targets: world.targets ? world.targets() : [] });
      if (hit && hit.kind === 'water') { Object.assign(bolt, { x: hit.x, y: hit.y, z: hit.z }); line.state = 'home'; }
      else if (hit) hookOn(hit);
    } else if (line.state === 'hooked') {
      const t = line.hook.target;
      if (t && t.at) {
        t.at(here);
        bolt.x = here.x + line.hook.off[0]; bolt.y = here.y + line.hook.off[1]; bolt.z = here.z + line.hook.off[2];
      }
      if (line.reeling) wind(dt);
      const dx = bolt.x - from.x, dy = bolt.y - from.y, dz = bolt.z - from.z;
      line.taut = Math.sqrt(dx * dx + dy * dy + dz * dz) >= line.L - 1e-6;
    } else if (line.state === 'home') {
      // Drawn straight back along the line, at the reel's speed, until it is in the barrel.
      const dx = from.x - bolt.x, dy = from.y - bolt.y, dz = from.z - bolt.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const step = REEL_SPEED * 2 * dt;
      if (d <= REEL_MIN || d <= step) { line.state = 'stowed'; line.L = 0; return; }
      bolt.x += dx / d * step; bolt.y += dy / d * step; bolt.z += dz / d * step;
      line.L = d - step;
      wound += step;
      clicks();
    }
  }
  function wind(dt) {
    const before = line.L;
    line.L = Math.max(line.minL, line.L - REEL_SPEED * dt);
    wound += before - line.L;
    clicks();
  }
  function clicks() {
    while (wound >= REEL_TICK) { wound -= REEL_TICK; line.cues.clicks++; }
  }

  // One frame: `mouth` is where the gun's mouth is now (the ship moves under it), `dt` the frame's
  // seconds. Draws the rope too.
  line.update = (mouth, dt) => {
    Object.assign(from, { x: mouth.x, y: mouth.y, z: mouth.z });
    acc = Math.min(acc + dt, 0.25);
    while (acc >= TICK) { acc -= TICK; tick(TICK); }
    draw();
  };

  // The hooked end, for whoever does the pulling: { kind, id, x, y, z } or null.
  line.hooked = () => (line.state === 'hooked' ? { kind: line.hook.kind, id: line.hook.id, x: bolt.x, y: bolt.y, z: bolt.z } : null);
  // All the line is in that the reel will take: what it holds is as close as it comes.
  line.reeledIn = () => line.state === 'hooked' && line.L <= line.minL + 1e-9;
  line.mesh = mesh;

  const t = new THREE.Vector3(), u = new THREE.Vector3(), v = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0), ACROSS = new THREE.Vector3(1, 0, 0);
  function draw() {
    mesh.visible = line.state !== 'stowed';
    if (!mesh.visible) return;
    // While flying the line pays out behind the bolt and hangs a little; hooked it is as long as the
    // reel says, so it hangs until the pull takes the slack out.
    const length = line.state === 'flying' ? line.L * 1.02 : line.L;
    ropeShape(from, bolt, length, points);
    for (let i = 0; i <= ROPE_SEGS; i++) {
      const j = Math.min(i + 1, ROPE_SEGS), k = Math.max(i - 1, 0);
      t.set(points[j * 3] - points[k * 3], points[j * 3 + 1] - points[k * 3 + 1], points[j * 3 + 2] - points[k * 3 + 2]).normalize();
      u.crossVectors(t, Math.abs(t.y) > 0.95 ? ACROSS : UP).normalize();
      v.crossVectors(t, u).normalize();
      for (let s = 0; s < SIDES; s++) {
        const a = (s / SIDES) * Math.PI * 2, c = Math.cos(a) * ROPE_R, n = Math.sin(a) * ROPE_R;
        const o = (i * SIDES + s) * 3;
        pos[o] = points[i * 3] + u.x * c + v.x * n;
        pos[o + 1] = points[i * 3 + 1] + u.y * c + v.y * n;
        pos[o + 2] = points[i * 3 + 2] + u.z * c + v.z * n;
      }
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  return line;
}
