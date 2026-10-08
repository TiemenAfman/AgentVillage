// The harpoons on the sea (Plans/harpoen.md, fase B). The sea flies nothing here: every page flies its
// own line (web/js/harpoon-line.js) and the sea passes on what the others need, after checking it.
//
//   {t:'harpoon', a:'line', b, i, s, at, L, k}   a line's state from the page whose gun it is: `s` 'out'
//         or 'off', `at` the bolt in the world, `L` the line's length, `k` what it holds (none, 'land',
//         'galleon', 'rowboat', 'statue', 'player'). Passed on as is with the sender's `id`, so every
//         page draws the rope from that ship's harpoon to `at`, and the ship's pilot - if the gunner is
//         crew - draws her along it (web/js/harpoon-play.js remote lines). Only from somebody aboard
//         that ship, about one of her mounts, a few a second at most.
//   {t:'harpoon', a:'hook', b, i, who}            the sender's line struck player `who`. The sea checks
//         the sender is aboard `b` and `who` is on foot or swimming (not aboard, not in a room, not
//         asleep), within a line's reach of the sender, and not on their own island (the keeper's
//         "altijd", with Plans/open-world-pvp.md's one rule: your own island is safe) - then tells
//         `who` alone {t:'harpoon', a:'hooked', by, b, i}, and their own page reels them in (walk.js).
//   {t:'harpoon', a:'free', who}                  let go of: {t:'harpoon', a:'free', by} to `who`, if
//         the sender is the one holding them.
//
// No SEA_V: an older sea drops an unknown `t`, an older page ignores one. In memory, like everything
// the sea holds: who holds whom is forgotten on a restart, and a page lets go after HOOK_MS anyway.
import { ROPE_MAX } from '../shared/harpoon.mjs';
import { POSE } from './players.mjs';

export const LINE_EVERY_MS = 60;     // ~16 a second at most, per player
export const HOOK_EVERY_MS = 600;
export const HOOK_REACH = ROPE_MAX + 6;
export const HOOK_MS = 20000;
const KINDS = new Set(['', 'land', 'galleon', 'rowboat', 'statue', 'player']);

export function createHarpoons({ fleet, roster, bound = 2400 }) {
  const holds = new Map();           // hooked player id -> { by, until }

  function islandAt(x, z) {
    for (const island of fleet.all()) {
      const t = island.terrain;
      if (!t) continue;
      const lx = x - island.origin[0], lz = z - island.origin[1];
      if (lx > -t.half && lx < t.half && lz > -t.half && lz < t.half) return island;
    }
    return null;
  }
  const num = (v, lim) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim ? v : null);
  const mount = (i) => (Number.isInteger(i) && i >= 0 && i < 8 ? i : null);
  const aboardAny = (id) => roster.boats.snapshot().some((b) => b.pilot === id || (b.crew && b.crew.includes(id)));

  // One message from player `p`; `sendAll(msg, except)` reaches everybody joined.
  function on(p, m, sendAll, now = Date.now()) {
    if (!p || !p.walking || typeof m.b !== 'string' || !roster.boats.aboard(m.b, p.id)) return false;
    if (m.a === 'line') {
      const i = mount(m.i);
      const s = m.s === 'off' ? 'off' : m.s === 'out' ? 'out' : null;
      if (i === null || !s) return false;
      const at = Array.isArray(m.at) && m.at.length === 3 ? m.at.map((v, k) => num(v, k === 1 ? 200 : bound)) : null;
      const L = num(m.L, ROPE_MAX + 1);
      const k = typeof m.k === 'string' && KINDS.has(m.k) ? m.k : '';
      if (s === 'out' && (!at || at.includes(null) || L === null)) return false;
      if (s === 'out' && now - (p.lineAt || 0) < LINE_EVERY_MS) return false;
      p.lineAt = now;
      sendAll({ t: 'harpoon', a: 'line', id: p.id, b: m.b, i, s, ...(s === 'out' ? { at, L, k } : {}) }, p);
      return true;
    }
    if (m.a === 'hook') {
      const i = mount(m.i);
      if (i === null || typeof m.who !== 'string' || m.who === p.id) return false;
      if (now - (p.hookAt || 0) < HOOK_EVERY_MS) return false;
      const q = roster.all().find((o) => o.id === m.who);
      if (!q || !q.walking || q.room || q.posed === false || (q.f & POSE.ASLEEP) || aboardAny(q.id)) return false;
      if (Math.hypot(q.x - p.x, q.z - p.z) > HOOK_REACH) return false;
      const home = islandAt(q.x, q.z);
      if (home && q.island && home.id === q.island) return false;
      p.hookAt = now;
      for (const [k, h] of holds) if (h.until < now) holds.delete(k);
      holds.set(q.id, { by: p.id, until: now + HOOK_MS });
      q.conn.send(JSON.stringify({ t: 'harpoon', a: 'hooked', by: p.id, b: m.b, i }));
      return true;
    }
    if (m.a === 'free') {
      const h = typeof m.who === 'string' ? holds.get(m.who) : null;
      if (!h || h.by !== p.id) return false;
      holds.delete(m.who);
      const q = roster.all().find((o) => o.id === m.who);
      if (q) q.conn.send(JSON.stringify({ t: 'harpoon', a: 'free', by: p.id }));
      return true;
    }
    return false;
  }

  // Somebody gone: nobody holds them, and they hold nobody.
  function forget(id) {
    holds.delete(id);
    for (const [k, h] of holds) if (h.by === id) holds.delete(k);
  }

  return { on, forget, holds: () => holds };
}
