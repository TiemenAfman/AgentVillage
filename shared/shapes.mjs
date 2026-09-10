// The catalogue of things that can be put on the island by hand.
//
// This is metadata only - names, a line of description, and which of the optional
// numbers actually mean something for that shape. The geometry lives in
// web/js/props.js under the same keys, and the command line reads this file to say
// what it will accept. Node and the browser both import it, like shared/terrain.mjs.
//
// Adding a shape means two edits: an entry here, and a builder in web/js/props.js.
// A prop whose kind is not in this list is still placed - it stands as a labelled
// cairn - so a request never fails just because nobody has drawn it yet.

export const SHAPES = {
  tree: { what: 'A broad-leaved tree', takes: ['scale'] },
  pine: { what: 'A pine, darker and narrower than a tree', takes: ['scale'] },
  rock: { what: 'A boulder', takes: ['scale'] },
  bush: { what: 'A low shrub', takes: ['scale'] },
  bridge: { what: 'A plank bridge with railings, spanning whatever is under it', takes: ['rot', 'length'] },
  fence: { what: 'A run of paling fence', takes: ['rot', 'length'] },
  bench: { what: 'A bench to sit on', takes: ['rot'] },
  lamp: { what: 'A lamp post, lit after dark', takes: ['scale'] },
  signpost: { what: 'A signpost with a blank board', takes: ['rot'] },
  well: { what: 'A stone well with a roof', takes: ['scale'] },
  statue: { what: 'A settler on a plinth', takes: ['rot', 'scale'] },
  campfire: { what: 'Logs and a flame', takes: ['scale'] },
  flag: { what: 'A pole with a pennant', takes: ['scale'] },
  cairn: { what: 'A stack of stones. What an unknown shape becomes.', takes: ['scale'] },
};

// The numbers every prop carries, whatever its shape.
export const COMMON = ['x', 'z', 'rot', 'scale', 'label'];

export function knownShape(kind) {
  return Object.prototype.hasOwnProperty.call(SHAPES, String(kind));
}

export function catalogueLines() {
  return Object.entries(SHAPES).map(([k, s]) => {
    const extra = s.takes.filter((t) => t !== 'scale' && t !== 'rot');
    return `  ${k.padEnd(10)} ${s.what}${extra.length ? ` (--${extra.join(', --')})` : ''}`;
  });
}
