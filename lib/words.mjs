// Most sessions carry no readable slug, so settlers get a name derived from their
// session id: stable, pronounceable, and village-flavoured.
export const ADJECTIVES = [
  'Amber', 'Ashen', 'Bold', 'Brisk', 'Bright', 'Copper', 'Clever', 'Cobble',
  'Dusty', 'Dawn', 'Deft', 'Drifting', 'Eager', 'Ember', 'Elder', 'Fern',
  'Frosty', 'Gentle', 'Golden', 'Grave', 'Hearth', 'Hollow', 'Humble', 'Iron',
  'Jolly', 'Keen', 'Kindly', 'Lantern', 'Lively', 'Loamy', 'Merry', 'Misty',
  'Moss', 'Nimble', 'Northern', 'Oaken', 'Olive', 'Patient', 'Pebble', 'Quiet',
  'Rusty', 'Rowan', 'Ruddy', 'Salt', 'Sandy', 'Silver', 'Slate', 'Sober',
  'Sparrow', 'Steady', 'Stony', 'Sunny', 'Tawny', 'Thistle', 'Thrifty', 'Tidy',
  'Umber', 'Verdant', 'Wandering', 'Wary', 'Willow', 'Windy', 'Wry', 'Zesty',
];

export const NOUNS = [
  'Alder', 'Anvil', 'Barrow', 'Beacon', 'Bell', 'Birch', 'Bramble', 'Brook',
  'Cairn', 'Cedar', 'Chisel', 'Cove', 'Crane', 'Dell', 'Dune', 'Ember',
  'Fathom', 'Ferry', 'Field', 'Finch', 'Forge', 'Furrow', 'Gable', 'Glade',
  'Granite', 'Harbour', 'Hawthorn', 'Heath', 'Hollow', 'Kiln', 'Lantern', 'Ledge',
  'Loom', 'Marsh', 'Meadow', 'Mill', 'Moor', 'Orchard', 'Otter', 'Peat',
  'Pike', 'Quarry', 'Quill', 'Reed', 'Ridge', 'Rook', 'Sable', 'Sail',
  'Shale', 'Shore', 'Sickle', 'Spindle', 'Spire', 'Stile', 'Tern', 'Thatch',
  'Thorn', 'Tide', 'Vale', 'Warren', 'Wharf', 'Willow', 'Wren', 'Yarrow',
];

export function titleCase(s) {
  return String(s || '')
    .split(/[\s\-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
