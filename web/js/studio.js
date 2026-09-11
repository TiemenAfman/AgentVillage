// The dressing room for the one settler you steer. A little turntable on the left shows
// exactly the figure you will walk as; the swatches on the right change it as you pick.
// Nothing is committed until you wear it - "Never mind" puts back what you had on.
import * as THREE from 'three';
import {
  SWATCHES, HAT_SHAPES, DEFAULT_AVATAR,
  loadAvatar, saveAvatar, normalizeAvatar, avatarPlayerGeometry,
} from './avatar.js';

const hex = (n) => `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;

export function createAvatarStudio(root, { onApply, onClose } = {}) {
  const el = document.createElement('div');
  el.className = 'handover';
  el.hidden = true;
  root.appendChild(el);

  let spec = loadAvatar();
  let snapshot = null;   // the look worn on open, restored if they back out
  let preview = null;    // the turntable, alive only while the panel is

  function onKey(e) {
    if (el.hidden) return;
    if (e.key === 'Escape') {
      // Stopped dead, not just from bubbling on: walk.js listens on this same window,
      // and close() has just let its feet go - so it would read this very Escape as
      // "back to the sky". stopPropagation cannot help with a listener on the same
      // element; only stopImmediatePropagation can.
      e.preventDefault();
      e.stopImmediatePropagation();
      cancel();
      return;
    }
    e.stopPropagation();   // the swatches own the keyboard while open, not the island
  }
  // Escape has to work whether focus is on the Avatar chip that opened us (caught on the
  // window) or on a swatch inside the panel (caught here, before it bubbles away).
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } e.stopPropagation(); });
  addEventListener('keydown', onKey);

  const swatchRow = (part) => SWATCHES[part]
    .map((s) => `<button class="av-sw" data-part="${part}" data-hex="${s.hex}" title="${s.name}" style="--sw:${hex(s.hex)}"></button>`)
    .join('');
  const hatRow = () => HAT_SHAPES
    .map((h) => `<button class="av-hat chip" data-shape="${h.id}">${h.name}</button>`)
    .join('');

  function open() {
    spec = loadAvatar();
    snapshot = { ...spec };
    el.hidden = false;
    el.innerHTML = `
      <div class="handover-panel av-panel">
        <button class="x" id="av-close">✕</button>
        <h3>Your settler</h3>
        <p class="ho-sum">Compose the one settler on the island you walk as. Your look lives in this
        browser, so it is yours to change whenever you like.</p>
        <div class="av-body">
          <div class="av-stage"><canvas id="av-canvas"></canvas></div>
          <div class="av-controls">
            <h4>Skin</h4><div class="av-swatches" data-row="skin">${swatchRow('skin')}</div>
            <h4>Tunic</h4><div class="av-swatches" data-row="tunic">${swatchRow('tunic')}</div>
            <h4>Sleeves &amp; hands</h4><div class="av-swatches" data-row="trim">${swatchRow('trim')}</div>
            <h4>Hat</h4><div class="av-hats">${hatRow()}</div>
            <h4>Hat colour</h4><div class="av-swatches" data-row="hat">${swatchRow('hat')}</div>
          </div>
        </div>
        <div class="ho-buttons" style="margin-top:16px">
          <button class="btn primary" id="av-save">Wear it</button>
          <button class="btn" id="av-reset">Reset</button>
          <button class="btn" id="av-cancel">Never mind</button>
        </div>
      </div>`;

    el.querySelector('#av-close').addEventListener('click', cancel);
    el.querySelector('#av-cancel').addEventListener('click', cancel);
    el.querySelector('#av-save').addEventListener('click', save);
    el.querySelector('#av-reset').addEventListener('click', () => { spec = { ...DEFAULT_AVATAR }; sync(); apply(); });
    el.querySelectorAll('.av-sw').forEach((b) => b.addEventListener('click', () => {
      spec[b.dataset.part] = Number(b.dataset.hex); sync(); apply();
    }));
    el.querySelectorAll('.av-hat').forEach((b) => b.addEventListener('click', () => {
      spec.hatShape = b.dataset.shape; sync(); apply();
    }));

    preview = makePreview(el.querySelector('#av-canvas'));
    sync();
    apply();
  }

  // Light up the swatch and hat that match the current spec.
  function sync() {
    el.querySelectorAll('.av-sw').forEach((b) => b.classList.toggle('on', Number(b.dataset.hex) === spec[b.dataset.part]));
    el.querySelectorAll('.av-hat').forEach((b) => b.classList.toggle('on', b.dataset.shape === spec.hatShape));
  }

  // Show the change on the turntable and on the character out on the island at once.
  function apply() {
    if (preview) preview.set(spec);
    onApply && onApply(normalizeAvatar(spec));
  }

  function save() { spec = saveAvatar(spec); onApply && onApply(spec); teardown(); onClose && onClose(); }
  function cancel() {
    if (snapshot) onApply && onApply(normalizeAvatar(snapshot));   // back into what they arrived in
    teardown();
    onClose && onClose();
  }

  function teardown() {
    if (preview) { preview.dispose(); preview = null; }
    el.hidden = true;
    el.innerHTML = '';
  }

  return {
    open, close: cancel, isOpen: () => !el.hidden,
    dispose: () => { removeEventListener('keydown', onKey); teardown(); el.remove(); },
  };
}

// A self-contained turntable: its own renderer, one light rig, one rotating figure. It
// runs only while the panel is open and is torn down with it, so it never competes with
// the island's own frame loop for long.
function makePreview(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
  cam.position.set(0, 0.5, 1.95);
  cam.lookAt(0, 0.3, 0);
  scene.add(new THREE.HemisphereLight(0xfff3e0, 0x2a2f3a, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(1.4, 2.4, 1.9);
  scene.add(key);

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0 });
  const mesh = new THREE.Mesh(avatarPlayerGeometry(DEFAULT_AVATAR), mat);
  const pivot = new THREE.Group();
  pivot.add(mesh);
  scene.add(pivot);

  function resize() {
    const w = canvas.clientWidth || 220, h = canvas.clientHeight || 300;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  requestAnimationFrame(resize);   // wait for layout before sizing to the canvas

  let raf = 0, alive = true, last = performance.now();
  function tick(now) {
    if (!alive) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    pivot.rotation.y += dt * 0.7;
    renderer.render(scene, cam);
  }
  raf = requestAnimationFrame(tick);

  return {
    set(spec) { mesh.geometry.dispose(); mesh.geometry = avatarPlayerGeometry(spec); },
    dispose() {
      alive = false;
      cancelAnimationFrame(raf);
      removeEventListener('resize', resize);
      mesh.geometry.dispose();
      mat.dispose();
      renderer.dispose();
    },
  };
}
