# Animal stories and island mysteries

Status: built, on 2026-09-26 (branches `codex/dierenverhalen`, then `claude/dierenverhalen`).
This page stays as the design; [Plans/dierenverhalen.md](../Plans/dierenverhalen.md) has the
decisions taken while building it, [animals-wire.md](animals-wire.md) the wire and
[animal-story-storage.md](animal-story-storage.md) the disk.

## Implementation status

All five stages are in, and connected end to end:

| | where |
|---|---|
| the story (reducer: traits, four labels with hysteresis, 13 encounters and a rest, window/hour/day limits, the relationship cap, marks, the Feathered Corner, the mystery, the vignette) | `lib/animal-stories.mjs` |
| the journal (flushed appends, one writer with stale-lock takeover, torn tails kept, paged diary) | `lib/animal-store.mjs` |
| when each is asked, and what is published (after every scan, on a completion, `/api/animals*`) | `lib/animal-life.mjs`, `serve.mjs` |
| where an animal can be on an island, and ground for a mark (the garden's own check) | `lib/animal-places.mjs` |
| the door and its strict parser, the forgiving packer | `lib/animalbundle.mjs`, `lib/sea.mjs` |
| movement on the sea (ticks, no trigonometry) and the herds | `shared/animalwalk.mjs`, `lib/animal-crowd.mjs` |
| the line home: generation, the door, `done` | `lib/seaclient.mjs` |
| the pose split and the shared instanced batch | `web/js/fauna.js`, `web/js/animal-view.js` |
| the marks (Blender set `traces`, seven props) | `scripts/build-traces.py`, `web/js/traces.js` |
| dossier, diary, return card, toasts, the settler dossier's section | `web/js/animal-dossier.js` |

Measured: every story animal on every island draws in at most 18 calls (one per species and
body part), the marks in 9; see "Metingen" in the Plans file. Tests: `node --test
"tests/animal-*.test.mjs" tests/traces.test.mjs tests/fauna.test.mjs`.

Where the build departed from the text below, the Plans file says so; the main ones: an
animal only visits within its species' reach of home (`MOTION.reach`), the sea's `done`
carries the generation of the *latest* post, the positions travel as `{t:'af'}` and the
public state as `{t:'herd'}` rather than as `island` messages, and a perching sparrow is
lifted onto the roof by the page (the sea knows no roof heights).

## Experience

Open the island to find out what its inhabitants have been doing. Animals should be
recognisable individuals whose repeated choices become local history. A small cast with
memorable habits matters more than a large species catalogue.

Keep the existing loop: sessions build homes and neighbourhoods. Add a second loop:
activity creates opportunities, animals respond, encounters change relationships, and
some relationships leave a permanent mark on a place. Let mysteries emerge from those
marks. There is no animal currency, feeding obligation or collection checklist.

The supplied examples are a creative direction, not literal balance requirements.
Five cats should not automatically conjure a building; cats repeatedly gathering at a
particular terrace could eventually make it the island's cat cafe.

## Existing animals and integration status

Nine species already have baked models and behaviour in `web/js/fauna.js`:

| Species | Existing behaviour |
| --- | --- |
| Horse | Walks and grazes; used by the stable module |
| Cow | Walks and grazes |
| Sheep | Walks and grazes |
| Goat | Walks and grazes with a restless rhythm |
| Chicken | Walks and pecks; two hens in the stable module |
| Duck | Swims and feeds |
| Gull | Flies in circles |
| Pig | Walks and roots about |
| Sparrow | Hops, pecks and flies; separate ground and flying models |

Reuse `assets/fauna/fauna.blend`, `scripts/build-fauna.py` and `web/js/fauna-mesh.js`.
Bees also exist in `web/js/countryside.js`: seven animated instances around a beehive.
They are a decorative swarm, not individually modelled fauna. Reuse them for later
flower-and-bee discoveries.

The inspected callers of the fauna, stable and countryside creation functions are the
demo, stable module and tests. Live main/guest-island integration is still needed.
Available assets and demo behaviour must not be mistaken for persistent live animals.

Missing from the supplied proposal: cat, dog, goose, raccoon, fox, rabbit, deer, frog
and octopus/mythic creature models. None is required for the first release.

## Other existing foundations

- `lib/village.mjs`: session-derived inhabitants, progression and activity. An inhabitant
  represents a session; do not assume that a named AI assistant is one stable person
  across unrelated sessions.
- `web/js/history.js` and the chronicle in `web/js/main.js`: views of the island's past.
  These are not yet a durable journal of animal encounters.
- `lib/weather.mjs`: shared weather owned by the sea, held only in memory.
- `lib/crowd.mjs`, `shared/settlerwalk.mjs`, `web/js/crowd-view.js`: a precedent for
  movement on the sea and presentation in the browser.
- `lib/islandbundle.mjs` and `lib/seaclient.mjs`: redacted publication and incremental
  parcel updates. Animal state and story updates need their own validated extension.
- `lib/layout.mjs`: permanent locations that must not move to make room for a new story.

No named-animal or animal-memory system was found in the inspected source. The lighthouse
already unlocks at 50 settlers. Preserve it; a later mystery can reveal its old signal,
a keeper's cache or an offshore light.

## First playable release

Start with one existing chicken, then goat and sparrow, up to six named story animals
per island. This cap excludes decorative bee swarms and does not remove ambient animals.
Introduce the chicken at a safe patch near a home during the first active viewing session,
on new and established islands. A stable or pond is not required. Do not replay old
sessions to populate the island.

| Animal | Recognisable habit | Developing story | Visible trace |
| --- | --- | --- | --- |
| Chicken | Revisits a doorstep | Familiarity becomes trust and a favourite resting place | Named nesting spot; nest prop later |
| Goat | Repeatedly approaches one resident | Pushy curiosity becomes rivalry or trust | Favourite lookout patch |
| Sparrow | Revisits a roof or garden | Becomes a regular visitor and draws attention to a clue | Named perch; nest prop later |

Each animal has a stable name, two or three traits, a favourite place and a small set of
relationships. Traits change the weights of concrete behaviours: a bold animal approaches
busy homes; a shy one chooses quiet edges. They must affect what the player sees.

Show relationships as bonded, tolerant, suspicious or nemesis, backed by familiarity,
trust and irritation. Use thresholds with hysteresis so labels do not oscillate after
every encounter. Cap tracked relationships and retain meaningful ones. A goat must be
able to recognise the same resident tomorrow without evaluating every resident each tick.

Implement about twelve encounter templates across the three species. Every encounter
names its participants and place, has prerequisites and a cooldown, and produces an
observable action or persistent trace. Repeated encounters can become a summary such as
"Bram approached Max again" rather than twelve identical journal entries.

Theft concerns invented story objects, never files, messages, garden money or user props.
Animal behaviour cannot interrupt an agent task or obstruct player movement.

### What the player sees

- Animals moving, waiting and returning to places in the world.
- Click an animal for its name, current habit, relationships and short life story.
- Click a resident to see a few relevant animal relationships.
- A return summary with at most three meaningful developments and camera links.
- Quiet journal entries for ordinary encounters; a toast only for a first arrival,
  major relationship change or discovery. No permanent floating animal nameplates.

Example arc: Pip the chicken pecks near Nova's door, waits nearby while Nova is active,
and eventually chooses a nesting spot there. These are island fiction triggered by
activity metadata. Do not claim Nova actually discussed or fed Pip in a real conversation.

## Time and story rules

Use newly observed session activity as opportunities, not one reward per message. Group
bursts into activity windows so a verbose session does not produce hundreds of encounters.
Record source cursors at activation and deduplicate future input. A rescan, transcript
re-import or counter correction must not repeat arrivals or discoveries.

The first settings to tune are a maximum of one notable encounter per animal per activity
window, three notable island events per hour, and one major relationship change per animal
per day. Ordinary movement continues between events. Provide deterministic accelerated
fixtures for development; do not force testers to wait weeks.

When the islander remains running, stories may progress while the page is closed. When
the islander is stopped, durable story progression pauses. On return, allow one gentle
time-based vignette after a long absence, explicitly recorded at return; do not invent a
complete unseen sequence or historical weather. No offline death, hunger or lost bonds.

Quiet homes can attract resting animals. Treat that as a different kind of life, not a
punishment for using an agent less. Overgrowth, if added later, is cosmetic and reversible.

## Ownership and persistence

The islander owns durable animal identities, relationships, story decisions and discovery
state. The sea owns transient movement. The browser renders and interpolates. Preserve one
movement path for single-player and multiplayer.

### Reuse and movement migration

`fauna.js` currently combines articulated meshes, cosmetic animation and browser-local
movement driven by frame delta and trigonometry. It cannot move wholesale into shared/.
Keep the existing geometry and joint animations. Extract a presentation API accepting
position, direction and action from the wire; implement fixed-tick movement separately.

Migrate the chicken first. Its live figure must never also run the old autonomous movement.
Keep the demo's standalone behaviour for asset inspection; it does not author stories.
Goat and sparrow follow the same boundary, including the sparrow's ground/flight transition.
Bees remain cosmetic until a separate colony story system is justified.

Use island-owned persistent animal ids, not array positions or demo seeds. If a spawn slot
is enrolled, persist its association with its animal id so a scene rebuild cannot create
a second identity. Transform stable-local coordinates through the building placement
before applying the island's world offset.

Proposed components:

| Component | Responsibility |
| --- | --- |
| `lib/animal-stories.mjs` | Reduce activity inputs into encounters, relationships and discovery state |
| `lib/animal-store.mjs` | Durable journal, checkpoints, input cursors and migration |
| `shared/animalwalk.mjs` | Fixed-tick movement without browser imports, clocks or transcendental functions |
| `lib/animal-crowd.mjs` | Run animal movement on the sea from published animal intentions |
| `web/js/fauna.js` | Existing geometry and joint animation with an externally driven presentation API |
| `web/js/animal-view.js` | Live lifecycle, interpolation, picking and batching of existing parts |
| `web/js/animal-dossier.js` | Life story and relationship presentation |

Store irreversible facts in `data/animal-events.jsonl`; use `data/animals.json` as a
rebuildable checkpoint carrying its last applied journal sequence. An event includes an
id, sequence, schema version, kind, timestamp, animal and resident references, place,
cause id and explicit outcome. Replaying outcomes must not reroll randomness.

The islander is the sole writer. Commit the event before acknowledging or publishing it;
write checkpoints atomically. Recover complete journal records after a crash and handle
an incomplete trailing record explicitly. Keep arrival, bonding, discovery and naming
events permanently; do not journal every step. Page older life-story entries.

Document the journal as a new irreplaceable data file, with backup and recovery guidance.
Removing generated village/cache files must not reset animal lives. Persist schema and
rules versions so balance changes apply to future choices without rewriting old stories.

An intended encounter first sends an action target to the sea. The sea reports completion
over the islander's existing outbound-established connection; only then does the islander
commit the encounter outcome. Completion ids are deduplicated. Interrupted actions can be
retried after reconnect without counting twice. This adds an inbound message handler on
that connection, not an inbound route on the islander. The current seaclient does not yet
act on these messages, so this is an explicit protocol change.

Do not trust completion messages as arbitrary commands or state updates: accept only a
pending action id for the current island and connection generation, with bounded fields.
Weather-based rules later consume observed sea weather through the same connection;
there is no reconstruction of weather lost in a sea restart.

## Multiplayer, privacy and rendering

- Extend the forgiving sender and strict bundle parser together. Publish bounded animal
  summaries, redacted resident references and current intentions. Real session ids,
  transcript content, paths and private dossier history stay on the islander.
- Send story changes through a dedicated sequenced patch. Do not republish terrain or
  change the island geometry revision for an encounter. Detect missing patches and fetch
  a fresh animal snapshot; the next scan also remains a recovery opportunity.
- Reconnect starts from the islander's durable checkpoint and pending intentions. Sea
  movement positions can reset to safe anchors; identities and committed memories survive.
- Joining viewers receive a complete initial position snapshot. Hide figures until their
  position is known. A full island publish must reconcile surviving animal ids instead
  of treating them all as new arrivals.
- Keep positions island-local in storage and apply region origins at the established
  boundary. Verify behaviour on an island whose world origin is not zero.
- Visitors see animals and a small public description. Their browser cannot write stories
  or retrieve the mapping back to real local session ids.
- Use baked synchronous meshes and instancing. Separate cosmetic randomness from movement
  and story randomness. Render animals only on detailed islands, within the existing
  nearest-island policy.
- Measure existing articulated meshes first: each animal has separate moving parts.
  Record draw calls and frame times with zero, one and six story animals on the same
  crowded scene, including multiple detailed islands. Establish a measured release budget
  in stage 1; withdraw the earlier assumption of six extra draw calls for three species.
  Share geometry/materials and batch matching parts if six animals exceed that budget.
  Bound message size and movement frequency independently of resident count.
- In the chronicle, show dated discoveries and memories, and hide live animals. Historical
  path replay is outside the first release.

## Permanent traces, combinations and mysteries

Add traces only after the first three animals generate worthwhile stories. Place nests,
nesting props and named spots through existing placement checks. Never move a house, reroute
the town or bump a layout version to accommodate an animal. If no safe site exists, retain
the discovery and defer its physical placement. Retry placement idempotently.

Recipes should combine place, repeated behaviour and a relationship, with several ways to
qualify. Start with a sparrow perch revealed by repeated visits, or a hen's nesting spot
established through familiarity with a resident. Later, flowers and existing bee visuals
can support a honey-themed place, and sheep can inspire clothing. Cat cafes and fox paths
require new species and come after these reused assets. Avoid an enlarged
pond initially: changing terrain has substantially larger consequences than placing a prop.

Keep numerical recipes out of the player UI. Show clues and remembered events so a result
feels explainable after discovery. Hidden rules in a local source repository are a design
choice, not a technical secret. Give developers explicit eligibility and suppression reasons.

The first Island Mystery should have three authored stages: an unusual footprint, related
finds in different places, and a revealed landmark detail. Track clues and resolution with
stable ids. Different residents can contribute; repeated visits by one resident must also
offer a slower path, so nobody needs to manufacture extra conversations to finish it.

After this works, introduce a cat, then a goose or raccoon when its encounters need that
species. Reuse duck and sheep before expanding the model catalogue. Foxes, frogs, dogs,
rabbits, deer and mythic creatures each need models, animation, placement and encounters.
Rain-linked frog gatherings therefore come later. Seasons,
breeding, resident-to-resident relationships and mythic animals are later independent
expansions. Breeding needs a population policy before implementation; rare animals need
multiple future opportunities so absence does not become a penalty.

## Delivery order and acceptance

1. **Durable foundation and protocol.** Build the journal, reducer, cursors and animal
   snapshot/patch/action contract with synthetic fixtures. Acceptance: repeated scans,
   interrupted writes and sea/islander restarts never duplicate a memory or lose a
   committed bond; redaction and validation tests cover both publication directions.
   Measure fauna rendering and establish the six-animal release budget.
2. **One complete chicken story.** Reuse the baked chicken, split movement from animation,
   and connect live placement, sea movement, an encounter, dossier and return summary.
   Acceptance: two viewers see the same chicken at the same home; no second local movement
   loop runs; closing a page does not affect outcomes; a nonzero region origin works.
   Existing demo and stable animations still work.
3. **Recognisable cast from existing assets.** Add goat and sparrow, personality weights,
   relationship changes,
   cooldowns and the six-animal cap. Acceptance: scripted fixtures show repeat preferences,
   different personalities and a possible reconciliation; the draw-call budget holds.
4. **History leaves a place.** Add safe persistent props and one combination discovery.
   Acceptance: every existing house retains its plot, discoveries place once, and the
   chronicle never shows a trace before its creation. Stop the live server before any
   layout comparison, following `docs/branches.md`.
5. **One mystery, then expansion.** Add clues and one reveal around an existing landmark.
   Acceptance: progress survives restarts, both single- and multi-resident routes resolve,
   and clues give useful direction without exposing a numerical checklist.

Extend `tests/fauna.test.mjs` for the presentation split, preserving existing animation
and area checks. Add pure movement tests without Three.js or document stubs, identity and
disposal tests, and live/guest integration checks. Keep `tests/countryside.test.mjs`
covering decorative bees; their cosmetic animation must not author story events.

Run focused Node tests for each stage, then `node --test "tests/*.test.mjs"` for integration.
Compare known layout-measure failures with a clean baseline. New baked models must pass
`node --test tests/models.test.mjs`; sea imports must remain inside Dockerfile.sea's copied
directories. Measure render and network budgets with one island and multiple detailed islands.

Before expanding the species list, playtest whether people remember an animal's name and
habit, can explain a relationship change, and return curious about a specific ongoing story.
If all they remember is the number of animals, improve the encounters first. Collect this
through observation or optional local diagnostics; remote analytics is not a prerequisite.

## First implementation task

Implement stage 1 with a synthetic chicken encounter and no new terrain or assets. Its review
should demonstrate activity deduplication, action completion, durable recovery and public
redaction. Stage 2 then turns that tested contract into the first visible life story.
