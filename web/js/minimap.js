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
export function districtColor(h, owner, hues) {
  const base = terrainRGB(h);
  if (owner == null || owner === NONE_OWNER) return `rgb(${base[0]},${base[1]},${base[2]})`;
  const tint = owner === TOWN_OWNER ? TOWN_TINT : hslToRgb((hues && hues[owner]) || 0, 0.55, 0.5);
  const c = lerp3(base, tint, owner === TOWN_OWNER ? TOWN_ALPHA : DISTRICT_ALPHA);
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
