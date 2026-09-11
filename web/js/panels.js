// The pages that hang on the island. A panel prop gets a real piece of the page put in
// front of its board, transformed into the scene by three's CSS3DRenderer.
//
// Why DOM and not a texture: live DOM cannot be sampled into WebGL. That is a security
// boundary rather than a missing feature, and the ways around it all cost the thing a
// panel is for - a screenshot into a CanvasTexture is dead, and clicking one would mean
// building a small remote-desktop protocol. So the HTML stays HTML, on its own layer
// above the canvas, and the browser does the perspective and the hit-testing.
//
// What that costs is depth. This layer knows nothing of the terrain, the buildings, the
// shadows or the fog, so a panel cannot be hidden behind a hill or a roof. Two cheap
// halves of the problem are dealt with here - a panel goes out past a few dozen paces,
// and it goes out when you are standing behind it - and the expensive half, punching a
// hole in the canvas where the glass is, is not. Stand a panel beside a house and walk
// around it: what you see is the whole of the limitation, and it is the thing to know
// before panels go up inside a room.
//
// Two rules of pointer-events hold this together, and breaking either is silent:
//   - the container is `none`, or it swallows every drag and click meant for the island;
//   - a panel's own element is `auto` only while it is being worked, which is nothing
//     yet - a panel you cannot use should not be taking the mouse off OrbitControls.
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { panelFace } from './props.js';
import { createFace } from './faces.js';

// How big a face is in its own pixels. Far more than a panel is ever drawn at on screen,
// which is what keeps it sharp when you walk up to it, and the same 16:10 as the board
// it hangs on so nothing has to letterbox.
const FACE_W = 960;
const FACE_H = 600;

// Past this a panel is a smudge that still costs a composited layer, so it stops being
// drawn. It also settles what a panel looks like from the sky: from up there the camera
// is a hundred units out, so there is nothing to see.
const MAX_DIST = 34;

export function createPanels({ camera, terrain, island, element }) {
  const css = new CSS3DRenderer(element ? { element } : {});
  css.setSize(innerWidth, innerHeight);
  // The one rule that keeps the island usable. Without it this layer lies over the whole
  // canvas and OrbitControls, the walk drag and the picking all stop working - with no
  // error anywhere to say why.
  css.domElement.style.pointerEvents = 'none';

  // Its own scene: the WebGL renderer has no business walking over a tree of objects it
  // cannot draw, and this one only ever holds panels.
  const scene = new THREE.Scene();
  const records = new Map();     // id -> { spec, object, face }
  let shown = true;

  function add(p) {
    const face = createFace(p.face || 'notice', { prop: p, island });
    const el = document.createElement('div');
    el.className = 'panel3d';
    el.style.width = `${FACE_W}px`;
    el.style.height = `${FACE_H}px`;
    // Not `auto`: nothing on a panel can be worked yet, and a panel that takes the mouse
    // while it cannot use it is the worst of both.
    el.style.pointerEvents = 'none';
    el.appendChild(face.el);

    const object = new CSS3DObject(el);
    place(object, p);
    scene.add(object);
    records.set(p.id, { spec: p, object, face });
  }

  // Where the glass sits: the board's own sums, turned and scaled with the prop, and
  // stood on the same ground props.js stands the woodwork on.
  function place(object, p) {
    const f = panelFace(p);
    const scale = p.scale || 1;
    const rot = p.rot || 0;
    const s = Math.sin(rot), c = Math.cos(rot);
    const ground = terrain.worldHeight(p.x, p.z) - 0.03;
    object.position.set(p.x + s * f.z * scale, ground + f.y * scale, p.z + c * f.z * scale);
    object.rotation.set(0, rot, 0);
    object.scale.setScalar((f.w * scale) / FACE_W);
  }

  function remove(id) {
    const rec = records.get(id);
    if (!rec) return;
    scene.remove(rec.object);      // CSS3DObject takes its element out of the page itself
    if (rec.face.dispose) rec.face.dispose();
    records.delete(id);
  }

  // The same diff props.js does, over the same list: everything that is not a panel is
  // somebody else's business.
  function apply(list) {
    const seen = new Set();
    for (const p of list || []) {
      if (p.kind !== 'panel') continue;
      seen.add(p.id);
      const rec = records.get(p.id);
      if (!rec) { add(p); continue; }
      if (JSON.stringify(rec.spec) !== JSON.stringify(p)) { remove(p.id); add(p); }
    }
    for (const id of [...records.keys()]) if (!seen.has(id)) remove(id);
  }

  const toCamera = new THREE.Vector3();
  const facing = new THREE.Vector3();

  function update(dt) {
    for (const rec of records.values()) {
      toCamera.subVectors(camera.position, rec.object.position);
      const rot = rec.spec.rot || 0;
      facing.set(Math.sin(rot), 0, Math.cos(rot));
      // In front of the board and near enough to read. The dot product is the whole of
      // the back-face test: walk round behind a panel and the page stops being drawn,
      // instead of hanging in the air the wrong way round.
      const visible = shown && toCamera.lengthSq() < MAX_DIST * MAX_DIST && toCamera.dot(facing) > 0;
      rec.object.visible = visible;
      if (visible && rec.face.update) rec.face.update(dt);
    }
  }

  // Indoors there is an entirely different scene on the screen, and a panel standing out
  // on the island has no business floating through the wall of a room.
  function setVisible(v) { shown = !!v; }

  function render() { css.render(scene, camera); }
  function resize() { css.setSize(innerWidth, innerHeight); }

  function dispose() {
    for (const id of [...records.keys()]) remove(id);
  }

  return { apply, update, render, resize, setVisible, dispose, count: () => records.size };
}
