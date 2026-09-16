// The little people. A settler is not one mesh: it is a torso, a pair of limbs, a head
// and a hat, and each of those is an instance in a mesh the whole island shares. That
// split is what buys the variety. Instancing can give an instance its own colour and its
// own matrix but never its own geometry, so while a settler was a single merged figure
// every colour on it was baked into the vertices and a mesh could hold nothing but
// clones of one look. Cut the figure along its colour seams and the arithmetic turns
// round: the model that built a settler is a tunic colour now instead of a mesh of its
// own, an apprentice is a scale in the matrix instead of a mesh of its own, and the
// island draws nine meshes where it used to draw fifteen.
//
// Shape, unlike colour, still costs a mesh per variant, so exactly one part of a settler
// is allowed to vary in shape: the hat, six of them, the same six the player picks from
// in avatar.js. Height, build and head size are scale in the matrix and cost nothing.
//
// Movement is all sine waves and lerps: no skeletons, no physics.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE, box, cylinder, cone, sphere, dome } from './buildings.js';
import { HAT_SHAPES, SWATCHES } from './avatar.js';
import { makeRng, hash32, clamp } from 'shared/rng.mjs';

const tmpObj = new THREE.Object3D();
const tmpColor = new THREE.Color();
const bodyMat = new THREE.Matrix4();
const headMat = new THREE.Matrix4();
const SKIN = 0xf1c9a5;      // the island's first and only skin tone, now just a default
// White multiplies out: a part painted white takes whatever colour its instance is given.
const WHITE = 0xffffff;
const CAPACITY = 640;
const MAX_STROLL = 36;      // settlers out on an errand at the same time
const HEAD_Y = 0.37;        // where the neck is, on a figure of standard height
const HEAD_R = 0.076;       // and how big the head on it is
// Where a pair of eyes sits on a head, as a fraction of its radius above the middle of
// it. A head here is a sphere with nothing drawn on it, so this is the one number that
// says which part of that sphere is the face: aim at the middle and you are looking at a
// mouth, aim at the top and you are looking at the crown.
const EYE_UP = 0.3;
// Which way a plot's door faces, by its rotation: 0 = -z, 1 = +x, 2 = +z, 3 = -x.
const DOOR_DIR = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// How far above its own feet a figure's eyes are. A function rather than a constant
// because nobody on this island is standard height: the torso takes `height`, the head
// rides on top of whatever that came to at its own `head` size, and an apprentice has
// `baseScale` over the lot. Anything that wants to look a settler in the eye - the
// conversation camera in facetoface.js - asks here rather than adding a guess to a plot
// centre, which is how you end up addressing somebody's hat or their boots. Called with
// nothing it gives the standard figure, which is the one walk.js and the interiors wear.
export function eyeHeight({ look = null, baseScale = 1 } = {}) {
  const height = look && look.height ? look.height : 1;
  const head = look && look.head ? look.head : 1;
  return (HEAD_Y * height + HEAD_R * head * EYE_UP) * baseScale;
}

// ---------------------------------------------------------------- the parts
// Every piece is modelled where it sits on a figure standing at the origin, so the same
// numbers serve the merged figure that walk.js and the model sheet want and the separate
// instanced meshes the crowd is drawn from. `dy` is what lifts the head and its hat out
// of figure space into a space of their own, centred on the neck.
function torsoGeometry(hex) {
  const g = new THREE.CapsuleGeometry(0.092, 0.19, 3, 7);
  g.translate(0, 0.2, 0);
  return paintGeo(g, hex);
}
function limbParts(hex) {
  return [
    box(0.042, 0.12, 0.042, hex, { x: -0.055, y: 0 }),
    box(0.042, 0.12, 0.042, hex, { x: 0.055, y: 0 }),
    box(0.032, 0.032, 0.032, hex, { x: -0.1, y: 0.24 }),
    box(0.032, 0.032, 0.032, hex, { x: 0.1, y: 0.24 }),
  ];
}
function headGeometry(hex, dy = 0) {
  return sphere(HEAD_R, hex, { y: HEAD_Y + dy });
}
// The hats avatar.js lets the player choose between, in the same order and at the same
// heights, because they are the hats the island already wore: the player is meant to read
// as somebody from this village, and that only holds while both wardrobes are one.
function hatParts(shape, hex, dy = 0) {
  const y = (v) => v + dy;
  switch (shape) {
    case 'none': return [];
    case 'sailor': return [
      cylinder(0.082, 0.086, 0.052, 8, hex, { y: y(0.41) }),
      box(0.14, 0.022, 0.065, hex, { y: y(0.418), z: 0.065 }),
    ];
    case 'cap': return [
      cylinder(0.092, 0.092, 0.042, 8, hex, { y: y(0.41) }),
      box(0.13, 0.022, 0.075, hex, { y: y(0.418), z: 0.065 }),
    ];
    case 'dome': return [dome(0.09, hex, { y: y(0.39) })];
    case 'wizard': return [cone(0.1, 0.21, 6, hex, { y: y(0.41) })];
    case 'wide': return [
      cylinder(0.135, 0.135, 0.02, 9, hex, { y: y(0.42) }),
      cone(0.078, 0.058, 8, hex, { y: y(0.43) }),
    ];
    case 'band':
    default: return [cylinder(0.086, 0.086, 0.047, 7, hex, { y: y(0.41) })];
  }
}

function mergeParts(parts) {
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------- the wardrobe
// Which hat a model's people wore before anyone had a choice, and where its colour came
// from in that model's palette. It is still the likeliest hat on that model's heads.
const STYLE_HAT = {
  fable: ['wizard', 'accent'],
  opus: ['cap', 'roof'],
  sonnet: ['dome', 'roof'],
  haiku: ['wide', 'roof'],
  unknown: ['band', 'trim'],
};
const SAILOR_HAT = 0x2b4c7e;
// A sailor's cap is a uniform, not a preference: it is how the quay reads as a quay, so
// it stays off other heads and no landsman draws it.
const CIVILIAN_HATS = HAT_SHAPES.map((h) => h.id).filter((id) => id !== 'sailor');

// The look every settler of a style used to have, and still the look of the figure that
// walk.js, interior.js and the model sheet ask for by style alone.
export function styleLook(style, sailor = false) {
  const pal = PALETTE[style] || PALETTE.unknown;
  const [shape, slot] = STYLE_HAT[style] || STYLE_HAT.unknown;
  return {
    skin: SKIN, tunic: pal.wall, trim: pal.trim,
    hat: sailor ? SAILOR_HAT : pal[slot],
    hatShape: sailor ? 'sailor' : shape,
    height: 1, build: 1, head: 1,
  };
}

// Cloth here is dyed in small batches: the same colour, never quite the same shade. Done
// on the bytes rather than through HSL so it is the plain arithmetic it looks like, and
// so a tunic can drift a little warm or a little cold without leaving its own colour.
function dye(hex, rng) {
  const mul = rng.range(0.86, 1.12);
  const warm = rng.range(-0.06, 0.06);
  const ch = (v, shift) => clamp(Math.round(v * mul * (1 + shift)), 0, 255);
  return (ch((hex >> 16) & 255, warm) << 16) | (ch((hex >> 8) & 255, 0) << 8) | ch(hex & 255, -warm);
}

// What one settler looks like. Everyone a model built wears that model's cloth - it is
// how a settler on the square reads as belonging to the house behind it - but trousers,
// hat, skin and build are their own, and no two bolts of the same cloth took the dye the
// same way. Everything here is hashed off one string the caller promises is the same on
// every scan: village.json is thrown away and rebuilt from the transcripts every minute,
// so a look drawn from Math.random, or from a slot number, or from anything the rebuild
// is free to reorder, would give the same person a new face every time.
export function settlerLook(seed, style, kind = 'adult') {
  const pal = PALETTE[style] || PALETTE.unknown;
  const base = styleLook(style, kind === 'sailor');
  const rng = makeRng(hash32(`${seed}:look`));
  const young = kind === 'apprentice';
  return {
    hatShape: kind === 'sailor' || rng.chance(0.45) ? base.hatShape : rng.pick(CIVILIAN_HATS),
    hat: kind === 'sailor' ? SAILOR_HAT : (rng.chance(0.35) ? pal.roof : rng.pick(SWATCHES.hat).hex),
    skin: rng.pick(SWATCHES.skin).hex,
    tunic: dye(pal.wall, rng),
    trim: rng.pick(SWATCHES.trim).hex,
    height: rng.range(0.9, 1.1),
    build: rng.range(0.9, 1.12),
    // An apprentice is scaled down as a whole, which would give a child an adult's head
    // in miniature. Keeping the head nearly full size is what makes small read as young
    // instead of far away.
    head: young ? rng.range(1.04, 1.16) : rng.range(0.93, 1.05),
  };
}

// One figure, merged, for everything that draws a settler as a plain mesh: walk mode, the
// interiors and the model sheet. The crowd outside does not go through here - it is drawn
// from the same parts as separate instanced meshes, see createSettlers.
export function figureGeometry(style, { sailor = false, look = null } = {}) {
  const lk = look || styleLook(style, sailor);
  return mergeParts([
    torsoGeometry(lk.tunic),
    ...limbParts(lk.trim),
    headGeometry(lk.skin),
    ...hatParts(lk.hatShape, lk.hat),
  ]);
}

function paintGeo(g, hex) {
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

// 4-neighbour A* over the cell grid, used when a settler walks in from the beach.
function findPath(terrain, from, to, blocked) {
  const size = terrain.size;
  const key = (x, z) => x + z * size;
  const open = [[0, key(from[0], from[1])]];
  const g = new Map([[key(from[0], from[1]), 0]]);
  const prev = new Map();
  const goal = key(to[0], to[1]);
  let guard = 0;
  while (open.length && guard++ < 12000) {
    open.sort((a, b) => a[0] - b[0]);
    const [, cur] = open.shift();
    if (cur === goal) break;
    const cx = cur % size, cz = (cur - (cur % size)) / size;
    for (const [nx, nz] of [[cx + 1, cz], [cx - 1, cz], [cx, cz + 1], [cx, cz - 1]]) {
      if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
      if (!terrain.isLand(nx, nz)) continue;
      const k = key(nx, nz);
      if (blocked && blocked.has(k) && k !== goal) continue;
      const cost = (g.get(cur) || 0) + 1 + 4 * terrain.slope(nx, nz);
      if (g.has(k) && g.get(k) <= cost) continue;
      g.set(k, cost);
      prev.set(k, cur);
      open.push([cost + Math.abs(nx - to[0]) + Math.abs(nz - to[1]), k]);
    }
  }
  if (!prev.has(goal) && key(from[0], from[1]) !== goal) return null;
  const out = [];
  for (let k = goal; k !== undefined; k = prev.get(k)) {
    out.push(terrain.cellWorld(k % size, (k - (k % size)) / size));
    if (k === key(from[0], from[1])) break;
  }
  return out.reverse();
}

export function createSettlers(scene, material, terrain) {
  function makeMesh(geo) {
    const m = new THREE.InstancedMesh(geo, material, CAPACITY);
    m.castShadow = true;
    m.count = 0;
    m.frustumCulled = false;
    scene.add(m);
    return m;
  }
  const tint = (mesh, i, hex) => {
    mesh.setColorAt(i, tmpColor.setHex(hex));
    mesh.instanceColor.needsUpdate = true;
  };

  // Everyone shares one slot number across the three meshes that everyone has, which is
  // also what lets a ray hit on a torso or a head name the person it belongs to.
  const roster = [];
  let slots = 0;
  const torso = makeMesh(mergeParts([torsoGeometry(WHITE)]));
  const limbs = makeMesh(mergeParts(limbParts(WHITE)));
  const head = makeMesh(mergeParts([headGeometry(WHITE, -HEAD_Y)]));
  const body = [torso, limbs, head];
  torso.userData.bucket = { figs: roster };
  head.userData.bucket = { figs: roster };
  // The hats keep their own slots: a settler is in exactly one of these meshes, or in
  // none of them if it is bare-headed.
  const hats = new Map();
  for (const h of HAT_SHAPES) {
    if (h.id === 'none') continue;
    hats.set(h.id, { mesh: makeMesh(mergeParts(hatParts(h.id, WHITE, -HEAD_Y))), slots: 0 });
  }

  const hammerGeo = mergeGeometries([
    paintGeo(new THREE.BoxGeometry(0.022, 0.16, 0.022), 0x8b5e3c),
    (() => { const g = new THREE.BoxGeometry(0.075, 0.05, 0.05); g.translate(0, 0.09, 0); return paintGeo(g, 0x3a3a3f); })(),
  ], false);
  hammerGeo.computeVertexNormals();
  const hammers = new THREE.InstancedMesh(hammerGeo, material, 64);
  hammers.count = 0;
  hammers.frustumCulled = false;
  scene.add(hammers);

  const figures = new Map();   // buildingId -> figure
  let time = 0;

  function add(id, spec, worldPos, opts = {}) {
    if (figures.has(id)) return figures.get(id);
    const kind = spec.kind === 'shed' ? 'apprentice' : (spec.harbour ? 'sailor' : 'adult');
    const style = PALETTE[spec.style] ? spec.style : 'unknown';
    const slot = slots;
    if (slot >= CAPACITY) return null;
    slots++;
    for (const m of body) m.count = slots;
    // Seeded off the building id: it is a session id with a prefix on it, or for an
    // apprentice the prefix plus the agent id that is the one thing telling four
    // apprentices of the same master apart. An upgrade or a refit does not touch it, so a
    // settler who moves up from a hut to a manor is still recognisably the same person.
    const look = settlerLook(id, style, kind);
    tint(torso, slot, look.tunic);
    tint(limbs, slot, look.trim);
    tint(head, slot, look.skin);
    const hatBucket = hats.get(look.hatShape) || null;
    let hatSlot = -1;
    if (hatBucket && hatBucket.slots < CAPACITY) {
      hatSlot = hatBucket.slots++;
      hatBucket.mesh.count = hatBucket.slots;
      tint(hatBucket.mesh, hatSlot, look.hat);
    }
    const rng = makeRng(hash32(id + ':walk'));
    // Stand outside the door, not in the middle of the floor. A settler placed on its
    // own plot centre spends its life inside its own walls, and an apprentice, whose
    // shed is barely wider than it is, walks straight through them.
    const rot = (spec.plot ? spec.plot.rot : 0) | 0;
    const [ox, oz] = DOOR_DIR[rot] || DOOR_DIR[0];
    const reach = spec.kind === 'shed' ? 0.46 : 0.85;
    const home = [worldPos[0] + ox * reach, worldPos[2] + oz * reach];
    const f = {
      id, slot, spec, look,
      hatBucket, hatSlot,
      baseScale: kind === 'apprentice' ? 0.62 : 1,
      // The body stretches and thickens; the head rides on top of it at its own size, or
      // a tall settler would be a normal one seen through a lens.
      mBody: new THREE.Matrix4().makeScale(look.build, look.height, look.build),
      mHead: new THREE.Matrix4().makeTranslation(0, HEAD_Y * look.height, 0)
        .scale(new THREE.Vector3(look.head, look.head, look.head)),
      // Long legs cover more ground per step, and no two people walk at the same cadence.
      stride: 0.88 + (look.height - 1) * 1.1,
      gait: rng.range(10.2, 11.8),
      home,
      pos: [home[0] + rng.range(-0.12, 0.12), home[1] + rng.range(-0.12, 0.12)],
      target: null, yaw: rng.range(0, 6.28), pause: rng.range(0, 3),
      mode: opts.mode || 'idle', speed: 0.34, rng, phase: rng.range(0, 6.28),
      radius: spec.kind === 'shed' ? 0.14 : 0.3, visible: true, path: null, pathI: 0, onDone: null,
      hammerSlot: -1, y: 0,
      strollIn: rng.range(4, 150), strollHome: null, keepHome: false, gate: undefined,
      // Whoever is talking to them, as [x, z], or null. See `attend`.
      attend: null,
    };
    f.speed = 0.34 * f.stride;
    figures.set(id, f);
    roster[slot] = f;
    return f;
  }

  function remove(id) {
    const f = figures.get(id);
    if (!f) return;
    f.visible = false;
    hide(f);
  }
  function hide(f) {
    tmpObj.position.set(0, -999, 0);
    tmpObj.rotation.set(0, 0, 0);
    tmpObj.scale.setScalar(0.0001);
    tmpObj.updateMatrix();
    for (const m of body) { m.setMatrixAt(f.slot, tmpObj.matrix); m.instanceMatrix.needsUpdate = true; }
    if (f.hatBucket && f.hatSlot >= 0) {
      f.hatBucket.mesh.setMatrixAt(f.hatSlot, tmpObj.matrix);
      f.hatBucket.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  function setVisible(id, v) {
    const f = figures.get(id);
    if (!f) return;
    f.visible = v;
    if (!v) hide(f);
  }
  function setMode(id, mode) {
    const f = figures.get(id);
    if (f && f.mode !== 'walk' && f.mode !== 'sail') f.mode = mode;
  }

  // Being spoken to. The figure stops where it stands and turns towards `at` ([x, z] in
  // world units) until it is let go of again - somebody who wanders off mid-sentence
  // leaves you addressing an empty street. Nothing they were doing is thrown away, only
  // suspended: the errand, its path and the hammer are all still on them, so afterwards
  // they carry on from the spot the conversation caught them at. Returns the figure,
  // because the caller's next question is always where they are standing.
  function attend(id, at) {
    const f = figures.get(id);
    if (!f || !f.visible) return null;
    f.attend = at ? [at[0], at[1]] : [f.pos[0], f.pos[1]];
    return f;
  }
  function unattend(id) {
    const f = figures.get(id);
    if (f) f.attend = null;
  }

  // ---- errands ---------------------------------------------------------------
  // Once there are streets there is somewhere to go, so settlers leave the yard now
  // and then, walk the road network to somewhere else in town, stand about for a bit
  // and walk home again. Everything below is bookkeeping on top of the walk mode that
  // already existed: no new movement code, only a reason to move.
  let roads = null;
  let strolling = 0;
  // Where a bridge carries the road over a river, and how high its deck is there.
  let deckAt = new Map();
  function setDecks(map) { deckAt = map || new Map(); }
  const groundOrDeck = (x, z) => {
    const gx = Math.round(x + terrain.half - 0.5), gz = Math.round(z + terrain.half - 0.5);
    const d = deckAt.get(gx + gz * terrain.size);
    return d != null ? d : terrain.worldHeight(x, z);
  };

  function setRoads(paths, squares) {
    const cells = new Set();
    for (const p of paths || []) for (const [gx, gz] of p.cells) cells.add(gx + gz * terrain.size);
    for (const [gx, gz] of squares || []) cells.add(gx + gz * terrain.size);
    roads = cells.size ? { cells, list: [...cells] } : null;
    for (const f of figures.values()) f.gate = undefined;   // streets moved; look again
  }

  // The road cell a figure steps out onto, cached: its front path by construction.
  function gateOf(f) {
    if (f.gate !== undefined) return f.gate;
    f.gate = null;
    if (roads) {
      const hx = Math.round(f.home[0] + terrain.half - 0.5);
      const hz = Math.round(f.home[1] + terrain.half - 0.5);
      let best = null, bd = Infinity;
      for (let dz = -3; dz <= 3; dz++) {
        for (let dx = -3; dx <= 3; dx++) {
          const k = (hx + dx) + (hz + dz) * terrain.size;
          if (!roads.cells.has(k)) continue;
          const d = dx * dx + dz * dz;
          if (d < bd) { bd = d; best = k; }
        }
      }
      f.gate = best;
    }
    return f.gate;
  }

  // Breadth first over road cells only. Roads are a thin network, so this stays small.
  function roadRoute(from, to) {
    if (!roads || from == null || to == null || from === to) return null;
    const size = terrain.size;
    const prev = new Map([[from, -1]]);
    const queue = [from];
    let head = 0;
    while (head < queue.length && head < 6000) {
      const cur = queue[head++];
      if (cur === to) {
        const out = [];
        for (let k = cur; k !== -1; k = prev.get(k)) out.push(terrain.cellWorld(k % size, (k - (k % size)) / size));
        out.reverse();
        return out;
      }
      const cx = cur % size, cz = (cur - cx) / size;
      for (const [nx, nz] of [[cx + 1, cz], [cx - 1, cz], [cx, cz + 1], [cx, cz - 1]]) {
        const k = nx + nz * size;
        if (!roads.cells.has(k) || prev.has(k)) continue;
        prev.set(k, cur);
        queue.push(k);
      }
    }
    return null;
  }

  function walkRoute(f, points, onDone) {
    f.path = [[f.pos[0], f.pos[1]], ...points];
    f.pathI = 0;
    f.mode = 'walk';
    f.keepHome = true;
    f.speed = (0.42 + f.rng.range(0, 0.14)) * f.stride;
    f.onDone = onDone;
  }

  function startStroll(f) {
    const gate = gateOf(f);
    if (gate == null) { f.strollIn = f.rng.range(20, 60); return; }
    const size = terrain.size;
    const gx = gate % size, gz = (gate - (gate % size)) / size;
    let dest = null;
    for (let tries = 0; tries < 6 && dest === null; tries++) {
      const k = roads.list[f.rng.int(roads.list.length)];
      const kx = k % size, kz = (k - (k % size)) / size;
      const d = Math.hypot(kx - gx, kz - gz);
      if (d > 5 && d < 42) dest = k;
    }
    const out = dest === null ? null : roadRoute(gate, dest);
    if (!out || out.length < 3) { f.strollIn = f.rng.range(15, 50); return; }

    strolling++;
    const home = [f.home[0], f.home[1]];
    walkRoute(f, out, () => {
      f.mode = 'idle';
      f.target = null;
      f.pause = f.rng.range(3, 11);          // stand about wherever the errand led
      f.strollHome = () => {
        walkRoute(f, [...out].reverse().concat([home]), () => {
          f.mode = 'idle';
          f.keepHome = false;
          f.home = home;
          f.strollIn = f.rng.range(40, 160);
          strolling--;
        });
      };
    });
  }

  // Walk in from the shore to a plot.
  function walkIn(id, fromCell, toCell, onDone) {
    const f = figures.get(id);
    if (!f) { onDone && onDone(); return; }
    const path = findPath(terrain, fromCell, toCell, null);
    if (!path || path.length < 2) { onDone && onDone(); return; }
    f.path = path;
    f.pathI = 0;
    f.pos = [path[0][0], path[0][1]];
    f.mode = 'walk';
    f.speed = Math.max(1.1, path.length / 7.5);
    f.onDone = onDone;
    f.visible = true;
  }

  function update(dt, nightAmount) {
    time += dt;
    let hammerCount = 0;
    for (const f of figures.values()) {
      if (!f.visible) continue;
      let bob = 0;

      if (f.attend) {
        // Held by a conversation: no step, no errand, no hammer - only the head coming
        // round to whoever is talking. The same lerp the walking uses, so they turn at
        // the speed they take corners at instead of snapping to face you.
        f.yaw = lerpAngle(f.yaw, Math.atan2(f.attend[0] - f.pos[0], f.attend[1] - f.pos[1]), 0.12);
      } else if (f.mode === 'walk' && f.path) {
        const t = f.path[Math.min(f.pathI + 1, f.path.length - 1)];
        const dx = t[0] - f.pos[0], dz = t[1] - f.pos[1];
        const d = Math.hypot(dx, dz);
        if (d < 0.12) {
          f.pathI++;
          if (f.pathI >= f.path.length - 1) {
            f.mode = 'idle'; f.path = null;
            if (!f.keepHome) f.home = [f.pos[0], f.pos[1]];   // an arrival settles here; an errand does not
            if (f.onDone) { const cb = f.onDone; f.onDone = null; cb(); }
          }
        } else {
          const step = Math.min(d, f.speed * dt);
          f.pos[0] += (dx / d) * step;
          f.pos[1] += (dz / d) * step;
          f.yaw = lerpAngle(f.yaw, Math.atan2(dx, dz), 0.2);
        }
        bob = Math.abs(Math.sin(time * f.gait + f.phase)) * 0.035;
      } else if (f.mode === 'hammer') {
        const dx = f.home[0] - f.pos[0], dz = f.home[1] - f.pos[1];
        const d = Math.hypot(dx, dz);
        const want = 0.52;
        if (Math.abs(d - want) > 0.08) {
          const dir = d > want ? 1 : -1;
          f.pos[0] += (dx / (d || 1)) * dir * 0.5 * dt;
          f.pos[1] += (dz / (d || 1)) * dir * 0.5 * dt;
        }
        f.yaw = lerpAngle(f.yaw, Math.atan2(dx, dz), 0.15);
        bob = Math.abs(Math.sin(time * 8 + f.phase)) * 0.02;
        if (hammerCount < 60) {
          // The hammer is held in a hand, so it hangs off whatever size that settler is:
          // an apprentice's is a small hammer at an apprentice's height.
          const s = f.baseScale * f.look.height;
          const swing = -1.15 + 0.75 * (0.5 + 0.5 * Math.sin(time * 8 + f.phase));
          tmpObj.position.set(f.pos[0] + Math.sin(f.yaw) * 0.16 * s, f.y + 0.26 * s, f.pos[1] + Math.cos(f.yaw) * 0.16 * s);
          tmpObj.rotation.set(0, f.yaw, swing);
          tmpObj.scale.setScalar(s);
          tmpObj.updateMatrix();
          hammers.setMatrixAt(hammerCount++, tmpObj.matrix);
        }
      } else {
        f.pause -= dt;
        if (f.strollHome && f.pause <= 0) {
          const go = f.strollHome; f.strollHome = null; go();
          continue;
        }
        // Fewer errands after dark, and never more at once than the eye can follow.
        f.strollIn -= dt;
        if (f.strollIn <= 0 && roads && strolling < MAX_STROLL && !f.deckY) {
          if (nightAmount > 0.55 && f.rng.next() < nightAmount) f.strollIn = f.rng.range(20, 70);
          else startStroll(f);
          if (f.mode === 'walk') continue;
        }
        if (!f.target && f.pause <= 0) {
          const a = f.rng.range(0, 6.283), r = f.rng.range(0.1, f.radius);
          f.target = [f.home[0] + Math.cos(a) * r, f.home[1] + Math.sin(a) * r];
        }
        if (f.target) {
          const dx = f.target[0] - f.pos[0], dz = f.target[1] - f.pos[1];
          const d = Math.hypot(dx, dz);
          if (d < 0.06) { f.target = null; f.pause = f.rng.range(1.2, 4.5); } else {
            const step = Math.min(d, f.speed * dt);
            f.pos[0] += (dx / d) * step;
            f.pos[1] += (dz / d) * step;
            f.yaw = lerpAngle(f.yaw, Math.atan2(dx, dz), 0.12);
            bob = Math.abs(Math.sin(time * 9 + f.phase)) * 0.03;
          }
        }
      }

      f.y = f.deckY != null ? f.deckY : groundOrDeck(f.pos[0], f.pos[1]);
      // One transform for the person, then the parts hang off it: torso and limbs take
      // the build, the head rides at the top of whatever body this is.
      tmpObj.position.set(f.pos[0], f.y + bob * f.baseScale, f.pos[1]);
      tmpObj.rotation.set(0, f.yaw, Math.sin(time * 9 + f.phase) * (bob > 0.001 ? 0.05 : 0.012));
      tmpObj.scale.setScalar(f.baseScale);
      tmpObj.updateMatrix();
      bodyMat.multiplyMatrices(tmpObj.matrix, f.mBody);
      torso.setMatrixAt(f.slot, bodyMat);
      limbs.setMatrixAt(f.slot, bodyMat);
      headMat.multiplyMatrices(tmpObj.matrix, f.mHead);
      head.setMatrixAt(f.slot, headMat);
      if (f.hatBucket && f.hatSlot >= 0) f.hatBucket.mesh.setMatrixAt(f.hatSlot, headMat);
    }
    for (const m of body) m.instanceMatrix.needsUpdate = true;
    for (const h of hats.values()) if (h.slots) h.mesh.instanceMatrix.needsUpdate = true;
    hammers.count = hammerCount;
    hammers.instanceMatrix.needsUpdate = true;
  }

  // The people are instanced, so a ray hit comes back as a mesh plus an instance
  // number. These two turn that back into the settler standing there, which is what
  // lets you hover someone halfway down a street and read who it is. Only the torso and
  // the head are offered: a ray that grazes a hat brim carries on into the head behind
  // it, and leaving the other meshes out halves the instances every hover has to test.
  const pickables = () => body.filter((m) => m !== limbs && m.count > 0);
  const figureAt = (mesh, i) => {
    const b = mesh && mesh.userData && mesh.userData.bucket;
    const f = b && i != null ? b.figs[i] : null;
    return f && f.visible ? f : null;
  };

  return {
    add, remove, setMode, setVisible, attend, unattend, setRoads, setDecks, walkIn, update, figures,
    pickables, figureAt,
    findPath: (a, b) => findPath(terrain, a, b, null),
  };
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * clamp(t, 0, 1);
}
