# A model from the workbench, in Godot

`/editor` has an **Export .glb** button. It writes the model that is on the bench at that
moment - your nudges included - to a single `.glb`, at the size the island draws it rather
than the size the code is written in. Drop that file in a Godot project and it is done:
the colours, the sheets and the lit windows are all in it, and there is no material to set
up on the far side.

## How it is put together

The island keeps its whole palette on the vertices and draws every building with a single
material. That is what makes hundreds of them affordable, and it is exactly the wrong shape
for a file: `COLOR_0` is only applied by an importer that has been told to look for it, and
a model that arrives white is no use to anybody. So on the way out the colour moves off the
vertices and into the material - one per colour the model actually uses, which is between
four and twenty on everything in the catalogue. More draw calls than the island would ever
accept, and perfectly ordinary for one model on someone else's stage.

Each surface is named for what it is and what it is painted: `island-wall-f0e2c8`,
`island-stone-a8a59e`, `island-paint-ffd27f-glow`. The `-glow` ones are lit windows and
lanterns, and carry their emission colour already.

The sheets travel with the file, and only the ones the model uses. `finish()` throws the uv
away - that is what lets parts built at wildly different sizes merge into one loaf - so
there was none to hand over, and one is baked at export instead: every triangle takes the
axis it faces most and reads the two other position axes as its uv, at the same scale
`islandSheet()` uses. On anything that stands straight, which is very nearly every face on
the island, that is the picture the shader draws. A roof pitch faces between two axes, so
where the shader cross-fades two projections and comes out soft, the baked uv takes one and
comes out crisp and stretched by about a third along the slope. Of the two it is usually
the roof that looks better in the file.

One real difference to know about: the sheets read a little stronger in the `.glb` than on
the island. `islandSheet()` samples them with `texture2D` in its own GLSL, which does no
sRGB decode, so the island draws them paler than they are; a `baseColorTexture` is decoded
the way the format says. The shapes and the scale are identical - it is the contrast that
differs.

## The whole catalogue at once

**All** writes every model in the list to one `promptholm-models.zip`: 67 models and the
four sheets, about 4.5 MB. Unzip it into the Godot project and the folder imports as it
stands.

These are `.gltf` rather than `.glb`, and that is the whole point of the button. A `.glb`
carries its sheets inside it, so a zip of 67 of them would be forty-odd megabytes of the
same four pictures, and Godot would import 268 textures instead of four. In the zip the
pictures and the vertex data sit beside the models as files of their own - `c-tavern.gltf`,
`c-tavern.bin`, `wall-plaster.png` - all in one folder, and every model points at the same
four sheets. The stone one is called `stone-stacked-washed.png`, because it is the sheet
with the island's wash already on it.

**All** exports the catalogue as `buildings.js` has it, not as the bench has it. Anything
you have nudged and not saved is in the single-model export only.

## If you would rather Godot did the projecting

The baked uv is one projection per triangle. Godot's own `StandardMaterial3D` can do the
full triplanar blend, the same one the shader does, and it ignores the uv when it does. To
take that route, replace the material on a surface and set:

| surface        | texture              | UV1 Scale |
| -------------- | -------------------- | --------- |
| `island-wall`  | `wall-plaster.png`   | 1.7       |
| `island-roof`  | `roof-tile.png`      | 1.0       |
| `island-stone` | `stone-stacked.png`  | 1.0       |
| `island-plank` | `plank.png`          | 1.3       |

Triplanar is **Local**, not World: the projection follows the model, which is what keeps
the pattern the same size on a cottage and on a keep. The sheets themselves are in
`web/textures/`. Note that the stone in the file has a white wash brushed over it - the
shader takes a little under two thirds of that sheet so the paving keeps the deepest tone
on the island - so a raw `stone-stacked.png` will come out darker than the export.

## What this is not

It is a one-way export of one model. The island itself is still built in `buildings.js` and
read from there, and a `.glb` that has been edited in Godot cannot be brought back. Nudge
in the workbench, Save, and export again.
