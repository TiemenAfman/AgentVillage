# Animal story storage

The islander keeps the story animals' memory in two files under its `DATA` (`lib/paths.mjs`:
`~/.promptholm/data`, or a linked worktree's own `data/`). `lib/animal-life.mjs` opens them on
the first scan through `openAnimalStore(DATA, { recoverStale: true })` and closes them in
`shutdown()`; `config.animals.enabled: false` means they are never opened. Tests always pass
a temporary directory.

## Files and ownership

- `animal-events.jsonl` is irreplaceable, like `layout.json` and `garden.json`. It holds every
  animal's identity and traits, the consumed activity cursors, pending errands, every
  encounter's outcome, the marks and discoveries and the mystery, in sequence. Back it up with
  the layout. Deleting `village.json` or `cache.json` never touches it; deleting it is starting
  the animals over.
- `animals.json` is a disposable checkpoint with the last applied sequence, written every 25
  events and on close. Opening replays the journal in full and never trusts it.
- `animal-events.jsonl.interrupted` preserves an incomplete trailing write for inspection.
  A second interrupted tail will refuse to overwrite that evidence; move the old recovery
  file to a backup before retrying recovery.
- `animal-store.lock` names the owning process. A second writer is refused. The islander
  opens with `recoverStale`, which takes over a lock only when its pid no longer runs (or the
  file is empty and over a minute old - a crash between creating and writing it); a live
  writer's lock is never taken. A normal close removes it.

Stop the islander before making a backup or restoring the journal. Restore the journal,
discard a stale checkpoint, and reopen. All newline-terminated records must parse, carry a
supported schema/rules version and form a continuous sequence; otherwise opening fails
without truncating the original, the islander logs "the animals stay away: ..." and runs
without them (`/api/animals` says why). Do not replace a damaged journal with an empty one.

The store saves an unterminated tail separately before truncating it. Only complete records
are replayed. New writes are flushed before returning their event; a failed append blocks
further work on that instance until it is closed and recovered (`healthy()` says which).
The islander does that itself, without a restart: on the next scan or completion
`recover()` in `lib/animal-life.mjs` closes the store, opens it again (replaying what is whole)
and has the sea asked once more, forced, so an errand the sea finished while the line could
not be written is answered again and remembered once (`tests/animal-recovery.test.mjs`).
Checkpoint writes use a flushed temporary file followed by rename. A checkpoint failure does not undo journaled
events. This is process-crash recovery, not a substitute for disk backups.

## Commands

All timestamps are explicit nonnegative integer milliseconds. Ids are opaque local strings;
settlers are named by their real house ids here, and only here - the sea and every visitor
get the redacted ones (`docs/animals-wire.md`).

- `arrive` `{ species, home: {x, z, r, label}, near, lookout, baseline, seed }` - the id is
  `animal:<n>` in arrival order, the name and traits are drawn from the island's own stream.
  `baseline` is every settler's current cursor: what happened before the animal is history.
- `observe` `{ residents: [{ id, cursor, active, lastAt, name, spots }], landmark }` - one
  `activity` event carrying the cursors a visit consumed (and first sightings) together with
  the visits, so a crash can never consume activity without remembering what it bought.
- `complete` `{ action, landmark }` - the sea said the errand happened. Unknown or finished
  actions do nothing. The event carries the outcome: the three numbers, the label, the
  diary line, any mark, discovery or step of the mystery.
- `abandon` `{ residents }` - errands older than three hours, or for a settler who left.
- `place` `{ trace, x, z, rot }` - where a mark was set down; once.
- `return` - after twelve hours with nothing recorded, one gentle line.

Replaying never rerolls: `decide*` makes every choice off a stream seeded by the island's salt
and the event's sequence, and `applyAnimalEvent` only checks and applies. `rules` in each
event says which rule set chose it, so balancing changes future choices only.

Run the checks with `node --test tests/animal-stories.test.mjs tests/animal-life.test.mjs`.
