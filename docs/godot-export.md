# A model from the workbench, in Godot

`/editor` has an **Export .glb** button. It writes the model that is on the bench at that
moment - your nudges included - to a single `.glb` next to your downloads, at the size the
island draws it, not at the size the code is written in.

## What comes across, and what does not

glTF holds meshes. It does not hold the material this island draws with, and it cannot:
`onBeforeCompile` is not something the format can express, and the sheets are projected
from the three axes rather than laid on a uv, so there is no texture coordinate to hand
over either. What arrives in Godot is therefore:

- the geometry, flat-shaded, with the normals worked out;
- the colours, as `COLOR_0` - one per vertex, exactly the palette this island uses;
- one surface per sheet, named after it.

What does not arrive is the sheet itself, the glow strength per vertex, and the anchors.

## Putting the sheets back on

Each surface comes out named for what it is drawn on. Give it a `StandardMaterial3D` with
**Vertex Color > Use As Albedo** ticked, then:

| surface          | texture              | Triplanar | UV1 Scale |
| ---------------- | -------------------- | --------- | --------- |
| `island-paint`   | none                 | off       | -         |
| `island-wall`    | `wall-plaster.png`   | on        | 1.7       |
| `island-roof`    | `roof-tile.png`      | on        | 1.0       |
| `island-stone`   | `stone-stacked.png`  | on        | 0.62 mix* |
| `island-plank`   | `plank.png`          | on        | 1.3       |
| `island-plankZ`  | `plank.png`          | on        | 1.3, turned a quarter |

Triplanar is **Local**, not World: the projection follows the model, which is what keeps
the pattern the same size on a cottage and on a keep. The sheets themselves are in
`web/textures/`.

\* The stacked stone was drawn for a rubble wall and swings from a fifth of full brightness
to all of it. `buildings.js` takes a little under two thirds of it so the paving keeps the
deepest tone on the island; in Godot that is an albedo tint rather than a scale.

Anything named `…-glow` is a lit window or a lantern. It arrives with its emission colour
already set to what the panes are painted; turn **Emission** on and it lights up.

## What this is not

It is a one-way export of one model. The island itself is still built in `buildings.js` and
read from there, and a `.glb` that has been edited in Godot cannot be brought back. Nudge
in the workbench, Save, and export again.
