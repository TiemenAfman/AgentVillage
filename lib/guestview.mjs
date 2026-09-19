// The island as a visitor is allowed to see it.
//
// The rule is short: they may see the place and the people - the project folders, the
// settlers' names, the shape of the village - and nothing that came out of a
// conversation. That last part is wider than it first looks, because the island writes
// several of its labels from the transcripts themselves:
//
//   title       is the session's opening prompt, verbatim. This is the chat.
//   gitBranch   and a district's branch list are named after what was being worked on,
//               so "claude/ban-numbers-fillable-terms" says as much as the prompt did.
//   workOrders  and commission carry ticket summaries.
//   cwd         and a district's root are absolute paths, so they publish the layout of
//               the machine and the name of whoever is logged into it. The folder's own
//               name is the part worth seeing, so that is the part that is kept.
//
// And one that is easy to miss: the identifiers. A district's id *is* its full path
// (p:d:\git\martijn\agentvillage), and that string turns up again inside the ids of its
// office and its roads; a house's id carries the session's uuid. The client uses all of
// these as lookup keys, so they cannot simply be dropped - they are renamed instead, the
// same way everywhere, which keeps the map working and says nothing.
//
// The transcript and the chat endpoints refuse a visitor outright; this is about what
// leaks through the map itself.

// Windows and posix separators both, since a village.json is written on either.
function folderName(p) {
  const s = String(p || '').replace(/[\\/]+$/, '');
  const cut = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
  return cut >= 0 ? s.slice(cut + 1) : s;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// `out`, when it is passed, is filled with `renamed id -> real id` for every building.
//
// It is derived from the two lists rather than from the swap table above, and that is the
// point: clean() maps an array to an array, so position is preserved by construction, and
// a rename this file learns to do tomorrow is carried without anybody remembering to add
// it here. Nothing in the redaction changes because somebody asked for it.
//
// It is the inverse of the whole exercise, so it must never leave the machine that built
// it. The one caller is serve.mjs, over loopback, so that the island's own page can match
// the crowd the sea walks - under redacted ids - to the houses it drew under real ones.
export function guestVillage(v, out = null) {
  if (!v || typeof v !== 'object') return v;

  // Every telling string, and the harmless thing it becomes. Longest first, so a token
  // that contains another is replaced whole rather than in pieces.
  const swap = new Map();
  (v.districts || []).forEach((d, i) => { if (d && d.id) swap.set(String(d.id), `p:d${i}`); });
  (v.buildings || []).forEach((b, i) => { if (b && b.sessionId) swap.set(String(b.sessionId), `s${i}`); });
  const tokens = [...swap.keys()].sort((a, b) => b.length - a.length);
  const re = tokens.length ? new RegExp(tokens.map(escapeRe).join('|'), 'g') : null;

  // A second, blunter pass. The list above only knows the sessions that still have a
  // house; a road left behind by one that does not, or a connector id in a tool count,
  // would sail straight through. This makes the guarantee unconditional: no uuid of any
  // kind reaches a visitor, whether or not this file anticipated where it came from.
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const spare = new Map();
  const anon = (u) => {
    const k = u.toLowerCase();
    if (!spare.has(k)) spare.set(k, `x${spare.size}`);
    return spare.get(k);
  };
  const scrub = (s) => {
    let out = String(s);
    if (re) out = out.replace(re, (m) => swap.get(m) || m);
    return out.replace(UUID, anon);
  };

  // Walks the whole thing, values and keys alike, so a rename cannot be missed because
  // an id turned up somewhere this file did not think to look.
  function clean(node) {
    if (typeof node === 'string') return scrub(node);
    if (Array.isArray(node)) return node.map(clean);
    if (node && typeof node === 'object') {
      const out = {};
      for (const [k, val] of Object.entries(node)) out[scrub(k)] = clean(val);
      return out;
    }
    return node;
  }

  const buildings = (v.buildings || []).map((b) => {
    const { title, sessionId, gitBranch, workOrders, commission, cwd, ...rest } = b;
    return clean({
      ...rest,
      // The folder's name alone: the dossier shows it as the project, and that is what a
      // visitor is here to see.
      cwd: cwd ? folderName(cwd) : null,
      // `sheds` rides along in `rest`, deliberately untouched. It is a list of shed *ids*
      // - `shed:<session>:<agent>` strings - and not a list of shed objects; the
      // apprentices themselves are buildings of their own in this same list, and are
      // redacted there. This used to spread each entry into an object rest to strip a
      // title and a branch off it, which on a string hands back its characters: sixty
      // single-character keys per shed and the id gone, so ui.js printed a heading
      // counting apprentices over a list that could match none of them.
      //
      // There is nothing further to redact here either. The session uuid inside the id is
      // renamed by the pass above, the same way it is renamed in the shed's own `id`, so
      // the two keep matching; the agent id is not a uuid and says nothing.
    });
  });

  if (out) {
    out.ids = new Map();
    (v.buildings || []).forEach((b, i) => {
      const shown = buildings[i];
      if (b && b.id && shown && shown.id) out.ids.set(String(shown.id), String(b.id));
    });
  }

  const districts = (v.districts || []).map((d) => {
    const { root, branches, ...rest } = d;
    return clean({ ...rest, root: root ? folderName(root) : null });
  });

  return {
    ...clean({ ...v, buildings: [], districts: [], assignments: [] }),
    buildings,
    districts,
    assignments: [],   // ticket summaries, which are somebody else's business
    guestView: true,
  };
}
