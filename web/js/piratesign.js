// The Salty Kraken's hanging sign (scripts/build-piratesign.py): an iron arm out from the wall,
// a board on two chains under it and a lantern on a hook at its end - the board and the lantern
// swinging a little in the wind, and the lettering painted on the board.
//
// The bake is its own hero set, `piratesign`, framed for hanging rather than standing: the wall
// is x = 0, the arm runs out along +x, the lettered face is +z (the back, -z, is the same), and
// `anchor.sign` is the point on the wall the arm is fixed to. So a building hangs it by naming a
// point on its facade (`at`, in the building's own frame) and the turn that brings +x to the
// facade's outward normal (`yaw`); everything else - where the set's origin goes, where each
// pivot is - is worked out here, off the bake.
//
// Three things, as the sawmill does it (web/js/sawmill.js):
//   - `pirateSignParts({ at, yaw })` is the still part, the arm, for the building to merge into
//     its own geometry (and so into the island's batch): zero draw calls of its own.
//   - `attachPirateSign(group, material, { at, yaw })` hangs what moves on its own pivots: the
//     board with its chains, its kraken and its four lettered planks as ONE mesh about the line
//     through the chain hooks, and the lantern about its hook. Two calls a pass, in the building
//     material, so the lantern's glass glows by `aEmissive` after dark like every other lamp.
//   - the lettering: a canvas on one plane over the four planks that carry it, front and back
//     in one geometry. One more call, and no shadow.
//
// Why canvas and not carved letters: "GROG, ALE & SEA STORIES" is about 1.5 cm high on a board a
// third of a unit across. As triangles it would be ~1200 more of them and alias to noise at any
// distance a settler stands at; a mipmapped texture stays legible and fades smoothly. The board
// has to be a mesh of its own anyway, because it swings, so the cost over carving is exactly
// one draw call. Canvas is how web/js/nameplate.js and web/js/treasure-plaque.js letter too.
import * as THREE from 'three';
import { mesh, meshAsset, mergeParts } from './buildings.js';
import * as models from './models.js';

export const SIGN = 'piratesign';
export const PART = {
  board: `${SIGN} swing board`,
  kraken: `${SIGN} swing kraken`,
  text: (i) => `${SIGN} swing text ${i}`,
  lantern: `${SIGN} lantern`,
};
// What moves, and so stays out of the building's merge: everything under `swing`, and the
// lantern. A part with several colours bakes as `name:0`, `name:1`.
export const isPirateSignMoving = (n) => /^piratesign (swing (board|kraken|text \d+)|lantern)(:\d+)?$/.test(n);

// The lines, bottom plank to top (`swing text 1` is the bottom one), and how much of its plank
// each may take across: the top two share their planks with the iron straps down the board's
// ends (build-piratesign.py puts them at x 0.152 and 0.414), so they are held inside them.
export const LINES = [
  { text: 'GROG, ALE & SEA STORIES', size: 0.5, fill: 0.84, ink: '#dcae5c' },
  { text: 'PIRATE PUB', size: 0.62, fill: 0.62, ink: '#dcae5c' },
  { text: 'KRAKEN', size: 0.92, fill: 0.7, ink: '#eadcbc' },
  { text: 'THE SALTY', size: 0.72, fill: 0.7, ink: '#eadcbc' },
];
const FONT = '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif';
const OUTLINE = '#22150c';
// Canvas pixels per island unit: 0.32 across is ~1024 px, enough for the smallest line to have
// a stroke at all when somebody stands under the sign.
const PPU = 3200;
// Just proud of the planks' faces. A gap this small z-fights at distance without the polygon
// offset on the material; with it the lettering wins at every range (treasure-plaque.js).
const LIFT = 0.0015;
// The letters are unlit (MeshBasicMaterial, as every lettered face on the island is), so they
// are dimmed by hand at night - to what the lantern beside them would leave.
const NIGHT_INK = 0.5;

// How it swings: radians and radians a second. A board of oak on two chains barely moves; a
// lantern on a hook moves more, a little behind it.
export const SWING = { board: 0.045, lantern: 0.08, rate: 1.1 };

function slotsOf(name) {
  return models.assetParts(SIGN).filter((n) => n === name || n.startsWith(name + ':'));
}

// A part's box in the set's frame, over every slot it baked as.
function boxOf(name) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const n of slotsOf(name)) {
    const { positions: p, at } = models.part(n);
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[i + k] + at[k]);
        hi[k] = Math.max(hi[k], p[i + k] + at[k]);
      }
    }
  }
  return { lo, hi };
}

// The sign's own measurements, all off the bake: the anchor on the wall, the two pivots, and
// the four planks the lettering lies on.
function measure() {
  const planks = [];
  for (let i = 1; slotsOf(PART.text(i)).length; i++) planks.push(boxOf(PART.text(i)));
  return {
    anchor: models.anchorsOf(SIGN).sign,
    board: models.part(slotsOf(PART.board)[0]).at,
    lantern: models.part(slotsOf(PART.lantern)[0]).at,
    planks,
  };
}

export function pirateSignGeometry() {
  return models.hasAsset(SIGN) ? measure() : null;
}

// Where the set's origin goes in the building's frame, and its turn: the anchor on `at`.
export function pirateSignFrame(at, yaw = 0) {
  const [ax, ay, az] = models.anchorsOf(SIGN).sign;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: at[0] - (ax * c + az * s), y: at[1] - ay, z: at[2] - (-ax * s + az * c), ry: yaw };
}

// The arm, for a building's parts list: `parts.push(...pirateSignParts({ at, yaw }))`.
export function pirateSignParts({ at, yaw = 0 } = {}) {
  if (!models.hasAsset(SIGN)) return [];
  return meshAsset(SIGN, 0xffffff, { ...pirateSignFrame(at, yaw), skip: isPirateSignMoving });
}

// Every slot of the given parts, merged, around their shared origin (they all have the pivot's).
// Through buildings.js's own merge, which fills in `aSheet` for the plain slots beside the
// planks: mergeGeometries refuses shapes that disagree on which attributes they have.
function merged(names) {
  const pieces = names.flatMap(slotsOf).map((n) => mesh(n));
  const g = mergeParts(pieces);
  pieces.forEach((p) => p.dispose());
  return g;
}

// The lettering's canvas: the planks' union, one line centred on each plank, fitted to it.
function paint(G) {
  const lo = [Math.min(...G.planks.map((p) => p.lo[0])), Math.min(...G.planks.map((p) => p.lo[1]))];
  const hi = [Math.max(...G.planks.map((p) => p.hi[0])), Math.max(...G.planks.map((p) => p.hi[1]))];
  const W = Math.round((hi[0] - lo[0]) * PPU), H = Math.round((hi[1] - lo[1]) * PPU);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  G.planks.forEach((plank, i) => {
    const line = LINES[i];
    if (!line) return;
    const ph = (plank.hi[1] - plank.lo[1]) * PPU;
    const pw = (plank.hi[0] - plank.lo[0]) * PPU;
    const cx = ((plank.lo[0] + plank.hi[0]) / 2 - lo[0]) * PPU;
    const cy = (hi[1] - (plank.lo[1] + plank.hi[1]) / 2) * PPU;
    let size = Math.round(ph * line.size);
    for (; size > 8; size -= 2) {
      g.font = `700 ${size}px ${FONT}`;
      if (g.measureText(line.text).width <= pw * line.fill) break;
    }
    // Painted on weathered oak: a dark edge round every letter so it holds against the planks
    // in any light, and a shadow a hair below it, which is what reads as the letters being cut.
    g.lineWidth = Math.max(3, size * 0.12);
    g.strokeStyle = OUTLINE;
    g.fillStyle = OUTLINE;
    g.fillText(line.text, cx, cy + size * 0.07);
    g.strokeText(line.text, cx, cy);
    g.fillStyle = line.ink;
    g.fillText(line.text, cx, cy);
  });
  return { canvas, lo, hi };
}

// One plane on each face, in one geometry: the back's u runs the other way, so it reads right
// from behind rather than as the front seen through the board.
function letteringGeometry(lo, hi, front, back) {
  const [x0, y0] = lo, [x1, y1] = hi;
  const position = [
    x0, y0, front, x1, y0, front, x1, y1, front, x0, y1, front,
    x1, y0, back, x0, y0, back, x0, y1, back, x1, y1, back,
  ];
  const uv = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return g;
}

// `group` is the building's, `material` the building material (the one its batch draws with),
// `at`/`yaw` the same as pirateSignParts was given. `lettering: false` leaves the words off,
// for a page that has no document (tests) or does not want the call.
export function attachPirateSign(group, material, { at, yaw = 0, lettering = true } = {}) {
  const G = pirateSignGeometry();
  if (!G) return null;
  const frame = pirateSignFrame(at, yaw);
  const root = new THREE.Group();
  root.position.set(frame.x, frame.y, frame.z);
  root.rotation.y = yaw;
  group.add(root);

  const geometries = [];
  const hang = (names, where) => {
    const geometry = merged(names);
    geometries.push(geometry);
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = true;
    m.position.set(...where);
    root.add(m);
    return m;
  };
  const board = hang([PART.board, PART.kraken, ...G.planks.map((_, i) => PART.text(i + 1))], G.board);
  const lantern = hang([PART.lantern], G.lantern);

  let letters = null, map = null, ink = null;
  if (lettering && typeof document !== 'undefined') {
    const { canvas, lo, hi } = paint(G);
    map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    ink = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const front = Math.max(...G.planks.map((p) => p.hi[2])) + LIFT;
    const back = Math.min(...G.planks.map((p) => p.lo[2])) - LIFT;
    // In the board's own frame, so it swings with it.
    const b = G.board;
    const geometry = letteringGeometry([lo[0] - b[0], lo[1] - b[1]], [hi[0] - b[0], hi[1] - b[1]], front - b[2], back - b[2]);
    geometries.push(geometry);
    letters = new THREE.Mesh(geometry, ink);
    board.add(letters);
  }

  const sign = { root, G, board, lantern, letters, map, ink, geometries };
  updatePirateSign(sign, 0, 0);
  return sign;
}

// The swing at time t, as angles about the arm (x). A function of t alone, so a page that feeds
// it the sea's clock (`timeNow()` in main.js) swings it the same on every screen.
export function swingAt(t) {
  const w = SWING.rate;
  return {
    board: SWING.board * (0.75 * Math.sin(w * t) + 0.25 * Math.sin(2.3 * w * t + 0.7)),
    lantern: SWING.lantern * (0.8 * Math.sin(w * t - 0.6) + 0.2 * Math.sin(3.1 * w * t + 1.3)),
    lanternRoll: 0.3 * SWING.lantern * Math.sin(1.7 * w * t + 1),
  };
}

// `night` is 0 by day and 1 in the dead of night (main.js's own night level); the lantern
// looks after itself through the building material's uNight.
export function updatePirateSign(sign, t, night = 0) {
  if (!sign) return;
  const s = swingAt(t);
  sign.board.rotation.x = s.board;
  sign.lantern.rotation.x = s.lantern;
  sign.lantern.rotation.z = s.lanternRoll;
  if (sign.ink) sign.ink.color.setScalar(1 - (1 - NIGHT_INK) * Math.min(1, Math.max(0, night)));
}

export function disposePirateSign(sign) {
  if (!sign) return;
  sign.root.removeFromParent();
  for (const g of sign.geometries) g.dispose();
  if (sign.map) sign.map.dispose();
  if (sign.ink) sign.ink.dispose();
}
