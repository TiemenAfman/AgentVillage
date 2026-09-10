// The flag a settler puts up when it is waiting for you.
//
// A session that has asked a question and stopped is easy to miss: the house looks the
// same as any other. So it raises a signal pole, tall enough to clear the roofs and read
// from across the island, and the pennant sways. Amber for a settler that has simply run
// out of work, red for one that ended on a question - that is the one worth walking to.
//
// This owns its own meshes and nothing else touches them: the village is redrawn often,
// and a marker that outlived its house would be worse than no marker at all.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const POLE_H = 2.05;
const ASKED = 0xe0483a;
const IDLE = 0xe8a33c;

// Built once and shared: a pole, a pennant, and a lamp at the top for after dark.
function poleGeometry() {
  const g = new THREE.CylinderGeometry(0.018, 0.026, POLE_H, 5);
  g.translate(0, POLE_H / 2, 0);
  g.deleteAttribute('uv');
  return g;
}

// A triangle, wide at the pole and tapering away from it, drawn on both sides so it is
// there whichever way you approach.
function pennantGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 0.62, 0.1, 0, 0, 0.34, 0,
    0, 0, 0, 0, 0.34, 0, 0.62, 0.1, 0,
  ], 3));
  g.computeVertexNormals();
  return g;
}

export function createWaitingFlags(scene) {
  const poleGeo = poleGeometry();
  const flagGeo = pennantGeometry();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x5a3c28, flatShading: true, roughness: 0.9 });
  const lampGeo = new THREE.SphereGeometry(0.055, 8, 6);

  const markers = new Map();   // building id -> { group, flag, lamp, asked, phase, baseY }
  const group = new THREE.Group();
  group.name = 'waiting-flags';
  scene.add(group);

  function make(asked) {
    const colour = asked ? ASKED : IDLE;
    const g = new THREE.Group();
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.castShadow = true;
    g.add(pole);

    const flagMat = new THREE.MeshStandardMaterial({
      color: colour, flatShading: true, roughness: 0.75, side: THREE.DoubleSide,
      emissive: new THREE.Color(colour), emissiveIntensity: 0.25,
    });
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(0.02, POLE_H - 0.42, 0);
    flag.castShadow = true;
    g.add(flag);

    // A small light at the masthead, so the flag is still findable at night.
    const lampMat = new THREE.MeshBasicMaterial({ color: colour, fog: false });
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(0, POLE_H + 0.03, 0);
    g.add(lamp);

    return { group: g, flag, lamp, flagMat, lampMat };
  }

  // specs: the buildings that are waiting, with the world position of each house.
  // Called whenever the village changes; markers that are no longer wanted are removed.
  function update(entries) {
    const wanted = new Set();
    for (const e of entries) {
      wanted.add(e.id);
      let m = markers.get(e.id);
      if (m && m.asked !== e.asked) { dispose(e.id); m = null; }   // the colour is baked in
      if (!m) {
        const built = make(e.asked);
        built.group.position.set(e.x, e.y + e.height, e.z);
        group.add(built.group);
        m = { ...built, asked: e.asked, phase: Math.random() * Math.PI * 2, baseY: e.y + e.height };
        markers.set(e.id, m);
      } else {
        m.baseY = e.y + e.height;
        m.group.position.set(e.x, m.baseY, e.z);
      }
    }
    for (const id of [...markers.keys()]) if (!wanted.has(id)) dispose(id);
  }

  function dispose(id) {
    const m = markers.get(id);
    if (!m) return;
    group.remove(m.group);
    m.flagMat.dispose();
    m.lampMat.dispose();
    markers.delete(id);
  }

  // The pennant sways and the whole pole breathes, because a still flag reads as scenery.
  function tick(t, night = 0) {
    for (const m of markers.values()) {
      const p = t * 2.2 + m.phase;
      m.flag.rotation.y = Math.sin(p) * 0.35;
      m.flag.rotation.z = Math.sin(p * 1.7) * 0.08;
      m.group.position.y = m.baseY + Math.sin(p * 0.6) * 0.05;
      const pulse = m.asked ? 0.55 + Math.sin(p * 1.3) * 0.45 : 0.35;
      m.flagMat.emissiveIntensity = 0.2 + pulse * (0.3 + night * 0.6);
      m.lamp.scale.setScalar(0.85 + pulse * 0.3);
    }
  }

  function clear() { for (const id of [...markers.keys()]) dispose(id); }

  function positionOf(id) {
    const m = markers.get(id);
    return m ? m.group.position : null;
  }

  return { update, tick, clear, positionOf, count: () => markers.size, group };
}
