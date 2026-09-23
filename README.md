# Promptholm

A 3D island where the Claude agents you work with live. Every Claude Code or Cowork
session is a settler who arrives, pitches a tent, and builds a house that grows as the
session does. Subagents become apprentices with their own sheds in the yard, repositories
become hamlets with their own fenced land, and the whole thing is read from the session
records already on this machine.

Nothing is invented and nothing leaves the computer: no API keys, no telemetry, and the
only thing that ever talks to another machine is the postbox on the town hall pavement,
which talks to your own mail server because that is what a postbox is for. The island is
shut by default and listens only to this machine. Open it on purpose and other people can
walk it with you — see
[Visitors and neighbours](docs/manual.md#visitors-and-neighbours) for exactly what they
can and cannot see.

![The island seen from the air](docs/screenshots/island.png)

## Getting started

Windows, Node 22 or newer, Claude Code installed:

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

### The islander and the viewer (needs Rust)

`npm run dev` is the whole island in a terminal. To have it as two programs instead - the
**islander** (`promptholm-island.exe`: the server, with a tray icon to stop, restart and
open it) and the **viewer** (`promptholm.exe`: the island in a window of its own) - they
have to be built once from `src-tauri/`. Everything the build needs besides Rust comes in
with `npm install` (the Tauri CLI is a devDependency); WebView2 is part of Windows 11.

**Without Rust:** download `promptholm-windows-x64.zip` from
[Releases](https://github.com/TiemenAfman/AgentVillage/releases), unblock it (right click →
Properties → Unblock), unpack it into `bin\` in your checkout and start
`bin\promptholm-island.exe`. The exes find the checkout from there, and `bin/` is
gitignored. They are unsigned, so SmartScreen may ask once: *More info* → *Run anyway*.

**With Rust**, building them yourself:

1. **Rust**, with the MSVC toolchain. Run `rustup-init.exe` from
   [rustup.rs](https://rustup.rs) (or `winget install Rustlang.Rustup`) and accept the
   defaults. If it says the Visual Studio C++ build tools are missing, let it install them
   (option 1) - that is the linker Rust uses on Windows. Without its offer:
   ```bash
   winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
   ```
2. **A new terminal**, so `cargo` is on the PATH, and check it:
   ```bash
   cargo --version
   ```
3. **Build** from the repository root. The first build fetches and compiles a few hundred
   crates and takes several minutes; after that it is seconds.
   ```bash
   npm install
   npm run app:build
   ```
   Both exes land in `src-tauri/target/release/`. There is no installer, on purpose: they
   find this checkout by themselves, and that is where `serve.mjs` and `data/` live.
4. **Run the islander** - `src-tauri\target\release\promptholm-island.exe`. Its icon appears
   in the tray (perhaps behind the ^); a left click opens the viewer. A shortcut to it in
   `shell:startup` starts the island at logon.

**Pulled after the start scripts went?** `start-island*.cmd`, `start-island-hidden.vbs` and
`stop-island.cmd` are gone, replaced by the islander. Stop an island still running from one
of them first - `netstat -ano | findstr :4747` gives its pid, `taskkill /f /pid <pid>` stops
it - then take one of the two routes above, and remove any
scheduled task or shortcut that pointed at the old scripts:
```bash
schtasks /delete /tn "Promptholm island" /f
```

Your island is your own: `seed` in `config.json` decides the shape of the land and
`islandName` names it. `config.json` is not in the repository, so nobody inherits anyone
else's village.

## Running it

```bash
npm run dev
```

That serves the island at http://localhost:4747 and opens a browser. Leave it running and
the page updates itself as sessions come and go.

Best as its own window rather than a browser tab. With [Rust](https://rustup.rs) installed,
`npm run app:build` makes two programs in `src-tauri/target/release/`: `promptholm-island.exe`, the island itself with a
tray icon to stop, restart and open it, and `promptholm.exe`, a window of its own (Tauri)
that starts the island if it is not running and shows the same page from it. Without Rust,
open the page once and use Chrome's **Install page as app**. Setting it up:
[The islander and the viewer](#the-islander-and-the-viewer-needs-rust); using it:
[Running the island](docs/manual.md#running-the-island).

| Command | What it does |
|---|---|
| `npm run dev` | Serve the island and open it |
| `npm run serve` | Serve without opening a browser |
| `npm run app` | Open the island as its own desktop window, starting the server if needed |
| `npm run scan` | Rebuild `data/village.json` once |
| `npm run scan:all` | Rebuild ignoring the founding date, using every session ever recorded |
| `npm run models` | Re-bake the Blender model sets and check them against the rules |
| `npm run vendor` | Re-copy three.js into `web/vendor` after `npm install` |

Drag to rotate, right-drag or shift-drag to pan, scroll to zoom. Click a building for its
dossier; the chronicle bar at the bottom replays the growth of the village. `?nointro`
skips the opening camera move and `?hour=21` freezes the time of day.

## A look around

| | |
|---|---|
| ![The town centre](docs/screenshots/village.png) | ![A settler on the town square](docs/screenshots/walking.png) |
| The town centre. Every settler is a session, every civic building is a milestone the village passed, and every field is fenced by whoever farms it. | Press **Walk** and you are down there yourself, with WASD and the mouse — or a controller, which the island picks up the moment you press a button on it. |
| ![The island at night](docs/screenshots/night.png) | |
| After dark the windows light up, campfires flicker, the lighthouse sweeps the water and a ripe row of moonleeks glows in the dark. | |

These were taken with `npm run scan:all`, which puts every session this machine has ever
recorded on the island at once. A village that starts today looks emptier for a while.

## Reading the island

Everything on the island means something and none of it is decoration. A few worth knowing
before you first look:

| On the island | In the data |
|---|---|
| A house | One Claude Code session |
| Tent → hut → cottage → house → manor → keep | 1, 3, 9, 21, 51 and 121 human turns |
| Scaffolding and hammering | That session is running right now |
| A shed in the yard | An apprentice: a lookout tent for Explore, a drafting hut for Plan, a workshop for general-purpose |
| A hamlet with its own green, sign and fenced land | One git repository, from its third session on |
| Post and rail, palings, a hedge, or dry stone | How stout that hamlet's edge is, read off the houses inside it |
| Stone walls and a slate roof / timber frame / thatch | Opus / Sonnet / Haiku |
| A forge with smoke, a lumber pile, a lantern | Heavy shell use, lots of file edits, mostly reading and searching |
| The Outlands | Sessions whose folder is not a project: System32, a downloads folder, a shelf full of other repos |
| A polder behind an earth wall | Land reclaimed once the island ran out, from 150 settlers on |

The full table — sixty-odd rows, every ornament and civic building and what earns it — is
[What you are looking at](docs/manual.md#what-you-are-looking-at). The day and night follow
the real clock and the season follows the month.

## Working from the island

It is not only something to look at. On the town square stand two noticeboards, and both
of them hand work out.

- **The cork one** carries your current Jira sprint, a card per open issue. Walk up, read
  it, pick a card, pick a settler, and a real Claude Code session starts in that settler's
  project folder and works the ticket. → [The sprint board](docs/manual.md#the-sprint-board)
- **The slate one** faces it across the square and carries the GitHub issues of the
  repository the island itself is built from, read through `gh`, so there is no second
  token to keep. → [The island's own board](docs/manual.md#the-islands-own-board)
- **Walk up to a house and press E** and that settler's transcript opens as a conversation
  you can carry on — in the same session, so what you say lands in the very transcript the
  island reads, and their house grows from it.
  → [Talking to a settler](docs/manual.md#talking-to-a-settler)
- **Every hamlet that is a git repository has an office** on its square: the branch, what
  is waiting in the working tree, the recent history, a diff per file. It only reads.
  → [The office](docs/manual.md#the-office)
- **A postbox stands on the town hall pavement** with your own inbox in it, read over IMAP
  and answered over SMTP, up to eight accounts. The flag on it is up when something is
  unread. The servers and passwords live in `data/mail.json`, which git has never tracked,
  and no visitor can open the box. → [The postbox](docs/manual.md#the-postbox)

## Building the island itself

Every shape is either a handful of coloured boxes written in `web/js/buildings.js` or a
model authored in Blender and baked into a module of triangles. There is no loader and
nothing to await: the shapes exist before the first line of `main.js` runs, which is why
the island never draws itself once with stand-ins and again with the real thing.

| | |
|---|---|
| `/demo` | The model sheet: every object the island can build, on one field, with a night slider and a hitbox view |
| `/editor` | The same sheet with its hands free — drag a piece and **Save** writes the line back into `buildings.js` |
| `assets/` | The Blender sets, one folder per set. [assets/README.md](assets/README.md) is the house style: axes, scale, sheets, triangle budgets |
| `npm run models` | Bake every set and refuse anything that breaks one of those rules |

## Layout

```
scan.mjs        read every session record, write data/village.json
serve.mjs       serve the island, push updates, rescan on a timer
hooks/          the SessionStart / SessionEnd hook
lib/            sources, incremental parsing, the village model, plot layout
shared/         the island generator, shared by Node and the browser
web/            the viewer (three.js, no build step)
assets/         the Blender sources; scripts/build-*.py author them
data/           generated; safe to delete
```

`shared/terrain.mjs` runs identically in Node and in the browser, so the ground the
scanner places houses on is exactly the ground you see. The viewer checks a hash of the
terrain on load and warns in the console if the two ever disagree.

## Where to read more

| | |
|---|---|
| [docs/manual.md](docs/manual.md) | Everything the island does: walking, gardening, the boards, visitors and neighbours, where the data comes from, the workbench |
| [docs/getting-started.md](docs/getting-started.md) | The longer install, including how to work on the code |
| [assets/README.md](assets/README.md) | Modelling for Promptholm: what a `.blend` has to be before the island will draw it |
| [docs/branches.md](docs/branches.md) | How to check that a change to the layout has not moved anybody's house |

Two things worth knowing whatever you do next. **A house never moves**: `data/layout.json`
records where every building stands and is only ever added to, so the town you know stays
the town you know. And **a transcript is never touched** — sending a settler away removes
them from the island and does nothing else at all.
