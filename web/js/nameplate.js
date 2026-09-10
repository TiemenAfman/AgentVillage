// A little sign staked in a settler's front yard, carrying the session's own name.
// The post and board are flat-shaded wood; the lettering is a canvas texture, because
// text is the one thing the merged vertex-colour geometry cannot draw.
import * as THREE from 'three';

// The frame and legs are shared across every sign — only the lettered face is per-house.
const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, flatShading: true, roughness: 0.85 });
const postMat = new THREE.MeshStandardMaterial({ color: 0x5a3c28, flatShading: true, roughness: 0.85 });

const BOARD_W = 0.86;
const BOARD_H = 0.34;
const CANVAS_W = 512;

function draw(text, boardW, boardH, canvasW, band) {
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
  for (let size = Math.round(62 * (CANVAS_W / 512)); size >= 14; size -= 2) {
    g.font = `600 ${size}px "Iowan Old Style", "Palatino Linotype", Georgia, serif`;
    const lines = wrap(g, words, maxW);
    if (lines.length <= 2 && lines.every((l) => g.measureText(l).width <= maxW)) {
      const lh = size * 1.12;
      const y0 = (CANVAS_H + top) / 2 - (lines.length - 1) * lh / 2;
      lines.forEach((l, i) => g.fillText(l, CANVAS_W / 2, y0 + i * lh));
      break;
    }
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

// A staked yard sign carrying `text`, its face toward local +z (the door/street side).
// `arch` turns the sign into a gateway: the posts stand a road's width apart and carry a
// beam, and the board hangs beneath it, so you read the name as you walk under it rather
// than passing a placard in a field. Signs are not blockers, so walking through needs no
// collision work - the arch only has to be tall enough to look walkable.
export function createNameplate(text, {
  small = false, width = BOARD_W, height = BOARD_H, canvasW = CANVAS_W, band = null,
  height0 = 0.42, posts = 1, arch = 0,
} = {}) {
  const s = small ? 0.7 : 1;
  const group = new THREE.Group();
  const boardY = height0 * s;

  const grow = Math.sqrt(width / BOARD_W);
  const span = arch ? arch / 2 : width * s * 0.42;
  const legH = arch ? boardY + height * s + 0.12 : boardY + 0.04;
  const legs = [];
  const n = arch ? 2 : posts;
  for (let i = 0; i < n; i++) {
    const r = arch ? 0.045 : 0.022 * grow;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.25, legH, 6), postMat);
    leg.position.set(n === 1 ? 0 : (i === 0 ? -1 : 1) * span, legH / 2, 0);
    leg.castShadow = true;
    group.add(leg);
    legs.push(leg);
  }
  if (arch) {
    // The beam overhangs its posts a little, the way a real one is pegged on top.
    const beam = new THREE.Mesh(new THREE.BoxGeometry(arch + 0.22, 0.1, 0.13), postMat);
    beam.position.y = legH + 0.05;
    beam.castShadow = true;
    group.add(beam);
  }


  const bw = width * s, bh = height * s;
  const board = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.03), woodMat);
  board.position.y = boardY + bh / 2 - 0.02;
  board.castShadow = true;
  group.add(board);

  const tex = draw(text, width, height, canvasW, band);
  const faceMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(bw * 0.94, bh * 0.86), faceMat);
  face.position.set(0, board.position.y, 0.017);
  group.add(face);

  group.scale.setScalar(s < 1 ? 1 : 1);   // reserved: keep API stable

  return {
    group,
    dispose() {
      for (const leg of legs) leg.geometry.dispose();
      board.geometry.dispose();
      face.geometry.dispose();
      faceMat.dispose();
      tex.dispose();
    },
  };
}
