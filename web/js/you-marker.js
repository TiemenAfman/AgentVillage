// web/js/you-marker.js - "You are here", seen from the sky (Plans/DONE/karakter-blijft-staan.md): the body left standing is
// a figure half a metre tall, which from the height the camera orbits at is a speck among
// three hundred houses. So an arrow hangs over it at a fixed size on screen (a sprite with
// sizeAttenuation off: the same pixels zoomed in or out), and where it is walking to gets a
// marker of its own. Only in the sky: on foot the camera is behind you and you know.
import * as THREE from 'three';

// `withArrow` false draws YOU alone, on a canvas cut to the word (Settings → From the sky).
function arrowMaterial(withArrow = true) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = withArrow ? 220 : 60;
  const g = c.getContext('2d');
  // YOU over a fat downward arrow in the island's accent, outlined dark so both hold on
  // grass and sand.
  g.font = 'bold 44px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'top';
  g.lineJoin = 'round';
  g.lineWidth = 10; g.strokeStyle = '#1f2a3a'; g.strokeText('YOU', 64, 6);
  g.fillStyle = '#ffd24a'; g.fillText('YOU', 64, 6);
  if (withArrow) {
  g.beginPath();
  g.moveTo(40, 64); g.lineTo(88, 64); g.lineTo(88, 128); g.lineTo(118, 128);
  g.lineTo(64, 210); g.lineTo(10, 128); g.lineTo(40, 128); g.closePath();
  g.lineJoin = 'round';
  g.lineWidth = 12; g.strokeStyle = '#1f2a3a'; g.stroke();
  g.fillStyle = '#ffd24a'; g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Drawn over everything: an arrow behind a roof is an arrow nobody finds.
  return new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false });
}

export function createYouMarker(scene) {
  const arrow = new THREE.Sprite(arrowMaterial());
  arrow.center.set(0.5, 0);          // hangs from its tip, so the tip points at the head
  arrow.scale.set(0.035, 0.06, 1);  // a fraction of the screen's height, whatever the zoom
  arrow.renderOrder = 999;
  arrow.visible = false;
  scene.add(arrow);
  // YOU without the arrow: the same width on screen, only as tall as the word.
  const word = new THREE.Sprite(arrowMaterial(false));
  word.center.set(0.5, 0);
  word.scale.set(0.035, 0.06 * 60 / 220, 1);
  word.renderOrder = 999;
  word.visible = false;
  scene.add(word);

  // Where it is going: a flat ring on the ground, the same yellow.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.28, 0.42, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 998;
  ring.visible = false;
  scene.add(ring);

  // The way there: a dot every DOT_GAP along what is left of the route, one instanced mesh
  // for all of them. Past MAX_DOTS the far end goes undotted; the ring still marks it.
  const DOT_GAP = 0.7, MAX_DOTS = 400;
  const dots = new THREE.InstancedMesh(
    new THREE.CircleGeometry(0.1, 10).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.85, depthWrite: false }),
    MAX_DOTS,
  );
  dots.renderOrder = 998;
  dots.frustumCulled = false;
  dots.count = 0;
  scene.add(dots);
  const m4 = new THREE.Matrix4();

  // `at` the body's feet (or null to hide everything), `route` what is left of its walk
  // ([[x, z], ...] or null), `heightAt(x, z)` the ground under a dot. `show` is
  // 'arrow' (YOU and the arrow), 'you' (the word alone) or 'off'; the route stays on in all
  // three (Settings → From the sky, ui.js).
  function update(at, route, heightAt, t, show = 'you') {
    arrow.visible = !!at && show === 'arrow';
    word.visible = !!at && show === 'you';
    if (at) {
      const y = at.y + 0.9 + Math.abs(Math.sin(t * 3)) * 0.25;
      arrow.position.set(at.x, y, at.z);
      word.position.set(at.x, y, at.z);
    }
    const going = !!(at && route && route.length);
    ring.visible = going;
    let n = 0;
    if (going) {
      const [gx, gz] = route[route.length - 1];
      ring.position.set(gx, heightAt(gx, gz) + 0.04, gz);
      ring.scale.setScalar(1 + Math.sin(t * 4) * 0.12);
      // Walked from the feet, so the dots stay put on the ground and the body eats them.
      let px = at.x, pz = at.z, carry = DOT_GAP;
      for (const [x, z] of route) {
        const len = Math.hypot(x - px, z - pz);
        let s = carry;
        while (s < len && n < MAX_DOTS) {
          const dx = px + ((x - px) * s) / len, dz = pz + ((z - pz) * s) / len;
          m4.makeTranslation(dx, heightAt(dx, dz) + 0.03, dz);
          dots.setMatrixAt(n++, m4);
          s += DOT_GAP;
        }
        carry = s - len;
        px = x; pz = z;
      }
    }
    dots.count = n;
    dots.instanceMatrix.needsUpdate = true;
  }
  return { update };
}
