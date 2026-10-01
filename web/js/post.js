// Bloom and anti-aliasing (Plans/bloom-en-aa.md): three's own passes, vendored like OrbitControls,
// put between the frame and the screen only where something asks for them. Everywhere else the
// frame is the plain `renderer.render` it always was.
//
// Only rooms for now. A composer draws the scene linear into a render target and turns it into the
// screen's colours in OutputPass at the end; the island's sky dome, its water and a few shaders of
// its own write screen colours already, and would be turned twice - washed out. Those go through
// `colorspace_fragment` first, then the island can have it too.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// What a lamp's flame and a lit window pass on, and how far the glow reaches: tuned in the Salty
// Kraken against its halos, so turning bloom on keeps the room's light where it was.
const THRESHOLD = 0.72;
const RADIUS = 0.55;

export function createPost(renderer) {
  let settings = { bloom: 'rooms', aa: 'msaa', bloomStrength: 0.7 };
  let composer = null, built = null, renderPass = null, bloomPass = null, smaaPass = null;
  const size = new THREE.Vector2(), last = new THREE.Vector2();

  // Built on first use and again only when what it holds changes (MSAA is the render target's, so
  // switching it is a new composer); a strength is only a uniform.
  function build() {
    const key = settings.aa;
    if (composer && built === key) return;
    if (composer) dispose();
    renderer.getDrawingBufferSize(size);
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType, samples: settings.aa === 'msaa' ? 4 : 0,
    });
    composer = new EffectComposer(renderer, target);
    renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    composer.addPass(renderPass);
    bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), settings.bloomStrength, RADIUS, THRESHOLD);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    // SMAA works on the screen's colours, so after OutputPass.
    if (settings.aa === 'smaa') { smaaPass = new SMAAPass(size.x, size.y); composer.addPass(smaaPass); }
    built = key;
    last.copy(size);
  }

  function dispose() {
    if (!composer) return;
    composer.renderTarget1.dispose();
    composer.renderTarget2.dispose();
    for (const p of composer.passes) p.dispose?.();
    composer = null; built = null; smaaPass = null;
  }

  // Whether this frame goes through the composer: bloom is asked for here.
  const wanted = (room) => settings.bloom === 'rooms' && room;

  return {
    set(next) {
      settings = { ...settings, ...next };
      if (bloomPass) bloomPass.strength = settings.bloomStrength;
      if (composer && built !== settings.aa) dispose();
    },
    get: () => ({ ...settings }),
    // Is bloom drawing this frame (so a room can put its fake glow away)?
    blooming: (room) => wanted(room),
    render(scene, camera, { room = false } = {}) {
      if (!wanted(room)) { renderer.render(scene, camera); return; }
      build();
      // The quality governor moves the pixel ratio (main.js applyQuality): follow the buffer.
      renderer.getDrawingBufferSize(size);
      if (!size.equals(last)) {
        composer.setPixelRatio(1);
        composer.setSize(size.x, size.y);
        last.copy(size);
      }
      renderPass.scene = scene;
      renderPass.camera = camera;
      composer.render();
    },
    dispose,
  };
}
