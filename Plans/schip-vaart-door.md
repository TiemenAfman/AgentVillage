# 🚧 Het schip vaart door, en een zeemeermin brengt je terug

Plan van 13 oktober 2026. De keeper wil dit uit Sea of Thieves:

- Spring je van een varend schip terwijl haar zeilen staan, dan vaart ze gewoon door: de wind stuwt haar.
- Ben je je schip kwijt, dan verschijnt na een tijdje een zeemeermin bij je in het water. Je herkent haar
  aan lichtgevende rook boven het water. Zwem erheen, druk op E, en je staat weer op je schip.
- Draag je iets (het schatbeeld, `walk.carrying()`), dan laat je dat achter als je via de zeemeermin
  teruggaat.
- Het risico blijft: het schip kan intussen ergens tegenaan varen of beschoten worden.

Dit draait een regel om die net is aangescherpt. Tot nu toe streek `letRun` (walk.js) de zeilen bij elke
manier van boord gaan: over de reling, van haar ladder, uit het kanon (`launchSelf`), op een harpoenlijn
(`takeRope`). Daarna rolde ze uit ([galjoen-vaart-houden.md](galjoen-vaart-houden.md), en de merge "Ladder
aan varende sloep"). Dat blijft zo voor een schip zonder zeil. Met zeil vaart ze nu door.

## 1. Wie stapt het schip als er niemand aan boord is

**De pagina van wie eraf ging, zolang die verbonden is. Daarna niemand.** De zee stapt geen rompen.
`stepBoat` (boat.js) leest de grond van elke regio, de hullwalk-kaart en de zeilen, en hoort bij de
pagina. Hem naar `shared/` verhuizen en de zee terrein geven om tegenaan te varen is een minor op
zichzelf, en de open zee schrijft niets en rekent geen rompen.

- `letRun(b)` strijkt de zeilen alleen nog als ze tegen staan of er geen staan (`b.underSail <= 0`). Een
  schip onder zeil (`underSail > 0`) blijft `loose`: `runOut(dt)` stapt haar met `stepUnderSail` in plaats
  van `stepBoat(…, {})`. Het roer staat midscheeps (zo liet `leaveHelm` het al), dus ze vaart rechtdoor.
- `runningOut()` laat haar pas los als ze stilligt **en** geen zeil voert, als iemand anders haar vaart
  (`isFollowing`), of als we weer aan boord zijn (dan stapt `update()` haar al).
- **Escape van het dek** (`exitWalk`) stopt haar nog steeds. Dat is een keuze om het spel uit te gaan,
  geen sprong.
- **Verbinding weg** (tab dicht, `release`): de zee laat `coast` los en zegt dat tegen iedereen. Ze
  ligt stil waar ze is, en na de bestaande vijf minuten (`IDLE_HOME_MS`, `driftHome`) gaat ze naar haar
  ligplaats. Voorheen zei `release` niets tegen anderen als wie haar uitliet geen crew meer was. Dan
  bleef `coast` op hun schermen staan.

## 2. Hoe lang ze doorvaart

Zolang niets haar stopt. Dat kan zijn:

- **Grond**: `stepUnderSail` strijkt de zeilen bij `b.aground` (bestaand), en dan rolt ze uit tegen de kust.
- **Kanonvuur**: na `HULL_HITS` zinkt ze (`boats.wreck`) en ligt ze heel aan haar ligplaats. De zeemeermin
  brengt je daar dan naartoe.
- **Iemand anders** pakt het roer of gaat aan boord: `take`/`handOn`, de bestaande overdracht.
- **De verbinding** van wie haar uitliet (zie 1).
- **`SAIL_ON_S`** (keuze voor de keeper, zie vraag 3): een plafond, waarna de zeilen vanzelf zakken en ze
  uitrolt.

## 3. De wereldrand

De wereld is rond door een sprong (`wrapEye`, `WORLD_HALF`). Een schip dat wij uitlaten springt dus
mee: main.js verschuift `runningHull()` met `wrapShift` zoals `wrapEye` het lijf verschuift.
`pushSample` (timeline.js) begint de track van anderen opnieuw bij een sprong van meer dan een halve
wereld. De zee kent de rand niet en hoeft dat ook niet.

## 4. Hoe andere spelers het zien (de zee)

- `{t:'boat', a:'leave'}` krijgt een optioneel `sail` (−1..1, zoals bij `letgo`). Gaat wie haar vaart
  (`coast.by`) als laatste van boord met `sail > 0`, dan blijft `coast` bij hem (`b.sail` = de stand).
- `moved` neemt de positie van de kustvaarder aan zolang hij crew is (bestaand), **of** zolang zijn
  posities blijven komen: elke `moved` van een kustvaarder die niet aan boord is, schuift `coast.until`
  op naar `now + runOut` en `freedAt` naar nu. Houdt de pagina op met sturen (ze ligt stil, of de tab
  is dicht), dan vervalt het venster na 60 s en gaat `driftHome` vijf minuten later.
- `driftHome` slaat een schip over zolang `coast` loopt. Anders haalde de zee een doorvarend schip na vijf
  minuten onder de pagina vandaan.
- `state()` zegt `coast` (wie haar vaart) en `sail` al zolang niemand aan het roer staat. Andere pagina's
  volgen haar track zoals bij een kustvaarder aan boord: `glideBoats`, `hullFollowed`.

**Een patch, geen minor**: een optioneel veld op een bestaand bericht, geen `SEA_V` en niets in
layout/config/bundle. **Wel een redeploy van de open zee** (stack 28, met de hand). Zonder die redeploy
neemt een oude zee na 60 s geen posities meer aan. Wie sprong ziet haar dan doorvaren, iedereen anders
ziet haar stilliggen. Dat is hetzelfde bekende gat als bij galjoen-vaart-houden.

## 5. De zeemeermin

### Wanneer ze verschijnt

- Je **zwemt** (`state.swimming`, ook duikend), je staat niet op een romp of ladder en zit niet in een
  boot, en
- **je schip** (zie hieronder) ligt verder dan `MERMAID_FAR` (40 eenheden, ruim buiten zicht van haar
  ladders) of is van de kaart, en
- dat is al `MERMAID_AFTER_S` (20 s) aan één stuk zo. Uit het water of dichtbij zet de klok terug op 0.

Dan komt ze boven `MERMAID_AHEAD` (6) voor je, naar de kant van je schip, op water dat diep genoeg is
(`canDive`) en zonder dek erboven. Daar blijft ze tot je haar gebruikt, het water uit gaat, je schip
binnen bereik komt, of `MERMAID_STAY_S` (120 s) voorbij is. Dan duikt ze weg en begint de klok opnieuw.

### Welk schip

**Het laatste schip waarvan je crew was** (`onBoarded` onthoudt het id, ook na een sprong). De
schatroeiboot en een skiff tellen niet: een roeiboot ligt aan de kust, en een skiff is altijd naast je.
Bestaat het schip niet meer in `state.boats` (het eiland is weg), dan komt ze niet. Zinkt het schip, dan
ligt het heel aan zijn ligplaats en brengt ze je daarheen. Zie vraag 2 voor de andere opties.

### Hoe ze eruitziet

Een zeemeermin die tot haar middel boven water uitkomt, met haar staart erachter die soms boven het water
slaat. Daarboven en om haar heen staat een kolom **lichtgevende rook**: additieve, onverlichte quads die
langzaam opstijgen en vervagen, blauwgroen, zoals `room-glow.js` en `cannon-fx.js` (rook) het doen. Daaronder
ligt een zachte gloed op het water (een additieve schijf). **Nooit een licht**: het aantal lichten zit in de
programmasleutel van elk materiaal, en een licht dat aan- en uitgaat compileert alles opnieuw (CLAUDE.md,
"lights ... turned down to 0 instead").

- **Model**: zie vraag 1. Mijn aanbeveling is een bake (`assets/mermaid`, `scripts/build-mermaid.py`) in de
  stijl van het eiland. Het bovenlijf, het haar en de staart zijn delen met hun origin op hun eigen as, de
  waterlijn op y = 0. Ze beweegt op de CPU: deinen, en een staartslag als een draaiing van het staartdeel,
  zoals de zaagmolen het doet. Eén draw call voor het model, twee voor de rook en de gloed. Later kan er een
  HD-variant naast komen via het HD-pakket.
- **Mixamo**: een *Swimming*- of *Treading Water*-clip werkt alleen op een geskind lijf van de Avonturier.
  Een bake met een staart heeft dat niet, dus de clip zit niet op haar. Wél op ons lijf: zie 6.
- Alleen op **je eigen pagina**. Een zeemeermin is van wie verdwaald is (in Sea of Thieves ziet alleen jouw
  crew haar). Niets van haar gaat over de draad.

## 6. De teleport

E bij haar (binnen `MERMAID_REACH` 2,5, zwemmend) doet dit:

1. **Wat je draagt, laat je los** (`letGo('mermaid')`): het beeld drijft waar je zwom (`floatAt`). Het
   bestaande pad `onLetGo` → `hunt.letGo` → `dropped` houdt de plek vast. Er gaat niets verloren.
2. **Een korte overgang**: het scherm vervaagt naar het blauwgroen van de rook (`#respawn`, `respawnFade`,
   zoals naar huis gestuurd worden) en het lijf speelt Mixamo's *Treading Water* (zit al in `swim`).
3. **Op haar dek**: `walk.mermaidAboard(ship)` zet je op `nearestStand(surface, 0, 0, dek)`, het
   dichtstbijzijnde plekje bij haar midden waar haar model je laat staan, nooit een coördinaat. Het midden,
   omdat de zee aan boord nemen weigert verder dan `BOARD_REACH` (3) van haar midden.
4. **Bemanning** daarna: zoals `hoist` doet, eerst één pose aan boord en dan na 300 ms
   `net.boardBoat(ship.id)`. Een pose mag overal heen springen (lib/players.mjs `p` heeft geen sprongcheck),
   `board` niet. Vanaf dan ben je crew. Vaart zij nog onder jouw zeil (`loose`), dan stapt `update()` haar
   weer.

## Vragen voor de keeper

1. Het model van de zeemeermin: een bake in eiland-stijl (aanbevolen), Pixal3D van een referentieplaatje
   (GPU nodig, jouw go), of de Wanderer-vrouw met een staart.
2. Welk schip: het laatste waarvan je crew was (aanbevolen), alleen het galjoen van je eigen eiland, of
   elk schip waarvan je ooit crew was.
3. Hoe lang ze doorvaart: tot iets haar stopt (aanbevolen), of zakken de zeilen na 10 minuten vanzelf.
4. Wanneer ze komt: na 20 s zwemmen, 40+ eenheden van je schip (aanbevolen), of sneller (10 s), of
   trager (45 s).

## Open

- De zee stapt geen verlaten romp. Dat zou een eigen plan zijn (stepBoat naar `shared/`, terrein op de zee).
