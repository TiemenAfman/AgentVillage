---
name: mixamo-fetch
description: Fetch Mixamo animations and characters in bulk from mixamo.com under the user's own login, with scripts/mixamo-fetch.mjs, into a folder outside git (MIXAMO_OUT, default D:\Mixamo), with the export settings Promptholm wants. Claude runs the tool; the user only puts the token in place. Use whenever a task says /mixamo-fetch, "fetch <animation> from Mixamo", "download the sword / dance / swim animations from Mixamo", "which walks does Mixamo have", "get X Bot / a character from Mixamo", "fetch every Mixamo animation", or when a Mixamo clip for the game still has to be downloaded.
---

# Mixamo in bulk

The user does not run the node commands: **Claude runs everything** and reports the result. The
tool uses mixamo.com's own web API with the bearer token of the user's logged-in browser. That is
not something Adobe offers: README.md, "Mixamo in bulk", is the one place that says so, and
whether it is acceptable under Adobe's terms is for every user to weigh for themselves - point
them there before a first run, never tell them it has been weighed already.

Tool: `scripts/mixamo-fetch.mjs` in the repository root (Node 22, no dependencies; tested offline
by `tests/mixamo-fetch.test.mjs`; documented in README.md, "Mixamo in bulk"). Run it from the
repository root.

## 0. Where it writes

`<out>` is `--out <dir>`, else `MIXAMO_OUT`, else `D:\Mixamo` (`DEFAULT_OUT` in the script). It
must be outside the repository. A user who wants another folder sets `MIXAMO_OUT` once (Windows:
`setx MIXAMO_OUT E:\Mixamo`, then a new shell) or passes `--out` per run. Ask which folder they
use if `D:\Mixamo` does not exist and `MIXAMO_OUT` is not set.

## 1. The token - never touch it

- The token is in `<out>/token.txt` (or `--token-file`), or in `MIXAMO_TOKEN`, which wins.
  Check only **that** it is there (`test -s`, its size). **Never read, print or paste it**, never
  put it in chat or a log, never log in for the user, and never ask them to paste it in the chat.
- Missing, or the tool says `401/403 ... token has expired` (it lives about a day): ask the user
  to put a fresh one in place:
  1. On `https://www.mixamo.com`, logged in, F12 → Console: `copy(localStorage.access_token)`.
     The console then shows `undefined` - that is normal, the token is on the clipboard.
  2. Paste it into `<out>/token.txt` (a `Bearer ` prefix or quotes may come along).
  3. If that does not work: DevTools → Network → a request to `/api/v1/products` → Request
     Headers → `Authorization`, the part after `Bearer `.

## 2. Run

```bash
node scripts/mixamo-fetch.mjs list --query walking                 # search (--kind anims|packs|characters)
node scripts/mixamo-fetch.mjs anims Walking "Standing Idle"        # exact names, first match
node scripts/mixamo-fetch.mjs anims id:<uuid>                      # exactly that variant
node scripts/mixamo-fetch.mjs anims --query sword --max 40         # everything a search finds
node scripts/mixamo-fetch.mjs anims --all                          # everything (~2500, hours - ask first)
node scripts/mixamo-fetch.mjs characters "X Bot"                   # with skin, T-pose
```

Options: `--character "X Bot"` / `--character-id`, `--inplace`, `--fps`, `--format`, `--out`,
`--token-file`, `--delay <ms>` (default 1500), `--max`, `--every-match`, `--dry-run`. Long runs
with `run_in_background` and a generous timeout.

**Variants:** Mixamo often has several products with the same name ("Walking" first gave
*Walking With A Swagger*). For a plain name: first `list --query <name>`, show the user the
variants with their descriptions, and fetch the chosen one with `id:<uuid>` - unless they ask for
every variant (`--every-match`).

## 3. What comes out

- Settings: FBX Binary (`fbx7`), Without Skin, 30 fps, no keyframe reduction, **In Place off**
  (needed for anything played by distance: walk, run, sprint). Characters: with skin, T-pose.
- Default character: **Y Bot** (the bake expects Mixamo's own skeleton; X Bot works too).
- `<out>/anims/<character>/<name>.fbx` and `<out>/characters/<name>.fbx`, each with a
  `<name>.json` manifest (name, id, description, character, settings, date) and an `index.json`
  per folder (Mixamo id → file). A second product with the same name gets `-<id8>`.
- A file already there is skipped: start a stopped run again and it carries on.
- Requests are paced, back off on 429/5xx (Retry-After counts). Motion packs are not downloaded:
  fetch their motions by name.
- Quick check without Blender: the file starts with `Kaydara FBX Binary`. With Blender
  (`node scripts/blender.mjs` says which one, `$BLENDER` overrides) fps, mesh count and how far the
  hips travel can be measured (`scripts/measure-mixamo.py`, see `mixamo-clips`).

## 4. Into the game

A download is **not** in the game. Only when the user asks: copy the FBX to `assets/mixamo/` and
follow the project skill [mixamo-clips](../mixamo-clips/SKILL.md) (clips.json, bake, playing it).
The FBX files never go into git.

## Verified

6 Oct 2026: search, export, status polling and download work against the real site (`Walking` on
Y Bot: FBX Binary, 0 meshes, 30 fps, hips 1.77 m forward). The character export (T-pose with skin)
has not been run for real yet - if it fails, compare `buildExport()` with what the page sends in
the network tab.
