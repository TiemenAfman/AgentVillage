// Whether a neighbour's island still looks like the one we drew.
//
// `rev` is the sea's counter and moves on every publish - it means "their bundle is not
// the one you have", which is not the same thing as "their island does not look like the
// one you drew". A scan republishes an island every time a session's state moves on, so a
// busy neighbour bumps `rev` three times a minute while nothing about their coastline,
// their wood or their houses has changed at all.
//
// That did not matter much when raising a guest island was a heightfield and some
// buildings. It matters now: a neighbour's island is built by the same createLandscape
// ours is, which plants twenty thousand trees, surveys the fields and walls the hamlets,
// and that measures 550 ms on this machine. Three times a minute the page stopped dead
// for half a second, and on the frame after it every settler, every mill and every cloud
// lurched forward by the whole of it. "Everybody shooting across the island like mad" is
// exactly what half a second of `dt` looks like.
//
// So this is the comparison that decides a rebuild, and `rev` only decides a re-fetch.
//
// Written as what to LEAVE OUT rather than what to include, which is the lesson this
// project has already paid for twice - see the note above the walk in
// tests/crowd-ids.test.mjs. A list of the fields that matter is a list somebody has to
// remember to add to, and the day they forget it a neighbour's new hamlet is simply never
// drawn and nothing says so. Everything counts unless it is named here.
//
// The four below have a door of their own: props and beds arrive through
// `POST /island/:id/parcel` and are applied without a rebuild (see CLAUDE.md), and
// placements and decks are the sea's business - a guest's buildings are placed from their
// specs by housePlacement here, and this page never reads either.
export const SOFT_FIELDS = new Set(['props', 'crops', 'placements', 'decks']);
// And these two, which are the whole of what a republish actually moves when nobody has
// built anything. Measured across a scan on a live island: `buildings` was the only field
// that differed, and `active` and `lastAt` were the only two keys inside it. They are the
// settler's state, not the building's shape, and neither changes a pixel of the ground.
export const SOFT_BUILDING_FIELDS = new Set(['active', 'lastAt']);
// And the Codex houses on the volcano, whole. They have a door of their own too - the sea
// sends them in a `codex` message and guest-island.js raises and lowers them one at a time
// (applyBuildings) - so a region that has taken them on board and one fetched afresh must
// not read as two different islands. Only the volcano has any. The prefix is isCodex's in
// shared/volcano.mjs, spelled out rather than imported so this file stays importable without
// the `shared/` import map (tests/island-signature.test.mjs registers no loader).
const SOFT_BUILDING = (b) => !!b && typeof b.id === 'string' && b.id.startsWith('codex:');

export function drawnSignature(b) {
  if (!b || !b.island) return '';
  const out = {};
  for (const k of Object.keys(b)) {
    if (SOFT_FIELDS.has(k)) continue;
    if (k !== 'buildings') { out[k] = b[k]; continue; }
    out.buildings = (b.buildings || []).filter((x) => !SOFT_BUILDING(x)).map((x) => {
      const kept = {};
      for (const f of Object.keys(x)) if (!SOFT_BUILDING_FIELDS.has(f)) kept[f] = x[f];
      return kept;
    });
  }
  return JSON.stringify(out);
}
