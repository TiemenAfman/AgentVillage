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

export function guestVillage(v) {
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
      sheds: (b.sheds || []).map((s) => {
        const { title: t, sessionId: sid, gitBranch: gb, ...shed } = s;
        return shed;
      }),
    });
  });

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
