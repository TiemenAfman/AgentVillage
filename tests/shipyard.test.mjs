// The shipyard and the ship on its stocks (scripts/build-shipyard.py, web/js/shipyard.js,
// Plans/scheepswerf.md).
//
// What is held here:
//   the ship    she is the Batavia the rede will get: about 12 on the waterline, 2.8 in the
//               beam, her main deck 1.1 over where she will float, a high flat transom, lower
//               masts 7 to 8 over the keel - and her stern is to the sea, as a ship is launched.
//   the stages  each of 0 to 4 draws, and draws exactly its parts: the frames only as frames,
//               the planking from 3, the masts at 4; anything missing or broken is the stocks.
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
const { buildBuilding, SHIPYARD_LAND, WALK_BODY_R } = await import('../web/js/buildings.js');
const { yardStage, shownAtStage, shipyardGround, turnLocal, YARD_W, YARD_D, YARD_FLOOR, LAND_ROWS, YARD_STAGES } = await import('../web/js/shipyard.js');
const { SHIPYARD } = await import('../web/js/shipyard-mesh.js');
const { HERO_BUDGET, checkSet } = await import('../scripts/model-rules.mjs');
delete globalThis.document;

const spec = (stage) => ({ id: `c:shipyard:${stage}`, kind: 'civic', civicType: 'shipyard', tier: 'civic', style: 'unknown', ornaments: [], ...(stage === undefined ? {} : { stage }) });
const build = (s) => {
  globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
  try { return buildBuilding(spec(s)); } finally { delete globalThis.document; }
};
const tris = (n) => SHIPYARD.parts[n].positions.length / 9;
// Every vertex of the parts whose name starts so, in the set's own frame (pile feet at 0).
function points(prefix) {
  const out = [];
  for (const [name, p] of Object.entries(SHIPYARD.parts)) {
    if (!name.startsWith(prefix)) continue;
    for (let i = 0; i < p.positions.length; i += 3) out.push([p.positions[i] + p.at[0], p.positions[i + 1] + p.at[1], p.positions[i + 2] + p.at[2]]);
  }
  assert.ok(out.length, `no part called ${prefix}`);
  return out;
}
const span = (pts, k) => [Math.min(...pts.map((p) => p[k])), Math.max(...pts.map((p) => p[k]))];
// She lies on the ways at their declivity, so a height is only a height in her own frame. The
// tilt is read off the bottom of her keel, fore end to aft end, and turned back out of every
// point: afterwards y is up from the keel's line and the waterline is one level.
const KEEL = points('shipyard s1-4 keel');
const bottomAt = (z) => Math.min(...KEEL.filter((p) => Math.abs(p[2] - z) < 0.01).map((p) => p[1]));
const [KZ0, KZ1] = span(KEEL, 2);
const TILT = Math.atan2(bottomAt(KZ0) - bottomAt(KZ1), KZ1 - KZ0);
const level = (pts) => pts.map(([x, y, z]) => [x, y * Math.cos(TILT) + z * Math.sin(TILT), -y * Math.sin(TILT) + z * Math.cos(TILT)]);

test('the bake is within the rules, as one hero, and every part is the yard or a stage', () => {
  assert.deepEqual(checkSet('shipyard', SHIPYARD), []);
  const total = Object.keys(SHIPYARD.parts).reduce((n, name) => n + tris(name), 0);
  assert.ok(total <= HERO_BUDGET, `${total} triangles against ${HERO_BUDGET}`);
  for (const name of Object.keys(SHIPYARD.parts)) {
    assert.ok(name.startsWith('shipyard '), `${name} is not named after the set`);
    const m = /^shipyard s(\d)-(\d) /.exec(name);
    if (m) assert.ok(Number(m[1]) >= 1 && Number(m[1]) <= Number(m[2]) && Number(m[2]) <= 4, `${name} names stages that do not exist`);
  }
  // The datum the island lowers it by is the one build-shipyard.py modelled to.
  assert.equal(SHIPYARD_LAND, 1.9);
});

test('the hull on the stocks is the Batavia: 12 on the waterline, 2.8 in the beam, the deck 1.1 over it', () => {
  // The pale bottom stops exactly on the row she will float at, so its length is the length
  // on the waterline - that row is the longest one under it, the stem raking forward above it.
  const bottom = points('shipyard s3-4 bottom');
  const [z0, z1] = span(bottom, 2);
  assert.ok(Math.abs(z1 - z0 - 12) < 0.5, `${(z1 - z0).toFixed(2)} long on the waterline`);
  const hull = [...points('shipyard s3-4 topsides'), ...points('shipyard s3-4 wales'), ...bottom];
  const [x0, x1] = span(hull, 0);
  assert.ok(Math.abs(x1 - x0 - 2.8) < 0.1, `${(x1 - x0).toFixed(2)} in the beam`);
  assert.ok(Math.abs(x0 + x1) < 1e-6, 'she is not symmetric');
  // In her own frame the waterline is the top of the bottom, and the main deck the lowest of
  // her four decks: the waist's, between the forecastle and the quarterdeck.
  const wl = Math.max(...level(bottom).map((p) => p[1]));
  const deck = Math.min(...level(points('shipyard s3-4 decks:0')).map((p) => p[1]));
  assert.ok(Math.abs(deck - wl - 1.1) < 0.02, `the main deck is ${(deck - wl).toFixed(3)} over the waterline`);
  assert.ok(TILT > 0.03 && TILT < 0.05, `she lies at ${TILT}, not at the ways' 1 in 24`);
  // A high stern with a flat transom: the transom is one plane, and it stands well over the
  // waist's deck.
  const transom = points('shipyard s3-4 transom:0');
  const [a, b, c] = [transom[0], transom[1], transom[2]];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = Math.hypot(...n);
  for (const p of transom) {
    const d = ((p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1] + (p[2] - a[2]) * n[2]) / len;
    assert.ok(Math.abs(d) < 1e-4, `the transom is not flat by ${d}`);
  }
  assert.ok(Math.max(...level(transom).map((p) => p[1])) - deck > 0.9, 'the stern is not high');
});

test('she is built stern to the sea, and the masts stand 7 to 8 over her keel', () => {
  const transom = points('shipyard s3-4 transom:0');
  const stems = points('shipyard s1-4 stems');
  // +z is the sea end of the model: the transom is out there, the stem head towards the land.
  assert.ok(Math.min(...transom.map((p) => p[2])) > 5, 'the transom is not at the sea end');
  assert.ok(Math.min(...stems.map((p) => p[2])) < -5, 'the stem is not at the land end');
  const keel = Math.min(...level(KEEL).map((p) => p[1]));
  const rise = Math.max(...level(points('shipyard s4-4 masts')).map((p) => p[1])) - keel;
  assert.ok(rise > 7 && rise < 8.2, `the mainmast stands ${rise.toFixed(2)} over the keel`);
  // And the keel lies on the ways at their declivity: lower at the sea end.
  assert.ok(bottomAt(KZ1) < bottomAt(KZ0), 'the keel does not fall towards the water');
});

test('each stage draws, and draws what it shows and nothing it covers', () => {
  const heights = [];
  for (let stage = 0; stage < YARD_STAGES; stage++) {
    const built = build(stage);
    const drawn = Object.keys(SHIPYARD.parts).filter((n) => shownAtStage(n, stage));
    assert.equal(built.geometry.attributes.position.count / 3, drawn.reduce((n, p) => n + tris(p), 0), `stage ${stage} merged something else`);
    const has = (what) => drawn.some((n) => n.includes(what));
    assert.equal(has(' keel'), stage >= 1, `stage ${stage}: the keel`);
    assert.equal(has(' frames'), stage === 2, `stage ${stage}: the frames`);
    assert.equal(has(' bottom'), stage >= 3, `stage ${stage}: the planking`);
    assert.equal(has(' masts'), stage === 4, `stage ${stage}: the masts`);
    // The yard is there at every stage: the slipway, the shed, the sheerlegs, the kettle.
    for (const what of ['slipway', 'shed', 'sheerlegs', 'tar kettle', 'blocks']) assert.ok(has(`shipyard ${what}`), `stage ${stage} has no ${what}`);
    assert.ok(built.anchors.smoke && built.anchors.smoke[1] > 0.3, 'the tar kettle does not smoke');
    heights.push(built.height);
    built.geometry.dispose();
  }
  // The yard stands as tall as its sheerlegs until the masts go in.
  assert.ok(heights[4] > heights[3] + 2, `the masts do not make her taller: ${heights}`);
  assert.ok(heights[0] > 4 && heights[0] < 5, `the sheerlegs stand ${heights[0]}`);
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

test('at night the shed lantern and the hearth glow, and nothing on the ship does', () => {
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
