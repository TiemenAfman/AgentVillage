# The Adventurer's source model

The Adventurer (Plans/tweede-avonturier.md) is adapted from a model published on Sketchfab.
These are the details the downloaded file carries itself (`asset.extras` in
`source-link.glb`, the unmodified download, sha256
`4edc94563249e59a553d1bfed474aba36ac70bf81b73bb5acd731b1e97687f9f`):

- **Title:** Link
- **Author:** A_CAT564 — https://sketchfab.com/A_CAT564
- **Source:** https://sketchfab.com/3d-models/link-c14d3de2cfc546ad94c3c9be4f24496a
- **Licence:** CC BY 4.0 — http://creativecommons.org/licenses/by/4.0/

The plan named the uploader as 1_clicks_ (@ZENTA-_-) from the model page; the file's own
metadata names A_CAT564. Both are recorded here until the page is checked again.

## What was changed

`scripts/build-adventurer.py` makes every change from the unmodified GLB, so the list below is
also what that script does:

- Scaled to the island (0.285 × 0.92) and turned to face +Z; the A-pose arms lowered 43° to hang.
- The 124-bone skeleton folded into three joints per limb, the rig the island's player uses.
- The texture sampled into per-corner colours; the face subdivided once so it keeps its detail.
- Recoloured: the tunic plain slate blue (its emblem gone), the hair dark brown, the trousers
  sand, belts, gauntlets and arm guard brown leather with plain brass fittings.
- Reshaped: the long pointed ears drawn in to small round ones, the ponytail and side locks
  shortened (both through the source's own ear, ponytail and sideburn bones).
- Left out: the sword, the shield, the sheath and the earring.
- Added: the island's own wardrobe (hats, backpack, armour), refitted from the Traveller.
