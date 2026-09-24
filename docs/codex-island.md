# Codex settlers on the volcano

Codex sessions on this machine are settlers too, but they do not get an island of their
own. Every islander with Codex data sends the sea a short list of its Codex settlers, and
the sea houses the settlers of everybody in the world together on its own island: the
volcano in the middle (`shared/volcano.mjs`). The houses of all islanders stand mixed
together on its flank. Until step 6 of `Plans/vulkaan-in-het-midden.md` each islander
published a separate, hostile Codex island next to its own; that island is gone.

`codexIsland` in `config.json` switches it on or off:

```json
"codexIsland": { "enabled": true }
```

An older config that still has `name` and `seed` in that block is read without complaint.
The Codex scan still uses those two for its own layout, which was founded on them.

## Where the settlers come from

The scanner reads rollouts under `~/.codex/sessions` and `~/.codex/archived_sessions`,
plus titles from `session_index.jsonl`. `PROMPTHOLM_CODEX_HOME` overrides the source;
otherwise `CODEX_HOME` is honoured before falling back to the user's home. These are
local Codex sessions, not cloud ChatGPT conversations. No account connection is needed.

The Codex scan runs in the same queue as the island's own scan and writes
`data/codex/village.json`, `layout.json` and `cache.json`, exactly as before.
`node scan.mjs --codex` refreshes it alone. `village.json` is now only the source of the
list. `layout.json` is still written and kept, but no house is placed from it any more:
the sea decides where every volcano house stands.

Rollouts are read incrementally. Repeated token totals replace earlier totals instead of
being added again. A task with a recent start and no completion is active; after ten
minutes without transcript activity it becomes idle. A Codex subagent rollout is a
settler of its own.

## What goes to the sea

`packCodex` (`lib/islandbundle.mjs`) runs the same redaction a bundle gets
(`guestVillage`), so a settler travels under its redacted name (`house:s3`) and never as a
session uuid, a prompt, a branch or a path. Each entry has five fields and nothing else:

```json
{ "settlers": [ { "id": "house:s3", "style": "unknown", "tier": "hut", "kind": "house", "active": false } ] }
```

At most 60 per islander (`CODEX.PER_ISLANDER`), with the settlers at work first and then
the most recently seen. The islander posts the list to `POST /island/<its id>/codex` after
every scan in which it changed, and again every time it (re)joins a sea, because a
restarted sea has an empty volcano. An empty list is sent too: it takes that islander's
houses down.

The sea checks the door in the same order as its other doors: its key (`X-Sea-Key`, if the
sea has one), then the island's own claim token (`X-Island-Token`), so an islander can only
speak for its own island, then the list. The list is parsed strictly: an unknown field, a
duplicate, a number where a word goes or more than 60 entries refuses the whole list.

## Houses, lodgers and residents

The volcano has 300 building plots on its apron (`codexPlots`): three-by-three lots with a
cell of path between them, clear of the crater, the lava, the beach, the guardhouse and the
bridges over the lava,
with the door facing downhill. A settler's plot is a hash of its full id,
`codex:<island id>:<redacted id>`. If that plot is taken it gets the next free plot in a
fixed order. A plot stays with its settler until that settler leaves, so a new house never
moves a standing one. A house on the volcano can still end up somewhere else after the sea
restarts: nobody can do anything with it, so the rule that a house never moves applies to
islands, not to the volcano.

When all plots are taken, the rest lodge in the guardhouse, like the guards, and move into
a house as soon as a plot comes free. Past 360 bodies on the mountain (`CODEX.RESIDENTS`) a
settler gets no body at all and waits in the list until somebody leaves.

Every Codex settler is a resident of the volcano and hostile like the guards (see below). A
settler at work stands at its own door and hammers. When one islander's list changes, only
that islander's residents change: they are added to or removed from the running crowd, so
the guards and everybody else's settlers carry on where they are.

When an islander goes offline, its island stays in the world for the usual grace of 45
seconds. When that runs out and the island is swept, its houses and residents go with it.
The volcano and its guards stay.

## The volcano and its guards

The volcano is raised at the middle of every sea before anybody joins, with the islands on
rings round it. Its guardhouse stands on the lower flank (drawn as the castle until it has
a model of its own). Its guards live there: four, plus three for every islander online, at
most 24. A new islander brings three more out at once; an islander who goes home takes
nobody away, and the surplus thins out as guards fall (see Fighting). Its lava hurts
anybody who walks into it, and guards will not path through it, so a flow is a way to shake
them off.

The volcano is hostile to everybody, including islanders with houses on it. Once a player
is on land, on a deck, or swimming within two cells of the shore, guards and residents
pursue them at 4.5: faster than a walk (3.4), slower than a run (6.6), so a sprint gets away
and running out of stamina does not. They swim that same coastal strip. Sailing, swimming
further out than the strip and viewing from orbit do not trigger pursuit, and retreating past
the strip releases them.

## Fighting

A player has 100 health, held by the sea (`lib/health.mjs`); everything that harms a player
goes through `hurt()`. A guard within reach (0.65) swings once every 1.2 s for 34, so three
blows empty the bar; a Codex resident swings as often for 20. Lava costs 60 a second for as
long as you stand in it. Health comes back at 25 a second once nothing has hurt you for 3 s,
so never while you are still in the lava. At 0 you are sent back to your own town square, or
a phone player to their skiff, whole again and immune for five seconds.

Holding the right mouse button blocks: a guard's blow from within 60 degrees of the way you
face costs 30% (ten blows instead of three). Lava cannot be blocked, and nothing can be
blocked while swimming.

A left click swings back. The page sends only that it swung; the sea finds the nearest guard
or Codex resident within 0.9 in front of you (the same 60 degrees) from your last pose, and
takes 25 off it. One swing per 0.45 s, only on foot, not in the water and not while blocking.
Agents have 100 health and do not heal, so four blows fell one. Everybody watching sees the
hit. A fallen guard comes back out of the guardhouse 20 s later, but only if the volcano still
has fewer guards than it should (four, plus three per islander online); a fallen Codex settler
gets up at its own house (or in front of the guardhouse, for a lodger) 20 s later.
`lib/combat.mjs` has the player's side, `lib/hostility.mjs` the guard's.

## Mixed versions

An islander running code from before this change still publishes its own hostile Codex
island. The sea treats it as just another hostile island: it berths on the ring, its
residents chase like any hostile island's, and it does not count as an extra islander for
the guards. A sea from before this change has no Codex door; a current islander is refused
there (404), says so once in its log, and publishes its home island as usual.
