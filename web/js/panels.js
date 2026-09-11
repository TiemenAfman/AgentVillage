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
// Nothing on this layer ever takes a pointer event - not the container, not a panel.
// The container must not, or it swallows every drag and click meant for the island. The
// panels must not because the browser will not aim them anyway; see aim() below, which
// does that job with the raycaster instead.
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { panelFace } from './props.js';
import { createFace } from './faces.js';

// How big a face is in its own pixels: the same 16:10 as the board it hangs on, so
// nothing has to letterbox, and comfortably more than a panel is drawn at on screen,
// which is what keeps it sharp when you walk up to one. These are also the units the
// type in web/css/panels.css is sized in - halve them and every letter on a board gets
// twice as big.
const FACE_W = 480;
const FACE_H = 300;

// Past this a panel is a smudge that still costs a composited layer, so it stops being
// drawn. It also settles what a panel looks like from the sky: from up there the camera
// is a hundred units out, so there is nothing to see.
const MAX_DIST = 34;

// How close you have to be for E to reach the board. A little further than a door, since
// a panel is something you stand in front of rather than walk into.
const REACH = 2.4;

// Why the mouse is aimed by hand.
//
// Chrome draws a CSS3D panel perfectly and then declines to hit-test it once it fills
// much of the view. Measured here, on a board 1.5 wide: a click lands while the camera
// is further away than roughly two and a half board-widths and falls straight through
// to the canvas below that - which is every distance anyone actually stands at to read
// one. There is no error and nothing in the console; the page simply stops answering.
//
// So the panels take no pointer events at all and the aiming is done here, with the
// raycaster the island already has. It is more code than `pointer-events: auto`, but it
// behaves the same at every distance, which that does not.

// One square metre of nothing, shared by every board: scaled to the face's own pixels
// and hung inside the CSS object, so it stands exactly where the glass does and its uv
// reads straight off as a position on the page.
const GLASS = new THREE.PlaneGeometry(1, 1);

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
  const records = new Map();     // id -> { spec, object, el, face, glass }
  let shown = true;
  let held = null;               // the record somebody is standing at and working

  function add(p) {
    const face = createFace(p.face || 'notice', { prop: p, island });
    const el = document.createElement('div');
    el.className = 'panel3d';
    el.style.width = `${FACE_W}px`;
    el.style.height = `${FACE_H}px`;
    // CSS3DObject sets `auto` on everything it is handed, and that has to go back: this
    // layer never takes a pointer event, at any distance. press() aims it instead.
    el.style.pointerEvents = 'none';
    el.appendChild(face.el);

    const object = new CSS3DObject(el);
    const glass = new THREE.Mesh(GLASS);
    glass.scale.set(FACE_W, FACE_H, 1);   // the object's own scale takes it back to metres
    object.add(glass);
    place(object, p);
    scene.add(object);
    records.set(p.id, { spec: p, object, el, face, glass });
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
    if (rec === held) release();
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

  // Stepping up to a board. From here the mouse is aimed at it by press(), and through
  // walk.js the keyboard is the page's: a button can be clicked and a field typed into.
  function take(id) {
    release();
    const rec = records.get(id);
    if (!rec) return false;
    held = rec;
    rec.el.classList.add('worked');
    return true;
  }

  function release() {
    if (!held) return;
    held.el.classList.remove('worked');
    hover(null);
    // A field left focused would keep every keystroke after you have walked away.
    if (held.el.contains(document.activeElement) && document.activeElement.blur) document.activeElement.blur();
    held = null;
  }

  // What walk mode needs to know to put E over a board: where it stands, how close you
  // have to be, and what to call it in the prompt.
  function interactables() {
    const out = [];
    for (const rec of records.values()) {
      const p = rec.spec;
      const what = p.label || 'the board';
      out.push({
        id: p.id, kind: 'panel', x: p.x, z: p.z, r: REACH,
        label: what, prompt: `step up to ${what}`,
      });
    }
    return out;
  }

  // ------------------------------------------------------------ aiming the mouse
  // A corner of the page nobody sees, where a face can be laid flat for the one
  // synchronous moment it takes to ask the browser what is at a point on it. Nothing is
  // painted in between, so the board never flickers.
  const bench = document.createElement('div');
  bench.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;opacity:0;z-index:2147483647;';
  document.body.appendChild(bench);

  const ray = new THREE.Raycaster();
  let hovered = null;

  // Where on the held board the pointer is, in the face's own pixels, or null when it
  // is not on the board at all. `pointer` is the same normalised vector the island's
  // picking uses.
  function aim(pointer) {
    if (!held) return null;
    held.object.updateWorldMatrix(true, false);
    held.glass.updateWorldMatrix(true, false);
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObject(held.glass, false)[0];
    if (!hit || !hit.uv) return null;
    return { x: hit.uv.x * FACE_W, y: (1 - hit.uv.y) * FACE_H };
  }

  // Which element of the face is at that point. The face goes to the bench, loses its
  // 3D transform, is asked, and goes back - all before the browser paints again.
  function elementAt(at) {
    const el = held.el;
    const home = el.parentNode, next = el.nextSibling;
    const transform = el.style.transform;
    bench.appendChild(el);
    el.style.transform = 'none';
    const found = document.elementFromPoint(at.x, at.y);
    el.style.transform = transform;
    if (home) home.insertBefore(el, next); else el.remove();
    return found && el.contains(found) ? found : null;
  }

  // :hover cannot fire on a page the mouse never actually enters, and a button that
  // does not light up reads as a picture of a button. So it is put on by hand.
  function hover(el) {
    if (hovered === el) return;
    if (hovered) hovered.classList.remove('under');
    hovered = el;
    if (hovered) hovered.classList.add('under');
  }

  // Both called from the island's own pointer handlers, and both answer whether the
  // board took it - so a click meant for a panel never also picks a building behind it.
  function point(pointer) {
    const at = held && aim(pointer);
    hover(at ? elementAt(at) : null);
    return !!at;
  }

  function press(pointer) {
    const at = held && aim(pointer);
    if (!at) return false;
    const el = elementAt(at);
    // Focus first: it is what makes a field take the keys walk.js has just let go of.
    if (el && el.focus) el.focus();
    if (el && el.click) el.click();
    return true;
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
  function setVisible(v) {
    shown = !!v;
    if (!shown) release();
  }

  function render() { css.render(scene, camera); }
  function resize() { css.setSize(innerWidth, innerHeight); }

  function dispose() {
    for (const id of [...records.keys()]) remove(id);
    bench.remove();
  }

  return { apply, update, render, resize, setVisible, take, release, point, press, interactables, dispose, count: () => records.size };
}
