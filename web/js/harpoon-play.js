// The harpoons in play on this page (Plans/harpoen.md): one line per manned harpoon of a ship we stand
// on, fired from walk mode's gun (main.js onGunFire, kind 'harpoon'), flown and reeled by
// web/js/harpoon-line.js, and what a hooked line does:
//
//   the statue   dragged to the gun's mouth over the water (treasure.js drag), and laid on the deck when
//                the reel has her in (reelAboard) - a line is how a ship takes a floating statue aboard
//   land         our own ship is drawn to it, and making way goes round it (harpoon-tow.js)
//   a ship       ours hangs on to hers and is drawn after her ("chase"); hers is never moved here
//
// Only our own hull is ever moved, and only while no other page is stepping her (hullFollowed): on the
// sea a boat goes where her pilot's page - or the page that just let go of her - says (lib/boats.mjs).
// The fire button with a line out lets go of it. Leaving the gun lets go of a line on the statue (and the
// bolt is reeled home on its own); one made fast in land or a ship stays where it is, unreeled, as a way
// across (ropes(): walk.js takeRope) until it is let go of, or the ship drifts far enough to part it. Nothing goes to the sea yet (fase B: others seeing the line, players hooked, a loose boat
// towed).
import * as THREE from 'three';
import { createHarpoonLine } from './harpoon-line.js';
import { towHull } from './harpoon-tow.js';
import { REEL_MIN } from 'shared/harpoon.mjs';

// How short the reel draws a line on each kind of hold: a statue to the mouth, a ship to the length of
// the two hulls apart, land to where she would still float.
const HOLD = Object.freeze({ statue: REEL_MIN, land: 6, galleon: 9, rowboat: 4 });
// How big each kind of target is to a bolt (its middle above the water, and a radius).
const HULL_R = Object.freeze({ galleon: 2.4, rowboat: 0.8 });
const HULL_Y = Object.freeze({ galleon: 1.6, rowboat: 0.4 });
const STATUE_R = 0.45;
// How much further than the line is long the two ends may come apart before it parts (a ship drifting
// off a line nobody is reeling).
const SNAP = 2.5;
// A statue the reel has within this of the gun's mouth is on board.
const ABOARD_AT = REEL_MIN + 0.4;

// deps: scene, boats() (state.boats), sea() (state.sea: height(x, z)), hunt() (state.hunt), kindOf(b)
// ('galleon' | 'rowboat'), followed(b) (main.js hullFollowed), surfaceAt(x, z) the water's height.
export function createHarpoonPlay(deps) {
  const lines = new Map();       // `${boat.id}:${i}` -> { line, boat, i, bolt }
  // What sound.js hears (its cue rule): a counter and the last few shots, ratchet clicks and creaks of
  // the line, each with where it was. Nothing here plays anything.
  const heard = { n: 0, list: [] };
  function hear(kind, p) {
    heard.n++;
    heard.list.push({ n: heard.n, kind, x: p.x, y: p.y, z: p.z });
    if (heard.list.length > 12) heard.list.shift();
  }
  const mouthL = new THREE.Vector3(), dirW = new THREE.Vector3(), q = new THREE.Quaternion();

  // Where gun `i` of hull `b` has its mouth this frame, in the scene, and where it points.
  function mouthOf(b, i, at = mouthL) {
    const m = b.craft && b.craft.gunMuzzle ? b.craft.gunMuzzle(i) : null;
    if (!m) return null;
    b.craft.object.updateMatrixWorld();
    b.craft.object.localToWorld(at.set(m.at[0], m.at[1], m.at[2]));
    b.craft.object.getWorldQuaternion(q);
    dirW.set(m.dir[0], m.dir[1], m.dir[2]).applyQuaternion(q).normalize();
    return { at, dir: dirW };
  }

  const ground = (x, z) => { const s = deps.sea(); return s ? s.height(x, z) : null; };
  // What a bolt fired from hull `own` can hook this frame.
  function targets(own) {
    const out = [];
    const hunt = deps.hunt();
    const st = hunt && hunt.loose ? hunt.loose() : null;
    if (st) {
      out.push({ id: 'statue', kind: 'statue', x: st.x, y: st.y + 0.25, z: st.z, r: STATUE_R,
        at(o) { const s = hunt.loose(); if (s) { o.x = s.x; o.y = s.y + 0.25; o.z = s.z; } return o; } });
    }
    for (const b of deps.boats() || []) {
      if (b === own || !b.craft) continue;
      const kind = deps.kindOf(b);
      out.push({ id: b.id, kind, x: b.x, y: HULL_Y[kind], z: b.z, r: HULL_R[kind],
        at(o) { o.x = b.x; o.y = HULL_Y[kind]; o.z = b.z; return o; } });
    }
    return out;
  }

  function entry(b, i) {
    const key = `${b.id}:${i}`;
    let e = lines.get(key);
    if (!e) {
      const line = createHarpoonLine({ world: { ground, targets: () => targets(b) } });
      deps.scene.add(line.mesh);
      const bolt = b.craft.harpoonBoltClone ? b.craft.harpoonBoltClone(i) : null;
      if (bolt) { bolt.visible = false; deps.scene.add(bolt); }
      e = { line, boat: b, i, bolt, held: null };
      lines.set(key, e);
    }
    return e;
  }

  // The fire button at harpoon `i` of hull `b`: out it goes, or - with a line out - it is let go of.
  function fire(b, i) {
    const e = entry(b, i);
    if (e.line.state !== 'stowed') { letGoOf(e); return 'released'; }
    const m = mouthOf(b, i);
    if (!m) return null;
    const carry = { x: Math.sin(b.yaw) * (b.v || 0), z: Math.cos(b.yaw) * (b.v || 0) };
    if (!e.line.fire(m.at, m.dir, carry)) return null;
    hear('harpoon', m.at);
    return 'fired';
  }
  function letGoOf(e) {
    if (e.held === 'statue') { const h = deps.hunt(); if (h && h.dragEnd) h.dragEnd(); }
    e.held = null;
    e.line.release();
  }
  // Leaving the gun: a line on land or a ship is left fast, and stops reeling; anything else is let go.
  function release(b, i) {
    const e = lines.get(`${b.id}:${i}`);
    if (!e || e.line.state === 'stowed') return;
    const h = e.line.hooked();
    if (h && h.kind !== 'statue') e.line.reeling = false;
    else letGoOf(e);
  }
  // Back at it: the reel takes in again.
  function manned(b, i) {
    const e = lines.get(`${b.id}:${i}`);
    if (e) e.line.reeling = true;
  }

  // Our hull, drawn along a line of hers that holds land or a ship (walk.js stepGun, onGunTow).
  function tow(b, gun, dt) {
    if (deps.followed(b)) return;
    const e = lines.get(`${b.id}:${gun.i}`);
    const h = e && e.line.hooked();
    if (!h || h.kind === 'statue') return;
    if (towHull(b, h, e.line.L, dt, !e.line.reeledIn())) {
      // The line straining: a creak every so often while she is on it.
      e.creak = (e.creak || 0) - dt;
      if (e.creak <= 0) { e.creak = 1.3 + Math.random() * 0.8; hear('creak', h); }
    }
  }

  const at = new THREE.Vector3(), look = new THREE.Vector3();
  // Every frame, after walk mode has stepped (so the mouths are where the hulls are drawn).
  function frame(dt) {
    for (const [key, e] of lines) {
      const b = e.boat;
      if (!(deps.boats() || []).includes(b)) { dispose(key, e); continue; }
      const m = mouthOf(b, e.i, at);
      if (!m) continue;
      const { line } = e;
      const clicks = line.cues.clicks;
      line.update(m.at, dt);
      // The reel's pawl: one tick heard a frame however many it made, or a fast reel is a buzz.
      if (line.cues.clicks > clicks) hear('ratchet', m.at);
      const h = line.hooked();
      if (h && !e.held) {
        e.held = h.kind;
        line.minL = HOLD[h.kind] ?? REEL_MIN;
      }
      if (h && h.kind === 'statue') haulStatue(e, m.at);
      // A ship drifting off a line nobody reels parts it.
      if (h && h.kind !== 'statue' && !line.reeling && Math.hypot(h.x - m.at.x, h.y - m.at.y, h.z - m.at.z) > line.L + SNAP) letGoOf(e);
      if (!h && e.held) e.held = null;
      if (b.craft.harpoonBolt) b.craft.harpoonBolt(e.i, line.state === 'stowed');
      if (e.bolt) {
        e.bolt.visible = line.state !== 'stowed';
        if (e.bolt.visible) {
          e.bolt.position.set(line.bolt.x, line.bolt.y, line.bolt.z);
          // Point first along its flight, then - held or coming home - away from the gun along the line.
          if (line.state === 'flying') look.set(line.bolt.x + line.bolt.vx, line.bolt.y + line.bolt.vy, line.bolt.z + line.bolt.vz);
          else look.set(2 * line.bolt.x - m.at.x, 2 * line.bolt.y - m.at.y, 2 * line.bolt.z - m.at.z);
          e.bolt.lookAt(look);
        }
      }
    }
  }

  // The statue on the line: never further from the mouth than the line is long, along the water (or
  // the sand, if that is where the line drags her), and aboard once the reel has her in.
  function haulStatue(e, mouth) {
    const hunt = deps.hunt();
    const s = hunt && hunt.loose ? hunt.loose() : null;
    if (!s) { letGoOf(e); return; }
    const dx = mouth.x - s.x, dz = mouth.z - s.z;
    const d = Math.hypot(dx, dz);
    if (d <= ABOARD_AT || e.line.reeledIn()) {
      if (hunt.reelAboard(e.boat)) { e.held = null; e.line.release(); }
      return;
    }
    if (d <= e.line.L) return;
    const k = (d - e.line.L) / d;
    const x = s.x + dx * k, z = s.z + dz * k;
    const g = ground(x, z);
    const afloat = !(g != null && g > 0);
    hunt.drag({ x, z, y: afloat ? (deps.surfaceAt ? deps.surfaceAt(x, z) : 0) : g, afloat });
  }

  function dispose(key, e) {
    deps.scene.remove(e.line.mesh);
    e.line.mesh.geometry.dispose();
    if (e.bolt) deps.scene.remove(e.bolt);
    lines.delete(key);
  }

  // For the sound and the HUD: the line at a gun, or null.
  const lineAt = (b, i) => { const e = lines.get(`${b.id}:${i}`); return e ? e.line : null; };
  const cues = () => {
    const out = { fired: 0, hooked: 0, clicks: 0 };
    for (const e of lines.values()) for (const k in out) out[k] += e.line.cues[k];
    return out;
  };

  // The lines that are a way across: made fast in land or a ship. Each as walk.js takeRope wants it:
  // `ends()` the gun's mouth (a) and the hook (b) in the scene now, or null once it has let go, and
  // `deck` where on her a body comes off it at the gun's end (the gunner's stand, in her frame).
  const ends = new Map();
  function ropeOf(e) {
    let r = ends.get(e);
    if (!r) {
      const spec = e.boat.craft && e.boat.craft.spec && e.boat.craft.spec.mounts ? e.boat.craft.spec.mounts[e.i] : null;
      const a = new THREE.Vector3();
      r = {
        key: `${e.boat.id}:${e.i}`,
        ends() {
          const h = e.line.hooked();
          if (!h || h.kind === 'statue' || !(deps.boats() || []).includes(e.boat)) return null;
          const m = mouthOf(e.boat, e.i, a);
          return m ? { a: { x: a.x, y: a.y, z: a.z }, b: { x: h.x, y: h.y, z: h.z } } : null;
        },
        deck: spec ? { boat: e.boat, x: spec.stand[0], z: spec.stand[1], y: spec.y } : null,
      };
      ends.set(e, r);
    }
    return r;
  }
  const ropes = () => [...lines.values()].filter((e) => { const h = e.line.hooked(); return h && h.kind !== 'statue'; }).map(ropeOf);
  const ropeAt = (b, i) => { const e = lines.get(`${b.id}:${i}`); const h = e && e.line.hooked(); return h && h.kind !== 'statue' ? ropeOf(e) : null; };

  return { fire, release, manned, tow, frame, lineAt, cues, ropes, ropeAt, events: () => heard };
}
