// Captain Spack Jarrow, the Salty Kraken's captain (Plans/piratenkroeg.md): the one member of the
// crew who is not an instanced settler but a model of his own - a textured low-poly GLB
// (web/models/spack-jarrow.glb, 10k triangles, four embedded textures, no rig), kept exactly as
// it was chosen. A textured mesh cannot go through the bake (scripts/export-models.py drops UVs
// and textures; the building material knows only its own sheets), so he takes the one route the
// island has for a fetched model, the lava imp's (web/js/imp.js), and keeps its rules:
//
//   - nothing is fetched when this module is imported, and nothing before the first step into
//     the Kraken - which is after the boot screen by construction, so no allow flag is needed;
//   - the address goes through modelUrl (tests/api-base.test.mjs scans for bare paths);
//   - a failed load is said once in the console and never retried;
//   - nothing waits on it: until he has arrived the room shows an ordinary crew figure in his
//     place (pirate-tavern.js), and when he lands that figure is put away.
//
// His materials are the GLB's own (MeshStandardMaterial with its textures, colour space set by
// GLTFLoader), fogged by the room's haze and lit by its seven lamps. That is one program of its
// own, compiled once the first time he is drawn; the seven-light rule (interior.js, the tavern)
// is about the building material and he does not touch it. Five meshes, five draw calls, in one
// room. The geometry and the textures live for the rest of the page: a room is built once and
// kept (createInterior), so there is never a second copy to make or a first one to free.
import * as THREE from 'three';
import { modelUrl } from './assets.js';

export const CAPTAIN_FILE = 'spack-jarrow.glb';
// How tall he stands: a settler is 0.45, and a captain stands a head over his crew.
export const CAPTAIN_HEIGHT = 0.55;

let loading = null;
let model = null;
let failed = false;

// Scale, feet and facing, off the model's own box: the download stands about 200 of its units
// tall and faces +Z once its root turns it Y-up, which is the island's front already.
export function prepareCaptain(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const s = CAPTAIN_HEIGHT / (size.y || 1);
  const holder = new THREE.Group();
  holder.name = 'captain';
  root.scale.multiplyScalar(s);
  root.position.set(-(box.min.x + box.max.x) / 2 * s, -box.min.y * s, -(box.min.z + box.max.z) / 2 * s);
  holder.add(root);
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;           // rooms have no shadow pass
    o.receiveShadow = false;
    for (const m of [].concat(o.material)) m.fog = true;
  });
  return holder;
}

// The model, or null - and the first call starts the load. `onReady(model)` is called once it
// has landed (never if it fails), for a room that wants to swap it in at that moment.
export function captainModel(onReady = null) {
  if (model || failed) return model;
  if (!loading) {
    loading = import('three/addons/loaders/GLTFLoader.js')
      .then(({ GLTFLoader }) => new GLTFLoader().loadAsync(modelUrl(CAPTAIN_FILE)))
      .then((gltf) => {
        model = prepareCaptain(gltf.scene);
        if (onReady) onReady(model);
      })
      .catch((e) => {
        failed = true;
        console.warn(`captain: ${CAPTAIN_FILE} could not be loaded; the Salty Kraken's captain stays an ordinary figure`, e);
      });
  }
  return null;
}

// For the tests: where the load stands, without starting it.
export function captainState() {
  return { loading: !!loading, ready: !!model, failed };
}
