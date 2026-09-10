# Promptholm

A 3D island where the Claude agents you work with live. Every Claude Code or Cowork
session is a settler who arrives, pitches a tent, and builds a house that grows as the
session does. Subagents become apprentices with their own sheds in the yard.

Nothing is invented: every building is read from the session records already on this
machine. No network calls, no API keys, no data leaves the computer.

## Getting started

Windows, Node 20 or newer, Claude Code installed:

```bash
git clone https://github.com/TiemenAfman/AgentVillage.git
cd AgentVillage
npm install
npm run setup
npm run dev
```

`npm run setup` founds your island as of now, so it starts empty and grows, and adds the
session hook to `~/.claude/settings.json` after backing that file up. It leaves every
other setting, including your own hooks, alone. `npm run setup:remove` takes it back out.

Your island is your own: `seed` in `config.json` decides the shape of the land and
`islandName` names it. `config.json` is not in the repository, so nobody inherits anyone
else's village.

[docs/getting-started.md](docs/getting-started.md) has the longer version, including how
to work on the code.

## Running it

Best as its own window rather than a browser tab: double-click `start-island-app.cmd`, or
open http://localhost:4747 once and use Chrome's **Install page as app**. The island then
gets a taskbar icon and a window with no tab strip or address bar, which is what you want
for something you keep open beside your work.

```bash
npm run dev
```

That starts the island at http://localhost:4747 and opens a browser. Double-clicking
`start-island.cmd` does the same, and `stop-island.cmd` shuts it down again. Leave it
running and the page updates itself as sessions come and go.

| Command | What it does |
|---|---|
| `npm run dev` | Serve the island and open it |
| `npm run serve` | Serve without opening a browser |
| `npm run scan` | Rebuild `data/village.json` once |
| `npm run scan:all` | Rebuild ignoring the founding date, using every session ever recorded |
| `npm run vendor` | Re-copy three.js into `web/vendor` after `npm install` |

Drag to rotate, right-drag or shift-drag to pan, scroll to zoom. Click a building for
its dossier. The chronicle bar at the bottom replays the growth of the village.

Useful URL parameters: `?nointro` skips the opening camera move, `?hour=21` freezes the
time of day (handy for looking at the island at night).

## Every morning at 07:30

A Windows scheduled task called **Promptholm island** starts the server each morning, so
the village is already up and scanning when you sit down. It runs
`start-island-hidden.vbs`, which launches the server with no console window. If the
island is already running it notices the port is taken and exits quietly, so it can
never start a second copy.

| | |
|---|---|
| Stop the island | `stop-island.cmd` |
| Change the time or the days | Task Scheduler, or `Set-ScheduledTrigger` on `Promptholm island` |
| Turn the schedule off | `Unregister-ScheduledTask -TaskName "Promptholm island"` |

The server listens on 127.0.0.1 only and refuses requests whose Origin is not the island
 itself, because it can start unattended agents in any folder on this machine.

The task runs as you and only when you are logged on, and it catches up if the machine
was off at 07:30. It does not open a browser; go to http://localhost:4747 when you want
to look. Add `--open` to the `sh.Run` line in the .vbs if you would rather it opened
itself.

## Walking the island

Press **Walk** (or **A** on a controller) and you step onto the town square as a settler
with a straw hat. WASD or the left stick to walk, drag the mouse or use the right stick
to look, Shift or the right shoulder button to run. Walk up to a house and press **E**
(**A** on the pad) to read its dossier; **Esc** or **B** flies you back up to the sky.

Any XInput controller works: plug it in, press a button so the browser notices it, and
the on-screen hints switch to controller buttons. Left stick walks, right stick looks,
right shoulder runs, **A** uses what you are standing at, **B** flies back up. Nothing needs a
controller: mouse and keyboard do everything on their own.

## Talking to a settler

Walk up to a house and press **E** (**A** on the controller), or open its dossier and use
**Talk to them**. Their session transcript opens as a conversation: what you asked, what
they answered, and the tools they reached for along the way. A long stretch of tool work
is folded into one turn with the last few calls shown, so it reads the way the session
actually went rather than as hundreds of fragments.

Type in the box and the conversation carries on **in that same session**. Resuming keeps
the session id, so what you say lands in the very transcript the island reads: talk to a
settler and their house grows from it. The reply streams in as it is produced, tool calls
and all, and **Stop** cuts it short.

The dropdown in the corner says what the settler may do while you talk:

| | |
|---|---|
| Can do anything | Reads, writes and runs things, unattended |
| May edit files | Changes files, shell work still needs a person |
| Read only | Looks and plans, changes nothing |

Apprentices are different. They reported back to their master and their session is over,
so their shed opens as a record of what they did, with no box to type in.

## Starting a new session from the island

**New settler** in the top right, or walk up to the town hall and press **E**. Pick the folder
they should live in, pick a model, and optionally say what they should start on. A fresh
Claude session begins there, a house appears, and you carry on with them by walking up and
pressing **E** again, which opens their conversation.

They are a resident, not a visitor: no ticket is attached and they stay until you send
them away. Sessions you start the ordinary way, in the desktop app, in VS Code or from a
terminal, arrive on the island by themselves through the session hook.

## Inviting a session that already exists

Walk up to the town hall and press **E**, or use **New settler** in the top right. The
register lists every session this machine remembers, with the name the island would give
it, what it worked on and how big its house would be. **Invite** gives it a plot, and it
builds according to what it actually did.

This is how sessions from before the island was founded get in. **Release** takes one back
out of the register; that is not the same as sending a settler away, and an invited
settler can always be invited again. Sessions that arrived on their own, through the
hook, need no invitation and cannot be released this way.

The same panel has **Send for a newcomer instead**, which starts a brand new session.

## Who gets a house, and who is only visiting

Not every session that starts becomes a settler. Plenty of them begin and end within
seconds without ever writing a line; those are not people, they are process noise, and
the island ignores them. A session earns a house by saying something.

Agents the island sends out itself, from the sprint board, are **visitors**. They pitch a
tent, do the one job they were sent for, and are gone half an hour after they fall quiet.
Their dossier says *Visiting*, and the record of what they did stays on the board under
"Handed out". Everyone else is a resident and keeps their house until you send them away.
The grace period is `visitorGraceMs` in `config.json`.

## Sending a settler away

Walk up to a house and press **X** (**X** on the controller), use **Send away** in the top right
of a settler's conversation, or open their dossier and use **Send off the island**. It always asks twice: the first press shows who you are about to
send away, the second confirms. The house comes apart in a cloud of dust, the settler's
apprentices leave with them, and their plot becomes ordinary ground that a later arrival
can build on.

This removes them from the island and nothing else. **The session transcript is never
touched**, so nothing about your Claude history is lost, and the toast that appears offers
**Bring them back** for as long as it is on screen. After that, `data/banished.jsonl` holds
the full history and a line with `"action":"return"` puts anyone back. The town hall, the
sprint board and the other village buildings cannot be sent away.

## The sprint board

On the town square stands a noticeboard with the current Jira sprint pinned to it, one
card per open issue. Walk up to it and press **E** to read it close up: the cards are
grouped by workflow stage (IJskast, Actief, Controleren, Ready for deploy
and FAT, Gereed), with the work that can still be handed out at the top.

The cards are filtered by assignee, and open on **you** by default: the board asks Jira who
the token belongs to and starts on that person. The dropdown at the top switches to a
colleague, to everyone, or to what nobody has picked up yet, and remembers your choice.

You can drive the whole board three ways. With the mouse as usual; with the keyboard,
where the arrow keys walk between cards, **Enter** picks one, **A** switches person, **R** refreshes
and **Esc** steps back; or with a controller, where the left stick moves a pointer across the
cork, **A** presses what is under it, the right stick scrolls and **B** steps back. The hint bar at
the bottom of the board always shows the set that applies.

The board reads Jira over REST v2 with the same three environment variables the
`jira-ticket-oppakken` skill uses: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`. It
refreshes itself every few minutes and caches the last answer in `data/sprint.json`, so
the board still shows something when Jira is unreachable.

### Handing a card to a settler

Click a card, pick a settler, and read the summary before you confirm: the folder the
work will happen in, the model, and that it runs unattended. **Hand it over** starts a real
Claude Code session in that settler's project folder with the prompt `pak BS-xxxx op`,
which triggers the repo's `jira-ticket-oppakken` skill: fetch the ticket, move it to
Actief, diagnose, fix behind a `cfg_BS<number>` gate, commit and push a `BS-<number>`
branch, write the test instruction into the ticket and move it to Ready for deploy and FAT.

The first choice in the list is **a newcomer**: nobody on the island yet. Pick the project
folder and the model yourself, and a fresh settler steps ashore to do the work. The folder
list is every project this machine has run Claude in, with the repos that carry the Jira
skill at the top, plus a field for a path that is not in the list. The name the newcomer
will carry is decided before it starts, so the settler that appears on the island is the
one the board said it would be.

Settlers whose folder carries that skill are marked *knows the Jira workflow* and listed
first. Handing a BS ticket to a settler from another repo is allowed but warned about: the
agent would have to improvise the workflow.

Because the island already watches every session, the agent shows up as a new settler
within seconds, building in the same district. Its transcript log is kept under
`data/agents/`, and `data/assignments.jsonl` records every hand-over. **Only prepare the
command** writes the exact command line instead of running it, for when you want to start
it yourself in a terminal.

## How the village grows

A session hook is installed in `~/.claude/settings.json`. It fires on `SessionStart` and
`SessionEnd`, records the arrival, and rescans. The hook writes nothing to stdout and
always exits 0, so it can never disturb a session. The server also rescans every 60
seconds, which is how Cowork tasks are noticed (their sandbox may not run user hooks).

Sessions that started before the island was founded are ignored, so the village begins
empty and grows from the founding session onward. `npm run scan:all` shows what the
island would look like with the entire history on it, written to separate files so it
never disturbs the real village.

## What you are looking at

| On the island | In the data |
|---|---|
| Town Hall and founding stone | The session that founded the island |
| A house | One Claude Code session |
| A district with a plaque and a well | One project folder |
| An outpost | A session in a git worktree |
| A house on stilts at the quay | A Cowork task; its settler arrives by boat |
| An apprentice's shed | A subagent: lookout tent for Explore, drafting hut for Plan, workshop for general-purpose, book kiosk for the guide |
| Tower with a copper dome | Fable |
| Stone walls, slate roof | Opus |
| Timber frame, green roof | Sonnet |
| Small house under thatch | Haiku |
| A yard sign | The session's own name (its title), e.g. "Sybolt digital twin" |
| Tent → hut → cottage → house → manor → keep | 1, 3, 9, 21, 51 and 121 human turns |
| Scaffolding and hammering | That session is running right now |
| Campfire and tent | A settler just arrived; no transcript yet |
| Forge with smoke | Heavy shell use |
| Lumber pile | Lots of file edits |
| Lantern | Mostly reading and searching |
| Weathervane | Drove a browser |
| Pigeon loft | Fetched things from the web |
| Banner | Published an artifact |
| Lightning rod | Repeated API errors |
| Well, market, clock tower, windmill, lighthouse, castle | 5, 10, 20, 30, 50 and 100 settlers |

The day and night follow the real clock; the season follows the month. Windows light up
after dark, campfires flicker, the lighthouse sweeps the water and fireflies come out.

## When the browser will not draw

The island needs WebGL. If the browser's graphics process falls over, which shows up in
the console as `GL_RENDERER = Disabled` or `BindToCurrentSequence failed`, no WebGL page
works until it comes back. The island waits and reloads itself four times with growing
pauses, and if that does not help it offers **Open the sprint board anyway**: the board is
plain HTML and hands out work without a graphics driver.

Anything the page trips over is posted to the server and lands in `data/server.log`
alongside the server's own output, so a crash can be explained afterwards rather than
guessed at. On integrated graphics the island automatically uses a smaller shadow map and
a lower pixel ratio.

## Where the data comes from

| Source | Path |
|---|---|
| Claude Code transcripts | `~/.claude/projects/<project>/<session>.jsonl` |
| Subagent transcripts | `…/<session>/subagents/agent-<id>.jsonl` |
| Running sessions | `~/.claude/sessions/<pid>.json` |
| Session titles and models | `%APPDATA%\Claude\claude-code-sessions\…` |
| Cowork tasks | `%APPDATA%\Claude\local-agent-mode-sessions\…` |

Transcripts are append-only, so the scanner remembers how far it read and only folds in
new bytes. A first scan of a few hundred megabytes takes a second or two; every scan
after that takes a fraction of one.

## Layout

```
scan.mjs        read every session record, write data/village.json
serve.mjs       serve the island, push updates, rescan on a timer
hooks/          the SessionStart / SessionEnd hook
lib/            sources, incremental parsing, the village model, plot layout
shared/         the island generator, shared by Node and the browser
web/            the viewer (three.js, no build step)
data/           generated; safe to delete
```

`shared/terrain.mjs` runs identically in Node and in the browser, so the ground the
scanner places houses on is exactly the ground you see. The viewer checks a hash of the
terrain on load and warns in the console if the two ever disagree.

## Housekeeping

- **First run**: copy `config.example.json` to `config.json`. Leave `foundedAt` empty to
  start the village from now, or set it to an ISO date to include earlier sessions.
- **Rename the island** or move the founding date: edit `config.json`.
- **Start over**: delete `data/` and rescan. Houses will be placed afresh.
- **A house never moves.** `data/layout.json` records where every building stands and is
  only ever added to, so the town you know stays the town you know.
- **Turn it off**: remove the two `Settlers` entries from `hooks` in
  `~/.claude/settings.json`. A timestamped backup of the original file is next to it.
