---
name: mixamo-clips
description: Add or change a Mixamo animation for the player's body - download settings, assets/mixamo/clips.json, scripts/bake-mixamo-gait.py -> web/js/gait-clips.js, playing it in web/js/classic-avatar.js (playClips), and checking it against the clip. Use whenever a task adds a Mixamo clip (walk, run, sprint, idle, jump, swim, dig, a new action), touches gait-clips.js, bake-mixamo-gait.py, measure-mixamo.py or the clip code in classic-avatar.js, or asks why a played clip looks wrong (a limb pointing the wrong way, a foot sliding or in the ground, a body lying twice as far forward).
---

# Mixamo clips on the player's rig

The player's body (the Adventurer, `gait: 'athlete'` with `clips: true` in `web/js/avatar-gait.js`)
plays Mixamo clips. It does **not** load an FBX at runtime (CLAUDE.md, "Nothing is fetched at
boot"): every clip is baked into `web/js/gait-clips.js`, a generated module, and the rig turns its
own joints towards the baked rotations. The plan is [Plans/tweede-avonturier.md](../../../Plans/tweede-avonturier.md).

    ~/Downloads/<Clip>.fbx      what Tiemen downloads from mixamo.com
        |  copied to assets/mixamo/<name>.fbx, listed in assets/mixamo/clips.json
        v
    scripts/bake-mixamo-gait.py (Blender)  -->  web/js/gait-clips.js   (committed, never hand-edit)
        v
    web/js/classic-avatar.js  playClips / applyClip  -->  the rig's joints

## 1. Download settings (tell the user these)

- **Format: FBX Binary (.fbx)**. Blender imports no ASCII FBX.
- **Skin: Without Skin** for the clip itself (one *With Skin* download is useful once, to render
  the Mixamo body beside ours for comparison).
- **Frames per Second: 30**, **Keyframe Reduction: none**.
- **In Place: OFF** for anything played by distance (walk, run, sprint): the bake reads the
  stride from how far the hips travel and refuses an In Place gait. For a clip played by time
  (idle, jumps, swim, dig) it does not matter.

**Many at once:** `node scripts/mixamo-fetch.mjs anims Walking "Standing Idle"` (or `--query`,
`--all`; `characters` for bodies with skin in T-pose) exports with exactly these settings on Y Bot
through mixamo.com's web API, under the user's own token, into `D:\Mixamo\anims\y-bot\` - outside
git, skipping what it already has, a `<name>.json` manifest beside each file. README.md, "Mixamo in
bulk", says how the user gets the token; never type, paste or log one yourself. A fetched clip is
not in the game until it is copied into `assets/mixamo/` as below.

## 2. Add it

1. Copy the download to `assets/mixamo/<file>.fbx` (lower case, dashes) and add
   `"<name>": "<file>.fbx"` to `assets/mixamo/clips.json`. The bake writes the module **whole**
   from that list, so a clip left out of it disappears from the game. A listed clip whose FBX is
   not on this machine keeps the rows the module already has (`KEPT` in the output), so a new
   clip needs only its own download; one that was never baked and has no FBX stops the bake. The
   FBX are **not in git** (`.gitignore`): Adobe's terms allow
   Mixamo animations inside a game, not handed out as files, and the repository is public. Only
   `clips.json` and the baked `gait-clips.js` are committed; a machine without the FBX downloads
   them again (each listed file is named after its Mixamo clip: Walking, Running, Sprint,
   Standing Idle, Jump, Standing Jump, Swimming, Treading Water, Digging, Falling Forward Death and
   Floating - "Floating In Air Flailing Arms", which is `drown`: Mixamo has no drowning clip) before it can re-bake.
2. Decide how it is played and say so in `bake-mixamo-gait.py`:
   - **by distance** (a gait: walk, run, sprint): nothing to add; it needs a travelling clip and
     gets `stride`, `speed` and `contact` (where in the cycle the left foot comes down).
   - **by time** (idle, a jump, swim, dig, `die`, `drown`, any action): add the name to `TIMED`. A jump also
     gets `air` (the stretch with both feet off the ground) when it is listed where `air` is
     worked out.
3. Bake (needs Blender; `node scripts/blender.mjs` says which one):

       node scripts/blender.mjs --background --python scripts/bake-mixamo-gait.py

   It prints `BAKED <name> ...` per clip. A script that throws still exits 0 through
   `scripts/blender.mjs`: look for `Traceback` in the output. Bake twice and `cmp` the module:
   the second run must change no byte.
4. Measure the clip in numbers (angles per frame and a summary in leg lengths) when its
   speed, stride, lean or arm swing matter:

       node scripts/blender.mjs --background --python scripts/measure-mixamo.py -- assets/mixamo/<file>.fbx

## 3. Play it

All of it is in `web/js/classic-avatar.js`, inside `buildRig`:

- `GAIT_CLIPS.<name>` is `{ source, seconds, contact, rows, stride?, speed?, air? }`; a row is a
  quaternion per joint of `GAIT_JOINTS` (pelvis, spine, chest, neck, head, l/r clavicle, arm,
  elbow, wrist, hip, knee, ankle, toe) and the hips' `drop` in leg lengths.
- `sampleClip(clip, u, pose)` reads it at `u` (0..1, wrapping); `sampleOnce` does not wrap (a
  jump's flight); `blendPose` slerps two poses; `mirrorPose` turns a right-handed clip into the
  left hand's.
- `playClips(pose, dt, ...)` picks which clip plays this frame and hands the result to
  `applyClip(p, w, { arms, back, drop })`, which turns every joint by `w` (`clipMix`, eased).
  Arms that are busy (an item, a swing, a block) keep their own pose unless `arms: true` (the
  dig, which holds the shovel with both hands). A new action is a new branch in `playClips`:
  its condition from `pose` (or the rig's own state, like `dug`), its own clock (`digT`,
  `swimT`), and whatever gameplay counter it drives (the dig's `dirt` at `DIG_THROW`).
- Dying (`die`, `drown`; Plans/vallen-en-verdrinken.md) is the first branch of `playClips`, on
  `pose.dying.t` (the caller's clock), and with no clip baked `dyingPose` does it procedurally -
  so baking one is the whole change. `dyingSeconds` caps a clip at 4 s, inside the sea's wait for arrival (lib/health.mjs `ARRIVE_MAX_MS`).
  Never a death clip from the WoW pack (`/wowhead-character-extract`): Blizzard's, local only.
- Speeds: a gait plays by distance, so its foot never slides at any speed. `withClips` takes
  the clips' stride (scaled by this body's leg, hip to ankle) and the walk's speed; run and
  sprint keep the profile's faster speeds, which only raises their cadence.
- `plantFeet` lifts the body off the ground (and lets it down at a walk) by the lowest heel,
  ball or toe, since Mixamo's angles on our proportions leave a foot a centimetre out.

The rig the clip turns: the torso is skinned to `torso.pelvis/spine/chest/neck`; legs hang
from `mounts.pelvis`, the collarbones (`clavicles`) and the pack/chestplate from `mounts.chest`,
the head from `mounts.neck` - a mount is a group whose matrix is its bone's change from rest
(`placeMounts`), so every pivot keeps its rest position. Legs have a toe bone, arms a sleeve cap.

## 4. How the bake turns Mixamo's bones into ours (when something points the wrong way)

- A joint's own turn is `Dparent^-1 D` with `D = W W0^-1` (world rotation against rest).
- Mixamo's rest is a T-pose; the arm and leg chains' rests are first turned to hang straight
  down (`align`), so elbows, wrists, knees and ankles keep exactly their turn.
- Blender world (X the body's left, -Y forward, Z up) to the rig's mirrored frame: a quaternion
  `(w, x, y, z)` becomes `(w, x, -z, y)` (`to_rig`). The rig's "left" is the body's left.
- The heading: a travelling clip faces the way its hips travel; a **timed** clip faces the way
  its hips face at its first frame (`LeftUpLeg - RightUpLeg` is the left) - an In Place clip
  still drifts a few centimetres, and taking that drift as the heading turned a dig sideways.
- Constant offsets are taken out where our rest already has them: the collarbones keep only
  their swing about their mean (Mixamo's shoulders drop 20 degrees from the T-pose), and the
  swim's pelvis loses only its mean lean forward, about the body's left (walk.js already lays a
  swimmer 1.32 rad forward) - not its roll: Mixamo's hips roll a few degrees that the spine turns
  back, and taking the whole mean out left the shoulders twisted. A body that plays its own stroke
  says so (`strokes` on the rig), and walk.js and peers.js then lay it in the water without the
  roll and nod they give the Traveller, which on top of a clip were a wiggle on their own beat.

To check a pose objectively, compare bone directions: a Blender script printing, at clip
fraction `u`, the unit vectors hips->neck, shoulder->elbow, elbow->hand, hip->knee, knee->ankle
(converted to three's frame: `(x, z, -y)` after turning to the clip's heading), against the
same vectors off the rig's bones (`rig.joints.<limb>.root/bend/end`, `torso:pelvis`/`torso:neck`
by name) after stepping it to the same moment. They should agree to about 0.1.

## 5. Check and ship

- `/avatar-motion.html` (the motion workbench): Lopen, Rennen, Sprinten, Zwemmen, Graven,
  Springen, Dichtbij, Zijaanzicht. In a hidden browser pane no frames run between screenshots:
  set `travellerPreview.held = true` and step with `travellerPreview.advance(frames)`.
- Tests: `node --test tests/characters.test.mjs tests/sprint-walk.test.mjs tests/avatar.test.mjs`
  (feet on the ground, speeds, a sky-view route sprinting, the rig's structure), then the suite.
- Commit `clips.json`, `gait-clips.js` and the code together - never the FBX (above); the
  message in Dutch, in the island's terms ("Laat de avonturier graven zoals Mixamo").
