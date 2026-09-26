# Story animals on the wire

The contract between the three processes for the island's story animals
([Plans/dierenverhalen.md](../Plans/dierenverhalen.md)). The islander owns who the animals are
and what happened to them (`lib/animal-stories.mjs`, `lib/animal-store.mjs`, `lib/animal-life.mjs`);
the sea owns where they are (`shared/animalwalk.mjs`, `lib/animal-crowd.mjs`); the page draws
(`web/js/animal-view.js`) and explains (`web/js/animal-dossier.js`). Vocabulary - species,
traits, acts, trace kinds - is `shared/animals.mjs`, the one copy.

All positions are **island-local** (`-half..+half`, the frame of `shared/terrain.mjs` and
`layout.json`), exactly like the settlers' rows; the page adds a region's origin in one place.

## Islander -> sea: `POST /island/:id/animals`

Same door rules as `/island/:id/codex`: `keyOpens` first, then `fleet.vouch(id, token)` with
`X-Island-Token`, then a strict parse (`parseAnimals` in `lib/animalbundle.mjs`; the sender uses
the forgiving `packAnimals`). Body cap 16 KiB. `rev` never moves; the crowd is never rebuilt.

```js
{
  v: 1,
  seq: 42,            // the story's sequence when this was packed; echoed on `herd`
  gen: 3,             // the islander socket's connection generation (see "Completion")
  animals: [          // at most MAX_ANIMALS (6), sorted by id; ids `animal:<1-99>`
    { id: 'animal:1', species: 'chicken', name: 'Pip',       // name 1..24 chars
      traits: ['bold', 'curious'],                           // 1..3 of TRAITS
      home: [x, z], r: 0.9,                                  // patch middle, radius 0.3..4
      about: 'A bold hen who keeps to Slate Mill\'s doorstep.' | null,   // <= 160 chars, public
      friends: [{ who: 'house:s3', label: 'bonded' }] },     // <= 4, redacted ids only
  ],
  actions: [          // at most one per animal
    { id: 'act:57:0', animal: 'animal:1', act: 'peck', dur: 14,   // act in ACTS, dur 1..120 s
      to: [x, z], look: [x, z] | null },                          // where to go, what to face
  ],
  traces: [           // at most 32
    { id: 'trace:nest:animal:1', kind: 'nest', x, z, rot: 0..3,
      name: "Pip's nest by Slate Mill's door", at: 1790000000000 },
  ],
}
```

Ids: animal `^animal:\d{1,2}$`; action `^act:\d{1,9}:\d{1,2}$`; trace
`^trace:[a-z]+(:[a-z0-9]+){0,4}$` (<= 60 chars). An action naming an animal not in `animals`
refuses the lot, as does an unknown field, a duplicate id, a number where a word belongs, or a
coordinate outside the island's half. Answer `{ ok: true, animals, actions, traces }`.

## Sea -> islander: completion

`{ t: 'animal', a: 'done', i: <islandId>, action: 'act:57:0', gen: 3 }`, sent only to joined
sockets with `as === 'islander'`, `island === i` and the island's own token - never broadcast.
`gen` is the generation of the POST the action came in on. The islander accepts it only for an
action still pending and a `gen` equal to its current one; anything else is ignored. A
reconnect bumps `gen` and re-posts every pending action, so an errand interrupted by a sea
restart simply runs again, and a completion heard twice counts once (the reducer's `complete`
of a finished action is null).

The sea remembers the last 32 completed action ids per island: an action re-posted after it
finished is not walked again, its `done` is sent again instead.

## Sea -> everybody

- `{ t: 'herd', i, seq, animals, traces }` - the public state as last posted (without
  `actions`), broadcast when an accepted POST changed `animals` or `traces`; one per island with
  a herd in the join dump; `{ t: 'herd', i, seq: 0, animals: [], traces: [] }` when the sweep
  drops the island. Its own `t` on purpose: a page from before this reads any unknown
  `{t:'island', a}` as a fleet row, while an unknown `t` is ignored.
- `{ t: 'af', i, r: [idx, qx, qz, act, qh, fx, fz, ...] }` - positions, seven numbers a row.
  `idx` is the animal's index in the last `herd`'s `animals`; `qx = round((x + half) * 32)`,
  `qz` likewise, `act` an index into `ACTS`, `qh = round(h * 32)` the height above the ground
  (a sparrow's flight, 0 on foot), `fx, fz` a facing hint as integers in -16..16 (0, 0 for
  none; the page then faces the way it moves). Rows that changed go out at the walker rate
  (`WALKER_HZ`), every row every two seconds, and every row in the join dump.

## Islander -> its own page (loopback only, never on `PUBLIC_API`)

- `GET /api/animals` - the private state: every animal with traits, home, favourite place,
  habit and its relationships under the real house ids and settler names; pending errands;
  traces; discoveries; the mystery with its hint; the latest 60 diary entries.

  ```js
  { enabled: true, seq,
    animals: [{ id, species, name, traits, arrivedAt, home: { x, z, r, label }, favourite: { label, at } | null,
                habit, encounters, about,
                relationships: [{ resident, name, label, fam, trust, irr, visits, since, lastAt }] }],
    pending: [{ animal, resident, template, act, at }],
    traces: [{ id, kind, name, animal, resident, at, placed: { x, z, rot } | null }],
    discoveries: [{ id, name, line, at, resident }],
    mystery: { stage, hint, finds: [{ k, resident, at }], startedAt, resolvedAt } | null,
    story: [{ seq, at, kind, animal, line, where: [x, z] | null, big, major }],   // newest first
    more: true | false }
  ```
- `GET /api/animals/story?animal=<id>&before=<seq>&limit=<n>` - an animal's life story, paged.
- `GET /api/animals/summary?since=<seq>` - at most three meaningful developments since `seq`,
  for the "while you were away" card: `{ seq, items: [{ seq, at, line, where, animal }] }`.
- SSE `animals` (`localOnly`): `{ seq, news: [{ kind, line, where, animal }] }`, `kind` one of
  `arrival`, `major`, `trace`, `discovery`, `mystery` - the only ones that deserve a toast.
