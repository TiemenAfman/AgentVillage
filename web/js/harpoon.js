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
// landed (never if it fails).
export function harpoonModel(onReady = null) {
  if (model || failed) return model;
  if (!loading) {
    loading = import('three/addons/loaders/GLTFLoader.js')
      .then(({ GLTFLoader }) => new GLTFLoader().loadAsync(modelUrl(HARPOON_FILE)))
      .then((gltf) => {
        model = prepareHarpoon(gltf.scene);
        if (onReady) onReady(model);
      })
      .catch((e) => {
        failed = true;
        console.warn(`harpoon: ${HARPOON_FILE} could not be loaded; the ships carry no harpoon guns`, e);
      });
  }
  return null;
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
  const yoke = node('yoke'), gun = node('gun'), bolt = node('bolt'), muzzle = node('muzzle');
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
