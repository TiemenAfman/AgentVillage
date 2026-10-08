// The village tavern's regulars (web/js/interior.js buildTavern): a full house on the benches,
// a few stood at the ends of the bar and by the fire, and somebody at the karaoke mic. The room
// stood empty but for the barman, which with the jazz and the chatter playing read as a ghost
// pub (the keeper, 8 October 2026).
//
// Drawn the way the Salty Kraken draws its crew (pirate-tavern.js createCrewShow): the island's
// own instanced settlers (settler-figures.js), `'sit'` on a bench or `'still'` on their feet, so
// the whole house is a handful of draw calls rather than a mesh each. Nobody here is a settler of
// the island - a resident in the tavern would be in two places at once, since the sea walks them
// outside - so their looks come from their seat's id alone (`settlerLook`), the same house every
// visit. Nobody stands on the stools: those are yours (interior.js seats).
import { createFigures, settlerLook } from './settler-figures.js';
import { lerpAngle } from 'shared/settlerwalk.mjs';

// The tavern's benches stand 0.135 over the floor (the tables on the square, and buildTavern's).
const BENCH_TOP = 0.135;
// How far off a bench's middle each of its two places is: the bench is 0.42 long.
const PLACE_DX = 0.105;

// Who sits where, from the tables buildTavern lays out. Four places a table, two a bench, less a
// few left free (a full room in which every place is taken reads as a painting, not a pub).
// `stand` is a list of [x, z, yaw, y] for the ones on their feet.
export function tavernPatrons({ tables, floor, stand = [] }) {
  const out = [];
  tables.forEach(([tx, tz], ti) => {
    for (const [side, yaw] of [[-1, 0], [1, Math.PI]]) {
      for (const dx of [-PLACE_DX, PLACE_DX]) {
        const id = `tavern:patron:${ti}:${side < 0 ? 'n' : 's'}${dx < 0 ? 0 : 1}`;
        // One place in five stays empty, picked by the place's own id so it is the same one
        // every visit.
        if (hashOf(id) % 5 === 0) continue;
        out.push({ id, x: tx + dx, z: tz + side * 0.32, y: floor, yaw, seat: { h: BENCH_TOP } });
      }
    }
  });
  stand.forEach(([x, z, yaw, y = floor], k) => out.push({ id: `tavern:patron:stand:${k}`, x, z, y, yaw, stand: true }));
  return out;
}

function hashOf(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// How much a regular turns in their seat to talk to the one beside them or across, and how slowly.
const CHAT_SPAN = 0.45;
const LOOK_R = 0.9;          // and how near you have to be for one to turn and look at you

export function createPatronsShow({ scene, material, layout }) {
  const view = createFigures(scene, material);
  const members = [];
  for (const m of layout.patrons) {
    const f = {
      id: m.id, pos: [m.x, m.z], y: m.y, yaw: m.yaw, faceAngle: m.yaw, visible: true,
      anim: m.stand ? 'still' : 'sit', mode: 'idle', speed: 0, beat: null,
      ...(m.seat ? { seat: m.seat } : {}),
    };
    // Trousers on the benches: a skirt shows through a bench (pirate-tavern.js has the same rule).
    const look = { ...settlerLook(m.id, 'unknown'), ...(m.stand ? {} : { outfit: 'trousers' }) };
    if (!view.enrol(f, look, 'adult')) continue;
    members.push({ m, f, phase: (hashOf(m.id) % 1000) / 1000 * Math.PI * 2, rate: 0.12 + (hashOf(`${m.id}:r`) % 100) / 1000 });
  }
  const figs = members.map((c) => c.f);
  let seconds = 0;

  function update(dt, extra = {}, player = null) {
    seconds += dt;
    for (const { m, f, phase, rate } of members) {
      // Talking: a slow turn one way and the other, to the neighbour and back to the table.
      let want = m.yaw + CHAT_SPAN * Math.sin(seconds * rate * 2 * Math.PI + phase);
      if (player) {
        const dx = player.x - m.x, dz = player.z - m.z;
        if (Math.hypot(dx, dz) < LOOK_R) {
          const d = Math.atan2(Math.sin(Math.atan2(dx, dz) - m.yaw), Math.cos(Math.atan2(dx, dz) - m.yaw));
          if (Math.abs(d) < 1.6) want = m.yaw + Math.max(-0.8, Math.min(0.8, d));
        }
      }
      f.faceAngle = lerpAngle(f.faceAngle, want, 0.05);
      if (Math.random() < dt * 0.03) view.drinkBeer(f);
    }
    view.draw(figs, dt);
  }

  return {
    enter() {},
    // Nobody steps aside for you: a body in a seat or at the bar is somebody to walk round.
    blockers: () => members.map(({ m }) => ({ x: m.x, z: m.z, r: 0.12, y0: m.y - 0.45, y1: m.y + 0.45 })),
    update,
    figures: () => figs,
    dispose() { view.dispose(); },
  };
}
