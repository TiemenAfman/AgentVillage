// Naming somebody on a visiting island under the mouse: the volcano's guards and Codex
// residents, and anybody else's settlers.
//
// Our own crowd is picked by raycasting its instanced meshes (main.js pick(), crowd-view's
// pickables/figureAt). That does not carry over. A guard near the camera is not an instance
// at all - crowd-view parks his body out of sight and stands a skinned lava imp there
// (web/js/imp.js), and raycasting a skinned mesh means skinning it on the CPU, per imp, per
// mouse move. So a guest figure is picked by where crowd-view last drew it, which is exactly
// where the imp stands too: the nearest body whose middle passes within a hand of the ray.
// A few hundred dot products and no allocation, which is what the picker can afford - it
// runs every frame in orbit, not only when the mouse moves (updateLabels).
//
// Label only. A guest island is a place, not a village (CLAUDE.md): no dossier, no
// state.byId, no nameplates - and never an id, which on the volcano is a redacted house id
// behind somebody's island id.
import { isGuard, isCodex, codexIsland } from 'shared/volcano.mjs';

// How far a body's middle may be from the ray and still be under the mouse, and how high
// that middle is above its feet. A settler is 0.43 units tall (RESIDENT_HEIGHT_U in imp.js);
// an imp is IMP_SIZE (1.3) times that, so a guard gets the bigger target whether or not he
// is an imp this frame - the nearest `impLimit` are, and which ones changes as the camera
// moves, and a target that shrank as he stepped out of that set would flicker.
const BODY = { lift: 0.22, radius: 0.26 };
const GUARD = { lift: 0.28, radius: 0.34 };

// The one result, reused: this is called every frame, and the caller only wants the hit.
const hit = { f: null, t: 0 };

// The nearest figure in `figures` (crowd-view's index -> figure map) whose middle is within
// reach of the ray from `o` along the unit vector `d`, no further than `maxT` along it.
// Returns the shared `hit` with `f` null when nobody is. Only bodies the crowd is showing:
// `to` is null before the sea has said where somebody is (they are hidden, see crowd-view
// draw), and `hidden` is a filter. `visible` is deliberately not asked - it is false for
// every guard standing as an imp, which is precisely who this is for.
export function nearestOnRay(figures, o, d, maxT) {
  hit.f = null;
  hit.t = maxT;
  for (const f of figures.values()) {
    if (!f.to || f.hidden) continue;
    const s = isGuard(f.id) ? GUARD : BODY;
    const vx = f.pos[0] - o.x, vy = (f.y || 0) + s.lift - o.y, vz = f.pos[1] - o.z;
    const t = vx * d.x + vy * d.y + vz * d.z;
    if (t <= 0 || t >= hit.t) continue;
    const off2 = vx * vx + vy * vy + vz * vz - t * t;
    if (off2 > s.radius * s.radius) continue;
    hit.f = f;
    hit.t = t;
  }
  return hit;
}

// What the hover label says about a guest figure, as { name, sub } for ui.setHover.
// `island` is the bundle's island block for the region they stand on; `fleet` the sea's
// rows (id, name, keeper), which is the only place a Codex settler's own island is named.
export function guestLabel(f, island, fleet) {
  const here = (island && island.name) || 'a neighbouring island';
  if (isGuard(f.id)) return { name: `Guard of ${here}`, sub: 'Keeps the mountain' };
  if (isCodex(f.id)) {
    const from = codexIsland(f.id);
    const row = (fleet || []).find((r) => r.id === from);
    const keeper = row && row.keeper;
    // A Codex house carries no name (lib/islandbundle.mjs codexHouse: id, style, tier) -
    // the list it came from is redacted on purpose - so a resident is named after whose
    // they are. The lodgers the plots ran out for are dressed against the guardhouse.
    const home = f.spec && f.spec.kind === 'house'
      ? (f.spec.tier ? `lives in a ${f.spec.tier}` : 'has a house here')
      : 'lodges at the guardhouse';
    return {
      name: typeof keeper === 'string' && keeper ? `Codex settler of ${keeper}` : 'Codex settler',
      sub: row && row.name ? `from ${row.name} · ${home}` : home,
    };
  }
  const keeper = island && typeof island.keeper === 'string' ? island.keeper : '';
  return { name: `Settler of ${here}`, sub: keeper ? `kept by ${keeper}` : '' };
}
