// The "Zzz" over a body nobody is steering (Plans/DONE/karakter-blijft-staan.md): our own, parked
// while the keeper looks down from the sky (walk.js), and anybody else's whose pose carries
// FLAG_ASLEEP (peers.js). One canvas texture for all of them - it never changes - so a
// harbour full of sleepers costs one texture and one material.
import * as THREE from 'three';

let shared = null;
function material() {
  if (shared) return shared;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px Georgia, serif';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = '#1f2a3a';
  g.fillStyle = '#f3e7cf';
  // Three letters climbing to the right, each a size smaller: the comic-strip sleep.
  [['Z', 14, 44, 30], ['z', 52, 30, 24], ['z', 84, 18, 18]].forEach(([t, x, y, px]) => {
    g.font = `bold ${px}px Georgia, serif`;
    g.strokeText(t, x, y);
    g.fillText(t, x, y);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  shared = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  return shared;
}

// A sprite to hang over a head. `lift` is how far above the feet it floats.
export function createZzz(lift = 0.82) {
  const s = new THREE.Sprite(material());
  s.scale.set(0.36, 0.18, 1);
  s.position.y = lift;
  s.visible = false;
  s.userData.lift = lift;
  return s;
}

// A slow float, off the wall clock: cosmetic only, nothing reads it back.
export function bobZzz(s, t) {
  s.position.y = s.userData.lift + Math.sin(t * 1.6) * 0.03;
}
