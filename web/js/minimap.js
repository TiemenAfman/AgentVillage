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

export function terrainColor(h) {
  let c;
  if (h < 0) c = lerp3(WATER_SHALLOW, WATER_DEEP, Math.min(1, -h / 2));
  else if (h < 0.35) c = SAND;
  else if (h > 3.4) c = ROCK;
  else c = lerp3(GRASS, ROCK, Math.min(1, (h - 0.35) / 5));
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
  function drawTerrain(home, pos) {
    if (!home) return;
    const scale = pixelRadius / worldRadius;
    const half = home.half;
    for (let py = -pixelRadius; py <= pixelRadius; py += terrainStep) {
      for (let px = -pixelRadius; px <= pixelRadius; px += terrainStep) {
        if (Math.hypot(px, py) > pixelRadius) continue;
        const wx = pos.x + px / scale, wz = pos.z + py / scale;
        const hgt = (Math.abs(wx) > half || Math.abs(wz) > half) ? -2.5 : home.worldHeight(wx, wz);
        ctx.fillStyle = terrainColor(hgt);
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

    drawTerrain(data.home, data.pos);

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
