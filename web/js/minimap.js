// The radar in the corner of the screen while you walk: north-up, player-centred, the
// ground of whichever island you are on painted underneath rather than a blank ring, with
// icons for a harbour, a boat, a neighbour and the town square - and, below, the chart of
// the whole sea that the second press of M brings up, with a word for whatever the pointer
// is over. Everything it draws is already scene-local (see
// shared/regions.mjs) by the time it reaches here, so this file does no coordinate work of
// its own beyond projecting a relative offset onto the canvas.
//
// `projectToRadar` and `terrainColor` are kept pure - no THREE, no `document` - so they can
// be unit-tested straight out of Node the same way web/js/boat.js keeps stepBoat clean of
// both.

// A world-space offset from the player, scaled into canvas pixels around the centre and
// clamped to the rim when it falls outside `worldRadius` - a "radar" reading rather than a
// map that simply stops drawing, since a neighbour a hundred units out is still worth
// knowing the direction of. The bearing survives the clamp exactly; only the magnitude caps.
export function projectToRadar(dx, dz, worldRadius, pixelRadius) {
  // -z is north, +x is east (the project's own convention),
  // and canvas y grows downward, so north (-z) already lands on "up" (-y) with no flip:
  // px = dx, py = dz.
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return { x: 0, y: 0, clamped: false };
  const scale = pixelRadius / worldRadius;
  let px = dx * scale, py = dz * scale;
  const r = Math.hypot(px, py);
  const clamped = r > pixelRadius;
  if (clamped) { const k = pixelRadius / r; px *= k; py *= k; }
  return { x: px, y: py, clamped };
}

// The treasure map's spot on the radar (Plans/schatkaarten.md, "Waar zie je je quests?"): a ring
// of QUEST_RING world units round the place with an X in it, so it says "somewhere in here" and
// not "dig exactly here" - finding the cross itself is the game. `dx`, `dz` are the spot's offset
// from the player. Inside the radar's reach it is the ring at its true size (`ring` in pixels,
// which grows as you sail up to it); beyond it there is no ring to draw and it is a pin on the
// rim at its bearing (`inside` false), like a far island.
export const QUEST_RING = 10;
export function questOnRadar(dx, dz, worldRadius, pixelRadius) {
  const p = projectToRadar(dx, dz, worldRadius, pixelRadius);
  const ring = QUEST_RING * pixelRadius / worldRadius;
  const dist = Math.hypot(dx, dz);
  // The ring is drawn while any part of it is within reach; the X only once its middle is.
  return { x: p.x, y: p.y, ring, inside: dist - QUEST_RING <= worldRadius, centred: !p.clamped };
}

// The same four bands web/js/horizon.js paints a distant island with (SAND/GRASS/ROCK,
// same thresholds), plus a water gradient off the sea shader's own two colours
// (web/js/world.js uDeep/uShallow) rather than an invented blue - so a puddle on the radar
// reads as the same water the island is actually standing in.
const WATER_SHALLOW = [101, 196, 181];
const WATER_DEEP = [33, 94, 120];
const SAND = [216, 201, 162];
const GRASS = [111, 138, 78];
const ROCK = [138, 133, 119];
const lerp3 = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));

export function terrainRGB(h) {
  if (h < 0) return lerp3(WATER_SHALLOW, WATER_DEEP, Math.min(1, -h / 2));
  if (h < 0.35) return SAND;
  if (h > 3.4) return ROCK;
  return lerp3(GRASS, ROCK, Math.min(1, (h - 0.35) / 5));
}

export function terrainColor(h) {
  const c = terrainRGB(h);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// The same district-hue wash the planner paints super-cells with (plan-overlay.js's
// `paint()`, HSL at .55/.5), mixed over the terrain colour instead of the bare ground -
// so a hamlet reads on the radar the same colour it reads on the planner's map. Town
// paving gets the planner's own neutral grey. Kept a plain HSL->RGB rather than pulling
// in THREE.Color, because this file stays importable with no THREE and no `document` at
// module load (see the header comment) - the district lookup itself is built in main.js,
// which already has both.
const TOWN_TINT = [184, 178, 164];       // plan-overlay.js's C.town (0xb8b2a4)
const DISTRICT_ALPHA = 0.45, TOWN_ALPHA = 0.32;
const NONE_OWNER = -1, TOWN_OWNER = -2;

function hslToRgb(hueDeg, s, l) {
  const h = (((hueDeg % 360) + 360) % 360) / 360;
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

// `owner` is a district index, TOWN (-2) or NONE (-1) - hamlets.js's decodeOwnership(),
// read by main.js off the same village every other ownership picture on the island comes
// from. `hues` is village.districts[].hue, by index.
export function districtRGB(h, owner, hues) {
  const base = terrainRGB(h);
  if (owner == null || owner === NONE_OWNER) return base;
  const tint = owner === TOWN_OWNER ? TOWN_TINT : hslToRgb((hues && hues[owner]) || 0, 0.55, 0.5);
  return lerp3(base, tint, owner === TOWN_OWNER ? TOWN_ALPHA : DISTRICT_ALPHA);
}

export function districtColor(h, owner, hues) {
  const c = districtRGB(h, owner, hues);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// ---------------------------------------------------------------- what an island has on it
// The civic buildings worth a mark of their own: the ones somebody would steer by or look
// for. The lamps, benches, planters and terrace tables are civic too, and a map with forty
// of those on it is a map with nothing on it.
export const LANDMARKS = {
  'civic:lighthouse': 'Lighthouse', 'civic:townhall': 'Town hall', 'civic:tavern': 'Tavern',
  'civic:market': 'Market', 'civic:school': 'School', 'civic:chapel': 'Chapel',
  'civic:windmill': 'Windmill', 'civic:castle': 'Castle', 'civic:watertower': 'Water tower',
  'civic:sawmill': 'Sawmill', 'civic:smithy': 'Smithy', 'civic:bakery': 'Bakery', 'civic:stable': 'Stable',
  'civic:clocktower': 'Clock tower', 'civic:board': 'Sprint board', 'civic:issues': "The island's own board",
  'civic:mailbox': 'Postbox',
  'civic:pirate': "The pirate's chest", 'civic:treasure': 'Treasure statue',
  // The shops of the town's plan (Plans/DONE/knus-dorpscentrum.md): the places a walk into town is
  // for, which is exactly what a map of it should say.
  'civic:bakery': 'Bakery', 'civic:grocer': 'Grocer', 'civic:apothecary': 'Apothecary',
  'civic:tailor': 'Clothes shop', 'civic:library': 'Library', 'civic:tearoom': 'Tea room',
  'civic:wandmaker': 'Wand maker', 'civic:butcher': 'Butcher', 'civic:sweetshop': 'Sweet shop',
  'civic:owlpost': 'Owl post', 'civic:cauldron': 'Cauldron maker',
};

// How far from the town centre, in cells, a civic building still counts as "on the square".
// The ring of lots round a 7-cell square reaches about 6 out (lib/layout.mjs's town lots),
// the school and the chapel a little further.
const SQUARE_REACH = 12;

// Everything the chart needs from one island, in world coordinates, off a village and the
// region's own cellWorld (which adds the region's origin - see shared/regions.mjs). Pure and
// cached by the caller per village object: a village is replaced, never edited, so a new
// object is the only sign anything changed.
//
// A guest island's bundle carries its districts, buildings, paths, bridges and town but not
// the parcels a district owns (lib/islandbundle.mjs), so its hamlets are a centre and a name
// rather than a painted patch - which is still what "where is that hamlet" needs.
export function islandFeatures(village, cellWorld, size) {
  const at = (gx, gz) => cellWorld(gx, gz);
  const houses = new Map();
  let total = 0;
  for (const b of (village && village.buildings) || []) {
    if (b.kind !== 'house') continue;
    total++;
    if (b.district) houses.set(b.district, (houses.get(b.district) || 0) + 1);
  }
  const hamlets = [];
  for (const d of (village && village.districts) || []) {
    if (!Array.isArray(d.center)) continue;
    const [x, z] = at(d.center[0], d.center[1]);
    hamlets.push({ id: d.id, name: d.name || 'A hamlet', houses: houses.get(d.id) || 0, x, z });
  }
  const landmarks = [];
  const town = village && village.island && village.island.town;
  const centre = town && Array.isArray(town.centre) ? town.centre : null;
  // The civic buildings round the square are folded into the square's own mark and named
  // in its tooltip. Drawn one by one they were a white smudge of eight diamonds on top of
  // each other at any scale the whole sea fits in, none of which the pointer could single
  // out - so only what stands clear of the town gets a mark of its own.
  const onSquare = [];
  for (const b of (village && village.buildings) || []) {
    const label = LANDMARKS[b.id];
    if (!label || !b.plot) continue;
    const gx = b.plot.gx + ((b.plot.w || 1) - 1) / 2, gz = b.plot.gz + ((b.plot.d || 1) - 1) / 2;
    const lighthouse = b.id === 'civic:lighthouse';
    if (!lighthouse && centre && Math.hypot(gx - centre[0], gz - centre[1]) <= SQUARE_REACH) { onSquare.push(label); continue; }
    const [x, z] = at(gx, gz);
    landmarks.push({ kind: lighthouse ? 'lighthouse' : 'civic', label, x, z });
  }
  if (centre) {
    const [x, z] = at(centre[0], centre[1]);
    landmarks.push({ kind: 'square', label: 'Town square', x, z, detail: onSquare.length ? onSquare.join(', ') : null });
  }
  // Roads, the paved square and the bridges as one mask over the island's own grid, which
  // is what the ground painter indexes anyway.
  const roads = new Uint8Array(size * size);
  const mark = (c) => {
    if (!Array.isArray(c)) return;
    const [gx, gz] = c;
    if (gx >= 0 && gz >= 0 && gx < size && gz < size) roads[gx + gz * size] = 1;
  };
  for (const p of (village && village.paths) || []) for (const c of p.cells || []) mark(c);
  for (const c of (town && town.paved) || []) mark(c);
  for (const b of (village && village.bridges) || []) {
    for (const c of b.cells || []) mark(c);
    const mid = (b.cells || [])[Math.floor((b.cells || []).length / 2)];
    if (mid) {
      const [x, z] = at(mid[0], mid[1]);
      landmarks.push({ kind: 'bridge', label: 'Bridge', x, z });
    }
  }
  return { hamlets, landmarks, roads, houses: total };
}

// A little anchor: the one mark that means "boats here" on every chart there is.
function anchorIcon(ctx, x, y, s = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.strokeStyle = '#f4ece0';
  ctx.fillStyle = 'rgba(12,14,18,.55)';
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(0, 0, 8.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(0, -4.5, 1.8, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -2.7); ctx.lineTo(0, 5.5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-3, -1); ctx.lineTo(3, -1); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 1.5, 4.5, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
  ctx.restore();
}

// The chart's other marks, each drawn round (x, y).
function landmarkIcon(ctx, kind, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = 1.5;
  if (kind === 'square') {
    ctx.strokeStyle = '#e8b45c'; ctx.fillStyle = '#e8b45c';
    ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(0, -8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(8, -5); ctx.lineTo(0, -2); ctx.closePath(); ctx.fill();
  } else if (kind === 'lighthouse') {
    ctx.fillStyle = '#f4ece0'; ctx.strokeStyle = 'rgba(12,14,18,.7)';
    ctx.beginPath(); ctx.moveTo(-3.5, 6); ctx.lineTo(-2, -4); ctx.lineTo(2, -4); ctx.lineTo(3.5, 6); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffd36b';
    ctx.beginPath(); ctx.arc(0, -6, 2.4, 0, Math.PI * 2); ctx.fill();
  } else if (kind === 'bridge') {
    ctx.strokeStyle = '#f4ece0';
    ctx.beginPath(); ctx.arc(0, 4, 6, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-6, 0.5); ctx.lineTo(6, 0.5); ctx.stroke();
  } else {
    ctx.fillStyle = 'rgba(244,236,224,.92)'; ctx.strokeStyle = 'rgba(12,14,18,.7)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, -4.5); ctx.lineTo(4.5, 0); ctx.lineTo(0, 4.5); ctx.lineTo(-4.5, 0); ctx.closePath();
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

// The treasure's red cross, or a grey one while the map sleeps (the water it points at is
// somebody's island now). Two strokes with a light outline, so it reads over sand and sea alike.
function questCross(ctx, x, y, asleep, size = 6) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineCap = 'round';
  for (const [w, c] of [[5, 'rgba(255,250,238,.92)'], [2.6, asleep ? '#8a8a86' : '#c0281c']]) {
    ctx.lineWidth = w;
    ctx.strokeStyle = c;
    ctx.beginPath();
    ctx.moveTo(-size, -size); ctx.lineTo(size, size);
    ctx.moveTo(size, -size); ctx.lineTo(-size, size);
    ctx.stroke();
  }
  ctx.restore();
}

export function createMinimap({ worldRadius = 130, dotSize = 4, terrainStep = 2 } = {}) {
  const panel = document.getElementById('minimap');
  const canvas = document.getElementById('minimap-canvas');
  const ctx = canvas.getContext('2d');
  // Drawn in CSS pixels on a backing store of CSS pixels x devicePixelRatio. The canvas
  // used to be 180 backing pixels stretched over a 180px box, which on a 150 % display is
  // 1.5 screen pixels to every one it drew - and with the ground in 4px blocks on top of
  // that, the coast came out as a staircase. `terrainStep` is 2 CSS pixels for the same
  // reason: about 6 400 height lookups a frame, which the chart does ~200 000 of once.
  //
  // Sized off the box it is shown in, not the markup's 180: the phone shows it at 144 (and
  // 120 held sideways), where a 180 drawing shrunk by CSS put the compass letters at 7px.
  // Checked every update, since the box only has a size once it is shown.
  let w = canvas.width, h = canvas.height;
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  let cx = 0, cy = 0, pixelRadius = 0;
  function fit() {
    const box = panel.clientWidth;
    if (box > 0 && box !== w) { w = box; h = box; }
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    cx = w / 2; cy = h / 2;
    pixelRadius = Math.min(cx, cy) - 6;
  }
  fit();

  function setVisible(on) {
    panel.hidden = !on;
  }

  function dot(x, y, r, fill) {
    ctx.beginPath();
    ctx.arc(cx + x, cy + y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  // A small pin: a ring round a filled core, the way a location reads on a paper map
  // rather than as a plain dot - used for both islands and the home coastline's neighbours.
  function pin(x, y, r, fill, ringAlpha = 0.9) {
    dot(x, y, r, fill);
    ctx.beginPath();
    ctx.arc(cx + x, cy + y, r + 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(244,236,224,${ringAlpha})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function boatIcon(x, y, yaw = null) {
    ctx.save();
    ctx.translate(cx + x, cy + y);
    if (yaw != null) ctx.rotate(Math.PI - yaw);
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 4.5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-4, 4.5);
    ctx.closePath();
    ctx.fillStyle = 'rgba(140,215,235,.95)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(18,32,44,.85)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }

  function playerSailingRadar(x, y, yaw) {
    ctx.save();
    ctx.translate(cx + x, cy + y);
    if (yaw != null) ctx.rotate(Math.PI - yaw);
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5.5, 6);
    ctx.lineTo(0, 3.2);
    ctx.lineTo(-5.5, 6);
    ctx.closePath();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(14,18,24,.92)';
    ctx.stroke();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#ff7a00';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0.5, 1.8, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();
  }

  function playerFootRadar(x, y) {
    const r = 5.5;
    ctx.save();
    ctx.translate(cx + x, cy + y);
    ctx.beginPath();
    ctx.arc(0, 0, r + 1.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(14,18,24,.9)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, r - 1.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ff7a00';
    ctx.fill();
    ctx.restore();
  }

  function playerRadarLabel(x, y, name) {
    const r = Math.hypot(x, y) || 1;
    let tx, ty;
    if (r > pixelRadius - 16) {
      const inward = Math.max(0, r - 14);
      tx = cx + (x / r) * inward;
      ty = cy + (y / r) * inward;
    } else {
      tx = cx + x;
      ty = cy + y - 8;
    }
    ctx.save();
    ctx.font = 'bold 9.5px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(14,18,24,.92)';
    ctx.strokeText(name, tx, ty);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(name, tx, ty);
    ctx.restore();
  }

  function flagIcon(x, y) {
    ctx.save();
    ctx.translate(cx + x, cy + y);
    ctx.strokeStyle = '#e8b45c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.lineTo(0, -6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(6, -3.5);
    ctx.lineTo(0, -1);
    ctx.closePath();
    ctx.fillStyle = '#e8b45c';
    ctx.fill();
    ctx.restore();
  }

  // The ground under the player: sampled on a coarse grid (not per canvas pixel) and
  // painted in blocks the size of that grid.
  //
  // Asked of the whole sea, not of home. It used to be `home.worldHeight` with everything
  // past home's own half-width painted as open water - so on any other island (Codex, a
  // neighbour you had sailed to) the radar was a blue disc with you in the middle of it.
  // `sea.height` is the archipelago, which answers for every region and is open sea
  // between them; home's districts are still painted over home's own cells only.
  function drawTerrain(sea, home, pos, district) {
    if (!sea && !home) return;
    const scale = pixelRadius / worldRadius;
    const half = home ? home.half : 0;
    const owner = district && district.owner, size = district && district.size, hues = district && district.hues;
    for (let py = -pixelRadius; py <= pixelRadius; py += terrainStep) {
      for (let px = -pixelRadius; px <= pixelRadius; px += terrainStep) {
        if (Math.hypot(px, py) > pixelRadius) continue;
        const wx = pos.x + px / scale, wz = pos.z + py / scale;
        const outside = !home || Math.abs(wx) > half || Math.abs(wz) > half;
        const hgt = sea ? sea.height(wx, wz) : outside ? -2.5 : home.worldHeight(wx, wz);
        let who = null;
        if (owner && !outside) {
          const gx = Math.floor(wx + half), gz = Math.floor(wz + half);
          if (gx >= 0 && gz >= 0 && gx < size && gz < size) who = owner[gx + gz * size];
        }
        ctx.fillStyle = who == null ? terrainColor(hgt) : districtColor(hgt, who, hues);
        ctx.fillRect(cx + px, cy + py, terrainStep + 1, terrainStep + 1);
      }
    }
  }

  function update(data) {
    fit();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Ground and points of interest are clipped to the circle; the ring and the compass
    // letters are drawn after, unclipped, so they sit crisp right on the rim.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, pixelRadius, 0, Math.PI * 2);
    ctx.clip();

    drawTerrain(data.sea, data.home, data.pos, data.district);

    for (const d of data.docks || []) {
      const p = projectToRadar(d.x - data.pos.x, d.z - data.pos.z, worldRadius, pixelRadius);
      anchorIcon(ctx, cx + p.x, cy + p.y, 0.8);
    }
    for (const it of data.boats || []) {
      if (!it || it.x == null) continue;
      if (it.pilot) continue;
      const p = projectToRadar(it.x - data.pos.x, it.z - data.pos.z, worldRadius, pixelRadius);
      boatIcon(p.x, p.y, it.yaw);
    }
    for (const pl of data.players || []) {
      if (!pl || pl.x == null) continue;
      const p = projectToRadar(pl.x - data.pos.x, pl.z - data.pos.z, worldRadius, pixelRadius);
      if (pl.sailing) playerSailingRadar(p.x, p.y, pl.yaw);
      else playerFootRadar(p.x, p.y);
    }
    for (const it of data.near || []) {
      const p = projectToRadar(it.x - data.pos.x, it.z - data.pos.z, worldRadius, pixelRadius);
      pin(p.x, p.y, dotSize, 'rgba(244,236,224,.95)');
    }
    // Neighbours with a real bearing (pinned) stand out from the decorative, hashed ones.
    for (const m of data.far || []) {
      const p = projectToRadar(m.x - data.pos.x, m.z - data.pos.z, worldRadius, pixelRadius);
      pin(p.x, p.y, dotSize * 0.85, m.pinned ? 'rgba(244,236,224,.9)' : 'rgba(244,236,224,.35)', m.pinned ? 0.9 : 0.3);
    }
    if (data.town) {
      const p = projectToRadar(data.town[0] - data.pos.x, data.town[1] - data.pos.z, worldRadius, pixelRadius);
      flagIcon(p.x, p.y);
    }
    // The treasure map in hand: a ring round the spot with the X inside it; a pin on the rim
    // when it is out of reach. Grey while the map sleeps.
    if (data.quest) {
      const q = questOnRadar(data.quest.x - data.pos.x, data.quest.z - data.pos.z, worldRadius, pixelRadius);
      const tint = data.quest.asleep ? '138,138,134' : '192,40,28';
      if (q.inside) {
        ctx.beginPath();
        ctx.arc(cx + q.x, cy + q.y, q.ring, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${tint},.16)`;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = `rgba(${tint},.9)`;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        if (q.centred) questCross(ctx, cx + q.x, cy + q.y, data.quest.asleep, Math.max(3, Math.min(6, q.ring * 0.5)));
      } else {
        pin(q.x, q.y, dotSize * 0.85, `rgb(${tint})`, 1);
      }
    }

    // The player, always dead centre, spun to face wherever the body is pointed. Forward is
    // (sin yaw, cos yaw) (boat.js:16-19), which lands on canvas direction (sin yaw, cos yaw)
    // too (px=dx, py=dz, see projectToRadar above) - but the arrow's own tip points "up"
    // (0,-1) before any rotation is applied, and ctx.rotate(theta) sends (0,-1) to
    // (sin theta, -cos theta), so theta has to be `Math.PI - yaw` to land the tip on
    // (sin yaw, cos yaw) rather than its mirror image.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI - (data.yaw || 0));
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(4, 5);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fillStyle = '#f4ece0';
    ctx.strokeStyle = 'rgba(20,16,12,.6)';
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.restore();   // drop the circular clip before the rim, which has to sit on top of it

    // Other players' names, unclipped inside the rim
    for (const pl of data.players || []) {
      if (!pl || pl.x == null || !pl.name) continue;
      const p = projectToRadar(pl.x - data.pos.x, pl.z - data.pos.z, worldRadius, pixelRadius);
      playerRadarLabel(p.x, p.y, pl.name);
    }

    // Where to go: the nearest islands by name and how far, the two closest of `named`
    // (the phone's radar - main.js minimapData). A bearing on the rim was all a wanderer
    // had to go on, with no word for what it was. Drawn unclipped, over the rim, and pulled
    // in from it so the words stay inside the circle.
    const named = (data.named || [])
      .map((n) => ({ ...n, d: Math.hypot(n.x - data.pos.x, n.z - data.pos.z) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    ctx.font = '600 10px sans-serif';
    ctx.textBaseline = 'middle';
    const taken = [];
    for (const n of named) {
      const p = projectToRadar(n.x - data.pos.x, n.z - data.pos.z, worldRadius, pixelRadius);
      const r = Math.hypot(p.x, p.y) || 1;
      const inward = Math.min(r, pixelRadius - 22);
      const words = `${n.name} ${n.d < 1000 ? `${Math.round(n.d / 10) * 10} m` : `${(n.d / 1000).toFixed(1)} km`}`;
      // Towards its bearing, off the one before it when the two lie the same way, and kept
      // inside the circle - the canvas is round on screen (border-radius), so a name in a
      // corner of the square was cut off - by sliding along the chord at that height.
      const tw = ctx.measureText(words).width;
      // No higher or lower than where a line this long still fits across the circle.
      const reach = Math.sqrt(Math.max(0, (pixelRadius - 3) ** 2 - (tw / 2 + 2) ** 2)) - 6;
      let ty = cy + Math.min(reach, Math.max(-reach, (p.y / r) * inward));
      for (const t of taken) if (Math.abs(t - ty) < 13) ty = t + (t <= cy ? 13 : -13);
      taken.push(ty);
      const chord = Math.sqrt(Math.max(0, (pixelRadius - 3) ** 2 - (ty - cy) ** 2));
      const room = Math.max(0, chord - tw / 2);
      const tx = cx + Math.min(room, Math.max(-room, (p.x / r) * inward));
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(14,18,24,.85)';
      ctx.strokeText(words, tx, ty);
      ctx.fillStyle = 'rgba(244,236,224,.95)';
      ctx.fillText(words, tx, ty);
    }

    ctx.strokeStyle = 'rgba(232,180,92,.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, pixelRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(244,236,224,.75)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', cx, cy - pixelRadius + 8);
    ctx.fillText('S', cx, cy + pixelRadius - 8);
    ctx.fillText('E', cx + pixelRadius - 8, cy);
    ctx.fillText('W', cx - pixelRadius + 8, cy);
  }

  return { setVisible, update };
}

// ---------------------------------------------------------------- the chart of the sea
// The second press of M: every island this page knows about on one north-up sheet, framed
// to fit rather than centred on the player. Same colours as the radar (terrainRGB,
// districtColor), so a coast reads the same on both.

// A world rectangle fitted into a w x h canvas with `pad` pixels to spare on every side,
// one scale for both axes so an island stays square. Pure, for the test.
export function fitMap(b, w, h, pad = 40) {
  const spanX = Math.max(1, b.maxX - b.minX), spanZ = Math.max(1, b.maxZ - b.minZ);
  const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanZ);
  const midX = (b.minX + b.maxX) / 2, midZ = (b.minZ + b.maxZ) / 2;
  return {
    scale, midX, midZ,
    toPx: (x, z) => [w / 2 + (x - midX) * scale, h / 2 + (z - midZ) * scale],
    toWorld: (px, py) => [midX + (px - w / 2) / scale, midZ + (py - h / 2) / scale],
  };
}

// The chart looked through a magnifier: `v` is { k, cx, cz }, k times the fitted scale
// round the world point cx, cz in the middle of the sheet. No magnifier (null) is the fit
// itself, so the sheet, its letters and its torn edge stay where the fit put them and only
// what is drawn on the sheet moves. Pure, for the test.
export const MAP_ZOOM_MAX = 12;
export function zoomedFit(base, w, h, v) {
  if (!v) return base;
  const scale = base.scale * v.k;
  return {
    scale, midX: v.cx, midZ: v.cz,
    toPx: (x, z) => [w / 2 + (x - v.cx) * scale, h / 2 + (z - v.cz) * scale],
    toWorld: (px, py) => [v.cx + (px - w / 2) / scale, v.cz + (py - h / 2) / scale],
  };
}

// The magnifier after one turn of the wheel by `factor` at pixel mx, my: the world point
// under the pointer stays under it, as in any map on a screen, and the view is kept inside
// what the unzoomed fit shows, so zooming never wanders off the sheet. Back at 1 it is null.
export function zoomMapAt(v, base, w, h, mx, my, factor) {
  const k = Math.min(MAP_ZOOM_MAX, Math.max(1, (v ? v.k : 1) * factor));
  if (k <= 1.001) return null;
  const [wx, wz] = zoomedFit(base, w, h, v).toWorld(mx, my);
  const s = base.scale * k;
  const keep = (c, mid, span, half) => Math.min(mid + span - half, Math.max(mid - span + half, c));
  return {
    k,
    cx: keep(wx - (mx - w / 2) / s, base.midX, w / 2 / base.scale, w / 2 / s),
    cz: keep(wz - (my - h / 2) / s, base.midZ, h / 2 / base.scale, h / 2 / s),
  };
}

// Everything worth framing: the grids that have ground under them, plus every mark on the
// horizon, which has a position but no ground this page has fetched.
export function mapBounds(regions, far, margin = 12) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const take = (x0, x1, z0, z1) => {
    if (x0 < minX) minX = x0; if (x1 > maxX) maxX = x1;
    if (z0 < minZ) minZ = z0; if (z1 > maxZ) maxZ = z1;
  };
  for (const r of regions) take(r.origin[0] - r.half, r.origin[0] + r.half, r.origin[1] - r.half, r.origin[1] + r.half);
  for (const m of far) take(m.x - margin, m.x + margin, m.z - margin, m.z + margin);
  if (minX === Infinity) return { minX: -32, maxX: 32, minZ: -32, maxZ: 32 };
  return { minX, maxX, minZ, maxZ };
}

// The multiples of `step` strictly inside min..max - where the chart's grid lines go. Pure,
// for the test: the lines hang off the WORLD frame (a kilometre from the volcano), and the
// page hands in scene coordinates, so the caller adds the berth back before asking.
export function gridSteps(min, max, step) {
  const out = [];
  for (let k = Math.floor(min / step) + 1; k * step < max; k++) out.push(k * step);
  return out;
}

// The chart is a treasure map: ink on parchment. Two inks, and the colours the ground is
// washed in - laid over the paper at half strength (update), so a watercolour blue rather
// than the radar's sea, and land faded towards the paper's own cream.
const INK = 'rgba(72,42,18,.82)';
const INK_FAINT = 'rgba(72,42,18,.28)';
const WASH_SHALLOW = [150, 196, 206];
const WASH_DEEP = [96, 150, 178];
const WASH_LAND = [246, 238, 214];

// A column's letter, spreadsheet-style past Z so a bigger world still names every square.
export function columnName(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// What the chart washes a point in, from the radar's own colour for it and its height:
// water a pale blue that deepens a little offshore, land the radar's colour faded most of
// the way to paper, so a hamlet's tint still reads but an island looks drawn rather than
// photographed. Pure, for the test.
export function chartRGB(c, h) {
  if (h <= 0) {
    const t = Math.min(1, -h / 2.5);
    return WASH_SHALLOW.map((v, k) => Math.round(v + (WASH_DEEP[k] - v) * t));
  }
  return c.map((v, k) => Math.round(v * 0.4 + WASH_LAND[k] * 0.6));
}

// What an islet is called under the pointer, by its kind in shared/islets.mjs.
const ISLET_WORDS = { sandbank: 'A sandbank with a palm', round: 'A round islet', green: 'A green islet' };

// `phone`: the app on a phone, which has no M key, no Esc and no hover. The chart then says
// so in its own words, answers a tap with what is there, and has a close button of its own.
export function createWorldMap({ step = 3, phone = false, onClose = null } = {}) {
  const panel = document.getElementById('worldmap');
  const canvas = document.getElementById('worldmap-canvas');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;

  // What the pointer is over, said in words. The panel keeps `pointer-events: none` - the
  // walk still owns the mouse underneath the chart, drag-to-look included - so the pointer
  // is read off the window and placed against the panel's own rectangle instead of being
  // caught by the panel.
  const tip = document.createElement('div');
  tip.className = 'worldmap-tip';
  tip.hidden = true;
  panel.appendChild(tip);
  let pointer = null;
  const aim = (e) => {
    if (panel.hidden || document.pointerLockElement) { pointer = null; return; }
    const r = panel.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    pointer = x >= 0 && y >= 0 && x <= r.width && y <= r.height ? { x, y } : null;
  };
  window.addEventListener('pointermove', aim);
  // A finger does not hover: a tap is where it points, and it stays pointed there.
  if (phone) window.addEventListener('pointerdown', aim);

  // The wheel over an open chart zooms the chart. Caught on the window in the capture phase,
  // before the canvas underneath hears it: the panel is `pointer-events: none` (above), so
  // the orbit controls and walk.js's own wheel took every turn and zoomed the world behind
  // the sheet instead (issue #77). Under a pointer lock there is no pointer, so the middle.
  let view = null, zoomedAt = 0, lastFit = null;
  window.addEventListener('wheel', (e) => {
    if (panel.hidden) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!lastFit) return;
    const r = panel.getBoundingClientRect();
    const locked = !!document.pointerLockElement;
    const mx = locked ? W / 2 : Math.min(W, Math.max(0, e.clientX - r.left));
    const my = locked ? H / 2 : Math.min(H, Math.max(0, e.clientY - r.top));
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1);
    view = zoomMapAt(view, lastFit, W, H, mx, my, Math.exp(-dy * 0.0015));
    zoomedAt = performance.now();
  }, { capture: true, passive: false });
  if (phone) {
    const close = document.createElement('button');
    close.className = 'x worldmap-close';
    close.setAttribute('aria-label', 'Close the chart');
    close.textContent = '✕';
    close.addEventListener('click', () => onClose && onClose());
    panel.appendChild(close);
  }

  // The ground is a few hundred thousand height lookups, so it is painted once into a
  // sheet of its own and only redrawn when what it shows changes: a region raised or
  // dropped, home rebuilt (a new region object - the archipelago replaces it), the
  // district picture (a new village), or the canvas resized. The markers go on top every
  // frame.
  const ground = document.createElement('canvas');
  const gctx = ground.getContext('2d');
  const objIds = new WeakMap();
  let nextObj = 1;
  const objId = (o) => {
    if (!o) return 0;
    if (!objIds.has(o)) objIds.set(o, nextObj++);
    return objIds.get(o);
  };
  let groundKey = '';
  // The fit the ground sheet was painted with: while the wheel is turning it is stretched
  // onto the new view rather than painted again every notch (see update).
  let groundFit = null;
  // The parchment under it all, and its torn outline (paintPaper).
  const paper = document.createElement('canvas');
  let paperKey = '';
  let sheet = new Path2D();

  // islandFeatures per village object. A village is replaced wholesale on every scan or
  // publish, so the object is the cache key and a WeakMap lets the old ones go.
  const featureCache = new WeakMap();
  function featuresOf(r) {
    const v = r.village;
    if (!v || !r.region || typeof r.region.cellWorld !== 'function') return null;
    let f = featureCache.get(v);
    if (!f) {
      const size = (r.region.terrain && r.region.terrain.size) || Math.round(r.half * 2);
      f = { ...islandFeatures(v, r.region.cellWorld, size), size };
      featureCache.set(v, f);
    }
    return f;
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = Math.max(1, panel.clientWidth);
    H = Math.max(1, panel.clientHeight);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    groundKey = '';
    groundFit = null;
    paperKey = '';
  }
  window.addEventListener('resize', () => { if (!panel.hidden) resize(); });

  function setVisible(on) {
    if (panel.hidden === !on) return;
    panel.hidden = !on;
    view = null;
    if (on) resize();
    else { tip.hidden = true; pointer = null; }
  }

  // Which region's own grid cell a world point falls in, or null.
  function cellIn(r, x, z, size) {
    const gx = Math.floor(x - r.origin[0] + r.half), gz = Math.floor(z - r.origin[1] + r.half);
    return gx >= 0 && gz >= 0 && gx < size && gz < size ? gx + gz * size : -1;
  }

  const ROAD = [201, 184, 142];

  // `w`, when the world is known, is where the ink stops: outside it the sheet is bare paper.
  function paintGround(data, fit, w) {
    const gw = Math.ceil(W / step), gh = Math.ceil(H / step);
    ground.width = gw; ground.height = gh;
    const img = gctx.createImageData(gw, gh);
    const d = data.district;
    const lands = data.regions.map((r) => ({ r, f: featuresOf(r) }));
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const [x, z] = fit.toWorld((i + 0.5) * step, (j + 0.5) * step);
        if (w && (x < w.minX || x > w.maxX || z < w.minZ || z > w.maxZ)) continue;   // alpha 0
        const hgt = data.sea.height(x, z);
        let c = null;
        for (const { r, f } of lands) {
          if (!r.region.contains(x, z)) continue;
          if (hgt > 0.05 && f) {
            const k = cellIn(r, x, z, f.size);
            if (k >= 0 && f.roads[k]) { c = ROAD; break; }
          }
          if (r.home && d) {
            const k = cellIn(r, x, z, d.size);
            c = districtRGB(hgt, k >= 0 ? d.owner[k] : null, d.hues);
          }
          break;
        }
        if (!c) c = terrainRGB(hgt);
        c = chartRGB(c, hgt);
        const k = (i + j * gw) * 4;
        img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
      }
    }
    gctx.putImageData(img, 0, 0);
  }

  function label(x, y, text, strong) {
    ctx.font = `${strong ? 'bold ' : ''}italic ${strong ? 15 : 13}px Georgia, 'Times New Roman', serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(240,226,190,.8)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = strong ? '#8e2f14' : INK;
    ctx.fillText(text, x, y);
  }

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // What is under the pointer, most specific first: a mark (harbour, boat, landmark) within
  // a few pixels, then the hamlet whose land it is (home: the painted parcel itself; any
  // other island: the nearest hamlet centre, since only home's parcels are known), then
  // the island. Answered in words, and with the point to ring on the chart.
  function pick(data, fit, marks) {
    if (!pointer) return null;
    const { x: mx, y: my } = pointer;
    let best = null, bestD = 16;
    for (const m of marks) {
      const dd = Math.hypot(m.px - mx, m.py - my);
      if (dd < bestD) { best = m; bestD = dd; }
    }
    if (best) return best;
    const [wx, wz] = fit.toWorld(mx, my);
    for (const r of data.regions) {
      if (!r.region.contains(wx, wz)) continue;
      const f = featuresOf(r);
      const island = r.name || 'An island';
      if (f && data.sea.height(wx, wz) > 0.05) {
        let h = null;
        if (r.home && data.district && r.village) {
          const k = cellIn(r, wx, wz, data.district.size);
          const who = k >= 0 ? data.district.owner[k] : -1;
          const dist = who >= 0 ? r.village.districts[who] : null;
          if (dist) h = f.hamlets.find((x) => x.id === dist.id) || null;
        }
        if (!h) {
          let near = 26;
          for (const x of f.hamlets) {
            const [px, py] = fit.toPx(x.x, x.z);
            const dd = Math.hypot(px - mx, py - my);
            if (dd < near) { near = dd; h = x; }
          }
        }
        if (h) {
          const [px, py] = fit.toPx(h.x, h.z);
          return { px, py, title: h.name, sub: `${plural(h.houses, 'house', 'houses')} · ${island}`, ring: 10 };
        }
      }
      const [px, py] = fit.toPx(r.origin[0], r.origin[1]);
      const sub = f ? `${plural(f.houses, 'house', 'houses')}, ${plural(f.hamlets.length, 'hamlet', 'hamlets')}` : 'nothing known about it yet';
      return { px, py, title: r.home ? `${island} (your island)` : island, sub };
    }
    return null;
  }

  function showTip(p) {
    if (!p) { tip.hidden = true; return; }
    tip.innerHTML = '';
    const b = document.createElement('b');
    b.textContent = p.title;
    tip.appendChild(b);
    if (p.sub) {
      const s = document.createElement('span');
      s.textContent = p.sub;
      tip.appendChild(s);
    }
    tip.hidden = false;
    // Beside the pointer, and turned back inside the sheet near its right and bottom edges.
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const x = pointer.x + 16 + tw > W ? pointer.x - 16 - tw : pointer.x + 16;
    const y = pointer.y + 14 + th > H ? pointer.y - 10 - th : pointer.y + 14;
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  function update(data) {
    if (panel.hidden) return;
    // The whole world when the page knows how big it is, so the chart has a scale you can
    // learn - fitted to whatever islands happened to be near, a kilometre was a different
    // length every time somebody joined. The fitted frame is the fallback for a page that
    // has no berth yet (no world to place it in).
    const w = data.world;
    // The pad leaves the grid's letters and numbers room outside the world's edge, and the
    // torn edge of the sheet room outside those.
    // `base` frames the sheet (paper, letters, compass, the words at the foot) and never
    // zooms; `fit` is what is drawn on it, through the wheel's magnifier.
    const base = fitMap(w || mapBounds(data.regions, data.far), W, H, w ? 58 : 40);
    lastFit = base;
    const fit = zoomedFit(base, W, H, view);
    const key = [W, H, w ? `${w.minX},${w.minZ}` : '', objId(data.district && data.district.owner),
      view ? `${view.k.toFixed(4)},${view.cx.toFixed(2)},${view.cz.toFixed(2)}` : '',
      ...data.regions.map((r) => `${r.id}@${objId(r.region)}@${objId(r.village)}`)].join('|');
    // A few hundred thousand height lookups is too many for every notch of the wheel, so
    // the old sheet is stretched until the wheel has been still for a moment.
    if (key !== groundKey && (!groundFit || performance.now() - zoomedAt > 150)) {
      paintGround(data, fit, w); groundKey = key; groundFit = fit;
    }
    // The sheet is cut to the world and its margin, not to the window: a square world on a
    // wide screen was a strip of blank parchment either side of it.
    let rect = [0, 0, W, H];
    if (w) {
      const [x0, y0] = base.toPx(w.minX, w.minZ), [x1, y1] = base.toPx(w.maxX, w.maxZ);
      const a = Math.max(0, x0 - 52), b = Math.max(0, y0 - 52);
      rect = [a, b, Math.min(W, x1 + 52) - a, Math.min(H, y1 + 52) - b];
    }
    const pk = `${W}x${H}:${rect.map(Math.round).join(',')}`;
    if (paperKey !== pk) paintPaper(pk, rect);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(paper, 0, 0, W, H);
    // The sea and the land are washed onto the paper at half strength rather than laid over
    // it, so the grain, the stains and the scorched edge show through every island as they
    // would through a watercolour. Multiplying was tried first: a blue on tan came out as
    // olive. Clipped to the torn sheet, so nothing is painted on the table beside it.
    ctx.save();
    ctx.clip(sheet);
    ctx.globalAlpha = 0.55;
    {
      const [gx, gy] = fit.toPx(...groundFit.toWorld(0, 0)), g = fit.scale / groundFit.scale;
      ctx.drawImage(ground, gx, gy, ground.width * step * g, ground.height * step * g);
    }
    ctx.restore();
    if (w) drawGrid(w, fit, base);
    compassRose(w ? base.toPx(w.maxX, w.minZ)[0] - 46 : W - 70, w ? base.toPx(w.maxX, w.minZ)[1] + 46 : 70, 30);

    // Zoomed in, what is drawn on the sheet stops at the world's edge as the sheet frames it,
    // or the marks would run out over the letters and the table.
    ctx.save();
    if (w && view) {
      const [x0, y0] = base.toPx(w.minX, w.minZ), [x1, y1] = base.toPx(w.maxX, w.maxZ);
      ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
    }

    // Everything with a place and a name goes into `marks` as it is drawn, so the hover
    // test below looks at exactly what is on the sheet and nothing else.
    const marks = [];

    // The islets, as dots at least big enough to see: at a whole world to the sheet the
    // biggest of them is four pixels across, and the painted ground (a third of the canvas's
    // resolution) loses every one. Sand, or green for the bushy kind.
    for (const i of data.islets || []) {
      const [px, py] = fit.toPx(i.x, i.z);
      ctx.beginPath();
      ctx.arc(px, py, Math.max(1.8, i.r * fit.scale), 0, Math.PI * 2);
      ctx.fillStyle = i.kind === 'green' ? 'rgb(150,160,98)' : 'rgb(238,222,180)';
      ctx.fill();
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = INK_FAINT;
      ctx.stroke();
      marks.push({ px, py, title: ISLET_WORDS[i.kind] || 'An islet', sub: 'nobody\'s, and nobody can claim it' });
    }

    // Islands on the horizon: a place with no ground fetched, so a pin and a name. A
    // hashed bearing (not pinned) is a rumour from a sea we have not joined, and looks it.
    for (const m of data.far) {
      const [px, py] = fit.toPx(m.x, m.z);
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fillStyle = m.pinned ? INK : INK_FAINT;
      ctx.fill();
      if (m.name) label(px, py - 8, m.name, false);
      marks.push({ px, py, title: m.name || 'An island', sub: m.pinned ? 'in a sea you have not joined' : 'a rumour on the horizon' });
    }

    const regionName = new Map(data.regions.map((r) => [r.id, r.name]));
    for (const r of data.regions) {
      const f = featuresOf(r);
      if (!f) continue;
      for (const l of f.landmarks) {
        const [px, py] = fit.toPx(l.x, l.z);
        landmarkIcon(ctx, l.kind, px, py);
        marks.push({ px, py, title: l.label, sub: [l.detail, r.name].filter(Boolean).join(' · ') || null });
      }
    }
    for (const d of data.docks || []) {
      const [px, py] = fit.toPx(d.x, d.z);
      anchorIcon(ctx, px, py);
      const island = regionName.get(d.region);
      const side = { n: 'North', e: 'East', s: 'South', w: 'West' }[d.side];
      marks.push({ px, py, title: side ? `${side} harbour` : 'Harbour', sub: island || null });
    }
    for (const r of data.regions) {
      const [px, py] = fit.toPx(r.origin[0], r.origin[1] - r.half);
      if (r.name) label(px, py - 4, r.name, r.home);
    }
    // The treasure map in hand, on top of the islets it points among: a red cross and its square
    // ("K7", the letters and numbers along the sheet's edge), grey while the map sleeps.
    if (data.quest) {
      const q = data.quest;
      const [px, py] = fit.toPx(q.x, q.z);
      questCross(ctx, px, py, q.asleep, 7);
      label(px, py - 11, q.grid, false);
      marks.push({
        px, py, ring: 12,
        title: q.asleep ? `Treasure map, square ${q.grid} (asleep)` : `Treasure map, square ${q.grid}`,
        sub: q.asleep ? "the water there is somebody's now" : 'dig for it on the islet',
      });
    }
    for (const b of data.boats || []) {
      if (!b || b.x == null) continue;
      if (b.pilot) continue;
      const [px, py] = fit.toPx(b.x, b.z);
      ctx.save();
      ctx.translate(px, py);
      if (b.yaw != null) ctx.rotate(Math.PI - b.yaw);
      ctx.beginPath();
      ctx.moveTo(0, -6.5); ctx.lineTo(4.5, 5); ctx.lineTo(0, 2.8); ctx.lineTo(-4.5, 5);
      ctx.closePath();
      ctx.fillStyle = 'rgb(58,96,122)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(28,48,64,.85)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
      marks.push({ px, py, title: 'Moored boat', sub: phone ? 'row up to it and tap X' : 'walk up to it and press E', ring: 12 });
    }

    // Other players: high-contrast markers on land and sea, with name labels and tooltips
    for (const pl of data.players || []) {
      if (!pl || pl.x == null) continue;
      const [px, py] = fit.toPx(pl.x, pl.z);
      if (pl.sailing) {
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(Math.PI - (pl.yaw || 0));
        ctx.beginPath();
        ctx.moveTo(0, -9.5);
        ctx.lineTo(6.5, 7);
        ctx.lineTo(0, 3.8);
        ctx.lineTo(-6.5, 7);
        ctx.closePath();
        ctx.lineWidth = 3.2;
        ctx.strokeStyle = 'rgba(40,24,12,.95)';
        ctx.stroke();
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = '#fffaf0';
        ctx.stroke();
        ctx.fillStyle = '#f26419';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, 0.5, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.restore();
      } else {
        const r = 5.5;
        ctx.save();
        ctx.translate(px, py);
        ctx.beginPath();
        ctx.arc(0, 0, r + 1.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(40,24,12,.92)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = '#fffaf0';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, 0, r - 1.4, 0, Math.PI * 2);
        ctx.fillStyle = '#f26419';
        ctx.fill();
        ctx.restore();
      }

      if (pl.name) {
        ctx.save();
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = 'rgba(255,250,238,.95)';
        ctx.strokeText(pl.name, px, py - 8);
        ctx.fillStyle = '#5c220e';
        ctx.fillText(pl.name, px, py - 8);
        ctx.restore();
      }

      marks.push({
        px, py,
        title: pl.name || 'Another player',
        sub: pl.sailing ? 'Sailing a boat' : (pl.room ? `In the ${pl.room}` : 'On foot'),
        ring: 14,
      });
    }

    // The player, with the same `Math.PI - yaw` as the radar's arrow (see there for why).
    const [px, py] = fit.toPx(data.pos.x, data.pos.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.PI - (data.yaw || 0));
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(5.5, 6.5); ctx.lineTo(-5.5, 6.5);
    ctx.closePath();
    ctx.fillStyle = '#b03a1c';
    ctx.strokeStyle = 'rgba(245,232,200,.9)';
    ctx.lineWidth = 1.2;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(255,250,238,.95)';
    ctx.strokeText('You', px, py - 10);
    ctx.fillStyle = '#8e2f14';
    ctx.fillText('You', px, py - 10);
    ctx.restore();
    const sailingSelf = (data.boats || []).some((b) => b.isSelf);
    marks.push({ px, py, title: 'You', sub: sailingSelf ? 'Sailing a boat' : null, ring: 14 });

    ctx.restore();

    const hit = pick(data, fit, marks);
    if (hit && hit.ring) {
      ctx.beginPath();
      ctx.arc(hit.px, hit.py, hit.ring, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(176,58,28,.85)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    showTip(hit);

    ctx.fillStyle = INK;
    ctx.font = 'italic 12px Georgia, serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(phone ? 'Tap a place to name it   ·   ✕  back to the radar'
      : data.sky ? 'M  or  Esc  close' : 'M  close   ·   Esc  back to the radar', rect[0] + rect[2] - 30, rect[1] + rect[3] - 24);
  }

  // A line every kilometre of the world (`w.km`), counted from the volcano, drawn in ink:
  // the squares lettered along the top and numbered down the left, A1 in the north-west as
  // on any sea chart, the world's edge as a dashed square and a one-kilometre bar in the
  // corner. `w` is in scene coordinates; `w.home` is the berth that turns them back into the
  // world's, which is what the lines are laid out on.
  // `base` is the unzoomed frame: zoomed in, the lines follow `fit` but stay inside the
  // frame's edge, and the letters and numbers stay along it, over the squares still in view.
  function drawGrid(w, fit, base = fit) {
    const [ox, oz] = w.home;
    const [fx0, fy0] = base.toPx(w.minX, w.minZ), [fx1, fy1] = base.toPx(w.maxX, w.maxZ);
    const [ex0, ey0] = fit.toPx(w.minX, w.minZ), [ex1, ey1] = fit.toPx(w.maxX, w.maxZ);
    const x0 = Math.max(fx0, ex0), y0 = Math.max(fy0, ey0), x1 = Math.min(fx1, ex1), y1 = Math.min(fy1, ey1);
    const xs = gridSteps(w.minX + ox, w.maxX + ox, w.km).map((k) => fit.toPx(k - ox, 0)[0]);
    const zs = gridSteps(w.minZ + oz, w.maxZ + oz, w.km).map((k) => fit.toPx(0, k - oz)[1]);
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = INK_FAINT;
    ctx.beginPath();
    for (const px of xs) if (px > x0 && px < x1) { ctx.moveTo(Math.round(px) + 0.5, y0); ctx.lineTo(Math.round(px) + 0.5, y1); }
    for (const py of zs) if (py > y0 && py < y1) { ctx.moveTo(x0, Math.round(py) + 0.5); ctx.lineTo(x1, Math.round(py) + 0.5); }
    ctx.stroke();
    ctx.setLineDash([7, 5]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = INK;
    // The world's real edge, not the frame's: zoomed in it is off the sheet and not drawn.
    ctx.save();
    ctx.beginPath(); ctx.rect(fx0 - 1, fy0 - 1, fx1 - fx0 + 2, fy1 - fy0 + 2); ctx.clip();
    ctx.strokeRect(Math.round(ex0) + 0.5, Math.round(ey0) + 0.5, Math.round(ex1 - ex0), Math.round(ey1 - ey0));
    ctx.restore();
    ctx.setLineDash([]);
    // A letter over the middle of every column and a number beside every row, the lines
    // being the squares' edges rather than their names.
    // Each square's name goes over the middle of the part of it still on the sheet (all of
    // it, unzoomed); a square wholly off the sheet gets none. Null keeps the index its name.
    const mids = (a, lines, b, lo, hi) => [a, ...lines, b].slice(1).map((v, i, all) => {
      const l = Math.max(lo, i ? all[i - 1] : a), r = Math.min(hi, v);
      return r - l > 8 ? (l + r) / 2 : null;
    });
    const size = Math.max(11, Math.min(18, Math.round((x1 - x0) / 55)));
    ctx.font = `${size}px Georgia, 'Times New Roman', serif`;
    ctx.fillStyle = INK;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    mids(ex0, xs, ex1, x0, x1).forEach((px, i) => px != null && ctx.fillText(columnName(i), px, y0 - 6));
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    mids(ey0, zs, ey1, y0, y1).forEach((py, i) => py != null && ctx.fillText(String(i + 1), x0 - 8, py));
    // The bar, bottom left, inside the edge.
    const len = w.km * fit.scale, bx = x0 + 14, by = y1 - 14;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx, by - 4); ctx.lineTo(bx, by); ctx.lineTo(bx + len, by); ctx.lineTo(bx + len, by - 4);
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = 'italic 12px Georgia, serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('1 km', bx + len + 6, by + 2);
    ctx.restore();
  }

  // An eight-point star in the chart's ink, the four cardinal points half dark, with the
  // letters round it. North is up on this chart and always will be.
  function compassRose(cx, cy, r) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.64, 0, Math.PI * 2); ctx.stroke();
    for (let k = 0; k < 8; k++) {
      const long = k % 2 === 0, len = long ? r : r * 0.55, a = (k * Math.PI) / 4;
      const tip = [Math.sin(a) * len, -Math.cos(a) * len];
      const side = long ? r * 0.13 : r * 0.1;
      const l = [Math.sin(a - Math.PI / 2) * side, -Math.cos(a - Math.PI / 2) * side];
      // Each point is two triangles, one inked and one left paper, which is what makes it
      // read as a star rather than a blot at this size.
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(tip[0], tip[1]); ctx.lineTo(l[0], l[1]); ctx.closePath();
      ctx.fillStyle = INK; ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(tip[0], tip[1]); ctx.lineTo(-l[0], -l[1]); ctx.closePath();
      ctx.fillStyle = 'rgba(240,226,190,.9)'; ctx.fill(); ctx.stroke();
    }
    ctx.font = `italic ${Math.round(r * 0.42)}px Georgia, serif`;
    ctx.fillStyle = INK;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const d = r + r * 0.35;
    ctx.fillText('N', 0, -d); ctx.fillText('S', 0, d); ctx.fillText('E', d, 0); ctx.fillText('W', -d, 0);
    ctx.restore();
  }

  // The sheet itself, painted once per canvas size: an uneven cream, a few stains, a grain
  // of fibres, two fold lines, and an edge torn by hand and scorched brown. All of it off
  // a seeded rng, so the same window always gets the same sheet and it does not shimmer
  // between reopenings. `sheet` is the torn outline, which the ground is clipped to.
  function paintPaper(key, [rx, ry, rw, rh]) {
    paperKey = key;
    paper.width = Math.round(W * dpr); paper.height = Math.round(H * dpr);
    const p = paper.getContext('2d');
    p.setTransform(dpr, 0, 0, dpr, 0, 0);
    p.clearRect(0, 0, W, H);
    let seed = 20260928;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    // The torn edge: a point every dozen pixels round the sheet's rectangle (in canvas
    // coordinates, because the ground is clipped to the same path), each nudged inwards by
    // a random bite, and now and then a deeper tear.
    const m = 10, pts = [];
    const L = rx + m, T = ry + m, R = rx + rw - m, B = ry + rh - m;
    const edge = (ax, ay, bx, by, nx, ny) => {
      const n = Math.max(2, Math.round(Math.hypot(bx - ax, by - ay) / 12));
      for (let i = 0; i < n; i++) {
        const t = i / n, bite = rnd() * 6 + (rnd() < 0.06 ? 8 + rnd() * 10 : 0);
        pts.push([ax + (bx - ax) * t + nx * bite, ay + (by - ay) * t + ny * bite]);
      }
    };
    edge(L, T, R, T, 0, 1); edge(R, T, R, B, -1, 0);
    edge(R, B, L, B, 0, -1); edge(L, B, L, T, 1, 0);
    sheet = new Path2D();
    pts.forEach(([x, y], i) => (i ? sheet.lineTo(x, y) : sheet.moveTo(x, y)));
    sheet.closePath();

    p.save();
    p.clip(sheet);
    const cx = rx + rw / 2, cy = ry + rh / 2;
    const g = p.createRadialGradient(cx - rw * 0.05, cy - rh * 0.05, 0, cx, cy, Math.hypot(rw, rh) / 2);
    g.addColorStop(0, '#f1e0b6'); g.addColorStop(0.7, '#e4cc96'); g.addColorStop(1, '#cfae70');
    p.fillStyle = g;
    p.fillRect(rx, ry, rw, rh);
    // Stains: soft blotches, mostly darker, a few lighter where the paper was rubbed.
    for (let i = 0; i < 46; i++) {
      const x = rx + rnd() * rw, y = ry + rnd() * rh, r = 30 + rnd() * Math.min(rw, rh) * 0.22;
      const dark = rnd() < 0.75;
      const s = p.createRadialGradient(x, y, 0, x, y, r);
      s.addColorStop(0, dark ? `rgba(128,86,34,${0.04 + rnd() * 0.07})` : `rgba(255,248,226,${0.05 + rnd() * 0.08})`);
      s.addColorStop(1, 'rgba(128,86,34,0)');
      p.fillStyle = s;
      p.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Two folds, the sheet having been carried in a pocket: a faint dark crease with a
    // lighter line beside it.
    for (const [ax, ay, bx, by] of [[rx + rw / 3, ry, rx + rw / 3 + 8, ry + rh], [rx, cy - 4, rx + rw, cy + 6]]) {
      p.lineWidth = 1.2; p.strokeStyle = 'rgba(110,72,30,.12)';
      p.beginPath(); p.moveTo(ax, ay); p.lineTo(bx, by); p.stroke();
      p.lineWidth = 2; p.strokeStyle = 'rgba(255,248,226,.14)';
      p.beginPath(); p.moveTo(ax + 2, ay + 2); p.lineTo(bx + 2, by + 2); p.stroke();
    }
    // Scorched edge: the outline stroked wide and blurred, inside the clip, so it only
    // browns the paper inwards.
    p.filter = 'blur(10px)';
    p.lineWidth = 36; p.strokeStyle = 'rgba(96,56,18,.55)';
    p.stroke(sheet);
    p.filter = 'none';
    p.restore();
    // Grain: a speckle of fibres over the paper alone.
    const img = p.getImageData(0, 0, paper.width, paper.height), px = img.data;
    for (let k = 0; k < px.length; k += 4) {
      if (!px[k + 3]) continue;
      const n = (rnd() - 0.5) * 18;
      px[k] = Math.max(0, Math.min(255, px[k] + n));
      px[k + 1] = Math.max(0, Math.min(255, px[k + 1] + n));
      px[k + 2] = Math.max(0, Math.min(255, px[k + 2] + n * 0.8));
    }
    p.putImageData(img, 0, 0);
    p.lineWidth = 1.2; p.strokeStyle = 'rgba(80,46,16,.55)';
    p.stroke(sheet);
  }

  return { setVisible, update };
}
