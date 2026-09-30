# Promptholm settler

The player uses the selected **Ambachtelijk karakter** study (concept 3): a smooth
traveller with a fitted sage waistcoat, linen shirt, belt pouch, leather backpack and
rolled blanket. Created in Blender 5.2 from the modelling helpers in
`scripts/build-settler-concepts.py`; `scripts/build-settler.py` builds the compact runtime
version and fitted equipment. No external character assets are used.

The geometry test caps the assembled model, including optional armour and any
one of the seven refined hats, at 24,000 triangles.
Blender corner normals survive export, so the island, inventory preview and item icons
show the same soft surfaces. Clothing and leather still use the existing saved dyes;
the waistcoat keeps its sage colour. The inventory's Outfit slot includes shirt sleeves,
vest, belt and pouch. Equipment toggles and all eight headwear choices remain available.

- `promptholm-settler.blend`: editable named parts, seven hidden/visible hat variants,
  materials, lighting and preview camera. Bare-headed uses no hat mesh.
- `settler-preview.png`: Blender studio render of the default wardrobe.
- `../../web/js/settler-mesh.js`: generated geometry used directly by the app.

The studio preview remains a vertex-coloured model with `aEmissive = 0` and
`aSheet = 0`, compatible with the island material. In walk mode the same named Blender
parts are split into a core, four limb groups and a backpack group by `classic-avatar.js`.
The Blender source now includes three bones per limb and skin weights, built by
`scripts/rig-settler.py`. Knees, ankles, elbows and wrists deform the clothing; shoe soles
remain rigid. `avatar-gait.js` places feet with two-bone inverse kinematics and advances
the cycle by actual displacement after collision checks, including interpolated peers
and movement relative to ship decks. Walking uses 0.65 units/s and running 1.10 units/s.
Running has longer strides, bent elbows and a brief flight phase. Water and vehicle
travel retain their existing speeds. The saved wardrobe format is unchanged. It is the only character
the Avatar panel offers - a second, rigged Kenney GLB used to be selectable alongside it and
was removed outright, `character` field and all, rather than kept as a second, unused code
path nothing built against any more.
NPC settlers use their own Blender resident model described below.

The browser's `promptholm.avatar` schema and seven hat choices are unchanged. Skin,
tunic, leather/trim and hat colours are applied at runtime. Feet are at Y=0, forward
is +Z, and scale remains 1.12. Eye height is exported from the Blender scene's
`avatar_eye_y` custom property, in unscaled game units.

The interactive `/avatar-motion.html` workbench shows walk, run and idle, optional
bones, two viewing angles and the live inventory. Motion captures are in `motion/`.

## Edit in Blender

Open the blend file, edit its named meshes and save. Keep the `avatar_slot`, `avatar_variant` and `avatar_group` custom properties on each exported object. Hidden hat variants are
exported too; the floor, lights and camera are excluded. Blender uses Z up, with the
character facing -Y. Update `avatar_eye_y` if you move the eyes vertically. The scene property
`avatar_rig` stores arm, leg, neck and hand anchors in game coordinates.
`avatar_joints` stores bend/end anchors. Keep the limb vertex groups and `avatar_skin`
properties when editing weighted meshes. `build-settler-hats.py` authors all seven hats.
`avatar_smooth_normals` enables corner-normal export. Keep it enabled for the player.

From the project root, export the saved edits in PowerShell:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' assets/settler/promptholm-settler.blend --background --python scripts/export-settler.py
node --test tests/*.test.mjs
```

Reload Promptholm and open **Avatar** to see the result. The studio and walking
avatar both use the exported geometry. No GLTF loader or asynchronous asset loading
is needed.

## Rebuild the original design

This regenerates the blend file and render, replacing any manual Blender edits:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --python scripts/build-settler.py
```

## Village residents

`promptholm-villager.blend` contains the residents' shorter body, rolled sleeves,
waistcoat, pocket apron and compact work hats. They share the player's facial style
but have no expedition pack or bedroll. `villager-preview.png` shows one resident;
`/characters.html` compares the runtime models, including women in work trousers and
skirts, an apprentice and a sailor. `villager-woman-preview.png` and
`villager-woman-trousers-preview.png` show the women's outfits. All residents have folded shirt collars and slimmer
waistcoats; the swept hair and bun sit below the hats.

`settlerLook` assigns roughly half the fictional residents a women's presentation using
an independent `:appearance` seed. It never infers anything about a session's author.
The original `:look` draw order, body proportions and walking stride stay unchanged.

The population uses eleven fixed articulated body batches (core clothing, paired arms,
hands and legs, neck, head and face details), two optional appearance batches (hair and
skirt), six hat batches, four chore-tool batches and a hammer batch: 24 in total.
The count is constant regardless of population: adding a resident still adds no draw
call. Skin colours, model-based clothing colours, seeded proportions and picking remain
supported, while walking residents now swing opposite arms and legs and workers lift the
hammer arm. The uninstanced figures used in interiors use these same parts and
proportions. Resident eye height is used by face-to-face conversations.

To export manual edits to the resident blend, run:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' assets/settler/promptholm-villager.blend --background --python scripts/export-settler.py
node --test tests/*.test.mjs
```

The scene property `avatar_mesh_name` directs this export to `web/js/villager-mesh.js`.
Keep the `avatar_variant` tags (`torso`, `limbs`, `hands`, `head`, `detail`, `womanHair`, `skirt`, or a hat ID)
and `avatar_slot` on edited meshes. The head and facial details pivot around game
Y=0.350; hands and neck follow the body. Hat, shirt, workwear and skin colours are
replaced by each resident's wardrobe at runtime, while facial detail colours are baked.

To regenerate the original residents from their own resident blend (replaces manual
clothing edits, preserves the resident faces), run Blender with `--background --python scripts/build-villagers.py`.
