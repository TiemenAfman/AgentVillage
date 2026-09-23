// The radar in the corner of the screen while you walk: north-up, player-centred, the
// island's own ground painted underneath rather than a blank ring, with icons for a boat,
// a neighbour and the town square. Everything it draws is already scene-local (see
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
  // -z is north, +x is east (the project's own convention - see bearingWord in main.js),
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

export function createMinimap({ worldRadius = 130, dotSize = 4, terrainStep = 4 } = {}) {
  const panel = document.getElementById('minimap');
  const canvas = document.getElementById('minimap-canvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h / 2;
  const pixelRadius = Math.min(cx, cy) - 6;

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

  function boatIcon(x, y) {
    ctx.save();
    ctx.translate(cx + x, cy + y);
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(3.5, 4);
    ctx.lineTo(0, 2.2);
    ctx.lineTo(-3.5, 4);
    ctx.closePath();
    ctx.fillStyle = 'rgba(127,199,217,.95)';
    ctx.fill();
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

  // The ground under the player: sampled on a coarse grid (not per canvas pixel - a couple
  // of thousand terrain lookups a frame is plenty of resolution for a 168px circle and far
  // cheaper than one per pixel) and painted in blocks the size of that grid.
  function drawTerrain(home, pos, district) {
    if (!home) return;
    const scale = pixelRadius / worldRadius;
    const half = home.half;
    const owner = district && district.owner, size = district && district.size, hues = district && district.hues;
    for (let py = -pixelRadius; py <= pixelRadius; py += terrainStep) {
      for (let px = -pixelRadius; px <= pixelRadius; px += terrainStep) {
        if (Math.hypot(px, py) > pixelRadius) continue;
        const wx = pos.x + px / scale, wz = pos.z + py / scale;
        const outside = Math.abs(wx) > half || Math.abs(wz) > half;
        const hgt = outside ? -2.5 : home.worldHeight(wx, wz);
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
    ctx.clearRect(0, 0, w, h);

    // Ground and points of interest are clipped to the circle; the ring and the compass
    // letters are drawn after, unclipped, so they sit crisp right on the rim.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, pixelRadius, 0, Math.PI * 2);
    ctx.clip();

    drawTerrain(data.home, data.pos, data.district);

    for (const it of data.boats || []) {
      if (!it || it.x == null) continue;
      const p = projectToRadar(it.x - data.pos.x, it.z - data.pos.z, worldRadius, pixelRadius);
      boatIcon(p.x, p.y);
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
    scale,
    toPx: (x, z) => [w / 2 + (x - midX) * scale, h / 2 + (z - midZ) * scale],
    toWorld: (px, py) => [midX + (px - w / 2) / scale, midZ + (py - h / 2) / scale],
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

export function createWorldMap({ step = 3 } = {}) {
  const panel = document.getElementById('worldmap');
  const canvas = document.getElementById('worldmap-canvas');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;

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

  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = Math.max(1, panel.clientWidth);
    H = Math.max(1, panel.clientHeight);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    groundKey = '';
  }
  window.addEventListener('resize', () => { if (!panel.hidden) resize(); });

  function setVisible(on) {
    if (panel.hidden === !on) return;
    panel.hidden = !on;
    if (on) resize();
  }

  function paintGround(data, fit) {
    const gw = Math.ceil(W / step), gh = Math.ceil(H / step);
    ground.width = gw; ground.height = gh;
    const img = gctx.createImageData(gw, gh);
    const home = data.regions.find((r) => r.home);
    const d = data.district;
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const [x, z] = fit.toWorld((i + 0.5) * step, (j + 0.5) * step);
        const hgt = data.sea.height(x, z);
        let c;
        if (d && home && home.region.contains(x, z)) {
          const gx = Math.floor(x - home.origin[0] + home.half), gz = Math.floor(z - home.origin[1] + home.half);
          const who = gx >= 0 && gz >= 0 && gx < d.size && gz < d.size ? d.owner[gx + gz * d.size] : null;
          c = districtRGB(hgt, who, d.hues);
        } else {
          c = terrainRGB(hgt);
        }
        const k = (i + j * gw) * 4;
        img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
      }
    }
    gctx.putImageData(img, 0, 0);
  }

  function label(x, y, text, strong) {
    ctx.font = `${strong ? 600 : 500} ${strong ? 13 : 12}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(12,14,18,.75)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = strong ? '#e8b45c' : 'rgba(244,236,224,.92)';
    ctx.fillText(text, x, y);
  }

  function update(data) {
    if (panel.hidden) return;
    const fit = fitMap(mapBounds(data.regions, data.far), W, H);
    const key = [W, H, objId(data.district && data.district.owner),
      ...data.regions.map((r) => `${r.id}@${objId(r.region)}`)].join('|');
    if (key !== groundKey) { paintGround(data, fit); groundKey = key; }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(ground, 0, 0, ground.width * step, ground.height * step);

    // Islands on the horizon: a place with no ground fetched, so a pin and a name. A
    // hashed bearing (not pinned) is a rumour from a sea we have not joined, and looks it.
    for (const m of data.far) {
      const [px, py] = fit.toPx(m.x, m.z);
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fillStyle = m.pinned ? 'rgba(244,236,224,.9)' : 'rgba(244,236,224,.35)';
      ctx.fill();
      if (m.name) label(px, py - 8, m.name, false);
    }
    for (const r of data.regions) {
      const [px, py] = fit.toPx(r.origin[0], r.origin[1] - r.half);
      if (r.name) label(px, py - 4, r.name, r.home);
    }
    for (const b of data.boats || []) {
      if (!b || b.x == null) continue;
      const [px, py] = fit.toPx(b.x, b.z);
      ctx.save();
      ctx.translate(px, py);
      ctx.beginPath();
      ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(0, 2.8); ctx.lineTo(-4.5, 5);
      ctx.closePath();
      ctx.fillStyle = 'rgba(127,199,217,.95)';
      ctx.fill();
      ctx.restore();
    }
    if (data.town) {
      const [px, py] = fit.toPx(data.town[0], data.town[1]);
      ctx.strokeStyle = '#e8b45c'; ctx.fillStyle = '#e8b45c'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(px, py + 7); ctx.lineTo(px, py - 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px, py - 7); ctx.lineTo(px + 7, py - 4); ctx.lineTo(px, py - 1); ctx.closePath(); ctx.fill();
    }
    // The player, with the same `Math.PI - yaw` as the radar's arrow (see there for why).
    const [px, py] = fit.toPx(data.pos.x, data.pos.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.PI - (data.yaw || 0));
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(5.5, 6.5); ctx.lineTo(-5.5, 6.5);
    ctx.closePath();
    ctx.fillStyle = '#f4ece0';
    ctx.strokeStyle = 'rgba(20,16,12,.7)';
    ctx.lineWidth = 1.2;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = 'rgba(244,236,224,.75)';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('N', W / 2, 10);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('M  close   ·   Esc  back to the radar', W - 14, H - 10);
  }

  return { setVisible, update };
}

