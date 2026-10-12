// Where a skinned resident can be seen into: every outfit the wardrobe can put together, posed and
// drawn into a small depth buffer from all round, and every pixel whose nearest surface is the
// *inside* of something (a back face) counted. The crowd's material is double-sided, so such a
// pixel is the inside of a shirt or a skirt seen through a gap - skin cut away where no cloth covers
// it, a seam that opens as a knee bends, a garment that falls short of the next. Pure arithmetic over
// the bake (web/js/residents-mesh.js) and the pose code (web/js/resident-skin.js poseJoints,
// web/js/resident-poses.js residentPose), so the bench below and tests/resident-holes.test.mjs
// measure exactly what the island draws.
import { RESIDENTS } from '../../web/js/residents-mesh.js';
import { poseJoints, createPose, clearPose, POSE_FLOATS, SKIN_COMBOS } from '../../web/js/resident-skin.js';
import { residentPose } from '../../web/js/resident-poses.js';

// What the wardrobe can put together (shared/palette.mjs residentWardrobe): a shirt or (a woman's) a
// dress; trousers or (a woman's) a skirt under the shirt; shoes or clogs; nothing, a vest or an apron
// over; a scarf or not. Hair and hats sit on the head and are left out: a hole is a body's.
export function outfits() {
  const out = [];
  for (const sex of ['male', 'female']) {
    const tops = sex === 'female' ? ['shirt', 'dress'] : ['shirt'];
    for (const top of tops) {
      const bottoms = top === 'dress' ? [null] : sex === 'female' ? ['trousers', 'skirt'] : ['trousers'];
      for (const bottom of bottoms) {
        for (const feet of ['shoes', 'clogs']) {
          for (const over of [null, 'vest', 'apron']) {
            for (const scarf of [false, true]) {
              out.push({ sex, top, bottom, feet, over, scarf, skin: top === 'dress' || bottom === 'skirt' ? 'skirt' : 'trousers' });
            }
          }
        }
      }
    }
  }
  return out;
}

export function outfitName(o) {
  return [o.sex, o.top, o.bottom, o.feet, o.over, o.scarf && 'scarf'].filter(Boolean).join(' ');
}

// The parts an outfit is drawn with, as the crowd draws them (settler-figures.js skinnedFigureGeometry):
// the skin's always-shown part and the bare pieces this outfit shows, then every garment.
export function partsOf(o) {
  const all = RESIDENTS[o.sex].parts;
  const show = `${o.skin}/${o.feet}`;
  const skin = all.filter((p) => p.kind === 'skin' && p.shows.includes(show));
  const ids = [o.top, o.bottom, o.feet, o.over, o.scarf && 'scarf'].filter(Boolean);
  return [...skin, ...ids.map((id) => all.find((p) => p.id === id)).filter(Boolean)];
}

// The poses a resident spends their day in: standing, the walk at four moments, a run, a chore's
// crouch, sitting at a table, a drink. `s` is what settler-figures.js draw() hands residentPose.
export const POSES = {
  stand: { legL: 0, legR: 0, left: 0.04, right: -0.04, anim: 'still' },
  walk0: { legL: 0, legR: 0, left: 0, right: 0, gait: 0, anim: 'walk' },
  walk1: { legL: 0.48, legR: -0.48, left: -0.48 * 0.8, right: 0.48 * 0.8, gait: Math.PI / 2, anim: 'walk' },
  walk3: { legL: -0.48, legR: 0.48, left: 0.48 * 0.8, right: -0.48 * 0.8, gait: 3 * Math.PI / 2, anim: 'walk' },
  run: { legL: 0.72, legR: -0.72, left: -0.6, right: 0.6, gait: Math.PI / 2, fast: true, anim: 'walk' },
  crouch: { legL: -0.25, legR: 0.18, left: -0.6, right: -0.6, anim: 'gather', work: {} },
  sit: { legL: -0.05, legR: 0.05, left: 0, right: 0, seat: { h: 0.16, rest: 0 }, sitBob: 0, anim: 'sit' },
  drink: { legL: 0, legR: 0, left: 0.04, right: 0, drunk: { w: 1 }, anim: 'still' },
};

// Every corner of a part posed: the two joints' matrices blended by the first one's weight.
function posed(part, joints) {
  const n = part.positions.length / 3, out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = part.joints[i * 2] * 12, b = part.joints[i * 2 + 1] * 12, w = part.weights[i];
    const x = part.positions[i * 3], y = part.positions[i * 3 + 1], z = part.positions[i * 3 + 2];
    for (let k = 0; k < 3; k++) {
      const ra = a + k * 4, rb = b + k * 4;
      const va = joints[ra] * x + joints[ra + 1] * y + joints[ra + 2] * z + joints[ra + 3];
      const vb = joints[rb] * x + joints[rb + 1] * y + joints[rb + 2] * z + joints[rb + 3];
      out[i * 3 + k] = va * w + vb * (1 - w);
    }
  }
  return out;
}

export function posedParts(o, poseName) {
  const rig = RESIDENTS[o.sex].rig;
  const P = clearPose(createPose());
  const s = { ...POSES[poseName], sex: o.sex, scale: 1 };
  residentPose(P, s, rig);
  const joints = poseJoints(rig, P, new Float32Array(POSE_FLOATS));
  return partsOf(o).map((p) => ({ id: p.id, pos: posed(p, joints) }));
}

// Views from all round: twelve bearings level, eight from a little above (how the island is mostly
// seen) and four from below (a seated figure's skirt, the camera low on foot).
export const VIEWS = [
  ...Array.from({ length: 12 }, (_, i) => [i * Math.PI / 6, 0]),
  ...Array.from({ length: 8 }, (_, i) => [i * Math.PI / 4 + 0.2, 0.5]),
  ...Array.from({ length: 4 }, (_, i) => [i * Math.PI / 2 + 0.4, -0.35]),
];
export const DEFAULT_RES = 160;            // pixels across the figure's 0.5 units: ~3 mm a pixel

// Draws the parts orthographically from bearing `az` and elevation `el` and counts the pixels that
// are a hole on the island. The crowd's material is front-sided: a back face is not drawn, and what is
// seen there is whatever front face lies behind it. So a pixel is a hole when the nearest surface is a
// back face (the inside of a sleeve, a collar, a boot, a skirt) and no front face lies within GAP behind
// it - the arm in the sleeve, the neck in the collar. Cut skin under cloth leaves exactly that: a
// shirt's hem seen from below shows the inside of its own back, then the sky.
export const GAP = 0.02;
// Skin this close in front of cloth (units; ~4 mm) has come through it rather than lying over it.
export const POKE = 0.001;
export function holesFrom(parts, az, el, RES = DEFAULT_RES) {
  const ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el);
  // Camera basis: right r, up u, and the direction d it looks along (towards -d is the eye).
  const r = [ca, 0, -sa];
  const d = [-sa * ce, -se, -ca * ce];
  const u = [r[1] * d[2] - r[2] * d[1], r[2] * d[0] - r[0] * d[2], r[0] * d[1] - r[1] * d[0]];
  const front = new Float64Array(RES * RES).fill(Infinity), backD = new Float64Array(RES * RES).fill(Infinity);
  const fOwner = new Int16Array(RES * RES).fill(-1), bOwner = new Int16Array(RES * RES).fill(-1);
  // The nearest front face that is cloth, and the nearest that is skin: skin drawn just in front of
  // cloth is skin come through it (a poke).
  const cloth = new Float64Array(RES * RES).fill(Infinity), skinZ = new Float64Array(RES * RES).fill(Infinity);
  const half = 0.27, mid = 0.22;
  const px = (p) => [((p[0] * r[0] + p[1] * r[1] + p[2] * r[2]) + half) / (2 * half) * RES,
    ((p[0] * u[0] + (p[1] - mid) * u[1] + p[2] * u[2]) + half) / (2 * half) * RES,
    p[0] * d[0] + p[1] * d[1] + p[2] * d[2]];
  parts.forEach((part, pi) => {
    const pos = part.pos;
    for (let t = 0; t < pos.length; t += 9) {
      const A = px([pos[t], pos[t + 1], pos[t + 2]]), B = px([pos[t + 3], pos[t + 4], pos[t + 5]]), C = px([pos[t + 6], pos[t + 7], pos[t + 8]]);
      const area = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
      if (Math.abs(area) < 1e-9) continue;
      const zs = area < 0 ? backD : front, own = area < 0 ? bOwner : fOwner;
      const kind = area < 0 ? null : part.id.startsWith('skin') ? skinZ : cloth;
      const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]))), x1 = Math.min(RES - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
      const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]))), y1 = Math.min(RES - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const qx = x + 0.5, qy = y + 0.5;
          const w0 = ((B[0] - qx) * (C[1] - qy) - (B[1] - qy) * (C[0] - qx)) / area;
          const w1 = ((C[0] - qx) * (A[1] - qy) - (C[1] - qy) * (A[0] - qx)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * A[2] + w1 * B[2] + w2 * C[2];
          const k = y * RES + x;
          if (z < zs[k]) { zs[k] = z; own[k] = pi; }
          if (kind && z < kind[k]) kind[k] = z;
        }
      }
    }
  });
  const by = {};
  const owner = new Int16Array(RES * RES).fill(-1), back = new Int8Array(RES * RES), depth = new Float64Array(RES * RES);
  let n = 0, cover = 0, pokes = 0;
  const poke = new Int8Array(RES * RES);
  for (let k = 0; k < RES * RES; k++) {
    if (fOwner[k] < 0 && bOwner[k] < 0) continue;
    cover++;
    if (skinZ[k] <= front[k] && cloth[k] - skinZ[k] < POKE) { pokes++; poke[k] = 1; }
    const hole = backD[k] < front[k] && front[k] - backD[k] > GAP;
    owner[k] = hole ? bOwner[k] : fOwner[k];
    depth[k] = hole ? backD[k] : front[k];
    if (hole) { n++; back[k] = 1; const id = parts[owner[k]].id; by[id] = (by[id] || 0) + 1; }
  }
  return { holes: n, cover, pokes, by, owner, back, depth, poke };
}

// One outfit in one pose from every view: back-face pixels over all views, and as a share of the
// figure's drawn pixels.
export function holesOf(o, poseName) {
  const parts = posedParts(o, poseName);
  let holes = 0, cover = 0, pokes = 0;
  const by = {};
  for (const [az, el] of VIEWS) {
    const h = holesFrom(parts, az, el);
    holes += h.holes; cover += h.cover; pokes += h.pokes;
    for (const [id, c] of Object.entries(h.by)) by[id] = (by[id] || 0) + c;
  }
  return { holes, cover, pokes, share: holes / cover, pokeShare: pokes / cover, by };
}

export { SKIN_COMBOS };
