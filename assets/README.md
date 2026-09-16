# Modelling for Promptholm

Every shape on the island is either written in `web/js/buildings.js` as a handful of
coloured boxes, or modelled in Blender and baked into a module of triangles. This is the
house style for the second kind: what a `.blend` in this folder has to be so that
`npm run models` accepts it and the island can draw it without knowing it came out of
Blender at all.

It is one page because it is one set of conventions. The figures came first
(`assets/settler/`, `scripts/build-settler.py`), the tavern second
(`assets/tavern/`, `scripts/build-tavern.py`), and everything since follows the same
rules. Where a number appears here it also appears in code, once:
`scripts/model-rules.mjs` holds the ones a machine can check.

## The route

    assets/<set>/<set>.blend  ──blender──▶  web/js/<set>-mesh.js  ──import──▶  mesh()

One folder is one set, one set is one `.blend`, and it bakes to one module of plain
arrays that `web/js/models.js` imports like any other file. There is no loader, no
manifest, no fetch and nothing to await: the shapes exist before the first line of
`main.js` runs. That is deliberate. A loader means the island either waits on the
network before it can draw, or draws itself once with stand-ins and again with the real
thing - and the boot screen saying "Charting the island…" forever is the failure this
project has already had once.

The price is bytes: `web/js/tavern-mesh.js` is 386 kB of JSON. `serve.mjs` gzips it to
12 kB on the way out, and the triangle budgets below are the other half of the answer.

    npm run models                    bake every set, then check all of them
    npm run models -- props           only this set
    npm run models:preview            render assets/<set>/renders/<asset>.png
    npm run models:preview -- props prop_barrel

`scripts/blender.mjs` finds `blender.exe`: `$BLENDER` first, then the versioned install
under `C:\Program Files\Blender Foundation\`, then the `PATH`. Nothing on the island ever
needs Blender - the baked modules are committed - so a checkout without it still boots.

Committed: the `.blend` and the baked `web/js/<set>-mesh.js`. Ignored: `*.blend1` and
`assets/**/renders/`, both of which anyone can make again from what is committed.

## Axes, scale and origin

**One Blender unit is one island unit is one ground cell is four metres.** There are no
metric units anywhere in the source; a barrel is 0.23 across because that is 90 cm. Two
places had guessed otherwise and were wrong, so if a number in metres ever has to be
converted, convert it here.

**Blender is Z up, the island is Y up.** The exporter maps
`game(p) = (p.x, p.z, −p.y)` — the same line in `scripts/export-models.py`,
`export-settler.py` and the `xyz()` helper every `build-*.py` uses to write island
coordinates and let Blender have them its own way.

**The front of a model faces +Z on the island, which is −Y in Blender.** Every door,
every window, every awning. The tavern faces the street on +Z; a tent whose opening ends
up on −Z has been modelled back to front, and it is worth checking on `web/demo.html`
rather than on the island, where half the buildings are turned anyway.

**The origin sits on the ground, in the middle of the footprint.** `y = 0` is grass. A
shape modelled around its own middle sinks half of itself into the lawn and a shape
modelled above the scene floor hovers; both only become visible once it is standing on
the island, which is too late. `npm run models` refuses either. Props and plants also
have to be centred on x and z, because that is the point the island puts them on.

A roof is the exception worth knowing: model it with its origin on the eaves plane, so
that `mesh('roof_gable_a', hex, { y: top })` behaves exactly like the `prismRoof()` it
replaces.

## Materials are colour slots, and the name is the sheet

No textures, no UVs, no shader nodes. The island draws every building with **one
material** and one draw call, and which of its four texture sheets a face is drawn on is
a number carried on the vertex. So a Blender material means two things and nothing else:
a colour, and a sheet.

The **material name's prefix, up to the first colon, is the sheet tag**:

| prefix | sheet | for |
|---|---|---|
| `plain` | none | glass, iron, cloth, foliage, anything small and painted |
| `wall` | plaster | rendered walls |
| `roof` | tiles | roof pitches, ridge caps |
| `stone` | rubble / paving | foundations, chimneys, plinths |
| `plank` | boards along x | beams, doors, furniture |
| `plankZ` | boards along z | the same boards turned a quarter, for a run along z |

Anything after the colon is for you: `wall:cream`, `plank:oak`, `plain:iron`. Any other
prefix and the bake stops with the list it knows — quietly falling back to `plain` would
mean a plastered wall that is subtly flat and nobody noticing for a month.

Two more sheets exist that no building may name: **`bark` and `foliage`**. They are the
forest's, and they are the exception to one material because the forest is the exception
to one draw call. A tree is not merged into the island's geometry — it is an
`InstancedMesh` of its own, twenty thousand copies for one call — so it can afford a
material array, and it needs one: needles want a different sheet from the trunk they
grow on, and a building carrying the sheet as a number on the vertex cannot express
that. So `flora_pine_a trunk` is `bark:pine`, its skirts are `foliage:pine`, and
`grouped('flora_pine_a', ['bark', 'foliage'])` in `web/js/models.js` gives back one
geometry with a group per slot, in the order asked for, for `world.js` to hand its two
materials to positionally. Ask for the slots in the wrong order and the tree grows a
wooden canopy; the order is asserted in `tests/models.test.mjs`.

`grouped()` also decides where the sheet lands, because no UVs come out of Blender for
anything: it projects each triangle flat down whichever axis the triangle faces most, the
same triplanar idea the building sheets use. A cylindrical wrap was tried first and
cannot work — the n-gon closing the underside of a bough spans every angle at once.

Set the colour on both `material.diffuse_color` and the Principled BSDF's base colour,
**linearised** (`build-tavern.py` has the four-line conversion). Linear is what the
exporter bakes into the vertex colours and what three.js encodes to sRGB on the way to
the screen, so `plank:oak` #845335 arrives on the island as #845335. A material with
`m['emissive'] = 1.0` becomes `aEmissive` on its vertices and glows after dark; it is a
switch, not a dial.

**Vertex colours are a multiplier, not a colour.** White leaves the material's colour
alone, which is what an unpainted mesh gets. Paint them to weather a surface or to shade
one face of a form, never to colour it — the colour belongs to the slot, for the same
reason `scripts/make-textures.mjs` keeps its sheets grey: two things that decide the same
colour make mud.

Flat shading throughout. The exporter writes no normals and `finish()` throws away the
ones it is given, because faces merged from shapes of wildly different sizes cannot share
smooth normals - and because the island looks the way it looks.

## What marks a mesh, an asset and an anchor

- `obj['building_part'] = True` on every mesh that should be baked. Anything without it
  is studio furniture: the floor, the camera rig, the reference cube. That is how each
  `.blend` can hold a lit scene to open and still bake only the model.
- `scene['building_height']` is how tall the set's tallest thing is. Buildings read it;
  props do not.
- **A set with more than one thing in it puts each in a collection named after it**, and
  every object inside is named after that collection too: collection `prop_barrel`,
  objects `prop_barrel staves`, `prop_barrel hoop lower`. The register in
  `web/js/models.js` is flat across all sets, so a part name has to be unique on the
  whole island; `npm run models` refuses two sets that use one name. A `.blend` with no
  such collection is a single hero asset named after the set - which is what the tavern
  is, because every part of it belongs to that one building.
- Empties named `anchor.<name>` become the anchors `main.js` hangs things on: `smoke`,
  `flag`, `door`, `sign`. Any other name is a typo rather than a feature, and the check
  says so.
- Variants are `_a`, `_b`, `_c`, so a caller can pick one with the rng; an optional `_lo`
  is the cheap one for the modest GPU mode.

Modifiers are fine and are applied on the way out (the tavern's bevels are real
modifiers), which means the triangle budget below is counted after them, not before.

## Triangle budgets

The cost of a shape is not its own size but how often the island draws it. A rock is
instanced by the thousand; a tavern stands once. So the budget follows the name prefix,
and `scripts/model-rules.mjs` refuses anything over it:

| prefix | triangles | why |
|---|---|---|
| `flora_rock` | 40 | thousands, instanced |
| `flora_bush` | 40 | undergrowth: a tree's cost with none of a tree's presence |
| `flora_` | 60 | ten thousand trees |
| `prop_` | 120 | dozens, put down by hand |
| `addon_` | 150 | a dormer or a turret, one or two per house |
| `roof_` | 300 | one per house, and there are 300 houses |
| `house_` | 600 | the body under that roof |
| `civic_` | 1500 | a handful on the island, looked at up close |

**The tavern is a deliberate exception.** It is a hero asset - a whole `.blend` authored
as one building, drawn once - and it sits at 2684 triangles as baked, 2956 as it stands
on the island with its porch and foundation under it. `HERO_BUDGET` is 4000, which is
where `tests/tavern.test.mjs` already put the ceiling for a modest GPU. A hero is
something you decide to make, not something a set becomes by growing.

None of this costs draw calls. A baked part carries the same attributes as a `box()` and
is merged into the same single geometry, so ten barrels are still zero extra draw calls -
which is the number to report, and `?stats` on the island is where to read it. The forest
is the one exception and it is an exception in the island's favour: a plant is an
`InstancedMesh` and costs one call per slot no matter how many of it there are, which is
why four thousand bushes are one call and a richer pine is none.

One thing `?stats` will not tell you, and it matters most here: **the shadow pass is not
in it.** three resets `renderer.info` after drawing the shadow map and before the colour
pass, so the overlay reports the colour pass alone - and an `InstancedMesh` is frustum
culled as one object, so if any part of the forest is in the shadow camera, every stem on
the island is submitted to it. A shadow-casting instance is paid for twice. Work the
second half out by hand and report it: instances times triangles, over the meshes with
`castShadow`.

## The yard a house has to fit in

`lib/layout.mjs` gives a house a 3×3 of cells and the plot edge is 1.50 from the middle.
What fits inside that is not free:

- **A house reaches at most ~1.15 from the middle of its plot.** Today's tiers reach
  0.86, and the difference is the border an apprentice's shed stands in.
- **The door cell, on +Z, stays clear.** It is where the path arrives and where a settler
  stands; `tests/tavern.test.mjs` asserts it for the tavern and a new asset should expect
  the same test.
- **A shed gets `SHED_SPAN` 0.58 across in a corner cell** - the cell less what the
  master's house already reaches over it. Draw one wider and it is drawn through its
  master's doorstep, which is exactly what happened to 37 of 39 of them once.
- Anything below `WALK_CLEARANCE` 0.55 blocks walking, and anything below `PORCH_UPTO`
  0.45 counts as footprint rather than as roof. A knee-high barrel blocks; an awning does
  not.

## What `npm run models` will not let past

Blender bakes without an opinion and Node decides what is wrong with the result, so the
rules live in one file and the test suite runs the same ones over what is committed
(`tests/models.test.mjs`). It fails, loudly and with the name of the offending part, on:

- a material whose prefix is not one of the six sheets;
- an asset over the budget for its name prefix, or with a name that matches no prefix at
  all and therefore has no budget;
- an origin that is not on the ground, or a prop that is not centred on it;
- an `anchor.*` nothing reads;
- two sets that bake a part under the same name;
- a scene with no `building_height`, a part with a colour for every position but one, an
  emissive that is neither 0 nor 1.

Run it twice: it is idempotent, and a second run that changes a byte means something in
the bake is not deterministic.
