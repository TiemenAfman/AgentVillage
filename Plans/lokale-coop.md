# Lokale co-op: twee spelers achter één scherm

🚧 Plan van 29 september 2026, nog niet gebouwd. Verkend, niet gemeten.

Twee mensen op één machine: speler 1 met toetsenbord en muis, speler 2 met een gamepad. Twee
manieren om dat te bouwen zijn afgewogen en verworpen of uitgesteld, en de keuze staat hieronder
zodat niemand het onderzoek over hoeft te doen.

## De keuze: één pagina, één gedeelde camera

**Niet: het spel twee keer starten** en een pad aan het venster zonder focus binden. Chromium
(en dus WebView2) geeft de Gamepad API vermoedelijk alleen aan het venster met focus - niet
geverifieerd, maar als het klopt is de controller-instantie precies het venster dat niets ziet.
`createGamepad` (`web/js/gamepad.js:23`) heeft bovendien één sticky `padIndex` en pakt de eerste
verbonden pad, dus twee pagina's lezen beide pad 0; en beide delen `localStorage` (naam, uiterlijk,
`promptholm.walk.spot.*`, keybinds). Wat wél klopt: de zee telt twee sockets als twee spelers (een
speler is een `conn.id`, `lib/players.mjs`), dus de server hoeft niet mee. Een `?input=`-pin en
een Rust-pad-lezer (`gilrs`, via `webview.eval`, want `lib.rs:43-44` geeft de pagina bewust geen
IPC) zouden het redden, maar dat is een omweg om iets wat één pagina gratis geeft.

**Niet (nu): splitscreen.** `main.js` gaat uit van één oog. Alles wat per camera moet gebeuren
staat op één plek (`main.js:6430-6510`) en moet dan per view lopen: `cullRecords`, `applyFogRange`,
`world.recentre`, `setWaterFocus`, `followShadow` (één schaduwfrustum), `underwater`, weer,
`seaFloorFrame`, het geluid, de horizon en de islets, en de CSS3D-laag van de borden, die onder de
canvas zit en door gaten in één scène kijkt. Een tweede `renderer.render` verdubbelt de kleurpas en
de schaduwpas. Dat is een refactor van het frame, geen schakelaar.

**Wel: één pagina, twee lopers, één camera die het midden volgt** - het RPG-idee. Één render, één
oog, één venster met focus: toetsenbord en pad komen in dezelfde pagina binnen. De single-eye
singletons blijven kloppen zolang de spelers bij elkaar blijven (een leash). Later kan een
instelling *Volgt beide | Gesplitst* dezelfde twee lopers over twee views verdelen; dat is fase 2.

## Wat er al klaarstaat

- `createWalkMode` (`walk.js:182`) is per instantie: state, keys, stamina, tipsy, avatar en dance
  zitten erin, alleen de scratchvector `seatAt` (:96) is module-breed. `interior.js:639` maakt er
  al een tweede naast de eilandloper.
- `park()` (:1315) is een loper die getekend en gestept wordt zonder de camera te raken, en
  `hand(side, down)` (:1968) is voor de telefoon gebouwd: slaan en blokken zonder muis.
- Een tweede `createNet` is een tweede speler: eigen id, gezondheid, adem, naam en look, join als
  `as: 'client'` (`main.js:7278`), niets geclaimd. Kost één plek van `maxPlayers`.
- `peers.js` tekent al N figuren met dezelfde rig.

## Wat er ontbreekt

**`walk.js` heeft geen loper zonder camera, DOM of toetsenbord.** Nodig: `camera: null` (bewaak
`placeCamera` :1836, `setFirstPerson` :655, `exit()`s `camera.up` :1290), `dom: null` (geen
pointer lock via `syncLock`, geen :668-672), `keyboard: false` (geen window-listeners :495-497,
anders ziet ook de tweede loper WASD). De richting van een stap volgt `state.camYaw` (:1620), dus
de aanroeper zet die voor loper 2. Verder een `follow()`-haak voor de gedeelde camera in
`placeCamera`, een leash in `blocked()` (:812-828, zoals `peerBlockers` alleen stappen weigert die
dichter komen) en een `teleportTo` op de "stap terug tot legaal"-lus (:1265, :1320). Een boot
negeert `blocked` (`stepBoat`, :1507): de leash daar apart oplossen.

**`peers.js` filtert één eigen id** (`selfId`: `setSelf` :547, `join` :197, `snapshot` :270).
Twee sockets zouden elkaar tweemaal tekenen (eigen avatar én ghost), en `net.gone()` wist met
`peers.clear()` (:352) iedereen. Dus: een set (`addSelf`/`removeSelf`), een stub-`peers` voor
net 2 die `setSelf` doorgeeft, en de twee lopers als lokale `peerBlockers`-cirkels voor elkaar in
plaats van elkaars gelagde ghost (`peers.blockers()`, `main.js:6215`).

**Net 2 luistert alleen naar zichzelf.** Elke socket krijgt alles, dus `onWorld`, `onCrowd`,
`onHerd`, `onAgent`, `onBoat`, `onPanels`, `onSaid`, `onWeather` en `onWelcome` blijven no-ops
(dat zijn de defaults, `net.js:104-107`); alleen `onEvicted`, `onBreath` en `onRefused`
worden aangesloten.

**Invoer.** `createGamepad({ slot })` pint een pad. Speler 1 leest dan geen pad. Pad 2 loopt buiten
`ORDER` (`input.js:12`) om: `walker2.pad(actions(p, MAPS.coop))`, en RT/LT via `walker2.hand`.
Speler 2 krijgt alleen wat een loper zonder menu nodig heeft: lopen, springen, sprinten, bukken,
interact (vooral de boot), slaan en blokken, fiets en dansen. Geen inventory, chat, bouwen, zaaien,
first person of minimap. De paneel-, parley- en inside-modi van `createInput` gaan allemaal uit
van één speler, en dat blijft zo.

**`main.js` denkt overal aan één actor** (~126 verwijzingen naar `state.walk`). Voor loper 2:
een eigen frame-stap (volgorde: loper 2, dan loper 1, en de camera wordt in loper 1 geplaatst
zodat de partner vers is), en het midden of de leash-grens voor `focusPoint()` (:3454), `wrapEye`
(:2902), de waterfocus (:6440), `followShadow` (:6471) en `seaFloorFrame` (:6165). Fog, cull en
schaduw hangen aan `camera.position` en zijn dus veilig zolang de camera uitzoomt met de afstand.

## Open punten om te beslissen

- **Interieur.** `inside.walk` (:2107) haalt loper 1 van het eiland af en rendert de kamer-scène.
  Loper 2 blijft dan buiten. Voorstel: binnenlopen blokkeren zolang er co-op is.
- **Panelen en parley** pauzeren alleen loper 1 (`state.walk.setPaused`). Voorstel: loper 2 loopt
  door, en de camera valt niet stil.
- **De boot.** Bootbezit, dans-id, minimap-`isSelf` en panel-`self` hangen aan `net.id()` (o.a.
  :892, :910, :1714, :1783, :2074, :2180, :3354, :7326) en blijven speler 1. Speler 2 stuurt via
  net 2 (`takeBoat`), en de leash beslist wat er gebeurt als de één vaart en de ander loopt.
- **Vitals.** Gezondheid is `net.health()` (:6262), adem is een pool in `main.js` (:6133), stamina
  hangt aan loper 1 (:6243), tipsy is gedeeld. Loper 2 krijgt eigen pools en een tweede rij balken
  of een gereduceerde HUD; eviction krijgt eigen respawn (`onEvicted` :7220-7244 is nu alleen loper 1).
- **Naam en uiterlijk** van speler 2 onder een tweede sleutel (`promptholm.avatar.p2`); dezelfde
  pagina, dus geen opslag-botsing.
- **Fase 2, splitscreen**: eerst een per-view `eye`-object voor de lijst hierboven en
  `setViewport`/`setScissor`, en dan pas de instelling. Eigen plan.

## Ernaast, los te leveren: de chips rechtsboven tonen hun binding

Nu staat de sneltoets alleen in de `title` van elke chip (`web/index.html:116-149`) en dan nog
hardgecodeerd: na een rebind is hij fout. Er is geen begrip van "laatst gebruikt apparaat"
(`padConnected` in `ui.js:1063` gaat nooit meer uit).

- **Detector** in `createUI`: `setDevice('kbd'|'pad')` met een `body`-klasse `input-kbd` /
  `input-pad` naast `chip-names` (`ui.js:522`). Aanhaken op capture-`keydown`/`pointerdown` (naast
  `main.js:3236`) en op `p.anyHit` of een stick buiten de dode zone (`input.js:123`). Touch telt
  niet als pad (`eitherPad`, `main.js:7002`). In co-op telt alleen het apparaat van speler 1.
- **Eén tabel** chip-id -> `{ key, pad }`: de toets uit `keyLabel(keyOf(action))`
  (`keybinds.js:26`, :48), de padknop uit `padKey(mode, action)` (`input.js:86`). Een
  `<kbd class="hint">` in elke `.chip.nav`, met de `kbd`-stijl van `ui.css:288` / `harbour.css:102`;
  `setLabel` (`ui.js:64`) krijgt een toets-argument, zodat Walk en Plan kloppen. Een rebind
  tekent de hints opnieuw.
- **De gaten**: op de pad hebben alleen Walk (A) en Menu (START) een binding; Map, Inventory,
  Overview, New settler, Plan, Say en Animals niet. En N, O, P, T en Esc zijn geen `ACTIONS` maar
  hardgecodeerd in `ORBIT_KEYS` (`main.js:3220`). Keuze: alleen tonen waar een binding bestaat, of
  Map, Inventory, Overview, New settler en Plan op vrije knoppen binden (R3, LT, RT en het
  d-pad links, rechts en onder, `input.js:18-31`) zodat de hint iets te tonen heeft.

## Verificatie (als het gebouwd wordt)

- Headless, naar model van `tests/diving-walk.test.mjs:16-40`: een loper zonder camera, dom en
  toetsenbord beweegt en raakt niets; de leash weigert een stap; `teleportTo` landt legaal. Een
  peers-test voor de `selfId`-set (geen ghost, geen dubbele `clear()`). Een gamepad-slot-test.
- In een echte Chrome of het Tauri-venster (het browserpaneel weigert pointer lock en runt
  verborgen geen frames): toetsenbord met loper 1, pad met loper 2; geen dubbele figuren,
  camera volgt het midden en zoomt uit, de leash houdt ze bij elkaar, een boot per speler,
  eviction respawnt de juiste. `?stats`: draw calls ongeveer die van één speler.
- De open zee hoeft niets nieuws te draaien: twee gewone sockets, geen nieuw bericht.
