# Getting started

Windows, with [Node](https://nodejs.org) 20 or newer and Claude Code installed.

```bash
git clone https://github.com/TiemenAfman/AgentVillage.git
cd AgentVillage
npm install
npm run setup
npm run dev
```

`npm install` also copies three.js into `web/vendor`. `npm run setup` writes a
`config.json` for this machine, founds your island as of now so it starts empty and grows,
and adds the session hook to `~/.claude/settings.json`. That file is backed up first and
every other setting in it, your own hooks included, is left alone.

| | |
|---|---|
| See what setup would do | `node scripts/setup.mjs --dry-run` |
| Take the hook back out | `npm run setup:remove` |
| Remove it entirely | uninstall the hook, then delete the folder |

Your island is your own. The `seed` in `config.json` decides the shape of the land, so a
different number gives a different island, and `islandName` names it. `config.json` is not
in the repository, so nobody inherits anyone else's village.

The sprint board needs `JIRA_BASE_URL`, `JIRA_EMAIL` and `JIRA_API_TOKEN` in your
environment. Without them everything else still works and the board simply stays empty.

## Working on it

No build step and no framework: edit a file and reload the page. `npm run dev` serves
`web/` with caching off, so a reload always gets your latest edit, while three.js is
cached because it is pinned to a version.

```
scan.mjs        read every session record, write data/village.json
serve.mjs       serve the island, push updates over SSE, rescan on a timer
hooks/          the SessionStart / SessionEnd hook
lib/            sources, incremental parsing, the village model, plot layout,
                the sprint board, agent dispatch, conversations
shared/         the island generator, identical in Node and in the browser
star/           .star applets for the desk display, rendered by pixlet
web/js/         the viewer: world, buildings, settlers, walking, board, chat
data/           generated, gitignored, safe to delete
```

Useful while developing:

- `npm run scan` rebuilds the village once and prints what it found.
- `npm run scan:all` ignores the founding date and uses every session ever recorded. It
  writes to separate files, so it never disturbs your real village.
- `data/server.log` collects the server's own output **and** anything the page reports,
  so a crash in the browser leaves a trace on disk.
- `?nointro` skips the opening camera move, `?hour=21` freezes the time of day.

## The desk display

`build deskdisplay` puts a wooden box with a 64 by 32 LED matrix on the island. What
the matrix shows is a [pixlet](https://github.com/tidbyt/pixlet) applet - the same .star
files a Tidbyt or a Board & Base runs - rendered server side and hung on the panel as a
texture.

```
node tools/island.mjs build deskdisplay --here --label promptholm
```

`--label` names the applet: `promptholm` is `star/promptholm.star`. Drop another .star
in `star/` and it can be built the same day - a folder works too, for an applet that
comes with its own files. Saving the file is enough: the render is keyed on the applet's
own timestamp, so the panel picks the change up the next time it looks - within a minute,
and without restarting anything.

pixlet has to be installed, and the island looks for it on PATH and in the usual places.
If yours lives somewhere else, say so in `config.json`:

```json
"star": { "pixlet": "C:/tools/pixlet.exe", "app": "promptholm", "refreshMs": 60000 }
```

`refreshMs` is how long a rendered frame is kept before pixlet is asked again - short for
an applet that tells the time, long for one that draws a logo. An applet that wants a key
or a URL of its own should read it from `config.json`, which is gitignored; nothing in
`star/` is.

Rendering is the keeper's, not a visitor's: `/api/star` is not in the public list in
`lib/access.mjs`, because an applet is a small program that is free to go and fetch
something private. Somebody walking your island sees the box with a dark panel.

Two things to keep in mind when changing the code:

`shared/terrain.mjs` runs in Node and in the browser and must stay that way, because the
scanner places houses on the same ground the viewer draws. It sticks to plain arithmetic
for that reason: no `sin`, `cos` or `pow`, which can differ in the last bit between
runtimes. The viewer checks a hash of the terrain on load and warns in the console if the
two ever disagree.

`data/layout.json` is append-only on purpose. A building that has a plot keeps it, so the
village you know stays the village you know even when the placement code changes.

## Safety

The server binds to `127.0.0.1` and refuses any request whose `Host` is not this machine
or whose `Origin` is not the island itself. That matters more than it looks: the island
can start unattended Claude agents with full permissions in any folder, so it must never
be reachable from the network or from another website in your browser.

At most four agents run at once. The ceiling is `SETTLERS_MAX_AGENTS`, and they are
stopped when the server shuts down.
