// A health bar floating over every hostile near enough to fight: the volcano's guards and the
// Codex settlers housed on it.
//
// What a bar says is the sea's last word on that body - `{t:'agent', a:'hit', hp, max}`
// (lib/combat.mjs), kept on the figure by crowd-view.js hit() - and agents do not heal
// (combat.mjs's header), so the last word stays true until the next one. A body this page has
// never heard about is whole; a fallen one is a hole in the roster and a new body when it
// comes back, which starts whole again without anybody saying so. A page that joins mid-fight
// shows a hurt guard as whole until somebody hits it once more: the sea does not send every
// agent's health to a newcomer, and a bar a blow out of date is not worth a welcome that size.
//
// Two draw calls for every bar on the screen, however many: one InstancedMesh for the dark
// backs and one for the red fills, each instance turned to face the camera on the CPU.
// Twenty-odd bars as meshes of their own would have been forty-odd draw calls, which is the
// budget of a whole island (CLAUDE.md, "One material, one draw call per building").
import * as THREE from 'three';

// How many bars at once, nearest the eye first.
export const BAR_LIMIT = 24;
// Who gets one: every hostile within SHOW_RANGE of the eye, and a hurt one out to HURT_RANGE,
// so the guard you just hit keeps its bar while you back off. Island units (4 m each).
export const SHOW_RANGE = 14;
export const HURT_RANGE = 30;
// The bar itself, in island units: about an imp's shoulders wide, over its horns. It was 0.42
// across, which on foot - the camera a couple of units behind you - was a slab over the head
// of whoever you were fighting and hid your own.
const WIDTH = 0.28, HEIGHT = 0.034, BORDER = 0.009;
const BACK = 0x1a0d0a, FILL = 0xd8281c;

// Which of `cands` ([{ x, y, z, frac }], scene frame) get a bar: in range of `eye`, nearest
// first, at most `limit`. Kept apart from the drawing so a test can hold the rule.
export function pickBars(cands, eye, limit = BAR_LIMIT) {
  if (!eye) return [];
  const out = [];
  for (const c of cands) {
    const dx = c.x - eye.x, dy = c.y - eye.y, dz = c.z - eye.z;
    const d = dx * dx + dy * dy + dz * dz;
    const range = c.frac < 1 ? HURT_RANGE : SHOW_RANGE;
    if (d <= range * range) out.push({ c, d });
  }
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, limit).map((o) => o.c);
}

export function createAgentBars(scene, limit = BAR_LIMIT) {
  const mat = (color, opacity) => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, toneMapped: false,
  });
  const backGeo = new THREE.PlaneGeometry(WIDTH + BORDER * 2, HEIGHT + BORDER * 2);
  // Anchored at its left edge, so a scale in x empties it from the right.
  const fillGeo = new THREE.PlaneGeometry(1, HEIGHT).translate(0.5, 0, 0);
  const backs = new THREE.InstancedMesh(backGeo, mat(BACK, 0.75), limit);
  const fills = new THREE.InstancedMesh(fillGeo, mat(FILL, 1), limit);
  // Drawn after everything opaque and the backs first, so a fill is never under its back;
  // the depth test stays on, so a bar behind a hill is behind the hill.
  backs.renderOrder = 10;
  fills.renderOrder = 11;
  for (const m of [backs, fills]) {
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = false;
    m.receiveShadow = false;
    scene.add(m);
  }

  const pos = new THREE.Vector3(), right = new THREE.Vector3(), scale = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  // `cands` as for pickBars, plus `top`: how high over `y` the bar floats. `camera` is what
  // the frame is rendered with; every bar faces it.
  function update(cands, camera) {
    const shown = camera ? pickBars(cands, camera.position, limit) : [];
    if (shown.length) right.setFromMatrixColumn(camera.matrixWorld, 0);
    const q = camera ? camera.quaternion : null;
    shown.forEach((c, i) => {
      pos.set(c.x, c.y + c.top, c.z);
      backs.setMatrixAt(i, matrix.compose(pos, q, scale.set(1, 1, 1)));
      const frac = Math.max(0, Math.min(1, c.frac));
      pos.addScaledVector(right, -WIDTH / 2);
      // A sliver rather than nothing at zero: a scale of 0 makes a singular matrix.
      fills.setMatrixAt(i, matrix.compose(pos, q, scale.set(Math.max(1e-4, WIDTH * frac), 1, 1)));
    });
    backs.count = fills.count = shown.length;
    backs.instanceMatrix.needsUpdate = fills.instanceMatrix.needsUpdate = true;
    return shown.length;
  }

  function dispose() {
    for (const m of [backs, fills]) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); m.dispose(); }
  }

  return { update, dispose, meshes: () => [backs, fills] };
}
