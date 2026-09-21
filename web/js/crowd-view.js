// Somebody else's settlers, drawn from what the sea says.
//
// Our own island still walks its crowd here in the page - the same shared/settlerwalk.mjs
// the sea runs, through web/js/settlers.js - because it is ours and it is free. Every other
// island's people arrive as positions on a wire, and this draws them.
//
// It reuses the drawing half exactly as it is. createFigures() wants figure objects with a
// position, a heading and one word saying which animation to play; it does not care whether
// a walk wrote those or a socket did. That is the whole payoff of the split: no second
// renderer, no second set of meshes, and a guest island's crowd costs the same eleven draw
// calls ours does however many people are on it.
//
// Two things are deliberately not here. No nameplates - CLAUDE.md records what 41 of them
// cost on one guest island, and a crowd is not 41 but 274. And no faces on the wire: the
// roster carries building ids, and settlerLook hashes the identical person out of one on
// both sides, which is the promise the wardrobe has always made.
import { createFigures } from './settler-figures.js';
import { createBoat } from './boat.js';
import { settlerLook, kindOf, styleOf } from 'shared/palette.mjs';

// How far behind the sea we draw. The same reasoning and the same number as web/js/peers.js:
// far enough back that the next message has almost always arrived, close enough that
// nobody is watching the past. Walkers come at 5 Hz, so this is one message of slack.
const LAG_MS = 220;
// And how long we will guess for when one does not arrive. Past this a body holds still
// rather than sliding off across the water on a stale heading.
const MAX_GUESS_MS = 400;

export function createCrowdView({ scene, material, region, buildings = [] }) {
  const view = createFigures(scene, material);
  // index -> the figure the renderer draws, plus where it is coming from and going to.
  const figures = new Map();
  // The village's buildings by id, so a roster entry can be dressed. A guest island's
  // bundle is already on the region; this is only a faster way to look one up.
  const byId = new Map(buildings.map((b) => [b.id, b]));
  const [ox, oz] = region.origin;

  // The afternoon boats. index -> what the last message said about that outing, and
  // index -> the hull drawn for it. Two maps rather than one object, because the hull is
  // ours and the row is theirs and only one of the two survives a message.
  const rides = new Map();
  const hulls = new Map();

  // The same bodies, by building id. The wire counts in indices because that is what is
  // cheap to send; everything on this side that is *about* somebody - the dossier, the
  // hover label, a filter, a conversation - has always known them by the id of the house
  // they live in. Kept beside the index map rather than searched for, because the picker
  // runs on every mouse move.
  const byIdx = new Map();

  // Who the indices mean. Sent when the island arrives and again when its village changes,
  // which is the only time the order can move.
  function roster(ids) {
    for (const [idx, f] of figures) if (ids[idx] !== f.id) retire(idx);
    ids.forEach((id, idx) => {
      if (figures.has(idx)) return;
      const spec = byId.get(id);
      if (!spec) return;                      // a settler whose house we have not got yet
      const kind = kindOf(spec);
      const look = settlerLook(id, styleOf(spec), kind);
      const f = {
        id, spec,
        // What the renderer reads. The walk would have written these; a socket does now.
        pos: [ox, oz], y: 0, yaw: 0, anim: 'still', mode: 'idle', speed: 0.42,
        face: null, turn: 0.12, faceAngle: null, visible: true,
        // Where it is coming from and going to, and when. See `draw`.
        from: null, to: null, at: 0, took: 1,
      };
      if (!view.enrol(f, look, kind)) return;  // the crowd is full; better a gap than a lie
      figures.set(idx, f);
      byIdx.set(id, f);
    });
  }

  function retire(idx) {
    const f = figures.get(idx);
    if (!f) return;
    f.visible = false;
    view.hide(f);
    figures.delete(idx);
    if (byIdx.get(f.id) === f) byIdx.delete(f.id);
  }

  // Taken out of sight without being forgotten: a filter, a chronicle scrubbed back past
  // the day they arrived, a house that is popping in or out. A separate word from
  // `visible`, which `draw` writes every frame - hanging a filter on that one would put
  // everybody back the next time anything moved.
  function setVisible(id, on) {
    const f = byIdx.get(id);
    if (!f) return;
    f.hidden = !on;
  }

  // A message from the sea. Positions are in the island's OWN frame, so they survive a
  // re-berth and cost fewer digits; the origin goes on here, once, where the two frames
  // meet - which is the same asymmetry shared/regions.mjs is built around.
  function apply(rows, now) {
    for (const [idx, at] of rows) {
      const f = figures.get(idx);
      if (!f) continue;
      const x = at.x + ox, z = at.z + oz;
      // The first word about a body is where it *is*, and not where it is going.
      //
      // A figure enrolled by a roster sits at `pos = [ox, oz]` - the island's own middle,
      // because that is all a roster knows - so interpolating from there to its first real
      // position walked it out of the town square in a dead straight line to its own front
      // door. The `!f.to` guard in draw() kept it from being *seen* standing in the middle;
      // it could not keep it from setting off from there. Every enrolment did it: at boot,
      // after a reseed, and for the whole village at once whenever a roster came back
      // under different names (see ourRoster in main.js). A hundred settlers gliding off
      // the square in formation, once a minute.
      if (!f.to) { f.pos[0] = x; f.pos[1] = z; }
      // Where it was when the last message landed becomes where it is coming from. Taking
      // the *drawn* position rather than the last message's keeps a body that was still
      // interpolating from jumping back to catch up.
      f.from = [f.pos[0], f.pos[1]];
      f.to = [x, z];
      f.took = Math.max(40, now - f.at);
      f.at = now;
      f.anim = at.anim;
      f.mode = at.anim === 'walk' ? 'walk' : at.anim === 'hammer' ? 'hammer' : 'idle';
    }
  }

  // The dinghies, which arrive whole every beat - so a row that is not in this message is
  // an outing that has finished, and its hull comes out of the water here.
  //
  // No interpolation on a hull. It is sent every beat where a walker is sent every fourth,
  // and it moves at CRUISE - a fifth of a unit between messages, at the distance another
  // island is watched from. The body standing in it comes in the same row for the same
  // reason, so the two can never drift apart.
  function applyRides(rows, now) {
    for (const [idx, hull] of hulls) {
      if (rows.has(idx)) continue;
      hull.dispose();
      hulls.delete(idx);
      // Ashore again, and the crowd's own interpolation takes over on the next message.
      // Its clock is restarted here: `apply` measures how long the last step took from
      // `at`, and a voyage's worth of staleness would make the first step ashore crawl.
      const f = figures.get(idx);
      if (f) { f.from = null; f.to = null; f.at = now; f.faceAngle = null; }
    }
    rides.clear();
    for (const [idx, r] of rows) rides.set(idx, r);
  }

  // Draw everybody where they have got to. Positions are interpolated from the last two
  // messages and then extrapolated a little; the heading comes out of the movement, which
  // is exactly what the renderer already does for our own settlers - it is handed a
  // direction rather than an angle either way.
  // `now` is the caller's clock, and it has to be the same one `apply` was given: the two
  // are subtracted from each other. Handing draw() an accumulated dt while apply() stamped
  // performance.now() is a bug that reads as every body standing perfectly still - the
  // difference comes out as a number of hours and the interpolation clamps at its far end,
  // for ever.
  function draw(dt, groundAt, now, showing = true) {
    // Off while the chronicle is scrubbed back. Their people are here, now, and the island
    // on the screen is somebody's island in May - so they are hidden rather than left to
    // walk through a history they were not in. The positions keep arriving and keep being
    // applied, so coming back to Live puts everybody where they actually are.
    if (!showing) {
      for (const f of figures.values()) { if (f.visible) { f.visible = false; view.hide(f); } }
      for (const hull of hulls.values()) hull.object.visible = false;
      return;
    }
    // Whoever is on the water first: their hull decides where they are, how high and
    // which way round, so none of the interpolation below applies to them.
    const time = now / 1000;
    for (const [idx, r] of rides) {
      let hull = hulls.get(idx);
      if (!hull) { hull = createBoat({ scene, material }); hulls.set(idx, hull); }
      hull.object.visible = true;
      hull.place(r.x + ox, r.z + oz, r.yaw);
      hull.bob(time);
      const f = figures.get(idx);
      if (!f || f.hidden) continue;
      if (!f.visible) f.visible = true;
      f.pos[0] = r.rx + ox;
      f.pos[1] = r.rz + oz;
      // The height on the wire is the deck with no swell in it - see the note on
      // encodeRides - so the rise this hull happens to be on goes on here. That makes a
      // seated rider exactly hull.deck() without a clock ever having been sent.
      f.y = r.ry + hull.object.position.y;
      f.face = null;
      f.faceAngle = r.ryaw;
      f.anim = 'still';
      f.mode = 'idle';
    }
    for (const [idx, f] of figures) {
      if (f.hidden) { if (f.visible) { f.visible = false; view.hide(f); } continue; }
      // Already placed by the hull they are standing in.
      if (rides.has(idx)) continue;
      // And nobody at all before the sea has said where they are. A body enrolled by a
      // roster starts at `pos = [ox, oz]`, which is the island's own middle, and stood
      // there in plain sight until its slice came round - up to ten seconds of a stranger
      // in the town square. It shows worst at the one moment it matters most: a newcomer
      // is enrolled and walked up from the beach in the same breath, so the arrival began
      // with them standing on the square and vanishing.
      if (!f.to) { if (f.visible) { f.visible = false; view.hide(f); } continue; }
      if (!f.visible) f.visible = true;
      const age = now - f.at;
      const t = Math.min((age + LAG_MS) / f.took, 1 + MAX_GUESS_MS / f.took);
      const nx = f.from[0] + (f.to[0] - f.from[0]) * t;
      const nz = f.from[1] + (f.to[1] - f.from[1]) * t;
      const dx = nx - f.pos[0], dz = nz - f.pos[1];
      f.pos[0] = nx;
      f.pos[1] = nz;
      // Only turn when actually going somewhere: a body nudged a centimetre by a late
      // message should not spin to face it.
      if (dx * dx + dz * dz > 1e-6) f.face = [dx, dz];
      f.y = groundAt ? groundAt(nx, nz) : 0;
    }
    view.draw(figures, dt);
  }

  function dispose() {
    for (const idx of [...figures.keys()]) retire(idx);
    byIdx.clear();
    view.dispose();
    for (const hull of hulls.values()) hull.dispose();
    hulls.clear();
    rides.clear();
  }

  return {
    roster, apply, applyRides, draw, dispose, setVisible,
    count: () => figures.size,
    // The bodies themselves, for anything that wants to look: the hover labels, a
    // measurement, a console. Read-only by convention - the sea owns where these are.
    figures: () => figures,
    // And by the name the rest of the island calls them. `figure` is the one lookup
    // everything that is about a person goes through.
    figure: (id) => byIdx.get(id) || null,
    byId: () => byIdx,
    // Picking somebody out of the crowd with the mouse. Straight through to the meshes:
    // a view has no opinion about it, and the figures are instanced, so an instance id is
    // the only way back from a ray to a body.
    pickables: () => view.pickables(),
    figureAt: (object, instanceId) => view.figureAt(object, instanceId),
  };
}
