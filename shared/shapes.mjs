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
  // Built out of the quay's own dock set, and it sits on the sea rather than on the
  // ground: a dock put down inland is a dock buried in a hillside, which is the right
  // answer to asking for one there.
  dock: { what: 'A plank dock on piles, with a ramp onto the beach and mooring posts', takes: ['rot', 'length'] },
  fence: { what: 'A run of paling fence', takes: ['rot', 'length'] },
  bench: { what: 'A bench to sit on', takes: ['rot'] },
  barrel: { what: 'An oak barrel, the tavern\'s own', takes: ['scale'] },
  // The yard, modelled in Blender: the things lying about between the houses. Every one of
  // them turns, because a cart parked square to a wall and a cart parked across a lane are
  // different pictures, and none of them stretches - a baked mesh has one length, unlike
  // the fence and the bridge, which are drawn to fit.
  cart: { what: 'A handcart with spoked wheels and a draw pole', takes: ['rot', 'scale'] },
  crate: { what: 'A slatted packing case', takes: ['rot', 'scale'] },
  woodpile: { what: 'A stack of split firewood', takes: ['rot', 'scale'] },
  tent: { what: 'A ridge tent, open at the front. What a session lives in before it builds', takes: ['rot', 'scale'] },
  washline: { what: 'Two posts, two lines and the washing on them', takes: ['rot', 'scale'] },
  lamp: { what: 'A lamp post, lit after dark', takes: ['scale'] },
  signpost: { what: 'A signpost with a blank board', takes: ['rot'] },
  well: { what: 'A stone well with a roof', takes: ['scale'] },
  statue: { what: 'A settler on a plinth', takes: ['rot', 'scale'] },
  campfire: { what: 'Logs and a flame', takes: ['scale'] },
  flag: { what: 'A pole with a pennant', takes: ['scale'] },
  panel: { what: 'A board with a page of the island on it, read and worked up close', takes: ['rot', 'scale', 'length', 'face'] },
  cairn: { what: 'A stack of stones. What an unknown shape becomes.', takes: ['scale'] },
};

// The numbers every prop carries, whatever its shape.
export const COMMON = ['x', 'z', 'rot', 'scale', 'label'];

// The order the build menu offers them in, which is the order they are written above.
export const KINDS = Object.keys(SHAPES);

// What the wheel does for a shape you are holding.
//
// This is the one place `takes` stops being documentation. It has always listed which of
// the optional numbers mean something for a shape; the build menu turns that into which
// modifier does what, so nothing has to be memorised and no shape gets a control that
// would do nothing.
//
// A round thing has no turn worth making, so plain scroll falls through to its size -
// that is the catalogue earning its keep rather than a special case. `length` is the
// stretch in one direction, and only the three shapes that have a length offer it.
export function wheelsFor(kind) {
  const takes = (SHAPES[String(kind)] || {}).takes || [];
  const wheel = takes.includes('rot') ? 'rot' : takes.includes('scale') ? 'scale' : null;
  return {
    wheel,
    ctrl: takes.includes('scale') && wheel !== 'scale' ? 'scale' : null,
    shift: takes.includes('length') ? 'length' : null,
  };
}

export function knownShape(kind) {
  return Object.prototype.hasOwnProperty.call(SHAPES, String(kind));
}

export function catalogueLines() {
  return Object.entries(SHAPES).map(([k, s]) => {
    const extra = s.takes.filter((t) => t !== 'scale' && t !== 'rot');
    return `  ${k.padEnd(10)} ${s.what}${extra.length ? ` (--${extra.join(', --')})` : ''}`;
  });
}
