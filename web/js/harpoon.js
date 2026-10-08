// The galleon's harpoon gun as a model (Plans/harpoen.md): web/models/harpoon.glb, the Sketchfab
// download made lighter by scripts/build-harpoon-glb.py (credits in assets/harpoon/CREDITS.md). It is
// textured, so it cannot go through the bake, and takes the route the captain and the lava imp take:
//
//   - nothing is fetched when this module is imported; the first ask starts the load, and nobody
//     asks before the boot screen has gone (a ship with harpoons on it asks when she is built);
//   - the address goes through modelUrl (tests/api-base.test.mjs scans for bare paths);
//   - a failed load is said once in the console and never retried;
//   - nothing waits on it: a ship without it is a ship without harpoons until it lands.
//
// The GLB is four nodes nested as they move - pedestal, yoke, gun, harpoon - each with its origin on
// its own axis, and an empty at the barrel's mouth. `makeHarpoonGun` clones the loaded model (the
// clone shares geometry, materials and textures, so a second gun costs only its nodes and its draw
// calls) and hands back the two angles and the points the line needs.
import * as THREE from 'three';
import { modelUrl } from './assets.js';

export const HARPOON_FILE = 'harpoon.glb';
export const HARPOON_NODES = Object.freeze({
  mount: 'harpoon_mount', yoke: 'harpoon_yoke', gun: 'harpoon_gun', bolt: 'harpoon_bolt', muzzle: 'harpoon_muzzle',
});

let loading = null;
let model = null;
let failed = false;

// The loaded scene as a template: every mesh fogged and casting a shadow (a ship's deck is outdoors,
// unlike the captain's room), and the four nodes checked, because a GLB rebuilt with a node renamed
// would otherwise be a gun that never turns.
export function prepareHarpoon(root) {
  for (const name of Object.values(HARPOON_NODES)) {
    if (!root.getObjectByName(name)) throw new Error(`harpoon.glb has no ${name}`);
  }
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    for (const m of [].concat(o.material)) m.fog = true;
  });
  return root;
}

// The template, or null - and the first call starts the load. `onReady(model)` is called once it has
// landed (never if it fails), for every caller that asked before it did: each ship built meanwhile.
const waiting = [];
export function harpoonModel(onReady = null) {
  if (model || failed) return model;
  if (onReady) waiting.push(onReady);
  if (!loading) {
    loading = import('three/addons/loaders/GLTFLoader.js')
      .then(({ GLTFLoader }) => new GLTFLoader().loadAsync(modelUrl(HARPOON_FILE)))
      .then((gltf) => {
        model = prepareHarpoon(gltf.scene);
        for (const f of waiting.splice(0)) f(model);
      })
      .catch((e) => {
        failed = true;
        console.warn(`harpoon: ${HARPOON_FILE} could not be loaded; the ships carry no harpoon guns`, e);
      });
  }
  return null;
}

// Which of the two the ships carry (the keeper wanted the Sketchfab model first and the bake to compare):
// 'glb' unless this browser says 'bake' (localStorage promptholm.debug.harpoon). A ship always starts on
// the bake - it is there before the first frame - and swaps the GLB in when it lands.
export const HARPOON_LOOK_KEY = 'promptholm.debug.harpoon';
export function harpoonLook() {
  try { return globalThis.localStorage && globalThis.localStorage.getItem(HARPOON_LOOK_KEY) === 'bake' ? 'bake' : 'glb'; }
  catch { return 'glb'; }
}

export function harpoonState() {
  return { loading: !!loading, ready: !!model, failed };
}

// One gun, cloned from the template. `aim(yaw, pitch)`: yaw turns the yoke about y (0 = straight
// ahead, along the mount's own +z; positive to its left, as three turns), pitch lifts the barrel
// (positive up). `muzzleAt(out)` / `boltTailAt(out)` are world positions (call after the parent's
// matrices are up to date); `aimDir(out)` the barrel's world direction. `boltShown(on)` hides the
// harpoon in the barrel while it is out on its line, and `boltClone()` is a free harpoon to fly.
export function makeHarpoonGun(template) {
  const object = template.clone(true);
  const node = (k) => object.getObjectByName(HARPOON_NODES[k]);
  return rig(object, node('yoke'), node('gun'), node('bolt'), node('muzzle'));
}

// The same gun out of the house-style bake (scripts/build-harpoon.py, web/js/harpoon-mesh.js), on the
// same frame and with the same handle. `geometryOf(piece)` is the caller's: the merged geometry of
// every slot of `harpoon <piece>` around that piece's own origin (buildings.js mesh + mergeParts - not
// imported here, because buildings.js makes a TextureLoader when it is imported). `at` holds each
// piece's origin in the set's frame, and `muzzle` (models.part(...).at, models.anchorsOf('harpoon')).
export const HARPOON_PIECES = Object.freeze(['mount', 'yoke', 'gun', 'bolt']);
export function bakedHarpoonGun(geometryOf, material, at) {
  const solid = (k) => {
    const m = new THREE.Mesh(geometryOf(k), material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  const object = new THREE.Group();
  object.name = HARPOON_NODES.mount;
  object.add(solid('mount'));
  const hang = (name, parent, p, from, child) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(p[0] - from[0], p[1] - from[1], p[2] - from[2]);
    if (child) g.add(child);
    parent.add(g);
    return g;
  };
  const yoke = hang(HARPOON_NODES.yoke, object, at.yoke, [0, 0, 0], solid('yoke'));
  const gun = hang(HARPOON_NODES.gun, yoke, at.gun, at.yoke, solid('gun'));
  const bolt = hang(HARPOON_NODES.bolt, gun, at.bolt, at.gun, solid('bolt'));
  const muzzle = hang(HARPOON_NODES.muzzle, gun, at.muzzle, at.gun, null);
  return rig(object, yoke, gun, bolt, muzzle);
}

// What both kinds hand back: the angles, and the points the line and the shot need.
function rig(object, yoke, gun, bolt, muzzle) {
  const yaw0 = yoke.rotation.y, pitch0 = gun.rotation.x;
  const ahead = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  return {
    object,
    aim(yaw, pitch) {
      yoke.rotation.y = yaw0 + yaw;
      // A turn about x by +a carries +z towards -y: lifting the muzzle is a negative turn.
      gun.rotation.x = pitch0 - pitch;
    },
    muzzleAt(out = new THREE.Vector3()) { return muzzle.getWorldPosition(out); },
    boltTailAt(out = new THREE.Vector3()) { return bolt.getWorldPosition(out); },
    // The bolt's tail and the muzzle both lie on the bore, so the line between them is where it points.
    aimDir(out = new THREE.Vector3()) {
      muzzle.getWorldPosition(ahead);
      bolt.getWorldPosition(tmp);
      return out.copy(ahead).sub(tmp).normalize();
    },
    boltShown(on) { bolt.visible = on; },
    boltClone() {
      const b = bolt.clone(true);
      b.position.set(0, 0, 0);
      b.rotation.set(0, 0, 0);
      return b;
    },
  };
}
