// The avatar you steer is the one settler on the island you get to compose yourself.
// Everyone else is dressed by their model (see PALETTE and figureGeometry); you pick
// your own skin, tunic, trim and hat here. It is kept in the browser, not on the
// island: village.json is rebuilt from transcripts every scan, so a look stored there
// would not survive - localStorage belongs to whoever is looking, which is exactly
// whose avatar this is.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { box, cylinder, cone, sphere, dome } from './buildings.js';

const KEY = 'promptholm.avatar';

// The hats are the same handful the settlers wear, freed from their styles: any of them
// can sit on any head now. 'wide' is the brim the player has always worn, which is why
// it is the one you start in.
export const HAT_SHAPES = [
  { id: 'wide', name: 'Wide brim' },
  { id: 'band', name: 'Head band' },
  { id: 'cap', name: 'Flat cap' },
  { id: 'sailor', name: 'Sailor cap' },
  { id: 'dome', name: 'Dome' },
  { id: 'wizard', name: 'Pointed' },
  { id: 'none', name: 'Bare-headed' },
];

// A curated swatch per part. Skin tones are named for materials rather than people, and
// the rest borrow the village's own palette so a settler you make still belongs here.
export const SWATCHES = {
  skin: [
    { name: 'Porcelain', hex: 0xf6d5b8 }, { name: 'Sand', hex: 0xf1c9a5 },
    { name: 'Honey', hex: 0xe0aa7c }, { name: 'Amber', hex: 0xc68642 },
    { name: 'Umber', hex: 0xa9713b }, { name: 'Chestnut', hex: 0x8d5524 },
    { name: 'Cocoa', hex: 0x6b4326 }, { name: 'Espresso', hex: 0x4a2f1d },
  ],
  tunic: [
    { name: 'Cream', hex: 0xf0e2c8 }, { name: 'Lilac', hex: 0xcfc4e6 },
    { name: 'Ash', hex: 0xa8a59e }, { name: 'Wheat', hex: 0xd9b98c },
    { name: 'Meadow', hex: 0x6fb84a }, { name: 'Poppy', hex: 0xd94f3d },
    { name: 'Cornflower', hex: 0x3d7ed9 }, { name: 'Gold', hex: 0xd9a33d },
    { name: 'Teal', hex: 0x3aa899 }, { name: 'Plum', hex: 0x8a4b7a },
  ],
  trim: [
    { name: 'Leather', hex: 0x6b4a2f }, { name: 'Walnut', hex: 0x5a3c28 },
    { name: 'Charcoal', hex: 0x3a3a3f }, { name: 'Violet', hex: 0x6e5aa8 },
    { name: 'Navy', hex: 0x2b4c7e }, { name: 'Tan', hex: 0x7d5a3a },
    { name: 'Rust', hex: 0x8a4b2a }, { name: 'Slate', hex: 0x4c5566 },
  ],
  hat: [
    { name: 'Straw', hex: 0xc9a75c }, { name: 'Slate', hex: 0x4c5566 },
    { name: 'Copper', hex: 0xb87333 }, { name: 'Violet', hex: 0x7a4fb0 },
    { name: 'Red', hex: 0xd94f3d }, { name: 'Navy', hex: 0x2b4c7e },
    { name: 'Green', hex: 0x5c8a4a }, { name: 'White', hex: 0xf5efe0 },
    { name: 'Black', hex: 0x3a3a3f },
  ],
};

// The wide-brimmed, straw-hatted settler the player has always been.
export const DEFAULT_AVATAR = { skin: 0xf1c9a5, tunic: 0xf0e2c8, trim: 0x6b4a2f, hat: 0xc9a75c, hatShape: 'wide' };

export function normalizeAvatar(spec = {}) {
  const d = DEFAULT_AVATAR;
  const num = (v, dv) => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) & 0xffffff : dv);
  const shape = HAT_SHAPES.some((h) => h.id === spec.hatShape) ? spec.hatShape : d.hatShape;
  return {
    skin: num(spec.skin, d.skin),
    tunic: num(spec.tunic, d.tunic),
    trim: num(spec.trim, d.trim),
    hat: num(spec.hat, d.hat),
    hatShape: shape,
  };
}

export function loadAvatar() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalizeAvatar(JSON.parse(raw));
  } catch { /* no storage, or nonsense in it: fall back to the default look */ }
  return { ...DEFAULT_AVATAR };
}

export function saveAvatar(spec) {
  const s = normalizeAvatar(spec);
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* the look is still applied for this session */ }
  return s;
}

// Vertex-colour a geometry the way buildings.js's primitives are, so it merges with them.
function paint(g, hex) {
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const flat = g.index ? g.toNonIndexed() : g;
  const n = flat.attributes.position.count;
  const c = new THREE.Color(hex);
  const col = new Float32Array(n * 3), emi = new Float32Array(n);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  flat.setAttribute('color', new THREE.BufferAttribute(col, 3));
  flat.setAttribute('aEmissive', new THREE.BufferAttribute(emi, 1));
  return flat;
}

function hatParts(shape, hex) {
  switch (shape) {
    case 'none': return [];
    case 'sailor': return [
      cylinder(0.082, 0.086, 0.052, 8, hex, { y: 0.41 }),
      box(0.14, 0.022, 0.065, hex, { y: 0.418, z: 0.065 }),
    ];
    case 'cap': return [
      cylinder(0.092, 0.092, 0.042, 8, hex, { y: 0.41 }),
      box(0.13, 0.022, 0.075, hex, { y: 0.418, z: 0.065 }),
    ];
    case 'dome': return [dome(0.09, hex, { y: 0.39 })];
    case 'wizard': return [cone(0.1, 0.21, 6, hex, { y: 0.41 })];
    case 'wide': return [
      cylinder(0.135, 0.135, 0.02, 9, hex, { y: 0.42 }),
      cone(0.078, 0.058, 8, hex, { y: 0.43 }),
    ];
    case 'band':
    default: return [cylinder(0.086, 0.086, 0.047, 7, hex, { y: 0.41 })];
  }
}

// The same figure the settlers are built from, but every colour and the hat come from a
// spec instead of a style. Base at y = 0, facing +z, ready to be dropped and turned.
export function avatarFigureGeometry(spec) {
  const s = normalizeAvatar(spec);
  const parts = [];
  const body = new THREE.CapsuleGeometry(0.092, 0.19, 3, 7);
  body.translate(0, 0.2, 0);
  parts.push(paint(body, s.tunic));
  parts.push(box(0.042, 0.12, 0.042, s.trim, { x: -0.055, y: 0 }));   // arms
  parts.push(box(0.042, 0.12, 0.042, s.trim, { x: 0.055, y: 0 }));
  parts.push(box(0.032, 0.032, 0.032, s.trim, { x: -0.1, y: 0.24 }));  // hands
  parts.push(box(0.032, 0.032, 0.032, s.trim, { x: 0.1, y: 0.24 }));
  parts.push(sphere(0.076, s.skin, { y: 0.37 }));                      // head
  parts.push(...hatParts(s.hatShape, s.hat));
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return g;
}

// The avatar the walk mode wears: the composed figure plus the satchel that has always
// marked the one you steer, so even bare-headed in a crowd you are still somebody.
export function avatarPlayerGeometry(spec) {
  const base = avatarFigureGeometry(spec);
  base.deleteAttribute('normal');   // recomputed after the satchel joins it
  const parts = [
    base,
    box(0.16, 0.13, 0.07, 0x8a5a34, { x: 0.11, y: 0.14, z: -0.03, ry: 0.3 }),   // satchel
    cylinder(0.008, 0.008, 0.24, 4, 0x5a3c28, { x: 0.04, y: 0.1, z: -0.02, rz: 0.5 }),   // its strap
  ];
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  g.scale(1.12, 1.12, 1.12);
  return g;
}
