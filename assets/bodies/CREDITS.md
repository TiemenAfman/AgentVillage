# The Wanderer's bodies and outfits

The Wanderer (Plans/basislichamen-en-outfits.md) is built from two free kits by **Quaternius**
(https://quaternius.com), both released under **CC0 1.0** (public domain dedication,
https://creativecommons.org/publicdomain/zero/1.0/). No credit is required; it is given anyway.

- **Universal Base Characters** (Standard, free) -
  https://quaternius.itch.io/universal-base-characters - the two bodies
  (`Superhero_Female_FullBody`, `Superhero_Male_FullBody`, with their eyes and eyebrows) and the
  hairstyles `Hair_Long`, `Hair_Buns`, `Hair_SimpleParted`, `Hair_Buzzed` and `Hair_BuzzedFemale`.
- **Modular Character Outfits - Fantasy** (Standard, free) -
  https://quaternius.itch.io/modular-character-outfits-fantasy - the clothes of the `Peasant`
  (`Female_Peasant`, `Male_Peasant`).

The zips (`Universal Base Characters[Standard].zip`, sha256
`fdbf1804c90dfc1ea03e992bff7da2dfd1a79318e13270a660180f9308455f40`, and `Modular Character Outfits
- Fantasy[Standard].zip`, sha256 `c3468b18871cc8c8f05ab14df7712baf22cb9f389cbd870babf130e595187f70`)
are 400 MB together and are kept outside git. `scripts/prepare-bodies-source.py` copies what the
bake reads into `source/`.

## What was changed

In `source/` (scripts/prepare-bodies-source.py): only the glTFs the bake reads; their textures
are the base-colour maps alone, scaled to 1024, and each glTF names only those. The bodies use the
kit's *light* skin map, saved under the name the glTF gives the dark one.

By `scripts/build-bodies.py`, which writes `island-wanderer-<sex>.blend` and `web/js/bodies-mesh.js`:

- Scaled to the island (0.25), the T-pose's arms let down 82 degrees to hang, and every armature
  (hair, outfits) posed onto the body's own bones - which also fits the male peasant, made for the
  kit's narrower Regular man, onto this body.
- The 65-bone skeleton folded into the island's limb chains: three joints a limb, the torso's
  five, three knuckles a finger.
- The textures sampled into per-corner colours; skin and hair turned into shades to be dyed; the
  underwear, which the kit colours through a vertex mask, drawn charcoal.
- The peasant cut into four garments (shirt, trousers, shoes, arm straps: the sleeves of `Arms` to
  the shirt, its loose straps to their own); skin under each garment's cloth left out per garment;
  the peasant woman's hands, painted into her sleeves, cut away so the body's own hands show.
- Re-weighted where pieces meet: the legs also to the pelvis, the shirt wholly to the torso, the
  crotch drawn in both legs.
- Added: the island's own wardrobe (hats, backpack, armour), refitted from the Adventurer's.
