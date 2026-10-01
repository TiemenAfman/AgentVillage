// A minimal glTF 2.0 binary for tests of the HD pack (shared/hdfit.mjs, web/js/hd-pieces.js): one
// node per primitive, each with its own material by name, positions only (and the min/max the spec
// requires), an optional node transform and an optional embedded image header. Enough for
// GLTFLoader and for glbInfo; no texture is ever decoded.
//
// prims: [{ positions: number[], material: 'name', translation?, rotation?, scale? }]
// images: [{ w, h }] - a PNG signature and IHDR only, which is all glbInfo reads.
export function makeGlb(prims, { images = [] } = {}) {
  const chunks = [];
  let offset = 0;
  const view = (bytes) => {
    const pad = (4 - (bytes.byteLength % 4)) % 4;
    const at = offset;
    chunks.push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), new Uint8Array(pad));
    offset += bytes.byteLength + pad;
    return { buffer: 0, byteOffset: at, byteLength: bytes.byteLength };
  };
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [],
    materials: [], accessors: [], bufferViews: [], buffers: [],
  };
  const matIndex = new Map();
  prims.forEach((p, i) => {
    const pos = new Float32Array(p.positions);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < pos.length; k++) { min[k % 3] = Math.min(min[k % 3], pos[k]); max[k % 3] = Math.max(max[k % 3], pos[k]); }
    json.bufferViews.push({ ...view(pos), target: 34962 });
    json.accessors.push({ bufferView: json.bufferViews.length - 1, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max });
    if (!matIndex.has(p.material)) {
      matIndex.set(p.material, json.materials.length);
      json.materials.push({ name: p.material, pbrMetallicRoughness: { baseColorFactor: [0.8, 0.6, 0.4, 1], metallicFactor: 0, roughnessFactor: 0.8 } });
    }
    json.meshes.push({ primitives: [{ attributes: { POSITION: json.accessors.length - 1 }, material: matIndex.get(p.material) }] });
    const node = { mesh: i };
    for (const k of ['translation', 'rotation', 'scale']) if (p[k]) node[k] = p[k];
    json.nodes.push(node);
    json.scenes[0].nodes.push(i);
  });
  if (images.length) json.images = [];
  for (const { w, h } of images) {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(png.buffer).setUint32(16, w);
    new DataView(png.buffer).setUint32(20, h);
    json.bufferViews.push(view(png));
    json.images.push({ bufferView: json.bufferViews.length - 1, mimeType: 'image/png' });
  }
  json.buffers.push({ byteLength: offset });
  const bin = new Uint8Array(offset);
  let at = 0;
  for (const c of chunks) { bin.set(c, at); at += c.byteLength; }
  let text = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (text.byteLength % 4)) % 4;
  if (jpad) { const t = new Uint8Array(text.byteLength + jpad).fill(0x20); t.set(text); text = t; }
  const total = 12 + 8 + text.byteLength + 8 + bin.byteLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, text.byteLength, true); dv.setUint32(16, 0x4e4f534a, true); out.set(text, 20);
  const b = 20 + text.byteLength;
  dv.setUint32(b, bin.byteLength, true); dv.setUint32(b + 4, 0x004e4942, true); out.set(bin, b + 8);
  return out;
}

// Twelve triangles of a box from (x0, y0, z0) to (x1, y1, z1), as a flat position list.
export function boxPositions([x0, y0, z0, x1, y1, z1]) {
  const v = (i) => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
  const faces = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  const out = [];
  for (const [a, b, c, d] of faces) out.push(...v(a), ...v(b), ...v(c), ...v(a), ...v(c), ...v(d));
  return out;
}
