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
const CANVAS_H = Math.round(CANVAS_W * BOARD_H / BOARD_W);   // keep the plaque's aspect ratio

function draw(text) {
  const c = document.createElement('canvas');
  c.width = CANVAS_W;
  c.height = CANVAS_H;
  const g = c.getContext('2d');

  // a painted plaque: cream field, routed dark border
  g.fillStyle = '#f3e7cf';
  g.fillRect(0, 0, CANVAS_W, CANVAS_H);
  g.fillStyle = '#e8d8b6';
  g.fillRect(0, 0, CANVAS_W, 10);
  g.strokeStyle = '#5a3c28';
  g.lineWidth = 14;
  g.strokeRect(7, 7, CANVAS_W - 14, CANVAS_H - 14);

  const words = String(text || 'Untitled session').trim().split(/\s+/);
  const maxW = CANVAS_W - 52;
  g.fillStyle = '#3a2a1a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';

  // Fit in one or two lines, shrinking the type until it fits the board.
  for (let size = 62; size >= 22; size -= 2) {
    g.font = `600 ${size}px "Iowan Old Style", "Palatino Linotype", Georgia, serif`;
    const lines = wrap(g, words, maxW);
    if (lines.length <= 2 && lines.every((l) => g.measureText(l).width <= maxW)) {
      const lh = size * 1.12;
      const y0 = CANVAS_H / 2 - (lines.length - 1) * lh / 2;
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
export function createNameplate(text, { small = false } = {}) {
  const s = small ? 0.7 : 1;
  const group = new THREE.Group();
  const boardY = 0.42 * s;

  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, boardY + 0.04, 6), postMat);
  post.position.y = (boardY + 0.04) / 2;
  post.castShadow = true;
  group.add(post);

  const bw = BOARD_W * s, bh = BOARD_H * s;
  const board = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.03), woodMat);
  board.position.y = boardY + bh / 2 - 0.02;
  board.castShadow = true;
  group.add(board);

  const tex = draw(text);
  const faceMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(bw * 0.94, bh * 0.86), faceMat);
  face.position.set(0, board.position.y, 0.017);
  group.add(face);

  group.scale.setScalar(s < 1 ? 1 : 1);   // reserved: keep API stable

  return {
    group,
    dispose() {
      post.geometry.dispose();
      board.geometry.dispose();
      face.geometry.dispose();
      faceMat.dispose();
      tex.dispose();
    },
  };
}
