// The HD pack's contract with the bake (Plans/piratenkroeg.md, "The HD pack"): an HD model replaces one baked asset
// only if it stands in the asset's own frame - foot on y = 0, front to +z, the same outline within
// HD_FIT. Plain arithmetic on numbers and bytes, no three.js and no node:fs, so the page (which
// checks every model it loads, web/js/hd-pieces.js) and tests/hd-pack.test.mjs (which checks a pack
// before it is handed out) make the one comparison. Like the rest of shared/, no sin or cos: a turn
// is a whole number of quarter turns, which is all a prepared model should need and keeps a box
// exact.

// How far each face of the HD model's box may lie from the bake's: 3 cm of the island's 4 m cells, or
// a tenth of the model's extent along that axis, whichever is more. Generous on purpose - a textured
// model of a drawing is never the hand-built piece vertex for vertex - and still tight enough that a
// KIT spot, a blocker and the camera's boom fitted to the bake stay fitted.
export const HD_FIT = Object.freeze({ abs: 0.03, rel: 0.1 });

// The roles a manifest may give a GLB material by name (web/js/hd-pieces.js applies them).
export const HD_ROLES = Object.freeze(['gilt', 'metal', 'flame']);

const NAME = /^[a-z0-9_]+$/;
const FILE = /^[a-z0-9_-]+\.glb$/i;

// ---- the manifest ------------------------------------------------------------------------------
// HOME/hd/hd-manifest.json. Forgiving about what it does not know (an unknown field is left out,
// so a newer pack's extras do not refuse it), strict about what it uses: a piece with a bad name,
// file or number is dropped whole, said in `skipped`, and the rest of the pack stands.
export function parseHdManifest(raw) {
  const out = { v: 1, pack: null, pieces: [], skipped: [] };
  if (!raw || typeof raw !== 'object' || raw.v !== 1 || !Array.isArray(raw.pieces)) return null;
  if (typeof raw.pack === 'string' && raw.pack.length <= 40) out.pack = raw.pack;
  const seen = new Set();
  for (const p of raw.pieces) {
    const why = pieceProblem(p, seen);
    if (why) { out.skipped.push(`${p && typeof p.asset === 'string' ? p.asset : '?'}: ${why}`); continue; }
    seen.add(p.asset);
    const at = p.at || {};
    const materials = {};
    for (const [name, role] of Object.entries(p.materials || {})) if (HD_ROLES.includes(role)) materials[name] = role;
    out.pieces.push({
      asset: p.asset, file: p.file,
      at: { x: at.x ?? 0, y: at.y ?? 0, z: at.z ?? 0, turn: at.turn ?? 0, s: at.s ?? 1 },
      materials,
      ...(p.roughness != null ? { roughness: p.roughness } : {}),
      ...(p.tone != null ? { tone: p.tone } : {}),
    });
  }
  return out;
}

function pieceProblem(p, seen) {
  if (!p || typeof p !== 'object') return 'not an object';
  if (typeof p.asset !== 'string' || !NAME.test(p.asset)) return 'asset is not a baked asset name';
  if (seen.has(p.asset)) return 'listed twice';
  if (typeof p.file !== 'string' || !FILE.test(p.file)) return 'file is not a bare .glb name';
  const at = p.at ?? {};
  if (typeof at !== 'object') return 'at is not an object';
  for (const k of ['x', 'y', 'z', 's']) if (at[k] != null && !Number.isFinite(at[k])) return `at.${k} is not a number`;
  if (at.s != null && !(at.s > 0)) return 'at.s is not positive';
  if (at.turn != null && !(Number.isInteger(at.turn) && at.turn >= 0 && at.turn <= 3)) return 'at.turn is not 0..3';
  if (p.materials != null && (typeof p.materials !== 'object' || Array.isArray(p.materials))) return 'materials is not a map';
  if (p.roughness != null && !(Number.isFinite(p.roughness) && p.roughness >= 0 && p.roughness <= 1)) return 'roughness is not 0..1';
  if (p.tone != null && !(Number.isInteger(p.tone) && p.tone >= 0 && p.tone <= 0xffffff)) return 'tone is not a colour';
  return null;
}

// ---- boxes -------------------------------------------------------------------------------------
// [minX, minY, minZ, maxX, maxY, maxZ].

// A baked asset's box in its own frame: every part's positions plus the part's `at` (the bake keeps
// positions about each part's Blender origin; web/js/buildings.js meshAsset adds it back).
export function boxOfParts(parts) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    const p = part.positions, [ax, ay, az] = part.at || [0, 0, 0];
    for (let i = 0; i < p.length; i += 3) grow(b, p[i] + ax, p[i + 1] + ay, p[i + 2] + az);
  }
  return b;
}

// A box after the manifest's `at`: scaled by s, turned by `turn` quarter turns about y (the way
// three's rotation.y turns: +x goes to -z), then moved.
export function placeBox(box, { x = 0, y = 0, z = 0, turn = 0, s = 1 } = {}) {
  let [x0, y0, z0, x1, y1, z1] = box.map((v) => v * s);
  for (let k = 0; k < (turn & 3); k++) [x0, z0, x1, z1] = [z0, -x1, z1, -x0];
  return [x0 + x, y0 + y, z0 + z, x1 + x, y1 + y, z1 + z];
}

// Whether `hd` fits `bake`, and by how much the worst face is off (in units, and which face).
export function fitsBake(hd, bake, tol = HD_FIT) {
  const FACES = ['minX', 'minY', 'minZ', 'maxX', 'maxY', 'maxZ'];
  let worst = { face: null, off: 0, allowed: 0 };
  let ok = true;
  for (let i = 0; i < 6; i++) {
    const axis = i % 3;
    const extent = bake[axis + 3] - bake[axis];
    const allowed = Math.max(tol.abs, tol.rel * extent);
    const off = Math.abs(hd[i] - bake[i]);
    if (off > allowed) ok = false;
    if (off - allowed > worst.off - worst.allowed || worst.face === null) worst = { face: FACES[i], off, allowed };
  }
  return { ok, worst };
}

// ---- reading a GLB -----------------------------------------------------------------------------
// Only what the check needs, from the JSON chunk: no mesh is decoded. The box comes from every
// POSITION accessor's min/max (required by the glTF spec) carried through the node transforms;
// triangles from the index or position counts; texture sizes from the PNG/JPEG headers in the
// binary chunk. Throws on anything that is not a glTF 2.0 binary.
export function readGlb(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  if (dv.getUint32(4, true) !== 2) throw new Error('not glTF 2.0');
  let json = null, bin = null;
  for (let off = 12; off + 8 <= u8.byteLength;) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const chunk = u8.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  return { json, bin };
}

export function glbInfo(bytes) {
  const { json, bin } = readGlb(bytes);
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  let tris = 0;
  const meshes = json.meshes || [], nodes = json.nodes || [], acc = json.accessors || [];
  const walk = (i, parent) => {
    const n = nodes[i];
    const m = mul(parent, localMatrix(n));
    if (n.mesh != null) {
      for (const prim of meshes[n.mesh].primitives || []) {
        const a = acc[prim.attributes.POSITION];
        if (!a || !a.min || !a.max) continue;
        for (let c = 0; c < 8; c++) {
          const v = [c & 1 ? a.max[0] : a.min[0], c & 2 ? a.max[1] : a.min[1], c & 4 ? a.max[2] : a.min[2]];
          grow(box, ...apply(m, v));
        }
        if ((prim.mode ?? 4) === 4) tris += (prim.indices != null ? acc[prim.indices].count : a.count) / 3;
      }
    }
    for (const c of n.children || []) walk(c, m);
  };
  const scene = (json.scenes || [])[json.scene ?? 0];
  for (const r of scene ? scene.nodes : nodes.map((_, i) => i)) walk(r, IDENTITY);
  const textures = (json.images || []).map((img) => imageSize(img, json, bin));
  return { box, tris: Math.round(tris), materials: (json.materials || []).length, textures };
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];   // column-major, as glTF

function localMatrix(n) {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation || [0, 0, 0];
  const [qx, qy, qz, qw] = n.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale || [1, 1, 1];
  return [
    (1 - 2 * (qy * qy + qz * qz)) * sx, 2 * (qx * qy + qz * qw) * sx, 2 * (qx * qz - qy * qw) * sx, 0,
    2 * (qx * qy - qz * qw) * sy, (1 - 2 * (qx * qx + qz * qz)) * sy, 2 * (qy * qz + qx * qw) * sy, 0,
    2 * (qx * qz + qy * qw) * sz, 2 * (qy * qz - qx * qw) * sz, (1 - 2 * (qx * qx + qy * qy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
const apply = (m, [x, y, z]) => [
  m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14],
];
function grow(b, x, y, z) {
  if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (z < b[2]) b[2] = z;
  if (x > b[3]) b[3] = x; if (y > b[4]) b[4] = y; if (z > b[5]) b[5] = z;
}

// Width and height of an embedded image, or null when it is not in the binary chunk or not a
// PNG/JPEG/WebP this reads (kitstuk exports WebP: a 2048 colour map as PNG made a RAW 40 MB).
function imageSize(img, json, bin) {
  if (img.bufferView == null || !bin) return null;
  const bv = json.bufferViews[img.bufferView];
  const b = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  if (b[0] === 0x89 && b[1] === 0x50) return { w: be32(b, 16), h: be32(b, 20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { w: (b[i + 7] << 8) | b[i + 8], h: (b[i + 5] << 8) | b[i + 6] };
      }
      i += 2 + len;
    }
  }
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) {         // RIFF....WEBP
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (kind === 'VP8 ') return { w: ((b[27] << 8) | b[26]) & 0x3fff, h: ((b[29] << 8) | b[28]) & 0x3fff };
    if (kind === 'VP8L') return { w: 1 + (((b[22] & 0x3f) << 8) | b[21]), h: 1 + (((b[24] & 0xf) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) };
    if (kind === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  }
  return null;
}
const be32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
