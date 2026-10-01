// The HD pack (Plans/piratenkroeg.md, "The HD pack"): textured models, made with Pixal3D on the keeper's machine,
// that stand in for baked kit pieces in a room. The pack lives in HOME/hd/ (an hd-manifest.json
// and its GLBs), never in the repository, a release folder or the app, and only the keeper's own
// page reads it (`/api/hd`, not on PUBLIC_API). Without it - on the phone, for a visitor, before
// the manifest has arrived - every room is exactly the bake.
//
// It keeps the lava imp's and the captain's rules (imp.js, captain.js): the manifest is asked for
// after the boot, a model only when a room that has its piece is built with HD wanted or HD is
// switched on in one, GLTFLoader is imported dynamically, nothing ever waits on any of it, and a
// failure is said once and leaves the bake standing. A model that does not fit its bake's box
// (shared/hdfit.mjs HD_FIT) counts as a failure: the KIT spot, the blockers and the camera's boom
// are all fitted to the bake, so an HD piece of another shape would stand in them wrong.
//
// How a room uses it (interior.js): a kit piece the pack lists is left out of the room's one merged
// mesh and drawn as its own (`createHdPieces`), so that showing one or the other is visibility on
// two siblings - which is what lets Settings -> Graphics switch a room that is already built.
import * as THREE from 'three';
import { mine, mineUrl } from './api.js';
import * as models from './models.js';
import { mergeParts } from './buildings.js';
import { createHalos, halosOf } from './room-glow.js';
import { parseHdManifest, boxOfParts, fitsBake } from 'shared/hdfit.mjs';

let manifest = null;
let asking = null;

// Ask the islander once what the pack holds. Called after the boot (main.js, beside the imp); a
// refusal, a 404 from an islander older than the routes, or the phone (where mine() refuses) all
// mean "no pack". Resolves to the parsed manifest or null, never throws.
export function loadHdManifest() {
  if (!asking) {
    asking = mine('/api/hd')
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => {
        manifest = raw && raw.installed !== false ? parseHdManifest(raw) : null;
        for (const s of manifest?.skipped || []) console.warn(`hd pack: piece left out - ${s}`);
        return manifest;
      })
      .catch(() => null);
  }
  return asking;
}

export const hdInstalled = () => !!(manifest && manifest.pieces.length);
export const hdPieceOf = (asset) => (manifest && manifest.pieces.find((p) => p.asset === asset)) || null;
// For Settings -> Graphics: which pack, how many pieces, or null for none.
export const hdStatus = () => (manifest ? { pack: manifest.pack, pieces: manifest.pieces.length } : null);

// ---- one model per asset, loaded once ----------------------------------------------------------
const templates = new Map();   // asset -> { ready: Promise, holder, flames } | { failed: true }

// The flames' middles, in the model's frame: a flame primitive is many small drops, gathered by
// where they stand - across, not in 3D, because a drop is twice as tall as it is wide and by
// distance alone each fell into three or four pieces (candlebarrel.js's trial: 56 halos for ten
// flames, the barrel a ball of fire).
function flameCentres(geometry, matrix) {
  const p = geometry.attributes.position, out = [], v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(matrix);
    const c = out.find((k) => Math.hypot(k.s[0] / k.n - v.x, k.s[2] / k.n - v.z) < 0.015 && Math.abs(k.s[1] / k.n - v.y) < 0.04);
    if (c) { c.s[0] += v.x; c.s[1] += v.y; c.s[2] += v.z; c.n++; } else out.push({ s: [v.x, v.y, v.z], n: 1 });
  }
  return out.map((c) => new THREE.Vector3(c.s[0] / c.n, c.s[1] / c.n, c.s[2] / c.n));
}

// Something to reflect for a metal part: a room's scene has no environment, and metal with nothing
// to mirror reads black. An equirectangular room of dark warm wood with a band of lamplight and a
// few lamps in it; three makes the PMREM of it the first time it is drawn. One for every HD piece.
let roomEnv = null;
function warmRoom() {
  if (roomEnv) return roomEnv;
  const w = 64, h = 32, data = new Float32Array(w * h * 4);
  const lamps = [[8, 14], [22, 12], [37, 15], [51, 13], [30, 4]];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const band = Math.exp(-(((y - 13) / 5) ** 2));
      let r = 0.05 + 0.5 * band, g = 0.03 + 0.3 * band, b = 0.015 + 0.12 * band;
      for (const [lx, ly] of lamps) {
        const d2 = (Math.min(Math.abs(x - lx), w - Math.abs(x - lx)) ** 2 + (y - ly) ** 2) / 4;
        const k = 6 * Math.exp(-d2);
        r += k; g += 0.7 * k; b += 0.35 * k;
      }
      data.set([r, g, b, 1], (y * w + x) * 4);
    }
  }
  roomEnv = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  roomEnv.mapping = THREE.EquirectangularReflectionMapping;
  roomEnv.needsUpdate = true;
  return roomEnv;
}

const GOLD = [1.0, 0.76, 0.36];
const FLAME = 0xffd23a, FLAME_GLOW = 0xffb040;
// room-glow.js halosOf's size for a flame; fainter than its 0.5, because a model's flames tend to
// stand within a hand of each other and their halos add up.
const HALO = { size: 0.28, strength: 0.3, hex: 0xffb050 };

// The GLB put into its bake's frame (the manifest's `at`), measured against the bake, and its
// materials given their roles. Throws when it does not fit.
export function prepareHd(root, piece) {
  const { x, y, z, turn, s } = piece.at;
  const holder = new THREE.Group();
  holder.name = `hd:${piece.asset}`;
  root.scale.multiplyScalar(s);
  root.rotation.y += (turn * Math.PI) / 2;
  root.position.set(x, y, z);
  holder.add(root);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  const bake = boxOfParts(models.assetParts(piece.asset).map(models.part).filter(Boolean));
  if (!Number.isFinite(bake[0])) throw new Error(`there is no baked ${piece.asset} to stand in for`);
  const fit = fitsBake([box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z], bake);
  if (!fit.ok) {
    throw new Error(`does not fit the bake: ${fit.worst.face} off by ${fit.worst.off.toFixed(3)} (allowed ${fit.worst.allowed.toFixed(3)})`);
  }
  const flames = [];
  const tone = piece.tone != null ? new THREE.Color(piece.tone) : null;
  const toned = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = false;       // rooms have no shadow pass
    for (const m of [].concat(o.material)) {
      m.fog = true;
      const role = piece.materials[m.name];
      if (role === 'flame') {
        if (m.color) m.color.setHex(FLAME);
        if (m.emissive) { m.emissive.setHex(FLAME_GLOW); m.emissiveIntensity = 1.6; }
        flames.push(...flameCentres(o.geometry, o.matrixWorld));
        continue;
      }
      if (role === 'gilt' || role === 'metal') {
        if (role === 'gilt' && m.color) m.color.setRGB(...GOLD);
        m.metalness = 1;
        m.roughness = piece.roughness ?? 0.38;
        m.envMap = warmRoom();
        m.envMapIntensity = 1.4;
      }
      // A texture that comes out lighter or darker than the bakes beside it, set by eye in the hall.
      if (tone && m.color && !toned.has(m)) { m.color.multiply(tone); toned.add(m); }
    }
  });
  return { holder, flames };
}

// The asset's model: { holder, flames } once it has landed, null while it loads or after it failed.
// `onReady` is called once it lands (never when it fails).
function hdModel(piece, onReady) {
  let t = templates.get(piece.asset);
  if (!t) {
    t = {};
    t.ready = import('three/addons/loaders/GLTFLoader.js')
      .then(({ GLTFLoader }) => new GLTFLoader().loadAsync(mineUrl(`/api/hd/${encodeURIComponent(piece.file)}`)))
      .then((gltf) => { Object.assign(t, prepareHd(gltf.scene, piece)); return t; })
      .catch((e) => {
        t.failed = true;
        console.warn(`hd pack: ${piece.file} stays the bake (${piece.asset}) - ${e.message || e}`);
        return null;
      });
    templates.set(piece.asset, t);
  }
  if (t.holder) return t;
  if (!t.failed && onReady) t.ready.then((r) => { if (r) onReady(r); });
  return null;
}

// ---- in a room ---------------------------------------------------------------------------------
// `pieces` is what the room left out of its merge: [{ asset, at: { x, y, z, ry }, roof, geoms }],
// one per placement (seven stools are seven). `scene` takes the floor's pieces, `roof` (an Object3D
// shown and hidden with the room's lid) the ones that hang from it. Both versions of a piece stand
// as siblings; `setDetail(hd)` decides which is seen.
export function createHdPieces({ scene, roof = scene, pieces, material, hd = false }) {
  const placed = pieces.map((p) => {
    const parent = p.roof ? roof : scene;
    const sd = new THREE.Group();
    sd.name = `sd:${p.asset}`;
    sd.add(new THREE.Mesh(mergeParts(p.geoms), material));
    const glow = halosOf(p.geoms);
    const sdHalos = glow.length ? createHalos(glow) : null;
    if (sdHalos) sd.add(sdHalos.object);
    parent.add(sd);
    return { ...p, parent, sd, sdHalos, hd: null, hdHalos: null };
  });
  let want = false;

  // Raise one placement's HD copy: the model shares its geometry and materials with every other.
  function raise(pl, t) {
    const h = t.holder.clone(true);
    h.position.set(pl.at.x || 0, pl.at.y || 0, pl.at.z || 0);
    h.rotation.y = pl.at.ry || 0;
    h.updateMatrix();
    pl.hd = h;
    pl.parent.add(h);
    if (t.flames.length) {
      pl.hdHalos = createHalos(t.flames.map((c) => {
        const w = c.clone().applyMatrix4(h.matrix);
        return { at: [w.x, w.y + 0.01, w.z], ...HALO };
      }));
      pl.parent.add(pl.hdHalos.object);
    }
  }

  function show() {
    for (const pl of placed) {
      if (want && !pl.hd) {
        const piece = hdPieceOf(pl.asset);
        const t = piece && hdModel(piece, () => show());
        if (t) raise(pl, t);
      }
      const hdOn = want && !!pl.hd;
      pl.sd.visible = !hdOn;
      if (pl.hd) pl.hd.visible = hdOn;
      if (pl.hdHalos) pl.hdHalos.object.visible = hdOn;
    }
  }

  function setDetail(on) { want = !!on; show(); }
  setDetail(hd);

  return {
    setDetail,
    update(t) {
      for (const pl of placed) {
        if (pl.sdHalos && pl.sd.visible) pl.sdHalos.update(t);
        if (pl.hdHalos && pl.hd && pl.hd.visible) pl.hdHalos.update(t);
      }
    },
    // The model itself is kept for the page, like the captain: a room is built once.
    dispose() {
      for (const pl of placed) {
        pl.sd.children[0].geometry.dispose();
        if (pl.sdHalos) pl.sdHalos.dispose();
        if (pl.hdHalos) pl.hdHalos.dispose();
      }
    },
  };
}
