// Moving water for the Blender-authored civic fountain.
//
// A building is normally merged into one geometry and one draw call. Stone wants that;
// water does not, because vertices in that merged loaf cannot move independently. The
// builder therefore leaves the two water surfaces and four streams out of the stone mesh
// and this module hangs them back on the building group as two small animated meshes.
import * as THREE from 'three';
import { buildFountainWaterGeometry } from './buildings.js';

export function attachFountain(group, at, material) {
  const root = new THREE.Group();
  root.position.set(...at);

  const surface = new THREE.Mesh(buildFountainWaterGeometry('surface'), material);
  surface.receiveShadow = true;
  surface.renderOrder = 2;
  const jets = new THREE.Mesh(buildFountainWaterGeometry('jets'), material);
  jets.renderOrder = 2;
  root.add(surface, jets);
  group.add(root);

  // A private immutable copy keeps the wave from accumulating numerical drift. Every
  // frame is sampled from the authored Blender surface, never from the previous frame.
  const position = surface.geometry.attributes.position;
  const base = new Float32Array(position.array);
  return { root, surface, jets, base, time: 0 };
}

export function updateFountain(fountain, dt) {
  if (!fountain) return;
  fountain.time += dt;
  const t = fountain.time;
  const position = fountain.surface.geometry.attributes.position;
  const p = position.array;

  // Two crossing waves are enough at this scale: one broad, one quicker and shallower.
  // The four-millimetre amplitude catches moving highlights without making a stone bowl
  // look as if it is sloshing on a ship.
  for (let i = 0; i < p.length; i += 3) {
    const x = fountain.base[i], z = fountain.base[i + 2];
    p[i + 1] = fountain.base[i + 1]
      + Math.sin(t * 2.4 + x * 13 + z * 9) * 0.004
      + Math.sin(t * 3.7 - x * 7 + z * 15) * 0.002;
  }
  position.needsUpdate = true;
  fountain.surface.geometry.computeVertexNormals();

  // The streams breathe by barely more than a percent and wander a fraction of a
  // degree. Their feet stay visually inside the basin while the silhouette stops being
  // a set of rigid blue rods.
  const pulse = Math.sin(t * 3.1);
  fountain.jets.scale.set(1 + pulse * 0.010, 1 + pulse * 0.014, 1 + pulse * 0.010);
  fountain.jets.rotation.y = Math.sin(t * 1.35) * 0.012;
  fountain.jets.position.y = Math.sin(t * 2.7) * 0.003;
}
