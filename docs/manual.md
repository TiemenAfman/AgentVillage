# The Promptholm manual

Everything the island does, in the order you are likely to want it. The front page
([README.md](../README.md)) is the short version: what this is, how to start it, and what
you are looking at. This is the rest.

| | |
|---|---|
| Living in it | [Walking](#walking-the-island) · [Market gardening](#market-gardening) · [Talking to a settler](#talking-to-a-settler) · [Sound](#what-the-island-sounds-like) |
| Putting it to work | [The sprint board](#the-sprint-board) · [The island's own board](#the-islands-own-board) · [The office](#the-office) · [Telling an agent how your team works](#telling-an-agent-how-your-team-works) |
| Who is on it | [Starting a session](#starting-a-new-session-from-the-island) · [Inviting one](#inviting-a-session-that-already-exists) · [Sending one away](#sending-a-settler-away) · [Visitors and neighbours](#visitors-and-neighbours) |
| How it is built | [How the village grows](#how-the-village-grows) · [Where the data comes from](#where-the-data-comes-from) · [The model sheet](#the-model-sheet) · [The workbench](#the-workbench) · [Layout](#layout) |

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

### As a window of its own

`start-island-app.cmd` opens the island in a Chrome window without tabs or an address bar,
starting the server first if it is not up. `npm run app` does the same with a window that
is the island's own (Tauri, WebView2; `npm run app:build` makes an installer). Both show the
very same page from the very same server - nothing is copied or bundled - and both leave the
server running when the window closes, since the scan, the mail and the agents live there
and not in the window. If nothing is listening the app starts `serve.mjs` itself, with its
output in `data/server.log` like the scheduled task, and shows what it is doing while it
waits. Links to Jira, GitHub or a repository open in your browser rather than in the window.

The server listens on 127.0.0.1 only and refuses requests whose Origin is not the island
 itself, because it can start unattended agents in any folder on this machine. Opening it
to other people is possible and deliberate; [Visitors and neighbours](#visitors-and-neighbours)
says what that does and does not give away.

The task runs as you and only when you are logged on, and it catches up if the machine
was off at 07:30. It does not open a browser; go to http://localhost:4747 when you want
to look. Add `--open` to the `sh.Run` line in the .vbs if you would rather it opened
itself.

## Walking the island

Press **Walk** (or **A** on a controller) and you step onto the town square as a settler
with a straw hat. WASD or the left stick to walk, drag the mouse or use the right stick
to look, Shift or a click of the left stick to run. Walk up to a house and press **E**
(**X** on the pad) to read its dossier; **Esc** or **Back** flies you back up to the sky.

**Space** jumps, which is enough to clear a doorstep or a low fence. **C** crouches;
keep it held while standing still and the settler decides the day is over, lies down and
puts up a parasol. Moving puts that clock back to zero, so a crouch-walk does not end in
a nap. Lying down outlasts the key - let go of C and they stay there. Walk, or press
C again, to get back up. (It was Ctrl until crouching and walking turned out to be
ctrl+W, which closes the tab: Chrome keeps that one for itself and a page cannot refuse
it.) You can wade into
the sea as long as the shore stays within reach - about two metres - and you swim rather
than walk once you are past the waterline. You cannot jump out of the water, and you
cannot set out for the horizon.

Any XInput controller works: plug it in, press a button so the browser notices it, and
the on-screen hints switch to controller buttons. The buttons are laid out the way a
console lays them out, so **A** is the one that says yes: on foot it jumps, **B** crouches,
**X** uses what you are standing at and **Y** has a thought. **RT** sows a bed, **LT** is the
destructive one - sending someone away, turning a bed over - and the shoulder buttons go
through the seed pouch. Click the left stick to run, **Back** flies you up to the sky.

In any panel the same four mean what you would expect: **A** picks, **B** steps back,
**X** switches person and **Y** refreshes. Indoors the island's buttons that have nothing to
do in a room simply do nothing. Nothing needs a controller: mouse and keyboard do
everything on their own.

## Market gardening

Once the village has earned its market stalls — ten settlers — one of them is a seed
stall. Walk up to it and press **E**: it sells seed, and it buys back whatever you grow.
You start with fifteen coins, which is seven beds of turnip or one long look at the
pumpkin seed and a change of plan.

**P** sows a bed where you are standing, **Q** takes the next kind of seed out of the
pouch, and **E** at a bed that is ready pulls it up. What you pull goes in the basket and
the basket is only worth anything back at the stall. **X** at a bed you have thought
better of turns it over again; a bed that is ready is pulled rather than dug, so a
mistyped key cannot cost you a pumpkin.

| | Seed | Ready in | A bed gives | The stall pays |
|---|---|---|---|---|
| **Turnip** | 2 | 4 min | 3 | about 2 each |
| **Carrot** | 4 | 8 min | 4 | about 3 |
| **Beetroot** | 7 | 15 min | 4 | about 6 |
| **Tidebean** | 12 | 25 min | 5 | about 8 |
| **Moonleek** | 20 | 45 min | 5 | about 15 |
| **Pumpkin** | 35 | 1 h 30 | 2 | about 90 |

The clock is the real one, so the long crops are for an island left open beside your
work and they pay better by the minute for it. Nothing rots: a bed that is ready waits
until you come back for it.

Where you sow matters twice. A bed needs earth — not the sea, not a river, not the
beach, not the flagstones of the square, and not a slope the water would run off — and
the **tidebean** wants salt in the air: sown within four paces of the water it sets two
extra pods. The **moonleek** is worth growing for its own reason, which is that a ripe
row is faintly lit and can be found after dark.

What the stall pays moves about a quarter either way from one day to the next, the same
for everyone looking at the same island, so a full basket carried over to tomorrow is a
real decision. The purse, the pouch and the basket are yours alone: a visitor walking
your island can see the beds standing in the ground, and that is all — the stall, like
the tickets and the git, belongs to whoever lives here.

## The postbox

There is a red pillar box on the pavement in front of the town hall, beside the door.
Walk up to it and press **E** and it opens your actual inbox: the subjects, who they are
from, and the words in them. The flag on its cheek is up when something in it is unread,
which is the point of standing it where you walk past twenty times a day.

It holds up to eight accounts, one tab each, and the tab carries its own unread count.
**Accounts** is where you put one in. What it wants is what any mail program wants:

| | |
|---|---|
| **E-mail address** | who the mail is to and from |
| **Username** | usually the same as the address, sometimes not |
| **Password** | the one you sign in with |
| **Incoming (IMAP)** | the server and its port. SSL on 993, or STARTTLS on 143 with the box unticked |
| **Outgoing (SMTP)** | usually the same server. SSL on 465, or STARTTLS on 587 |

**Test it** logs in and says what it found before anything is kept, which is the quick
way to tell a wrong port from a wrong password. **Take the certificate on trust** is for
an in-house server whose certificate has expired or was never signed by anyone: the line
stays encrypted, but the proof that the server is the one you meant is given up, so it is
not a box to tick for somebody else's mail. An account is read-only until you write
something: open a message, press **Reply**, and it goes out over SMTP with a copy filed
in your Sent folder if the server has one.

Three things are worth knowing about where all this lives.

The settings are written to `data/mail.json` on this machine and nowhere else. That file
is named twice in `.gitignore` — once by the rule that covers everything in `data/`, and
once on its own, so that widening the first rule later cannot start publishing a mail
password. Nothing about your mail is written into `village.json`, which is the file the
scanner rewrites every minute and the one a visitor is shown.

No password is ever sent back to the page. The panel is told that an account has one, not
what it is, and the field in the form starts empty: leave it empty and the password on
file is kept.

And an account whose login is refused is put aside rather than retried. The flag polls
every forty-five seconds, and forty-five seconds against a wrong password is how a work
account gets locked out — so the first refusal stops the polling for that account until
you save it again or press **Try again** yourself.

One thing to check before blaming the settings: the box reads over IMAP, and a Microsoft
Exchange does not necessarily speak it. IMAP4 is a service on that server and it is off
unless somebody turned it on, so 993 can be silent — not refused, just silent — while
webmail and Outlook and the phone in your pocket all work perfectly. A phone set up
against an Exchange is using ActiveSync over 443, which looks like the same account and
is not the same protocol at all. If 993 never answers, that is the thing to ask about,
and the fix is on the server rather than in this form:

```powershell
# in de Exchange Management Shell, op de server zelf
Set-Service MSExchangeIMAP4 -StartupType Automatic; Start-Service MSExchangeIMAP4
Set-Service MSExchangeIMAP4BE -StartupType Automatic; Start-Service MSExchangeIMAP4BE
Get-ImapSettings -Server <servernaam> | Format-List LoginType, SSLBindings, X509CertificateName
```

`LoginType` wants to be `SecureLogin`, and 993 has to be open on the way in. Sending is a
separate service and needs none of this: SMTP is usually already there.

The postbox is not a milestone and is not earned: it has stood there since the hall was
built, because what is in it was never the island's to give. It is also the one thing on
the island a visitor cannot open at all. `/api/mail` is not on the public list in
`lib/access.mjs`, so a guest walking an open island sees a postbox with a flag on it and
can no more read it than they could read the post through the slot.

## Visitors and neighbours

The island is open. Other people can walk it with you, each connection getting its own
settler to steer; two islands on the same network find each other, lie on each other's
horizon, and can be moored side by side. It answers on every address the machine has, and
phones and laptops reach it at `http://<the machine's name>:4747/`.

It was shut by default once, and that was right while a visitor could only look. Visiting
is what the island is for now, and an island nobody can reach has no neighbours - so the
lock is off and the thing to know is how to put it back on:

```json
"network":     { "public": false, "inviteCode": null, "hosts": [] },
"multiplayer": { "enabled": true, "maxPlayers": 16, "guestView": "redacted", "name": null }
```

A shut island keeps its mouth closed and its ears open: it listens only to this computer,
it does not announce itself, and it still sees the neighbours who did open theirs and can
go and visit them. `node serve.mjs --public` opens one for an afternoon without editing
anything.
Windows Firewall asks about the port the first time, and about UDP 47474, which is how
islands announce themselves to each other.

**What a visitor can do.** Walk, swim, sail, look at the village, read a settler's dossier,
and bump into the other people walking it. Handing out a ticket, talking to a settler,
founding one, sending one away, anything touching git, the sprint board and the town hall
are refused — not hidden, refused, by the server, for anyone who is not on this machine.
The rule is not a list of forbidden things but the other way round: a handful of paths are
public and everything else is local-only, so a route added later is shut unless somebody
deliberately opens it.

Exactly one route has been deliberately opened the other way, and it is worth knowing
about because it is the first one a visitor may *write* to. `POST /api/island` takes a
whole island — somebody else's — and moors it in the water beside yours. The carve-out is
written out in full above `PUBLIC_API` in `lib/access.mjs`, where whoever opens the second
one will read it; what guards it is this. An island that arrives is two megabytes at most,
and one address may send one every ten seconds, with three in hand for somebody who
reloads while finding their feet — asked at the door, before the body is read, so a
refusal costs nothing. There are four berths and no more. What arrives is parked under
`data/guests/`, where nothing merges it into the village, the scanner does not know it
exists, and it can reach neither `village.json` nor `layout.json`. It is not checked and
passed on: `lib/islandbundle.mjs` builds a brand new island out of a whitelist, field by
field, so a field it has never heard of cannot reach this disk whatever the sender calls
it. And the land is rebuilt from their seed here rather than taken on trust — if their
island hashes to something other than what they said it does, the two machines are not
running the same terrain generator, their houses would stand in the sea, and the upload is
refused outright. A berth is swept when the server starts, which is the rule that keeps an
uploaded island a visit rather than a copy of somebody's island living on your disk.

**What a visitor can see.** The place and the people: the island, the houses, the settlers'
names, and the project folders' names. Not the conversations. A session's title is its
opening prompt and is stripped, and so is anything else written out of a transcript —
branch names, ticket summaries. Absolute paths are cut back to the folder's own name, so
`C:\Users\you\Desktop\pixelart` reaches a visitor as `pixelart`, and the identifiers that
carry a path or a session id are renamed. `"guestView": "full"` turns all of that off for
a network you trust. An island packed up to be carried to somebody else's machine is
redacted whatever that setting says: it is one thing to let a neighbour look through your
own window, and another to write your branch names onto their disk, where they stay until
they restart a server they do not think of as holding your data.

**The house signs.** The board in a settler's front yard is the one label that spells a
title out in the world itself rather than in a panel you have to open, so it has a setting
of its own, under **Settings** in the top right:

| | |
|---|---|
| Everyone | Visitors see the signs too. |
| Only me | The default. A visitor's page is never told to build them. |
| Nobody | No signs at all, yours included. |

It is `"display": { "nameplates": "keeper" }` in `config.json`, and the panel writes it
there. The decision is the server's, not the page's: `/api/hello` tells each window
whether it may have the signs, and changing it reaches every open island at once. Under
`"guestView": "redacted"` a visitor's sign would carry the settler's made-up name and not
the title anyway — this is the belt to that pair of braces, and the setting that matters
if you ever turn the redaction off.

**Neighbours.** Every island shouts its name, its seed and its port over UDP every five
seconds. Their seed is enough to draw their island's true shape on your horizon without
ever connecting to them, always on the same bearing, so you learn where to look. Click one
and you sail over: the page really does go to their server, where you are a visitor like
anyone else. Who is on your network is yours alone — a visitor is never told.

**An island at a berth.** The horizon is not the only place a neighbour can be. An island
can also be moored beside yours — a real berth, with a strip of open sea between the two
coasts and ground on the far side you can stand on. There are four of them and they are
snapped to the compass, east, west, south and north, for the same reason the horizon puts
a neighbour on a fixed bearing: you learn where to look. An island on a berth is no longer
a silhouette on the horizon, because it cannot be in both places at once.

What comes with it is their land and their village. Their coast, their hills, their lake
and their rivers are all real — those are what their seed makes, which is why an island
can be drawn at all without asking them for anything — and their houses, sheds and civic
buildings stand on the plots their own layout recorded, built by the same code that builds
yours. Hover one and it says whose it is.

What deliberately does not come with it is everything that would make it a second village
rather than a place. There is no forest over there, no fields, no worn ground, no hamlet
greens or fences, and no settlers walking about. There are no yard signs either: a
nameplate is drawn into a texture of its own and forty of them are a large fraction of
everything on the screen, and the rule that replaces them reads well enough — a yard sign
is for the island you live on. Nothing over there turns, flies, chimes or smokes, because
none of that changes what the place looks like from across the water. Their chronicle,
their dossiers, their milestones and their post are not there at all. Your island is a
village; theirs is a place.

And it is a **snapshot of the moment it was uploaded**. There is no line open to the other
machine. A house that goes up over there does not go up over here, a settler who arrives
does not arrive, and nothing at that berth changes until the whole island is sent again.

**The quay and the boat.** Where a village has earned a quay district, its kade is the
island's dock: the same planks a Cowork settler sails up to, with the boat tied up at the
end of them. An island that never earned one still gets a dock — out over the water from
its landing, the coast cell nearest the town centre where a new settler walks ashore — so
there is always somewhere to cast off from, seed alone. Either way there is exactly one,
and it is the one the harbour houses are looking at.

Walk out along the planks and press **E**, and there is a boat alongside: one per dock, so
pressing it twice does not leave a raft of hulls tied up together. Aboard, **W** and **S**
are the oars and **A** and **D** the tiller, and **E** again puts you ashore wherever
there is shore to step onto. She is quicker than running and takes a couple of seconds to
find it, and a hard turn spends the way you had on. Press her at a coast and she will not
climb it — the water's edge is the only place you can get in or out of a boat at all.

Touching the bottom comes in two kinds, and the difference is the height of what the bow
found. A **shoal** — sand, a bar, the bank of a stream — is a bump: she shoulders along it,
loses most of her way in the moment, and carries on if you steer off. Lean on it with the
throttle open and she stops anyway, inside a second, because a boat that could grind along
a beach at walking pace would end up magnetised to the coast. Anything higher than sand is
a **wall**: she stops dead there and has to be backed off, the way she always did.

**Up the river.** Where a village has a river that reaches the sea, it dredges the mouth
once it is 25 settlers strong. `riverCourse` stops the water where the beach begins and
lets the tide do the rest, which is a good trade for the coast and leaves a bar across the
entrance — on Promptholm, ground sitting between 0.00 and 0.06, deep enough to float on
paper and a sandbank in practice. The dredger cuts a lane five cells wide from deep water
through that bar and a little way up the river behind it, and then it is marked: red cans
to port and green cones to starboard, entering from seaward, so the channel can be found
from out on the bay where it is invisible under the surface. The stakes are the point of
it — a fairway is a hole in a bar and looks exactly like the bar.

Behind the entrance the river is its own reward: on Promptholm it is a hundred and forty
cells of water between one and a half and three wide, with fifty-six bends, and it ends
fifteen units from the town square. It is dug once and written into `data/layout.json`,
like a polder and for the same reason: nothing that stands in the water may move. A river
that ends in a landlocked pool is left alone — cutting to it would be a canal through the
island, which is a much larger idea.

**Settlers go out on the water too.** Every now and then somebody who has nothing on walks
down the lane, out along the planks, and takes a little boat round the bay for the pleasure
of it. Not the island's boat — that one is the crossing, it is shared with everybody on the
island and with whoever is across the channel, and a settler is never in your way to it.
They bring a dinghy of their own instead, which comes alongside the far side of the head
and goes away again when they step out. Two afternoons at a time at most, never after dark,
and they always come home, which is why the route is a wide circle out and back rather than
a wander. If the dock is up a creek too narrow to turn in, the walk to the end of the pier
is the whole of the outing.

On foot the open water is still a wall. You may wade in as long as the shore stays within
about two metres, and not a step further, which is what has always kept you from setting
out for the horizon. That refusal is the reason the boat is worth having: it is what makes
the strip of sea between two islands a crossing rather than a paddle. Leave it in place.

**One thing this cannot defend against.** A port forwarder on this machine — `netsh
interface portproxy`, ngrok, `ssh -L`, Docker's userland proxy, a reverse proxy — makes
every visitor arrive from 127.0.0.1, and the island has no way to tell from the inside.
Anyone reaching it that way is the keeper, with the full run of the machine. Do not put
one in front of this. To let somebody in from outside your own network, set an
`inviteCode` and send them `http://…/?key=…`; without one, only your own subnet is let in.

An invite code used to buy a stranger a look at the island, and it now buys them a berth
as well. Membership of your own network is the whole gate on the one write route there is,
and a code is what stands in for that membership from outside — so whoever holds it can
moor an island here, which is four berths of two megabytes of somebody else's data sitting
in `data/guests/` until you restart. Hand one out to people, not to a mailing list.

## Talking to a settler

Walk up to a house and press **E** (**X** on the controller), or open its dossier and use
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

## The office

Every district that is a git repository has an office on its square. Walk in, or click
it, and you get what git has to say about that repo: the branch and how far it has
drifted from its upstream, what is waiting in the working tree, and the recent history.
Click a file for its diff, click a commit for its message, its stat and its patch.

It only reads. The one thing it will change is remote-tracking refs, through a **Fetch**
button, which never touches your work. Staging, rebasing and untangling a merge belong
in a real client, so the office lists the ones you have installed and opens them at that
repository: Git Extensions, Fork, SourceTree, GitHub Desktop, VS Code, or plain File
Explorer. Whatever is not installed is simply not offered.

The page names a district, never a path, so no request can point git at some other
folder on the machine.

## Telling an agent how your team works

The island does not know your workflow, so it does not carry one. What a dispatched
agent is told comes from `config.json`:

```json
"dispatch": {
  "opening": "Pick up {key}",
  "skill": null,
  "language": "en"
}
```

The `opening` is the first line of the prompt, so make it the phrase your own project
skill triggers on. Name that skill in `skill` and the agent is told to follow it from
beginning to end; leave it `null` and the agent is simply asked to work the ticket the
way the project does. `{key}`, `{number}`, `{summary}`, `{settler}` and `{island}` are
filled in.

The skill itself belongs in the repository the agent works in, next to the code it
describes, not here. That is also where it stays private.

The island's own board hands its cards over in the same shape, under `github`, and comes
with sensible answers already, so this only needs writing if you disagree with them:

```json
"github": {
  "repo": null,
  "dispatch": { "opening": "Pick up issue #{number}", "skill": "issue-oppakken" }
}
```

`repo` left null means the checkout's own `origin` remote. A skill is only ever named to
an agent whose folder actually carries it.

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

Walk up to a house and press **X** (**LT** on the controller), use **Send away** in the top right
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
cork, **A** presses what is under it, **X** switches person, **Y** refreshes, the right stick
scrolls and **B** steps back. The hint bar at
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

## The island's own board

A second noticeboard faces the sprint board across the square, in slate and iron under a
copper roof rather than cork under planks. The sprint board carries the work of the
village; this one carries the work on the village itself — the **GitHub issues of the
repository the island is built from**, one note pinned per open issue. Walk up to it and
press **E**, or click it.

It reads through the `gh` command line, so there is nothing to configure and no second
token to keep: the board sees the repository exactly as whoever `gh auth status` says is
logged in. Which repository that is comes from the checkout's own `origin` remote, so a
fork or a clone shows its own issues; `"github": { "repo": "owner/name" }` in
`config.json` overrides it. The last answer is cached in `data/issues.json`, so the board
still shows something when GitHub is unreachable, and the count of notes on the board
outside follows it.

GitHub has no columns to drag a card between, so what says an issue is taken is the
`in progress` label the workflow puts on, or somebody being assigned to it. The cards are
grouped as **Up for grabs**, **Being worked on**, **Done** and **Closed, not planned**,
and the board opens on everyone rather than on you, because most issues here belong to
nobody in particular.

Everything else works as the sprint board does: the same keyboard, the same controller,
the same hand-over. What differs is what the agent is told. **Hand it over** starts a
session with `Pick up issue #11`, which triggers the repo's `issue-oppakken` skill:
an issue first, then a branch from `origin/main` named after it, the issue marked as
picked up, and when the work is done the branch pushed and the issue closed as completed.
A folder that does not carry that skill gets the same route spelled out in the prompt
instead, so a hand-over still lands somewhere sensible.

Two warnings appear where they are earned: a folder without the skill, and the checkout
the island itself is being served from — an agent branching there changes the island
under your feet, so one of its worktrees is the quieter choice.

## How the village grows

A session hook is installed in `~/.claude/settings.json`. It fires on `SessionStart` and
`SessionEnd`, records the arrival, and rescans. The hook writes nothing to stdout and
always exits 0, so it can never disturb a session. The server also rescans every 60
seconds, which is how Cowork tasks were noticed (their sandbox may not run user hooks).

Since August 2026 the desktop app runs a Cowork task as a remote session: it leaves no
record in `local-agent-mode-sessions` and no transcript on this machine, only an id
(`cse_…`) in the app's own IndexedDB cache. So the quay is history - the houses on it stay,
because a house never moves, and no new ones are built. The scanner still reads the folder,
so a local Cowork task would come ashore again without a change here. Fetching the remote
sessions would mean the islander asking claude.ai with the user's token, which breaks the
rule that the island reads only what is already on disk, and was decided against.

### Hamlets and git

A working directory is not a project. `D:\git\Sybolt_PLC`, `...\TrayMagazijn` and
`...\_Scam\SCM_TrayFill_Coordinator` are three folders and one piece of work, so the
island walks up from a session's cwd to the repository the folder lives in and keys the
hamlet on that. A `.git` file rather than a directory is followed: a linked worktree
becomes an outpost of its repository, a submodule folds into its superproject.

Plenty of real projects have no `.git` at all, so two rules pick up the leftovers. A
plain folder with exactly one repository just below it belongs to that repository
(`D:\git\plclab` has none, `D:\git\plclab\src` has one). A plain folder under another
plain folder is absorbed by it - *unless* that parent holds two or more separate
projects, in which case it is a shelf, not a place, and never absorbs anyone. Without
that guard `D:\git\Martijn`, which is not a repository, swallows Claude, HomeAssistant,
WhatsappBot and five others into one meaningless block of sixty houses.

The answers are cached in `data/cache.json` under `repoRoots`, and **a positive answer is
never checked again**. Folders get renamed and deleted long after their sessions are over
- `D:\git\PlcLabNet` already has - and a hamlet that loses its folder should keep its
name rather than quietly turn into somewhere else. That map survives a parse-format
change for the same reason.

A project earns a hamlet - a green, a sign, a fence - on its third session. Below that it
gets a lone farmhouse in the countryside, or a place on the town commons if the island has
no room for one. When it reaches its third session it founds a hamlet, and the houses
already standing keep their plots: they stay where they are for good.

Every session of one project stands on that project's own land, and the boundary is what
says so: it runs all the way round the parcel and opens only where a road crosses, with a
gatepost either side. What it is made of is the district's own standing rather than a die
roll - average the houses inside, tent 0 through keep 5, and the answer climbs four rungs:
post and rail round a camp of tents, a paling fence round huts and cottages, a hedge once
there are houses, dry stone from a manor upward. Thickness is the one number that only
ever grows: sevenfold from end to end, and never doubling back where one material hands
over to the next. Height is allowed one dip, and takes it in the one place where a dip is
true to life - a well-grown hedge stands taller than the lowest dry stone. Sheds and civic
lots do not count - neither is anybody's house.

All four are Blender models rather than drawn shapes - `assets/rail`, `assets/fence`,
`assets/hedge` and `assets/wall`, a bay to the ground cell, warped onto the ground it
stands on. A drawn outline can only ever say one thing, and it says it for the whole
length of the island: extrude the best hedge silhouette there is over four hundred metres
and what you have is topiary. A bay can be picked from two, so what you have instead is a
boundary somebody built a bit at a time. It is also the only way to draw a fence you can
see a field through: the post and rail was one continuous board before, because a swept
outline has no way to leave a gap in itself.

**`PARCEL_VERSION`** in `lib/layout.mjs` is the one thing that can move a house. Land is
owned, and a change to how it is divided means re-planning every house and shed at once -
so that is a numbered, deliberate act, separate from `LAYOUT_VERSION`, which would also
throw away the town square and everything civic. If you delete `data/layout.json` you get
a completely different-looking island: the town is tied to the terrain, but which hamlet
sits where is not.

The **ground itself** can move a house too, and that one is not a version number: the
layout records `terrainHash`, and if a scan finds a different one it plans the island
again from nothing, town square included. That is not a courtesy, it is the only correct
answer - the land a plot was chosen on no longer exists, and left alone some of those
plots are now in the water. Anything that changes `shared/terrain.mjs` therefore costs the
whole island once, so it is worth getting the terrain right before the village grows on
it. Rivers cost exactly this when they landed.

Sessions that started before the island was founded are ignored, so the village begins
empty and grows from the founding session onward. `npm run scan:all` shows what the
island would look like with the entire history on it, written to separate files so it
never disturbs the real village.

### When the village crosses the river

At **90 settlers** the village builds a bridge. It is the one rung on the ladder that is
not a building, and the one thing on the island the roads are told to do rather than
priced into doing.

A road may cross water whenever it wants to: `routePath` sells a cell of deck for about
eight cells of walking, and a hamlet road takes that bargain where the way round is
longer. On some islands it does. On this one it never has and never will, because a river
never quite severs an island - you can always walk round its head - and all fourteen
projects here live on the town's own bank. There is no road that wants the far side, so
there is no route to bend, and making a deck cheaper changes nothing: cut the price to
almost nought and the island still builds none. So ninety settlers is where the village
stops waiting and lays one itself.

Ninety is the town square's own number. The plaza stops widening there (`SQUARE_STEPS`),
which is the scan on which the centre stops growing outward - and what the village does
next is reach across the water instead of paving more of its own bank.

Where it goes is decided by what the crossing is worth, in cells of walking saved. Every
straight reach of river no wider than five cells with ground a road may use on both banks
is a candidate; the one that takes the most off the walk to the town square wins, and a
bank no road can reach at all beats any saving, because a bridge there is not a short cut
but the only way. A reach that does not save at least the eight cells per cell of deck
that `routePath` charges is refused - a monument the village walks round is worse than no
monument - and the fairway is refused outright, because a deck over the dredged channel is
a bridge that closes the river it crosses.

Two things it will not do. It will not build where the roads have already crossed: a
bridge is built once and every later road comes over it, so on an island whose hamlet
roads got there first the rung is *that* crossing, and only the marker stone is new.
And it will not build at all where there is no reach to carry a deck - the rung then
waits, the way the polder mill waits for shallows and the harbour crane waits for a quay.
Measured over thirty islands: ten build a crossing, eleven adopt one, nine go without.

The deck goes up after the hamlet roads and not with the other milestones, because a
bridge is a road: laid any earlier there would be no lane on the island for it to join.
Along with it come a road from the far bank onto the planks and a road from the near head
to the first paving it meets. From then on those cells cost the next road almost nothing,
which is the whole argument - a route from the far bank that had to walk round the head of
the river, or could not get there by road at all, now comes over the planks for nothing.

The **bridge stone** is what the rung is recorded as. A deck has no plot - it stands over
water, with no footprint, no door and no yard - and a milestone with no plot has no
dossier, no date standing on the island and nothing for the legend to point at. So the
crossing is what was built and the squared stone beside its head is what says so, the way
a polder is the work and the mill on its dike is the rung. It stands *beside* the head and
never on it: that cell is the road onto the planks.

### When the island runs out of land

It does run out. The terrain holds 475 fully buildable 4x4 blocks; the hamlets and the
town commons own about 305 of them, and somewhere past three hundred houses a new project
stops being given a hamlet at all and its houses pile onto the commons. Raising
`gridSize` is not the way out - it is the terrain generator's own argument, so a bigger
number is a different island: a different coast, a failed `size` check in `loadLayout`,
and a town square somewhere else entirely.

So the village takes land off the water instead. At **150 settlers** it builds the polder
mill and drains its first polder, and it drains one more for every 25 settlers after
that - `POLDER_AT` and `POLDER_EVERY` in `lib/layout.mjs`. Each one is twelve super-cells
of shallow water, about eleven plots, walled by a dike where there is water to keep out
and joined to the island by a causeway over the beach. Which stretch of coast a polder
faces is the one thing the island seed decides, so two islands reclaim different water.

Reclamation only ever takes cells that are **under water**, never a cell that is already
land, which is what lets it happen to a village that is already standing: no house moves,
no parcel moves, and the town keeps every stone. A wall drawn round whole super-cells
leaves wedges of sea between it and the old shore that the tide can no longer reach, and
those are filled to the height of the polder too - so the new coast is dry rather than
puddled, and an earlier polder is simply more shore to the next one.

The dike and the causeway are raised ground you may walk but not settle, and they are not
marked alike. The causeway is road, written into `layout.paths` like any other stretch,
because it is the one way onto the new land. The sea wall is not: nothing builds on it and
no road crosses it either. Leaving the wall cheap to walk is what once tempted a hamlet's
road up onto it for fifteen cells that were recorded nowhere, and left three houses on the
polder with no way home. The one thing allowed to stand on a dike is the polder mill.

The trigger is the settler count and nothing else. `ensureParcel` does know when it could
not seat a district - that is what `rec.guest` means - but that answer only exists after
the placement, and the terrain has to be final before it. Feeding it back would mean
reclaiming on the *next* scan, and then a second scan of an unchanged island would rewrite
`data/layout.json`, which is the one thing that must never happen. A settler count is a
pure function of the model, so a rescan reclaims exactly the same land.

The polder mill used to be the last thing the village ever built. At **165 settlers** it
puts up a **harbour crane** as well, on the quay's own waterfront with its jib out over
the water - looking at the berth rather than back at the town, which no other civic on the
island does. It wants the cell beside the ramp onto the planks, and by the time it is
earned that cell is usually somebody's front garden: a settled quay is harbour houses
shoulder to shoulder. So it walks along the water's edge instead of inland, and stands on
the nearest open ground to the berth, never further from it than the planks are long.

The number sits in the window between the first polder and the second, because every dike
after the first is stone and timber that has to come ashore and the crane wants to be
standing before it is asked to land it. An island that has never run a Cowork task has no
quay and no planks, so the crane waits, exactly as the polder mill waits for a village
with no shallows to reclaim.

## What you are looking at

| On the island | In the data |
|---|---|
| Town Hall and founding stone | The session that founded the island |
| A cork noticeboard on the square | The Jira sprint; one pinned note per open ticket |
| A slate noticeboard facing it, under a copper roof | The GitHub issues of the island's own repository |
| A house | One Claude Code session |
| A hamlet: a green, a name sign, a fence and one road to town | One git repository, from its third session on |
| A post-and-rail fence, a paling fence, a hedge or a dry-stone wall | The edge of a hamlet's land, closed all the way round; it opens only where a road crosses it |
| How stout that edge is | The houses inside it: a rail round tents, palings round huts and cottages, a hedge round houses, dry stone round manors and keeps - and the grander the houses the thicker the stone |
| A river, with shingle and reeds along it | The other kind of boundary: where one runs along a hamlet's edge the boundary steps back and the water does the job |
| Red and green stakes standing in the water at a river mouth | The betonning of the dredged fairway. Red cans to port and green cones to starboard entering from seaward; follow them in and the river is yours as far as the town |
| A plank bridge | A crossing of the river. Built once, and every later road comes over it rather than build a second - either because a hamlet's road to town had to cross and paid for it, or because the village built one on purpose at 90 settlers |
| A squared stone with a bronze plate, at the head of a bridge | The bridge stone: the milestone at 90 settlers. The crossing is the monument, and this is where it is written down - see [When the village crosses the river](#when-the-village-crosses-the-river) |
| A lone farmhouse with a field, out in the country | A project with one or two sessions: too small for a hamlet yet |
| Houses around the town square with no boundary | The commons: whoever the island had no room for elsewhere |
| Flat green land behind an earth wall, out in a cove | A polder: land reclaimed once the island ran out, from 150 settlers on |
| A small mill on a dike | The polder mill, which drains the first polder |
| Ploughed fields and orchards | Countryside - buildable land no project has claimed |
| A kitchen garden | Land inside a hamlet that nobody has built on yet |
| A faint colour in the grass | Whose hamlet's land you are standing on |
| The Outlands | Sessions whose folder is not a project: System32, a downloads folder, a shelf full of other repos |
| The town square, growing 3 -> 5 -> 7 cells across | 1, 30 and 90 settlers |
| An outpost | A session in a git worktree, whether `.claude/worktrees` or `git worktree add` |
| A house on stilts at the quay | A Cowork task from before August 2026, when they still ran on this machine; its settler arrived by boat. No new ones come (see [How the village grows](#how-the-village-grows)) |
| A plank dock out over the water, with mooring posts | The quay: where a Cowork task's settler comes ashore, and where the island's boat lies. Stand on it and **E** gives you the boat — see [Visitors and neighbours](#visitors-and-neighbours). On the open sea, never on the lake or a river — a settler arriving by boat has to be able to get there |
| One dock and no more, on every island | The quay district's planks where there is a quay district, and a dock at the landing where there is not |
| A boat out on the bay with a settler in it | Somebody's afternoon off — they will bring her back to the quay |
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
| Well, market, tavern, clock tower, tables, windmill, water tower, chapel, fountain, lighthouse, statue, castle | 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 70 and 100 settlers |
| The plank bridge and its stone | 90 settlers: the one rung that is not a building on a lot, and the only one that may be somewhere you have to walk out to find |
| A timber derrick on the quayside with a crate hanging over the water | The harbour crane, at 165 settlers: the rung above the polder mill, and the last one the ladder has |
| A vegetable bed | Something you sowed yourself, growing in real time — see [Market gardening](#market-gardening) |
| A pale row that glows after dark | Moonleeks, ready to pull |
| The school | 25 apprentices: it is where they are taught |
| Flower beds, street lamps, benches, terraces on the square | one per 30, 45, 60 and 110 apprentices |

The day and night follow the real clock; the season follows the month. Windows light up
after dark, campfires flicker, fireflies come out, and the lighthouse throws a beam you can
watch turn — including somebody else's, sweeping across the water from their island to
yours, or flashing at the edge of sight from one too far away to make out.

The weather belongs to the sea rather than to the island, so everybody in one world is
standing in the same afternoon: clear, overcast, rain or fog, turning every ten minutes or
so. Overcast brings the clouds down and takes the sun out of the day; rain falls as snow
once the season is winter; fog closes the haze in, though never so far that it swallows the
islands out on the water. A sea that restarts starts the weather again — it keeps nothing
on disk, the sky included — and an island with no sea to ask has clear skies. `?sky=rain`
holds one of the four for as long as the page is open, which is the only way to look at
them all without waiting out somebody else's afternoon.

## What the island sounds like

**Sound** in the row of chips at the top right, beside Legend. It starts off, and whichever
way you leave it is how that browser finds it next time — it is a setting of your speakers
rather than of the island, so it is not in Settings and a visitor gets it too. Nothing makes
a noise before you click something: browsers will not start audio on their own, and neither
will this.

Switched on you get the sea where there is sea and the wind where there is not — walk inland
and one fades into the other — with everything quieter and duller after dark. Over it: a
settler whose session is running hammers at their own door, gulls over the quay in daylight,
and a murmur out of the tavern when there is anybody at the tables. Only the nearest few of
anything are ever heard, so a village of three hundred costs the same as a village of three.

It is all made up out of noise and arithmetic when you turn it on — there is not a single
sound file on this island, and there is not meant to be one.

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
| Cowork tasks (local ones only; remote tasks leave nothing here) | `%APPDATA%\Claude\local-agent-mode-sessions\…` |
| The sprint on the cork board | Jira REST v2, cached in `data/sprint.json` |
| The issues on the island board | `gh issue list`, cached in `data/issues.json` |

Transcripts are append-only, so the scanner remembers how far it read and only folds in
new bytes. A first scan of a few hundred megabytes takes a second or two; every scan
after that takes a fraction of one.

## The model sheet

`http://localhost:4747/demo` draws every object the island can build on one field:
each house tier in each model's colours, the sheds, the ornaments, every civic
building, everything that stands on the square, and every vegetable — each crop as
you would buy it, and one turnip through all four of its looks — with a night slider
so the lit windows, the street lamps and the moonleeks can be judged, and a wireframe
toggle. Nothing on it reads the village or the garden, so a piece that no village has
unlocked yet still shows up. Edit `web/js/buildings.js` and reload.

**Hitbox** draws what walk mode cannot step through. Amber is the solid part of the
shape: everything low enough for a settler to bump into, which leaves out roof
overhangs, bell towers and parasols because you walk under those. Red is where a
settler's middle actually stops, the same box grown by half a body -- so if two red
rings touch, nobody fits between those two objects. It is the view that answers why
something on the island cannot be walked past.

## The workbench

`http://localhost:4747/editor` is the model sheet with its hands free. Pick a model, click
a piece, and drag the arrows or tap an arrow key to move it; the panel on the right shows
the line of code that says so, and **Save** puts it in `web/js/buildings.js`.

It works because every primitive in `buildings.js` notes its own call on the geometry it
returns -- `box`, the three numbers, the colour, the placement. The merged mesh could never
say that one of its faces used to be a door; a piece that remembers being
`box(0.16, 0.26, 0.05, pal.accent, { z: 0.51 })` can. Ask `buildBuilding` for
`{ keepParts: true }` and you get those pieces back, still in the space the code was
written in.

The pieces that keep coming back are named rather than repeated. `KIT` holds a window, a
door, a bench, a table and a chair, each one a handful of primitives under a single name,
and `windowsOn()`, `door()` and the bench on the square all reach for it. So a window
picks up as a window instead of as the pane it happens to be, and **Add a piece** puts
another one down wherever you are.

**Save** writes the changed lines into `buildings.js` itself. It is on purpose the dullest
patcher imaginable: the page sends whole lines - the one standing in the file, and the one
that takes its place - and the server writes nothing at all unless each is found exactly
once. No line numbers, no diff format, nothing that can drift out of step, and loopback
only, because this writes source.

A line it cannot find is left alone and named, and that is the honest half of the feature.
Plenty of lines in this file are not written literally: `{ y: f + 0.62 }`, or four windows
out of `for (const x of [-0.42, 0.42])`, or a window whose numbers `windowsOn()` works out.
Those have no literal to match, so the panel says which ones and why, and hands you the
`+` line to place by hand.

**Copy** is there for exactly that, and for the rest:

- **Changes** lists what you moved as a `-` line to find in `buildings.js` and a `+` line
  to put in its place.
- **Whole model** writes the lot as one `case` for `civic()`, which is the short way to a
  new model: load the nearest thing to what you want, rearrange it, paste it under a new
  name.

Until you save, what you have moved lives in this browser: a reload comes back to the model
you were working on with your changes still on it, switching models asks before it drops
them, and closing the tab asks too. Two things stay out of reach of the editor itself: the
houses in `houseBody()` are drawn per tier with a little randomness, so they are shown but
not composed here, and the one piece that is turned after it is placed -- the awning on the
guide shed -- says so rather than pretending.

## Layout

```
scan.mjs        read every session record, write data/village.json
serve.mjs       serve the island, push updates, rescan on a timer
hooks/          the SessionStart / SessionEnd hook
lib/            sources, incremental parsing, the village model, plot layout
lib/access.mjs  who may do what: the keeper, a visitor, or nobody
lib/garden.mjs  the purse, the seed pouch and every bed that has been sown
lib/ws.mjs      a small WebSocket server, hand-written, no dependency
lib/players.mjs who is walking the island right now
lib/neighbours  the UDP beacon that finds other islands on the network
lib/guestview   the island as a visitor is allowed to see it
lib/sprint.mjs  the Jira sprint behind the cork board
lib/issues.mjs  the GitHub issues behind the island's own board, read through gh
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
- **After an update**: nothing. The island checks `config.json` when it starts and writes
  in any setting that has been added since, at its default, naming them on the console —
  so a file from an older island keeps every value you chose and still shows you what
  there is to change. It only ever adds: a setting it does not recognise is left alone,
  and one you set to `null` stays `null`. `config.example.json` is a dump of those
  defaults, held to them by `tests/config-file.test.mjs`.
- **Rename the island** or move the founding date: edit `config.json`.
- **Start over**: delete `data/` and rescan. Houses will be placed afresh.
- **The garden** is in `data/garden.json`, which the scanner never touches — but it is
  still under `data/`, so deleting that takes the purse, the pouch and every bed with it.
- **A house never moves.** `data/layout.json` records where every building stands and is
  only ever added to, so the town you know stays the town you know.
- **Turn it off**: remove the two `Settlers` entries from `hooks` in
  `~/.claude/settings.json`. A timestamped backup of the original file is next to it.
