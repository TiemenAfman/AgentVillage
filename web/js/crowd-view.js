// Everybody's settlers, ours included, drawn from what the sea says.
//
// Nobody is simulated in the page any more: the sea walks every crowd off the same
// shared/settlerwalk.mjs and sends where they got to, and this draws it. Our own island is
// on that wire like any other - see the note where main.js makes the view for it.
//
// It reuses the drawing half exactly as it is. createFigures() wants figure objects with a
// position, a heading and one word saying which animation to play; it does not care whether
// a walk wrote those or a socket did. That is the whole payoff of the split: no second
// renderer, no second set of meshes, and a guest island's crowd costs the same eleven draw
// calls ours does however many people are on it.
//
// What a socket cannot do is write a position sixty times a second, so the work of this
// file is turning five words a second into somebody walking. The rule is the one every
// networked game ends up at: a body sets off from where it is *drawn* towards the newest
// word and gets there in about the time the next word takes to arrive, so it is always one
// message behind the sea and never stands still between two. The first version of this
// file added the lag to the clock instead of accepting it, which put every walker a whole
// message *ahead* of the sea, overshooting on every word and creeping back before the next -
// a step forward and a shuffle back five times a second, with the head snapping round each
// time. tests/crowd-view.test.mjs walks a straight line through it now.
//
// Plans/ik-wil-graag-mutliplayer-splendid-nest.md asked for web/js/peers.js's rule here -
// draw LAG_MS behind and interpolate between the last two words - and this is that rule
// with one change: the near end is where the body is drawn, not the word before. A player's
// words come ten a second at one rate; a settler's come at two, five a second while walking
// and once every KEYFRAME_S standing, and a fixed lag that always has a pair to interpolate
// between at the slow rate is a ten-second glide. Setting off from the drawn position needs
// no lag at all and cannot snap back when a word is late.
//
// Two things are deliberately not here. No nameplates - CLAUDE.md records what 41 of them
// cost on one guest island, and a crowd is not 41 but 274. And no faces on the wire: the
// roster carries building ids, and settlerLook hashes the identical person out of one on
// both sides, which is the promise the wardrobe has always made.
import { createFigures, SETTLER_DRINK_S } from './settler-figures.js';
import { createTipsy, drinkIn, stepTipsy, settlerSway, SETTLER_TIPSY } from './tipsy.js';
import { createBoat } from './boat.js';
import { kindOf, styleOf, residentLook } from 'shared/palette.mjs';
import { isGuard, isCodex, GUARDHOUSE_ID } from 'shared/volcano.mjs';
import { lerpAngle } from 'shared/settlerwalk.mjs';
import { SEA_LEVEL } from 'shared/terrain.mjs';
import { impsOn, wantsImp, createImp, pickImps, IMP_LIMIT, IMP_SCALE } from './imp.js';

// How high over its feet an agent's health bar floats (agent-bars.js): over an imp's horns
// (1.08 m of model at IMP_SCALE), or over a settler's hat - RESIDENT_HEIGHT 0.43 units times
// its own look.height.
const BAR_OVER_IMP = 1.08 * IMP_SCALE + 0.1;
const BAR_OVER_SETTLER = 0.43;
const BAR_CLEAR = 0.14;
import { MOVING } from 'shared/settlerwire.mjs';
import { GOLDPIT_ID } from 'shared/gold.mjs';

// What a body does standing still that is not merely standing: the hammer and the chores
// (Plans/inwoners-aan-het-werk.md). Taken at the sea's word whenever the body is not
// moving on this screen, exactly as the hammer always was.
// 'load' is bent over a wheelbarrow at the gold pit (Plans/goudkuil.md).
const AT_WORK = new Set(['hammer', 'hoe', 'weed', 'chop', 'gather', 'fish', 'load']);
// Walks with something in hand, each kept to its own last stride rather than turned back
// into a plain walk: a bundle of sticks, and a wheelbarrow to or from the gold pit.
const LADEN = ['haul', 'carry', 'barrow'];

// How long a body may take to reach the newest word about it. It is normally the time
// since the word before - a walker's 200 ms - so that it arrives as the next one lands.
// The two ceilings are for the gaps that are not that: a walker's first word after a long
// stand, or after a stall on the wire, is capped near its own rate so the body sets off at
// once rather than spending the whole of the measured gap barely moving; and a keyframe -
// the other two hundred, placed once every KEYFRAME_S - is capped at about what an idle
// step takes on the sea's own clock, so it reads as the step it stands for rather than as
// a ten-second glide.
const WALK_TOOK_MS = 300;
const STAND_TOOK_MS = 600;
const MIN_TOOK_MS = 40;
// How long we carry on along the last direction when the next word is late. Past this a
// body holds still rather than sliding off on a stale heading; and it only applies to
// somebody who was *walking* when last heard from. A body the sea said was standing is
// not going anywhere, and guessing that it might put every errand a hand's width past its
// own front door until the next keyframe fetched it back.
const MAX_GUESS_MS = 150;
// Further than anybody can walk between two words. A body that turns up this far from
// where it was drawn did not walk there: the sea rebuilt its crowd and stood everybody at
// their own door again, or a newcomer was put down on the landing beach. Either way it is
// the first word about a body all over again, and it snaps rather than streaking across
// the island. The fastest legitimate mover - a newcomer coming up from the beach, at
// path.length / 7.5 units a second - covers about three units a message on a big island.
const SNAP_U = 6;
// Slower than this and a body is standing, whatever word came with its position. The
// gliding keyframes move at a few centimetres a second and the extrapolation clamp holds a
// late walker dead still, and a body treading air in a walking gait is what both of those
// look like without it.
const STANDING_U_S = 0.05;
// How far under the surface a body out of its depth is drawn. Guards on a hostile island
// swim a strip off the coast now (lib/hostility.mjs, GUARD_SWIM), and the stand height is
// the ground's - which out there is the sea bed, a metre or more down, so they chased you
// along the bottom. Clamped to the water instead, deep enough that only the chest and head
// show: the figures have no swimming pose, and an upright body at the player's own
// SWIM_SINK (walk.js) reads as walking on the water.
const WADE_Y = -0.22;
// How briskly somebody held by a conversation turns to the talker: the walk's own number
// for it, in the `attend` branch of shared/settlerwalk.mjs, where it is a literal.
const HELD_TURN = 0.12;

// `player` is where this page's own walker is (scene frame, like every position here), or
// null when nobody is on foot, and `eye` where the camera is - only the volcano's imps use
// either. `imp` makes the stand-in for one guard, (id) => actor or null while there is none
// to be had; web/js/imp.js by default, a stub in the tests. `impLimit` is how many stand at
// once. See syncImps below.
export function createCrowdView({
  scene, material, region, buildings = [], player = null, eye = null, imp: makeImp = null, impLimit = IMP_LIMIT,
}) {
  // A hostile island's people are armed (lib/hostility.mjs is what makes them chase you;
  // this is only what makes it look like they mean it). Read off the bundle the region
  // was raised from, the same flag the sea reads - there is no second copy of it.
  const armed = region.village?.island?.hostile === true;
  const view = createFigures(scene, material, { armed });
  // index -> the figure the renderer draws, plus where it is coming from and going to.
  const figures = new Map();
  // The village's buildings by id, so a roster entry can be dressed. A guest island's
  // bundle is already on the region; this is only a faster way to look one up.
  let byId = new Map(buildings.map((b) => [b.id, b]));
  // The last roster, so a change of buildings can dress again whoever it touched without
  // waiting for the sea to say who the numbers mean once more - see setBuildings.
  let lastIds = [];
  // On an island with a gold pit every house keeps a wheelbarrow (Plans/goudkuil.md): it goes
  // along on a trip for gold and stands beside its settler while they hammer. Worked out here
  // from the buildings rather than sent - the page already knows who is hammering and whether
  // there is a pit, so every screen draws the same barrows, after a reload too.
  let barrowsAtHome = byId.has(GOLDPIT_ID);
  const [ox, oz] = region.origin;

  // The afternoon boats. index -> what the last message said about that outing, and
  // index -> the hull drawn for it. Two maps rather than one object, because the hull is
  // ours and the row is theirs and only one of the two survives a message.
  const rides = new Map();
  const hulls = new Map();
  // Who is in the middle of a conversation, and where the talker stands, by index: what the
  // sea last said about it, whole (`held` below). Kept apart from the figures, and by index
  // rather than on a body, because it is the sea's word about a number - it can land before
  // our own roster has been translated and the body exists, and it is kept across a re-dress.
  const talkers = new Map();

  // The volcano's guards, drawn as lava imps instead of as members of the crowd.
  //
  // Each figure stays in the crowd - enrolled, interpolated, found by its id - and only its
  // drawing is swapped: every frame its instanced body is parked out of sight and its imp is
  // put where the body would have been drawn. That keeps every rule above (the snap, the
  // guess, the wade, the ride) in one place, and it means an imp that never arrives - still
  // loading, failed, a page that has not finished booting, or a guard past the nearest
  // `impLimit` - leaves the guard exactly the figure it always was. Codex residents lodging
  // in the guardhouse are not guards and stay settlers. Hovering a guard names him either way:
  // web/js/guest-pick.js picks by the figure's drawn position, which is where the imp stands.
  const standIn = impsOn(region) ? (makeImp || ((id) => createImp(scene, id))) : null;
  const imps = new Map();   // guard id -> { f, actor }

  // The same bodies, by building id. The wire counts in indices because that is what is
  // cheap to send; everything on this side that is *about* somebody - the dossier, the
  // hover label, a filter, a conversation - has always known them by the id of the house
  // they live in. Kept beside the index map rather than searched for, because the picker
  // runs on every mouse move.
  const byIdx = new Map();

  // The beer the player has handed round (Plans/bier-en-dronken.md), by building id rather
  // than on the figure: a roster or a change of buildings enrols a fresh body for the same
  // person, and a settler four beers down should not be sobered by a re-dress. This page's
  // alone - the sea walks them and knows nothing of it - so what it changes is only how they
  // are drawn here (`f.sway`, settler-figures.js). `sipping` is who is drinking one right now
  // and until when, so they keep facing whoever gave it them until it is down.
  const merry = new Map();     // id -> tipsy pool
  const sipping = new Map();   // id -> { f, until }

  // Who the indices mean. Sent when the island arrives and again when its village changes,
  // which is the only time the order can move - and on the volcano whenever a guard comes
  // out or falls, which never moves it: a new guard is appended, and a fallen one is a
  // `null` hole that retires whoever stood there and enrols nobody (shared/settlerwire.mjs).
  // Which building somebody is dressed against. Their own house, which is every settler
  // on every island - and on the volcano a Codex settler's house, whose id is theirs too
  // (`codex:<island>:<id>`). A guard has no house of their own: they live in the
  // guardhouse, and it is the one building a guard can be dressed against; so does a Codex
  // settler the plots ran out for (lib/residents.mjs). The face comes from their own id -
  // settlerLook hashes it - so each is somebody, where dressing them from the building's id
  // would have made every guard on the mountain the same man. lib/crowd.mjs passes the same
  // three arguments, so the stride the sea gave them fits the legs drawn here.
  const specFor = (id) => byId.get(id) || (isGuard(id) || isCodex(id) ? byId.get(GUARDHOUSE_ID) : null) || null;
  // What about that building shows on the body: which one it is, its palette and its kind.
  const dressOf = (spec) => `${spec.id}|${styleOf(spec)}|${kindOf(spec)}`;

  function roster(ids) {
    lastIds = ids;
    for (const [idx, f] of figures) if (ids[idx] !== f.id) retire(idx);
    ids.forEach((id, idx) => {
      if (figures.has(idx) || !id) return;
      const spec = specFor(id);
      if (!spec) return;                      // a settler whose house we have not got yet
      const kind = kindOf(spec);
      // residentLook, not settlerLook: the innkeeper and the mayor wear their dress over
      // the face the id hashes to, and the sea sized their stride from the same call. Their
      // own id and not the building's, so a guard dressed against the guardhouse is still
      // somebody of their own.
      const look = residentLook(spec, id);
      const f = {
        id, spec,
        // What the renderer reads. The walk would have written these; a socket does now.
        pos: [ox, oz], y: 0, yaw: 0, anim: 'still', mode: 'idle', speed: 0.42,
        face: null, turn: 0.12, faceAngle: null, visible: true,
        // Where it is coming from and going to, and when, and what the sea said it was
        // doing when it got there. See `apply` and `draw`.
        from: null, to: null, at: 0, took: 1, said: 'still', came: 'still',
        // How tall they are drawn, for the bar over their head; and their health as the sea
        // last told it (`hit`), null for "never hit": whole.
        tall: look.height || 1, hp: null, hpMax: null,
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
    // Freed rather than hidden: the slot goes back to the view for whoever is enrolled next,
    // which on the volcano - guards falling, Codex settlers arriving and leaving - is the
    // difference between a crowd that lasts the evening and one that fills up.
    if (view.free) view.free(f); else view.hide(f);
    figures.delete(idx);
    if (byIdx.get(f.id) === f) byIdx.delete(f.id);
  }

  // The island's buildings changed while it stands - the volcano's Codex houses (web/js/main.js,
  // the `codex` message). Whoever now lives in a different building, or is dressed
  // differently by it, is retired and enrolled again from the last roster, at the same index,
  // with the new clothes; whoever was waiting for a house they can be dressed against is
  // enrolled now; everybody else keeps their body and just learns their building. A retired
  // body is hidden until the sea next places it, and the sea places everybody at once right
  // after it sends the houses (lib/sea.mjs), so a move reads as a blink.
  function setBuildings(list = []) {
    byId = new Map(list.map((b) => [b.id, b]));
    barrowsAtHome = byId.has(GOLDPIT_ID);
    for (const [idx, f] of [...figures]) {
      const spec = specFor(f.id);
      if (!spec || dressOf(spec) !== dressOf(f.spec)) retire(idx);
      else f.spec = spec;
    }
    roster(lastIds);
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
      //
      // And so is any word that puts a body further away than it could have walked - see
      // SNAP_U. The sea rebuilding a crowd is the everyday case: everybody is back at their
      // own door, and a walker who was twenty units out would otherwise streak home.
      const dx = x - f.pos[0], dz = z - f.pos[1];
      if (!f.to || dx * dx + dz * dz > SNAP_U * SNAP_U) { f.pos[0] = x; f.pos[1] = z; }
      // Where it was when the last message landed becomes where it is coming from. Taking
      // the *drawn* position rather than the last message's keeps a body that was still
      // interpolating from jumping back to catch up.
      f.from = [f.pos[0], f.pos[1]];
      f.to = [x, z];
      const cap = MOVING.has(at.anim) ? WALK_TOOK_MS : STAND_TOOK_MS;
      f.took = Math.min(cap, Math.max(MIN_TOOK_MS, now - f.at));
      f.at = now;
      // What the sea said the body was doing, and what it said the time before. draw()
      // decides what is *shown* from these and from whether the body is actually moving on
      // this screen - see there.
      f.came = f.said;
      f.said = at.anim;
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
      // Until it lands they stand where the hull left them: this used to clear `to`, which
      // is the "never heard of" state, and draw() hides a body in that state - so somebody
      // stepping off a boat vanished for up to a keyframe. The clock is restarted here
      // because `apply` measures how long the last step took from `at`.
      const f = figures.get(idx);
      if (f) {
        f.from = [f.pos[0], f.pos[1]];
        f.to = [f.pos[0], f.pos[1]];
        f.at = now;
        f.faceAngle = null;
        f.said = 'still';
        f.came = 'still';
      }
    }
    rides.clear();
    for (const [idx, r] of rows) rides.set(idx, r);
  }

  // Who the sea is holding in a conversation (`fh`, decodeHeld): index -> where whoever is
  // talking to them stands, in the island's own frame like every row. The whole set every
  // time, so whoever is not in it has been let go of. draw() turns a held body towards the
  // talker once it has finished its last stride.
  function held(rows) {
    talkers.clear();
    for (const [idx, at] of rows) talkers.set(idx, [at.x + ox, at.z + oz]);
  }

  // A blow landing on somebody here - the sea's `{t:'agent', a:'hit'}` (lib/combat.mjs),
  // which main.js routes to the view of the island it names. The id is the sea's crowd id,
  // which is exactly the id the roster enrolled the body under (`guard:<n>`,
  // `codex:<island>:<id>`), so this is one lookup. An imp standing in for the body flinches
  // (imp.js hit); an ordinary figure flinches in settler-figures.js off `f.flinch`. Only one
  // of the two: a body under an imp is parked out of sight, and a flinch left on it would play
  // the moment the imp was handed to a nearer guard. What is left (`hp`, `max`) is kept on
  // the figure for its health bar (`bars`, agent-bars.js), and a fall needs nothing from
  // here: the roster's null hole retires the body and its imp together, and whoever comes back
  // is a new figure and whole. Returns whether anybody here was hit, for the tests and a
  // console.
  function hit(id, hp = null, max = null) {
    const f = byIdx.get(id);
    if (!f) return false;
    if (Number.isFinite(hp) && Number.isFinite(max) && max > 0) { f.hp = hp; f.hpMax = max; }
    const s = imps.get(id);
    if (s && s.f === f && s.actor.hit) s.actor.hit();
    else view.flinch(f);
    return true;
  }

  // A swing somebody here has started - the sea's `{t:'agent', a:'swing'}` (lib/hostility.mjs),
  // sent when a guard or a Codex resident begins a blow, GUARD_WINDUP_MS before it lands. The
  // imp plays its attack clip, a figure swings its sword arm (settler-figures.js strike): the
  // same one-of-two as a hit. Returns whether anybody here swung.
  function swing(id) {
    const f = byIdx.get(id);
    if (!f) return false;
    const s = imps.get(id);
    if (s && s.f === f && s.actor.swing) s.actor.swing();
    else view.strike(f);
    return true;
  }

  // A beer handed to `id` by somebody standing at `from` ([x, z], scene frame). They turn to
  // face the giver and drink it (settler-figures.js drinkBeer), and it counts towards their
  // sway at once. Refused - false - for somebody not drawn here, or still drinking the last.
  function giveBeer(id, from, now) {
    const f = byIdx.get(id);
    if (!f || f.hidden || !f.to || !view.drinkBeer(f)) return false;
    if (from) f.faceAngle = Math.atan2(from[0] - f.pos[0], from[1] - f.pos[1]);
    sipping.set(id, { f, until: now + SETTLER_DRINK_S * 1000 });
    let pool = merry.get(id);
    if (!pool) { pool = createTipsy(SETTLER_TIPSY); merry.set(id, pool); }
    drinkIn(pool, 1);
    return true;
  }
  // How many whole glasses' worth `id` still has in them, for the page to say something
  // when the third one goes down.
  const beersIn = (id) => (merry.has(id) ? merry.get(id).level / SETTLER_TIPSY.dose : 0);

  // Everybody here who could be fought, for the health bars: the guards and Codex residents
  // of a hostile island, standing where they are drawn (an imp stands exactly where its body
  // would have), in the scene frame. Appended to `out`, which main.js collects from every
  // island before agent-bars.js picks the nearest.
  function bars(out = []) {
    if (!armed) return out;
    for (const f of figures.values()) {
      if (!f.to || f.hidden || !(isGuard(f.id) || isCodex(f.id))) continue;
      const imp = imps.has(f.id);
      out.push({
        x: f.pos[0], y: f.y, z: f.pos[1],
        top: imp ? BAR_OVER_IMP : BAR_OVER_SETTLER * f.tall + BAR_CLEAR,
        frac: f.hp == null ? 1 : f.hp / f.hpMax,
      });
    }
    return out;
  }

  function dropImp(id) {
    const s = imps.get(id);
    if (!s) return;
    s.actor.dispose();
    imps.delete(id);
  }

  // After the figures have been placed and before they are drawn. A guard who has been
  // retired - fell, the roster sent a hole - or replaced by a new body under the same id
  // takes his imp with him; the next body gets a fresh one. Which guards have an imp is
  // decided again every frame (pickImps: two dozen distances, sorted), and a guard who
  // drifts out of the nearest `impLimit` gives his up and is a figure again. A heading is
  // worked out here, the way settler-figures.js would have: that file only turns figures it
  // draws.
  function syncImps(dt, now, showing) {
    if (!standIn) return;
    for (const [id, s] of imps) if (byIdx.get(id) !== s.f) dropImp(id);
    const cands = [];
    for (const f of figures.values()) {
      if (wantsImp(f.id) && f.to) cands.push({ id: f.id, x: f.pos[0], y: f.y, z: f.pos[1], has: imps.has(f.id) });
    }
    const chosen = pickImps(cands, eye ? eye() : null, impLimit);
    for (const id of [...imps.keys()]) if (!chosen.has(id)) dropImp(id);
    const walker = showing && player ? player() : null;
    for (const id of chosen) {
      const f = byIdx.get(id);
      let s = imps.get(id);
      if (!s) {
        const actor = standIn(id);
        if (!actor) continue;
        s = { f, actor };
        imps.set(id, s);
      }
      const shown = showing && f.visible && f.slot != null;
      if (f.faceAngle != null) f.yaw = f.faceAngle;
      else if (f.face) f.yaw = lerpAngle(f.yaw, Math.atan2(f.face[0], f.face[1]), f.turn);
      s.actor.update({
        x: f.pos[0], y: f.y, z: f.pos[1], yaw: f.yaw,
        moving: f.anim === 'walk' || f.anim === 'step', speed: f.speed, swimming: !!f.wet,
        visible: shown, dt, now,
        player: shown ? walker : null,
      });
      // Out of the instanced crowd for this frame. `visible` is written back to true by the
      // next frame's placing, so this is said again every frame rather than remembered - and
      // it is exactly what the crowd does with a body it may not show.
      if (f.visible) { f.visible = false; view.hide(f); }
    }
  }

  // Draw everybody where they have got to. A body glides from where it was drawn when the
  // last word landed to where that word put it, over about the time the word before took
  // to arrive, and then a little further along the same line if the next one is late; the
  // heading comes out of the movement, which is exactly what the walk did - the renderer
  // is handed a direction rather than an angle either way.
  // `now` is the caller's clock, and it has to be the same one `apply` was given: the two
  // are subtracted from each other. Handing draw() an accumulated dt while apply() stamped
  // performance.now() is a bug that reads as every body standing perfectly still - the
  // difference comes out as a number of hours and the interpolation clamps at its far end,
  // for ever.
  function draw(dt, groundAt, now, showing = true) {
    // The beer wears off whether anybody is drawn or not. Everybody's sway comes from their
    // own pool, and whoever has put their glass down is let go of the face they turned to.
    for (const [id, pool] of merry) {
      stepTipsy(pool, dt);
      const f = byIdx.get(id);
      if (f) f.sway = settlerSway(pool.level);
      if (pool.level <= 0) merry.delete(id);
    }
    for (const [id, s] of sipping) {
      if (now < s.until) continue;
      if (byIdx.get(id) === s.f) s.f.faceAngle = null;
      sipping.delete(id);
    }
    // Off while the chronicle is scrubbed back. Their people are here, now, and the island
    // on the screen is somebody's island in May - so they are hidden rather than left to
    // walk through a history they were not in. The positions keep arriving and keep being
    // applied, so coming back to Live puts everybody where they actually are.
    if (!showing) {
      for (const f of figures.values()) { if (f.visible) { f.visible = false; view.hide(f); } }
      for (const hull of hulls.values()) hull.object.visible = false;
      syncImps(dt, now, false);
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
      // Where along the glide we are: 0 is where the body was drawn when the word landed,
      // 1 is the word itself, reached as the next one is due. Never below 0 - a frame's
      // timestamp is taken before the frame's tasks run, so a word that landed just ahead
      // of this frame can be a hair *younger* than `now` and would otherwise nudge the
      // body backwards for one frame. And never past the guess, which is nothing at all
      // for a body the sea said was standing.
      const age = now - f.at;
      const guess = MOVING.has(f.said) ? MAX_GUESS_MS : 0;
      const tMax = 1 + guess / f.took;
      const t = Math.max(0, Math.min(age / f.took, tMax));
      const gx = f.to[0] - f.from[0], gz = f.to[1] - f.from[1];
      const nx = f.from[0] + gx * t;
      const nz = f.from[1] + gz * t;
      f.pos[0] = nx;
      f.pos[1] = nz;
      // What is shown is what the sea said, corrected by what this screen can see. A body
      // the sea called a walker that is not going anywhere on this screen - held at the
      // end of its guess, or a keyframe that put it back a centimetre from where it stood -
      // stands, or it would tread the air in a walking gait. A hammer is the one thing
      // that is not about moving, so it is taken at its word. And the glide towards the
      // word that somebody has *stopped* is the last stride of the walk they were on, so it
      // keeps the walking gait: `came` is what the word before this one said.
      //
      // The speed is the glide's own - how far this word is from where the body set off,
      // over how long it has to get there - and not this frame's displacement. A frame's
      // worth can be nothing at all with the body in full stride: a word stamped a hair
      // after the frame's own timestamp clamps `t` to 0 for that one frame, and a body
      // drawn 'still' for one frame drops its bob and its arms for that frame, which is a
      // hitch on every message that happens to land between the two.
      const speed = t >= tMax ? 0 : Math.sqrt(gx * gx + gz * gz) / (f.took / 1000);
      const moving = speed > STANDING_U_S;
      // A chore is taken at its word only when the body is not going anywhere here: the
      // glide towards the word that somebody has started hoeing is the last stride of the
      // walk that brought them, the same as the glide towards a stop.
      // A bundle of sticks, and a wheelbarrow to or from the gold pit, are kept the same way:
      // to the last stride (LADEN).
      const laden = LADEN.find((w) => f.said === w || (f.came === w && !MOVING.has(f.said)));
      const gait = laden || (MOVING.has(f.said) || MOVING.has(f.came) ? 'walk' : 'step');
      f.anim = f.said === 'hammer' ? 'hammer' : !moving ? (AT_WORK.has(f.said) ? f.said : 'still') : gait;
      f.mode = MOVING.has(f.anim) ? 'walk' : f.anim === 'hammer' ? 'hammer' : 'idle';
      f.barrowAtHome = barrowsAtHome && f.anim === 'hammer';
      // Only turn when actually going somewhere: a body nudged a centimetre by a late
      // message should not spin to face it. Towards the word rather than along this
      // frame's step, as briskly as the walk turned - it took its corners at 0.2 and its
      // idle steps at 0.12 - and the renderer picks a longer stride for anybody moving
      // faster than a stroll, which is how a newcomer's dash up from the beach has always
      // been drawn.
      if (moving) { f.face = [gx, gz]; f.turn = MOVING.has(f.anim) ? 0.2 : 0.12; f.speed = speed; }
      // Standing, and somebody talking to them: round to face whoever it is, at the walk's
      // own rate for it (the `attend` branch of shared/settlerwalk.mjs) - which the sea has
      // already done, and no row could say. Only once they stand: the sea stops them dead
      // and this screen is a word behind, so facing the talker during the stride that is
      // still being glided reads as a sidestep. A talker standing on top of them gives no
      // direction and leaves the head where it was.
      else {
        const hold = talkers.get(idx);
        const hx = hold ? hold[0] - nx : 0, hz = hold ? hold[1] - nz : 0;
        if (hx * hx + hz * hz > 1e-6) { f.face = [hx, hz]; f.turn = HELD_TURN; }
      }
      const ground = groundAt ? groundAt(nx, nz) : 0;
      f.y = Math.max(WADE_Y, ground);
      // Out of their depth: the ground under them is below the sea - walk.js's own test for
      // the player. Only an imp reads it (it swims rather than wades); the figures do not.
      f.wet = ground < SEA_LEVEL;
    }
    syncImps(dt, now, true);
    view.draw(figures, dt);
  }

  function dispose() {
    for (const id of [...imps.keys()]) dropImp(id);
    for (const idx of [...figures.keys()]) retire(idx);
    byIdx.clear();
    merry.clear();
    sipping.clear();
    view.dispose();
    for (const hull of hulls.values()) hull.dispose();
    hulls.clear();
    rides.clear();
    talkers.clear();
  }

  return {
    roster, apply, applyRides, held, draw, dispose, setVisible, setBuildings, hit, swing, bars, giveBeer, beersIn,
    count: () => figures.size,
    // The bodies themselves, for anything that wants to look: the hover labels, a
    // measurement, a console. Read-only by convention - the sea owns where these are.
    figures: () => figures,
    // And by the name the rest of the island calls them. `figure` is the one lookup
    // everything that is about a person goes through.
    figure: (id) => byIdx.get(id) || null,
    byId: () => byIdx,
    // Whatever stands in for each guard right now, by guard id: the imps, once the model
    // has loaded. For a console and the tests.
    imps: () => new Map([...imps].map(([id, s]) => [id, s.actor])),
    // Picking somebody out of the crowd with the mouse. Straight through to the meshes:
    // a view has no opinion about it, and the figures are instanced, so an instance id is
    // the only way back from a ray to a body.
    pickables: () => view.pickables(),
    figureAt: (object, instanceId) => view.figureAt(object, instanceId),
  };
}
