# Paving textures

Both from [ambientCG](https://ambientcg.com/), 1K JPG, **CC0 1.0 Universal (public domain)**.
No attribution is required; this note exists so the next person does not have to go looking
for the answer.

Three maps are kept from each pack — colour, normal (OpenGL convention, which is what Godot
wants) and roughness. Ambient occlusion and displacement are not used here and were dropped
rather than carried.

## rocks025 — the painted path

[Rocks025](https://ambientcg.com/view?id=Rocks025). Irregular flat slabs bedded in gravel with
a little moss.

This is the one the **terrain** is painted with. Two reasons it beats the cobble for that job:
it tiles without an obvious grid, which matters when a path is painted into the ground at
whatever angle it happens to run, and its grey-green sits inside this island's palette rather
than next to it.

## paving138 — the built street

[PavingStones138](https://ambientcg.com/view?id=PavingStones138). Regular medieval cobbles with
moss in the joints. Reads as something that was laid rather than worn, which is right for the
town square and wrong for a track between two hamlets.

The two terrain textures in `../terrain/` come from the same place, by way of Terrain3D's demo.
