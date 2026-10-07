// A little sign staked in a settler's front yard, carrying the session's own name.
// The post and board are flat-shaded wood; the lettering is a canvas texture, because
// text is the one thing the merged vertex-colour geometry cannot draw.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The frame - legs, beam and board - is one mesh in one material shared by every sign, its
// two woods carried as vertex colours; only the lettered face is per-house. It used to be
// a mesh per piece in two materials, which on a 150-house island was 302 of the 900 calls
// in the colour pass and 302 of the 715 in the shadow pass, for 5,700 triangles
// (Plans/DONE/sneller-tekenen.md). `new THREE.Color(hex)` is the same linear colour a
// material's `color` would have been given, so the wood looks exactly as it did.
const frameMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
const WOOD = new THREE.Color(0x6b4a2f);
const POST = new THREE.Color(0x5a3c28);
function painted(geo, colour, x, y, z) {
  geo.translate(x, y, z);
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colour.toArray(c, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

const SUNK = 0.2;
const BOARD_W = 0.86;
const BOARD_H = 0.34;
const CANVAS_W = 512;

function draw(text, boardW, boardH, canvasW, band, sub = null) {
  const CANVAS_H = Math.round(canvasW * boardH / boardW);     // keep the plaque's aspect ratio
  const c = document.createElement('canvas');
  c.width = canvasW;
  c.height = CANVAS_H;
  const g = c.getContext('2d');
  const CANVAS_W = canvasW;

  // a painted plaque: cream field, routed dark border
  g.fillStyle = '#f3e7cf';
  g.fillRect(0, 0, CANVAS_W, CANVAS_H);
  g.fillStyle = '#e8d8b6';
  g.fillRect(0, 0, CANVAS_W, 10);
  g.strokeStyle = '#5a3c28';
  g.lineWidth = 14;
  g.strokeRect(7, 7, CANVAS_W - 14, CANVAS_H - 14);

  // A hamlet's sign carries its own colour as a band across the top, so two neighbours
  // are told apart at a glance. The hue never goes in the geometry - the board itself is
  // one shared mesh.
  if (band != null) {
    g.fillStyle = `hsl(${band} 52% 46%)`;
    g.fillRect(7, 7, CANVAS_W - 14, Math.round(CANVAS_H * 0.12));
  }

  const words = String(text || 'Untitled session').trim().split(/\s+/);
  const maxW = CANVAS_W - 52;
  g.fillStyle = '#3a2a1a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';

  // Fit in one or two lines, shrinking the type until it fits the board.
  const top = band != null ? Math.round(CANVAS_H * 0.12) : 0;
  // A gateway with more than one entrance says which on the same board: the name above, in
  // the space the band leaves, and one small line under it. The name is then fitted to the
  // height it has left as well as to the width.
  const subH = sub ? Math.round(CANVAS_H * 0.3) : 0;
  const availH = CANVAS_H - top - subH - (sub ? 8 : 0);
  const start = Math.round(62 * (CANVAS_W / 512));
  for (let size = start; size >= 14; size -= 2) {
    g.font = `600 ${size}px "Iowan Old Style", "Palatino Linotype", Georgia, serif`;
    const lines = wrap(g, words, maxW);
    if (lines.length <= 2 && lines.every((l) => g.measureText(l).width <= maxW)
      && (!sub || lines.length * size * 1.12 <= availH)) {
      const lh = size * 1.12;
      const y0 = (top + availH / 2) + (sub ? 0 : (CANVAS_H - top - availH) / 2) - (lines.length - 1) * lh / 2;
      lines.forEach((l, i) => g.fillText(l, CANVAS_W / 2, y0 + i * lh));
      break;
    }
  }
  if (sub) {
    // Smaller, a shade lighter, ruled off from the name.
    g.strokeStyle = '#b89f78';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(CANVAS_W * 0.2, CANVAS_H - 14 - subH * 1.05);
    g.lineTo(CANVAS_W * 0.8, CANVAS_H - 14 - subH * 1.05);
    g.stroke();
    g.fillStyle = '#6b4a2f';
    let size = Math.round(subH * 0.78);
    for (; size > 12; size -= 2) {
      g.font = `600 ${size}px "Iowan Old Style", "Palatino Linotype", Georgia, serif`;
      if (g.measureText(sub).width <= maxW) break;
    }
    g.fillText(sub, CANVAS_W / 2, CANVAS_H - 14 - subH / 2);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

// Greedy wrap into at most two lines; a single word longer than the board is truncated.
function wrap(g, words, maxW) {
  const lines = [];
  let line = '';
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w;
    if (g.measureText(trial).width > maxW && line) { lines.push(line); line = w; }
    else line = trial;
    if (lines.length === 1 && g.measureText(line).width > maxW) break;
  }
  if (line) lines.push(line);
  if (lines.length > 2) {
    let last = lines[1];
    while (g.measureText(`${last}…`).width > maxW && last.length > 1) last = last.slice(0, -1);
    return [lines[0], `${last}…`];
  }
  return lines;
}

// The legs, the beam and the board, as one geometry in the sign's own frame.
function frameGeometry({ s, width, height, boardY, arch, n, boardAt }) {
  const grow = Math.sqrt(width / BOARD_W);
  const span = arch ? arch / 2 : width * s * 0.42;
  const legH = arch ? boardY + height * s + 0.12 : boardY + 0.04;
  const pieces = [];
  for (let i = 0; i < n; i++) {
    const r = arch ? 0.045 : 0.022 * grow;
    // A gateway's posts are sunk a hand into the ground: the two stand on cells that may differ a
    // little in height, and the shorter side must not hang in the air.
    const sunk = arch ? SUNK : 0;
    pieces.push(painted(new THREE.CylinderGeometry(r, r * 1.25, legH + sunk, 6), POST,
      n === 1 ? 0 : (i === 0 ? -1 : 1) * span, (legH - sunk) / 2, 0));
  }
  if (arch) {
    // The beam overhangs its posts a little, the way a real one is pegged on top.
    pieces.push(painted(new THREE.BoxGeometry(arch + 0.22, 0.1, 0.13), POST, 0, legH + 0.05, 0));
  }
  pieces.push(painted(new THREE.BoxGeometry(width * s, height * s, 0.03), WOOD, 0, boardAt, 0));
  const geo = mergeGeometries(pieces, false);
  pieces.forEach((g) => g.dispose());
  return geo;
}

// The same frame in the shape an island's batch of buildings takes (web/js/record-batch.js):
// non-indexed and with the building material's attributes. With nothing on a sheet and
// nothing lit, the building material draws it exactly as frameMat does - both flat-shaded
// vertex colour at roughness 0.85 - so a sign in the batch looks as it always did.
function batchable(geo) {
  const flat = geo.toNonIndexed();
  geo.dispose();
  flat.deleteAttribute('uv');
  flat.setAttribute('aEmissive', new THREE.BufferAttribute(new Float32Array(flat.attributes.position.count), 1));
  return flat;
}

// A staked yard sign carrying `text`, its face toward local +z (the door/street side).
// `arch` turns the sign into a gateway: the posts stand a road's width apart and carry a
// beam, and the board hangs beneath it, so you read the name as you walk under it rather
// than passing a placard in a field. Signs are not blockers, so walking through needs no
// collision work - the arch only has to be tall enough to look walkable.
//
// `batch` (a record batch, web/js/record-batch.js) puts the frame into it instead of giving it
// a mesh of its own. The yard signs were 395 frames on Hoogezand, a call each in both passes -
// as many as half the buildings. There are only as many frame shapes as there are option sets
// (a house's and a camp's), so every sign of one shape is an instance of one geometry. The
// lettered face stays a mesh: its canvas is the sign's own (Plans/DONE/gebouwen-in-een-batch.md).
export function createNameplate(text, {
  small = false, width = BOARD_W, height = BOARD_H, canvasW = CANVAS_W, band = null,
  height0 = 0.42, posts = 1, arch = 0, batch = null, sub = null, subBack = sub,
} = {}) {
  const s = small ? 0.7 : 1;
  const group = new THREE.Group();
  const boardY = height0 * s;
  const n = arch ? 2 : posts;
  const bw = width * s, bh = height * s;
  const boardAt = boardY + bh / 2 - 0.02;
  const shape = { s, width, height, boardY, arch, n, boardAt };

  let frameGeo = null, frame;
  if (batch) {
    frame = batch.addShared(`nameplate:${s}:${width}:${height}:${height0}:${n}:${arch}`, () => batchable(frameGeometry(shape)));
  } else {
    frameGeo = frameGeometry(shape);
    frame = new THREE.Mesh(frameGeo, frameMat);
    frame.castShadow = true;
  }
  group.add(frame);

  const tex = draw(text, width, height, canvasW, band, sub);
  const faceMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(bw * 0.94, bh * 0.86), faceMat);
  face.position.set(0, boardAt, 0.017);
  group.add(face);
  // A gateway is walked through both ways, and a single-sided face left whoever was leaving
  // the hamlet reading bare wood. Only the gateways: a yard sign is one of hundreds. With more
  // than one entrance the two sides say different things under the name - "North entrance" to
  // whoever comes in, "North exit" to whoever goes out - so the back has a canvas of its own.
  let backTex = null;
  if (arch) {
    backTex = subBack === sub ? null : draw(text, width, height, canvasW, band, subBack);
    const back = new THREE.Mesh(face.geometry, backTex ? new THREE.MeshBasicMaterial({ map: backTex, transparent: true }) : faceMat);
    back.position.set(0, boardAt, -0.017);
    back.rotation.y = Math.PI;
    group.add(back);
    if (backTex) group.userData.backMat = back.material;
  }

  group.scale.setScalar(s < 1 ? 1 : 1);   // reserved: keep API stable

  return {
    group,
    dispose() {
      if (batch) batch.remove(frame);
      else frameGeo.dispose();
      face.geometry.dispose();
      faceMat.dispose();
      tex.dispose();
      if (backTex) { group.userData.backMat.dispose(); backTex.dispose(); }
    },
  };
}
