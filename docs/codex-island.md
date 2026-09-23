# The Codex neighbour

The islander publishes two independent islands to the same sea: the existing Claude /
Cowork village and a Codex village. The sea assigns their berths using its ordinary
placement rules, and walks both crowds. Switching seas takes both islands along.

`codexIsland` in `config.json` controls the neighbour:

```json
"codexIsland": { "enabled": true, "name": "Codex", "seed": 7331 }
```

The scanner reads rollouts under `~/.codex/sessions` and `~/.codex/archived_sessions`,
plus titles from `session_index.jsonl`. `PROMPTHOLM_CODEX_HOME` overrides the source;
otherwise `CODEX_HOME` is honoured before falling back to the user's home. These are
local Codex sessions, not cloud ChatGPT conversations. No account connection is needed.

The neighbour uses `data/codex/layout.json`, `village.json` and `cache.json`. Its layout
is as irreplaceable as the original island's layout: never delete it to refresh sessions.
The original Claude layout is not involved in a Codex scan. `node scan.mjs --codex`
refreshes the neighbour alone; the server scans both on its normal timer.

Rollouts are read incrementally. Repeated token totals replace earlier totals instead
of being added again. A task with a recent start and no completion is considered active;
after ten minutes without transcript activity it becomes idle. Codex subagent rollouts
currently get their own houses. The ordinary redacted bundle is all the sea receives:
no prompts, local paths, tool arguments or transcript contents are published.

Restart the islander after changing this configuration. The neighbour's own name is
retained when hosting a sea, rather than being replaced by the machine's hostname.

The Codex island is hostile to everybody, its own islander's walker included: the island
is nobody's. Once a player is on land, on a deck, or swimming within two cells of the
shore, residents pursue them at 4.5 - faster than a walk (3.4), slower than a run (6.6), so
a sprint gets away and running out of stamina does not. Residents swim that same coastal
strip, rivers included. Contact is a hit through `hurt()` (`lib/health.mjs`), which for now
always sends the player back to their own town square, or a phone player to their skiff,
followed by five seconds of immunity. Sailing, swimming further out than the strip and
viewing from orbit do not trigger pursuit, and retreating past the strip releases the
residents. The sea decides pursuit and capture, broadcasts the ordinary crowd positions,
and privately tells the captured player to respawn.
