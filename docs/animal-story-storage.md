# Animal story storage

The first story modules are standalone. They are not called by the scanner, server or sea
yet. `openAnimalStore(directory)` requires an explicit directory; importing the module
does not discover or modify the real island's home. Production integration should pass
the islander's `DATA` from `lib/paths.mjs`, which may be under `~/.promptholm` rather than
the checkout. Tests always use temporary directories.

## Files and ownership

- `animal-events.jsonl` is irreplaceable. It holds identities, input cursors, pending
  visits and completed encounter outcomes in sequence. Back it up with layout and garden
  state once this feature is enabled. Never delete it as a generated scan cache.
- `animals.json` is a disposable checkpoint with the last applied sequence. The current
  implementation replays the journal in full and does not trust this checkpoint on load.
- `animal-events.jsonl.interrupted` preserves an incomplete trailing write for inspection.
  A second interrupted tail will refuse to overwrite that evidence; move the old recovery
  file to a backup before retrying recovery.
- `animal-store.lock` names the owning process. Opening a second writer is refused.
  A normal close removes it. After a process crash, verify that the recorded writer has
  stopped before removing this lock and reopening. Automatic stale-lock recovery remains
  part of production lifecycle integration; never remove a live writer's lock.

Stop the writer before making a backup or restoring the journal. Restore the journal,
discard a stale checkpoint, and reopen. All newline-terminated records must parse, carry
a supported schema/rules version and form a continuous sequence. Otherwise opening fails
without truncating the original. Do not replace a damaged journal with an empty one.

The store saves an unterminated tail separately before truncating it. Only complete records
are replayed. New writes are flushed before returning their event; a failed append blocks
further work on that instance until it is closed and recovered. Checkpoint writes use a
flushed temporary file followed by rename. A checkpoint failure does not undo journaled
events. This is process-crash recovery, not a substitute for disk backups or a guarantee
against hardware failure.

## Initial command contract

All timestamps are explicit nonnegative integer milliseconds. Ids are opaque local strings.
The store is private: neither its snapshots nor history can be sent to a visitor as-is.

1. `arrive`: stable `id`, existing fauna `species`, and `name`.
2. `observe`: `animal`, resident/session `source`, and a nonnegative integer `cursor`.
   The first observation only sets a baseline. Duplicate or lower counters do nothing.
   Increased activity can schedule one visit; an outstanding visit cannot be replaced.
3. `complete`: the pending `action` id. Repeated or unknown completions do nothing.

Activity cursor updates and visit intentions share one event, avoiding a crash between
consuming activity and persisting the action it caused. Completion records carry the chosen
visit count and relationship label, so future balancing does not reroll old memories.
The initial chicken becomes bonded after three completed visits; full relationship rules
are later work. No transcript content is accepted or stored.

There is intentionally no HTTP route or sea protocol yet. Before integration, completions
must be checked against the current connection generation and island, public ids must be
redacted, and pending actions need safe targets and reconnect handling. Do not expose
`dispatch()` directly to a browser or to arbitrary messages from the sea.

Run the foundation checks with `node --test tests/animal-stories.test.mjs`.
