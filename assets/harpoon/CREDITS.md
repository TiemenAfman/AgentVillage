# The harpoon gun's source model

The galleon's harpoon gun (Plans/harpoen.md) is the model below, made lighter. These are the details
the downloaded file carries itself (`asset.extras` in `source-harpoon.glb`, the unmodified download,
sha256 `188b6096d30c4bf84e1bfef7864bb9b2d38bbaaeea34874083eb3080046f9140`):

- **Title:** Sea Of Thieves Harpoon
- **Author:** J.D.Productions — https://sketchfab.com/J.D.Productions
- **Source:** https://sketchfab.com/3d-models/sea-of-thieves-harpoon-415e9492c4044f27ab8ec9d4367de5ec
- **Licence:** CC BY 4.0 — http://creativecommons.org/licenses/by/4.0/

The model is a fan's recreation of the harpoon in *Sea of Thieves*; that game and the design of its
harpoon belong to Rare Ltd. / Microsoft. Nothing here is endorsed by them, by the model's author or
by Sketchfab. The keeper chose to use it as it is (8 October 2026), with a house-style harpoon of the
island's own made beside it to compare.

## What was changed

`scripts/build-harpoon-glb.py` makes every change from the unmodified GLB into
`web/models/harpoon.glb`, so the list below is also what that script does:

- Turned to face +Z and scaled so the trunnion stands 0.31 above the deck (about 1.25 m).
- Grouped into four pieces with their origins on their own axes - pedestal, yoke, gun, harpoon -
  so the gun can be traversed and elevated and the harpoon fired out of it; an empty marks the
  barrel's mouth.
- Decimated per piece, from 48,518 triangles to about 7,400 (most of the cut is the leather
  windings and the rope coil).
- Textures halved to 512 × 512 and saved as JPEG; the ambient-occlusion maps left out.
