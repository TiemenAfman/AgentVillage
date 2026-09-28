// The shipyard and the ship on its stocks (scripts/build-shipyard.py, web/js/shipyard.js,
// Plans/scheepswerf.md).
//
// What is held here:
//   the order   the Dutch one of her century (schaalbouw): the keel and stems, then the bottom
//               planking held by cleats and not a frame, then the frames set into it and
//               rising to her sides, then her hull complete - and no mast at any stage, since
//               she is masted afloat and comes to the roads rigged.
//   stage 4     is the Batavia's own bake, laid on the ways: every vertex drawn is one of hers,
//               turned stern to the sea and pitched onto the declivity, with her numbers - 11.98
//               on the waterline, 2.80 in the beam, 1.00 draught, her four decks at 1.10, 1.60,
//               1.65 and 2.10, her taffrail at 2.57 and her crest at 3.03 - and in timber: none
//               of her paint, nothing lit, nothing she is given afloat.
//   stages 1-3  are drawn on her lines, so the shell and the frames lie inside the skin that
//               stage 4 puts on them.
//   the lot     every stage stays inside five by sixteen, and on all four rots the posed yard
//               stays inside its plot, stands on the land of its landward rows and never on
//               the sea's floor under the middle of it.
//   walking     the shed, the stacks and the hearth are walked round, the ship is behind the
//               slipway's solid, and the strip along her to the water is free.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

// buildings.js builds a TextureLoader as it loads.
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { buildBuilding, bataviaOnStocks, stocksPaint, STOCKS, SHIPYARD_LAND, WALK_BODY_R } = await import('../web/js/buildings.js');
const { yardStage, shownAtStage, shipyardGround, turnLocal, YARD_W, YARD_D, YARD_FLOOR, LAND_ROWS, YARD_STAGES, YARD_STAGE_NAMES, HULL_STAGE } = await import('../web/js/shipyard.js');
const { SHIPYARD } = await import('../web/js/shipyard-mesh.js');
const { BATAVIA } = await import('../web/js/batavia-mesh.js');
const { HERO_BUDGET, checkSet } = await import('../scripts/model-rules.mjs');
delete globalThis.document;

const spec = (stage) => ({ id: `c:shipyard:${stage}`, kind: 'civic', civicType: 'shipyard', tier: 'civic', style: 'unknown', ornaments: [], ...(stage === undefined ? {} : { stage }) });
const withDocument = (fn) => {
  globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
  try { return fn(); } finally { delete globalThis.document; }
};
const build = (s) => withDocument(() => buildBuilding(spec(s)));
const tris = (n) => SHIPYARD.parts[n].positions.length / 9;
const vertices = (p) => {
  const out = [];
  for (let i = 0; i < p.positions.length; i += 3) out.push([p.positions[i] + p.at[0], p.positions[i + 1] + p.at[1], p.positions[i + 2] + p.at[2]]);
  return out;
};
// Every vertex of the yard's parts whose name starts so, in the set's own frame (pile feet at 0).
function points(prefix) {
  const out = Object.entries(SHIPYARD.parts).filter(([name]) => name.startsWith(prefix)).flatMap(([, p]) => vertices(p));
  assert.ok(out.length, `no part called ${prefix}`);
  return out;
}
const span = (pts, k) => [Math.min(...pts.map((p) => p[k])), Math.max(...pts.map((p) => p[k]))];

// From the yard's frame, lowered by its datum as buildings.js draws it, back into hers: off her
// origin on the keel, the declivity undone, and the half turn that put her stern to the sea.
const cT = Math.cos(STOCKS.tilt), sT = Math.sin(STOCKS.tilt);
function toHer([x, y, z]) {
  const dx = x - STOCKS.x, dy = y - STOCKS.y, dz = z - STOCKS.z;
  return [-dx, dy * cT + dz * sT, -(-dy * sT + dz * cT)];
}
// The same from the bake's own frame, whose y is over the pile feet rather than the land.
const bakeToHer = ([x, y, z]) => toHer([x, y - SHIPYARD_LAND, z]);
// Her bake as it stands on the stocks, each geometry with the name of the part it came from.
const STOCKED = withDocument(() => bataviaOnStocks()).map((g) => {
  const p = g.attributes.position.array, pts = [];
  for (let i = 0; i < p.length; i += 3) pts.push(toHer([p[i], p[i + 1], p[i + 2]]));
  return { name: g.userData.part.args[0], g, pts };
});
const stocked = (name) => {
  const s = STOCKED.find((x) => x.name === name);
  assert.ok(s, `${name} is not on the stocks`);
  return s.pts;
};
const srgb = (v) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
const hexOf = (r, g, b) => (srgb(r) << 16) | (srgb(g) << 8) | srgb(b);
// Her own parts by the colour they were baked in - what STOCKS_PAINT in buildings.js goes by.
const herPartOf = (hex) => Object.keys(BATAVIA.parts).find((n) => /^batavia (hull|fittings)/.test(n)
  && hexOf(...BATAVIA.parts[n].colors.slice(0, 3)) === hex);

test('the bake is within the rules, as one hero, and every part is the yard or a stage', () => {
  assert.deepEqual(checkSet('shipyard', SHIPYARD), []);
  const total = Object.keys(SHIPYARD.parts).reduce((n, name) => n + tris(name), 0);
  assert.ok(total <= HERO_BUDGET, `${total} triangles against ${HERO_BUDGET}`);
  for (const name of Object.keys(SHIPYARD.parts)) {
    assert.ok(name.startsWith('shipyard '), `${name} is not named after the set`);
    const m = /^shipyard s(\d)-(\d) /.exec(name);
    if (m) assert.ok(Number(m[1]) >= 1 && Number(m[1]) <= Number(m[2]) && Number(m[2]) <= 4, `${name} names stages that do not exist`);
    // Masts go in at the fitting-out quay, after the launch.
    assert.ok(!/mast/.test(name), `${name}: the yard has no masts to draw`);
  }
  // The datum the island lowers it by is the one build-shipyard.py modelled to.
  assert.equal(SHIPYARD_LAND, 1.9);
  assert.deepEqual([...YARD_STAGE_NAMES], ['Empty stocks', 'Keel and stems', 'Bottom planking', 'Frames', 'Hull']);
  assert.equal(HULL_STAGE, 4);
});

test('each stage draws what the Dutch order has on the slipway by then, and nothing it covers', () => {
  const HERS = STOCKED.reduce((n, s) => n + s.g.attributes.position.count / 3, 0);
  const heights = [];
  for (let stage = 0; stage < YARD_STAGES; stage++) {
    const built = build(stage);
    const drawn = Object.keys(SHIPYARD.parts).filter((n) => shownAtStage(n, stage));
    const own = drawn.reduce((n, p) => n + tris(p), 0);
    assert.equal(built.geometry.attributes.position.count / 3, own + (stage >= HULL_STAGE ? HERS : 0), `stage ${stage} merged something else`);
    const has = (what) => drawn.some((n) => n.startsWith(`shipyard ${what}`));
    const at = (what, stages) => assert.equal(has(what), stages.includes(stage), `stage ${stage}: ${what}`);
    at('s1-3 keel', [1, 2, 3]);
    at('s1-3 stems', [1, 2, 3]);
    at('s1-2 braces', [1, 2]);
    at('s2-3 bottom', [2, 3]);
    at('s2-2 cleats', [2]);
    at('s2-4 shores', [2, 3, 4]);
    at('s3-3 frames', [3]);
    at('s3-3 ribbands', [3]);
    at('s3-3 stern timbers', [3]);
    at('s3-4 ladder', [3, 4]);
    // The yard is there at every stage: the slipway, the shed, the sheerlegs, the kettle.
    for (const what of ['slipway', 'shed', 'sheerlegs', 'tar kettle', 'blocks']) assert.ok(has(what), `stage ${stage} has no ${what}`);
    assert.ok(built.anchors.smoke && built.anchors.smoke[1] > 0.3, 'the tar kettle does not smoke');
    heights.push(built.height);
    built.geometry.dispose();
  }
  // No mast ever stands on the slipway, so the sheerlegs are the tallest thing at every stage but
  // the last, where her crest's lanterns come within a hand of them.
  for (const h of heights) assert.ok(h > 4 && h < 5, `the yard stands ${h} tall: ${heights}`);
});

test('at stage 4 the hull on the ways is the Batavia\'s own bake, every vertex of it', () => {
  // Turned back out of the ways, each vertex drawn is a vertex of the part it came from, to a
  // tenth of a millimetre - looked up in a grid of hers, since a rounding boundary can fall
  // between two copies of one number.
  const cell = (v) => v.map((c) => Math.floor(c * 100));
  for (const { name, pts } of STOCKED) {
    const grid = new Map();
    for (const v of vertices(BATAVIA.parts[name])) {
      const k = cell(v).join();
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(v);
    }
    const hers = (p) => {
      const [i, j, k] = cell(p);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        for (const v of grid.get([i + a, j + b, k + c].join()) || []) if (Math.hypot(v[0] - p[0], v[1] - p[1], v[2] - p[2]) < 1e-4) return true;
      }
      return false;
    };
    for (const p of pts) assert.ok(hers(p), `${name}: ${p} is not one of hers`);
  }
  // Her skin, decks and bulwarks whole: the cut takes only what she is given afloat.
  for (const name of Object.keys(BATAVIA.parts).filter((n) => /^batavia (hull|livery)/.test(n))) {
    assert.equal(stocked(name).length, BATAVIA.parts[name].positions.length / 3, `${name} is not all there`);
  }
  // Her origin is the keel's, which the builder laid under her lines, and she lies at the ways'
  // own declivity.
  const keel = SHIPYARD.parts['shipyard s1-3 keel'];
  assert.deepEqual([STOCKS.x, STOCKS.y + SHIPYARD_LAND, STOCKS.z], keel.at);
  assert.ok(Math.abs(Math.tan(STOCKS.tilt) - 1 / 24) < 1e-4, `she lies at 1 in ${1 / Math.tan(STOCKS.tilt)}`);
});

test('her numbers on the stocks are her numbers on the roads', () => {
  const W = BATAVIA.anchors.waterline[1];
  const bottom = stocked(herPartOf(0xd8cfb9));
  const [z0, z1] = span(bottom, 2);
  const [, top] = span(bottom, 1);
  const skin = STOCKED.filter((s) => /^batavia (hull|livery)/.test(s.name)).flatMap((s) => s.pts);
  const [x0, x1] = span(skin, 0);
  const decks = [...new Set(stocked(herPartOf(0xab8c60)).map((p) => Math.round((p[1] - W) * 100) / 100))].sort((a, b) => a - b);
  const numbers = {
    waterline: z1 - z0, beam: x1 - x0, draught: top - Math.min(...skin.map((p) => p[1])),
    taffrail: Math.max(...stocked(herPartOf(0x873323)).map((p) => p[1])) - W,
  };
  const near = (a, b, what) => assert.ok(Math.abs(a - b) < 0.006, `${what} is ${a.toFixed(3)}, hers is ${b}`);
  near(numbers.waterline, 11.98, 'the length on the waterline');
  near(numbers.beam, 2.80, 'the beam');
  near(numbers.draught, 1.00, 'the draught');
  near(W, 1.00, 'the draught she is floated by');
  assert.deepEqual(decks, [1.1, 1.6, 1.65, 2.1], 'the waist, the forecastle, the quarterdeck and the poop');
  near(numbers.taffrail, 2.57, 'the taffrail');
  // The crest over the transom: the back of it, which is her one INNER-coloured fitting.
  const crest = Object.keys(BATAVIA.parts).find((n) => /^batavia fittings/.test(n) && hexOf(...BATAVIA.parts[n].colors.slice(0, 3)) === 0x873323);
  near(Math.max(...stocked(crest).map((p) => p[1])) - W, 3.03, 'the transom crest');
  // Stern to the sea: her transom is at the lot's sea end, her stem towards the land.
  const yard = (pred) => STOCKED.flatMap((s) => {
    const p = s.g.attributes.position.array, out = [];
    for (let i = 0; i < p.length; i += 3) if (pred(toHer([p[i], p[i + 1], p[i + 2]]))) out.push(p[i + 2]);
    return out;
  });
  assert.ok(Math.min(...yard((q) => q[2] < -6.1)) > 6.5, 'her transom is not over the water');
  assert.ok(Math.max(...yard((q) => q[2] > 6.3)) < -4.5, 'her stem is not towards the land');
});

test('on the stocks she is timber: none of her paint, nothing lit, nothing she is given afloat', () => {
  const PAINT = [0x2f5b3d, 0x8e2b20, 0x873323, 0xc79634, 0xb8352a, 0x3e6a92];
  for (const { name, g } of STOCKED) {
    const c = g.attributes.color.array;
    for (let i = 0; i < c.length; i += 3) assert.ok(!PAINT.includes(hexOf(c[i], c[i + 1], c[i + 2])), `${name} is still painted`);
    assert.ok(g.attributes.aEmissive.array.every((e) => e === 0), `${name} is lit`);
    assert.ok(!/^batavia (rig|flag|pennant)/.test(name), `${name} is rigging`);
  }
  for (const [name, part] of Object.entries(BATAVIA.parts)) if (part.emissive) assert.ok(stocksPaint(part) != null, `${name} glows on`);
  const all = STOCKED.flatMap((s) => s.pts);
  // No mast, yard or top: nothing of her stands over the lanterns on her crest.
  assert.ok(Math.max(...all.map((p) => p[1])) < 4.6, 'something of her rig is on the stocks');
  // No accommodation ladder or float down her starboard side, where nothing else reaches past
  // her channels; and no spare anchor under her port cathead.
  assert.ok(Math.min(...all.map((p) => p[0])) > -1.48, 'her boarding ladder hangs over the slipway');
  const iron = stocked(herPartOf(0x2f2f33));
  assert.ok(!iron.some(([x, y, z]) => x > 0.8 && x < 1.4 && y > 1.7 && y < 2.7 && z > 5.1 && z < 5.75), 'her spare anchor is catted');
  // And the stage-4 yard glows no more than the empty one: the lantern and the hearth.
  const lit = (s) => { const b = build(s); const n = b.geometry.attributes.aEmissive.array.filter((e) => e > 0).length; b.geometry.dispose(); return n; };
  assert.equal(lit(4), lit(0));
});

test('the bottom and the frames are on her lines, inside the skin stage 4 puts over them', () => {
  // Her skin in her own frame, cut by the plane of a station: the widest she is there, between
  // two heights. Cut rather than sampled, since her stations are half a unit apart amidships.
  const skin = Object.entries(BATAVIA.parts).filter(([n]) => /^batavia (hull:[0-2]|livery)/.test(n)).map(([, p]) => vertices(p));
  const beamNear = (z, y0, y1, of = skin) => {
    let wide = 0;
    for (const v of of) {
      for (let i = 0; i < v.length; i += 3) {
        for (const [p, q] of [[v[i], v[i + 1]], [v[i + 1], v[i + 2]], [v[i + 2], v[i]]]) {
          if ((p[2] - z) * (q[2] - z) > 0 || p[2] === q[2]) continue;
          const t = (z - p[2]) / (q[2] - p[2]);
          const y = p[1] + t * (q[1] - p[1]);
          if (y >= y0 - 1e-6 && y <= y1 + 1e-6) wide = Math.max(wide, Math.abs(p[0] + t * (q[0] - p[0])));
        }
      }
    }
    return wide;
  };
  const frames = points('shipyard s3-3 frames').map(bakeToHer);
  const stations = [...new Set(frames.map((p) => Math.round(p[2] * 10) / 10))].sort((a, b) => a - b);
  const clusters = [];
  for (const z of stations) if (!clusters.length || z - clusters.at(-1).at(-1) > 0.2) clusters.push([z]); else clusters.at(-1).push(z);
  assert.equal(clusters.length, 13, 'thirteen frames');
  for (const c of clusters) {
    const zc = (c[0] + c.at(-1)) / 2;
    const frame = frames.filter((p) => Math.abs(p[2] - zc) < 0.2);
    const [lo, hi] = span(frame, 1);
    const wide = Math.max(...frame.map((p) => Math.abs(p[0])));
    const hers = beamNear(zc, lo, hi);
    assert.ok(wide < hers + 0.005, `the frame at ${zc.toFixed(2)} stands out of her skin: ${wide} against ${hers}`);
    assert.ok(hers - wide < 0.12, `the frame at ${zc.toFixed(2)} is ${(hers - wide).toFixed(3)} inside her skin`);
  }
  // The shell is her bottom: as wide as her skin at its own heights, station by station.
  const shell = [points('shipyard s2-3 bottom').map(bakeToHer)];
  for (const z of [-4, -2, 0, 2, 4]) {
    const [lo, hi] = [0.3, 0.8];
    const mine = beamNear(z, lo, hi, shell), hers = beamNear(z, lo, hi);
    assert.ok(Math.abs(mine - hers) < 0.03, `the bottom at ${z} is ${mine.toFixed(3)} wide, she is ${hers.toFixed(3)}`);
  }
});

test('a stage that is missing, broken or out of range is read, not refused', () => {
  assert.equal(yardStage(spec()), 0);
  assert.equal(yardStage({ stage: null }), 0);
  assert.equal(yardStage({ stage: 'x' }), 0);
  assert.equal(yardStage({ stage: -3 }), 0);
  assert.equal(yardStage({ stage: 2.7 }), 2);
  assert.equal(yardStage({ stage: 9 }), 4);
  assert.equal(yardStage(null), 0);
  const none = build(), stocks = build(0);
  assert.equal(none.geometry.attributes.position.count, stocks.geometry.attributes.position.count);
});

test('at night the shed lantern and the hearth glow, and nothing of the ship does', () => {
  const glowing = Object.entries(SHIPYARD.parts).filter(([, p]) => p.emissive === 1).map(([n]) => n);
  assert.ok(glowing.some((n) => n.startsWith('shipyard shed lantern')), 'no lantern on the shed');
  assert.ok(glowing.some((n) => n.startsWith('shipyard tar kettle')), 'the hearth is cold');
  assert.ok(glowing.every((n) => !/^shipyard s\d/.test(n)), 'a ship on the stocks is not lit');
});

test('every stage stays inside its five by sixteen', () => {
  for (let stage = 0; stage < YARD_STAGES; stage++) {
    const built = build(stage);
    const b = built.geometry.boundingBox;
    assert.ok(b.min.x >= -YARD_W / 2 - 0.02 && b.max.x <= YARD_W / 2 + 0.02, `stage ${stage} is ${b.min.x}..${b.max.x} across`);
    assert.ok(b.min.z >= -YARD_D / 2 - 0.02 && b.max.z <= YARD_D / 2 + 0.02, `stage ${stage} is ${b.min.z}..${b.max.z} along`);
    // Lowered by its datum: y = 0 is the land, and the slipway goes on down into the sea.
    assert.ok(b.min.y < -1.5 && b.min.y > -SHIPYARD_LAND - 0.01, `stage ${stage} reaches down to ${b.min.y}`);
    built.geometry.dispose();
  }
});

// A coast: land a little higher inland, then a beach, then the sea, along whatever way the
// plot's sea end points.
const HALF = 64;
function lot(rot) {
  const odd = rot % 2 === 1;
  const plot = { gx: 40, gz: 30, w: odd ? YARD_D : YARD_W, d: odd ? YARD_W : YARD_D, rot };
  const centre = [plot.gx + plot.w / 2 - HALF, plot.gz + plot.d / 2 - HALF];
  const [sx, sz] = turnLocal(rot, 0, 1);            // the sea end, in the island's frame
  // How far along the lot towards the sea a point is, from its middle.
  const along = (x, z) => (x - centre[0]) * sx + (z - centre[1]) * sz;
  const heightAt = (x, z) => {
    const a = along(x, z);
    return a < -2 ? 0.9 - 0.02 * (a + 8) : 0.3 - 0.2 * (a + 2);
  };
  return { plot, centre, along, heightAt };
}

test('the yard is turned the way makeRecord turns it, for all four rots', () => {
  for (let rot = 0; rot < 4; rot++) {
    const yaw = Math.PI - rot * Math.PI / 2;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const [x, z] of [[1, 0], [0, 1], [2.5, -8], [-2.5, 8]]) {
      const [tx, tz] = turnLocal(rot, x, z);
      assert.ok(Math.abs(tx - (x * c + z * s)) < 1e-9 && Math.abs(tz - (-x * s + z * c)) < 1e-9, `rot ${rot} turns (${x}, ${z}) wrong`);
    }
  }
});

test('on all four rots the yard stands inside its plot, on the land of its landward rows', () => {
  for (let rot = 0; rot < 4; rot++) {
    const { plot, centre, along, heightAt } = lot(rot);
    const asked = [];
    const y = shipyardGround(plot, centre, (x, z) => { asked.push([x, z]); return heightAt(x, z); });
    // The highest corner of the landward rows is the far end of them, 0.9 there.
    assert.ok(Math.abs(y - 0.9) < 1e-9, `rot ${rot} stands at ${y}`);
    for (const [x, z] of asked) {
      assert.ok(x >= plot.gx - HALF - 1e-9 && x <= plot.gx + plot.w - HALF + 1e-9, `rot ${rot} asked outside the plot at x ${x}`);
      assert.ok(z >= plot.gz - HALF - 1e-9 && z <= plot.gz + plot.d - HALF + 1e-9, `rot ${rot} asked outside the plot at z ${z}`);
      assert.ok(along(x, z) <= -YARD_D / 2 + LAND_ROWS + 1e-9, `rot ${rot} asked the sea end at ${x}, ${z}`);
    }
    // And the model's own footprint, turned the same way, lies inside the plot.
    const built = build(4);
    const b = built.geometry.boundingBox;
    for (const [x, z] of [[b.min.x, b.min.z], [b.max.x, b.min.z], [b.min.x, b.max.z], [b.max.x, b.max.z]]) {
      const [dx, dz] = turnLocal(rot, x, z);
      const wx = centre[0] + dx, wz = centre[1] + dz;
      assert.ok(wx >= plot.gx - HALF - 0.03 && wx <= plot.gx + plot.w - HALF + 0.03, `rot ${rot}: a corner at x ${wx} is off the plot`);
      assert.ok(wz >= plot.gz - HALF - 0.03 && wz <= plot.gz + plot.d - HALF + 0.03, `rot ${rot}: a corner at z ${wz} is off the plot`);
    }
    // Its sea end is where the plot's water is: the model's +z end is over the lowest ground.
    const [fx, fz] = turnLocal(rot, 0, YARD_D / 2 - 0.5);
    assert.ok(heightAt(centre[0] + fx, centre[1] + fz) < 0, `rot ${rot} puts the slipway's toe on land`);
    built.geometry.dispose();
  }
});

test('a yard on a low beach is raised to its floor, and water corners are no ground', () => {
  const { plot, centre } = lot(2);
  assert.equal(shipyardGround(plot, centre, () => 0.2), YARD_FLOOR);
  assert.equal(shipyardGround(plot, centre, () => -0.8), YARD_FLOOR);
  let k = 0;
  assert.equal(shipyardGround(plot, centre, () => (k++ % 2 ? -0.5 : 1.1)), 1.1);
});

test('the shed, the stacks and the hearth are walked round; the strip along the ship is free', () => {
  for (const stage of [0, 4]) {
    const built = build(stage);
    const blocked = (x, z) => built.solids.some((r) => Math.abs(x - r.x) <= r.hx + WALK_BODY_R && Math.abs(z - r.z) <= r.hz + WALK_BODY_R);
    assert.ok(blocked(-1.4, -7.2), 'you walk through the shed');
    assert.ok(blocked(0.8, -7.2), 'you walk through the logs');
    assert.ok(blocked(-2.08, -4.55), 'you walk through the tar kettle');
    // The ship, on the slipway, whose solid she stands inside.
    for (const z of [-4, 0, 4, 6]) assert.ok(blocked(0, z) && blocked(1.3, z), `you walk into the ship at ${z}`);
    // In at the gate and down the side of her to the water, clear of everything.
    for (let z = -7.9; z <= 7.9; z += 0.1) assert.ok(!blocked(2.3, z), `the strip along the ship is shut at ${z.toFixed(1)}`);
    built.geometry.dispose();
  }
});
