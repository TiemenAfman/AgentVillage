# De quay en de rivier vastzetten: de haven in de riviermonding

**🚧 Status: plan van 29 september 2026. Fase 0 (de meetlat) is er; fase 1 is op 30 september opnieuw gebouwd volgens "Kust netjes dichtmaken" (profielen, beslissingen op de stap, `layout.works`, back-up, weigeren van onbekende velden) en fase 2 als trechter (zie "Uitvoering" onderaan). Fase 3 (één haven met een stenen kade, volgens de door de keeper goedgekeurde preview) is op 30 september gebouwd: zie "Fase 3 gebouwd" helemaal onderaan. Niets gecommit. Open: de brug, de plek van de piratenkroeg (andere sessie) en fase 4 (de echte island migreren).**

## Aanleiding

De keeper wil dat de quay "echt gefixt" wordt. De foto's die hij erbij hield waren alleen
ideeën (houten huizen langs een kade, boeien, boten). Wat er ingame stuk is, zijn drie dingen. Ze
zijn gemeten op de live-island (seed 1337, grid 352, één groeistap `r=156` zonder `relief`,
terreinhash `03aefc04`, gelijk aan `layout.terrainHash`), op een kopie van `~/.promptholm`, met
`tools/measure-water.mjs`.

### Diagnose

1. **De rivier is onderbroken en de haven zit vast.** De rivier zelf is heel (141 cellen,
   [189,184] → [141,276]), maar het water staat niet in verbinding met open zee. De vaargeul
   (`layout.fairway`, 112 cellen) is in het 256-grid gegraven en de groeiring heeft daarna het
   zeewaartse einde dichtgegooid. Een zandstrook van twee cellen scheidt hem van de zee: (150,286)
   h=0,01, (151,286) h=0,11 en (152,285), waar de kraan staat. Gemeten: rivier plus vaargeul is één
   afgesloten lichaam van 375 cellen (x137..189, z184..286), en elke cel ervan was vóór de groei
   open zee. `accrete` (`shared/terrain.mjs`) spaart alleen rivierloop-cellen (`keep`) en geen
   vaargeul, en `growStep`/`doomedBy` (`lib/layout.mjs`) controleren nooit of de vaargeul nog
   uitkomt in zee.
2. **Plassen zee na groei.** Naast dat lichaam zijn er acht afgesloten stukken zee die een groeiring
   insloot (249 cellen: o.a. 112 cellen bij x278..300, z218..232, en 58, 46, 18 en 11 cellen), plus
   het meertje van het stichtingseiland zelf (14 cellen, dat was altijd al dicht). Een eerdere
   verkenning telde 7 ringplassen met 247 cellen; het verschil zit in de telling (4-buren
   hier, en welke kleine stukjes meetellen), niet in de diagnose. Oorzaak: `accrete` vult wat het
   kan bereiken en ziet lagunes en smalle landtongen van de kustvorm niet, en er is geen tweede
   flood ná het opbouwen. `isWater` middelt de vier hoeken, dus een balk van 0,0 tot 0,1 naast
   negatieve hoeken sluit water in. `hold` heeft er niets mee te maken.
3. **De quay zelf is "een gat in een heuvel".** `parcelWaterField` (`shared/quay-basin.mjs`) graaft
   het hele quay-perceel uit tot bassin, ongeacht wat er staat. Live: het perceel is 224 cellen
   (x155..166, z267..290) plus een ring van één cel is 300 cellen (x154..167, z266..291). Daarvan
   liggen er 297 op land, 254 waren vóór de groei open zee, en de randen zijn tot 1,66 hoog
   (gemiddeld 0,81). Het bassin heeft maar een paar stukken rand tegen water. De tests draaien
   alleen op vlak terrein (1,6) zonder groei. Daarbij:
   - de approach-weg komt 0,66 te hoog binnen op het dek;
   - het pakhuis kijkt met de deur naar water en zijn weg bereikt de achterkant;
   - de haven-diepte is overal ongeveer -0,02 tot -0,28, dus ondiep.

Alle drie hebben dezelfde wortel: **een groeiring wordt getekend zonder te weten wat er aan water,
haven en kade aan hangt**, en de quay zoekt zijn plek steeds opnieuw uit (`unsettleQuay` in
`growStep`). Dat komt overeen met het idee van de keeper: één vaste kuststrook waar de quay komt
en waar het eiland nooit meer wordt uitgebreid.

Nog niet bevestigd: hoe de basin-rand er in beeld uitziet (een mogelijke naad tussen bassin en
grondmesh) en of `village.json` tijdens een herstart kort zonder quay was. Fase 0 kijkt dat na.

## Besluiten

- **De haven wordt de onderloop van het stroompje, de rivierdelta.** De kade komt aan beide oevers
  (twee verbonden delen). De bestaande live-island wordt gemigreerd.
- **Een stap of polder is sticky en beïnvloedt de terreinhash.** Een nieuwe vorm krijgt een nieuwe
  versie naast de oude, nooit een edit (zoals `RELIEF_VERSION`), zodat elk bestaand eiland zichzelf
  blijft herkennen. Elke nieuwe grondlijst wordt met het *fairway-patroon* meegegeven aan alles wat
  grond of water bouwt (`layout.mjs`, `survey.mjs`, `plan.mjs`, `garden.mjs`, `fleet.mjs`,
  `islandbundle.mjs`, `web/js/main.js` incl. `groundSig`, `scan.mjs`, `guest-island.js`, `world.js`),
  niet opnieuw uitgevonden.
- **Nieuw veld in `layout.json` is een minor.** Een oudere zee weigert een island met een andere
  terreinhash, dus de open zee (stack 28) moet met deze code redeployed zijn voor iemand het merkt.
- **Kleinste poort die de klus doet:** de migratie loopt via `QUAY_VERSION` (`migrateQuay`), geen
  `LAYOUT_VERSION`.
- **Meten vóór bouwen.** `tests/support/water-bodies.mjs` (waterlichamen, afgesloten lichamen,
  of de vaargeul open is) en `tools/measure-water.mjs` zijn de meetlat voor elke fase; de tests
  van de latere fasen importeren de helper.

## Fasen (elke fase is los te leveren)

### Fase 0: vastleggen en meten

- Dit plan.
- `tests/support/water-bodies.mjs` (met `tests/water-bodies.test.mjs`) en `tools/measure-water.mjs`,
  te draaien op een **kopie** van `~/.promptholm` via `PROMPTHOLM_HOME` (met `multiplayer.sea` op
  `single` in die kopie). Op de live-island geeft het: terreinhash gelijk, 11 lichamen waarvan 10
  afgesloten (638 cellen; 624 daarvan waren vóór de groei open zee), vaargeul landlocked, en een
  quay-parcel dat vrijwel geheel onder het maaiveld zou worden gegraven.
- Nog te doen: bevestigen of de basin-rand en de stale village zichtbaar stuk zijn (Browser-pane
  op de kopie).

### Fase 1: groei breekt geen water meer (lost 1 en 2 op voor elk eiland)

Nieuwe groeiversie voor stappen die vanaf nu gezet worden (een `relief`-achtige opt-in, bijvoorbeeld
`water: 1`, geschreven door `growStep`):

- `accrete` krijgt `keep` = rivierloop **plus vaargeul plus de corridor tot open water**, zodat een
  ring de geul nooit dichtgooit (`growStep` geeft `layout.fairway` door aan de stap).
- Na het opbouwen een tweede flood vanaf de rand: stapgemaakt water dat niet met open zee is
  verbonden wordt opgehoogd tot `GROW_SHORE`. Precedent: `enclosedWater` en `p.pools`.
- `growStep` controleert na afloop of de vaargeul nog bij open water komt; zo niet, dan wordt hij
  verlengd (zie fase 3, reparatie).

Bestaande stappen (zoals de live-stap zonder `relief`) kunnen niet meer veranderen. Daar komt een
sticky reparatie op layout-niveau: `layout.pools` vult de ringplassen (een lijst naast de polders,
hash direct na het vullen opnieuw vastgelegd), en `layout.fairway` wordt uitgebreid tot de zee.

### Fase 2: een vaste haven-strook, `layout.fairway.haven` (gebouwd)

**Wat het is.** Een rechte strook zeewater van het zeewaartse einde van de vaargeul (`line[0]`) tot de rand van
het grid: `{ line: [[x0, z0], [x1, z1]], half, from }` in grid-indices. Hij staat IN het fairway-object, zoals
`fairway.fill` uit fase 1, omdat elke plek die grond bouwt de fairway al krijgt (`parseBundle` strikt, `growCanvas`,
village.json en dus elke pagina): geen dertig nieuwe plekken. `undefined` = nog niet gevraagd, `null` = gevraagd en
geen kanaal om vanaf te beginnen (het fairway-onderscheid tegen een zoekactie op elke scan).

- **Een straal, geen lijnstuk.** `line[1]` geeft alleen de richting; `growCanvas` schuift beide cellen en de strook
  loopt door de nieuwe zee voorbij de oude rand. Een lijnstuk had daar geëindigd en de volgende ring had het laatste
  stuk dichtgegooid. Cel-test in gehele getallen (`havenHas`: kruisproduct in het kwadraat tegen `half² · |d|²`, exact,
  geen wortel, geen trigonometrie in `shared/`), met een ronde kap van `half` om het begin.
- **`from`** (afwijking van het eerste ontwerp, dat alleen `{ line, half }` had): het aantal groeistappen op het
  moment van plannen. Een stap vóór `from` is getekend zonder haven en blijft zo: zijn grond zit in de terreinhash.
  Zonder dit zou een haven die na een `water: 1`-stap wordt gepland die stap met terugwerkende kracht anders tekenen.
  Alleen een stap met `water: 1` op index >= `from` leest de strook.
- **Geen hoogte, geen hash.** Plannen schrijft alleen het record; `terrainHash` blijft 9bead8fc op de live-kopie
  (test: hash voor en na gelijk) en er verhuist niets. Een fairway zonder `haven`, een stap zonder `water` en een stap
  vóór `from` tekenen bit voor bit als daarvoor (`tests/haven.test.mjs` plus de goldens in `tests/water-growth.test.mjs`).
- **Groei (`accrete`):** nooit een hoek van de strook ophogen, ook niet na het reliëf, de rivier-doorsnijding en
  `settleWater` (die zet de hoeken van de strook op hun hoogte vóór de stap terug). De meetkunde komt uit de strook,
  niet uit een cellijst: ook de nog niet bestaande ring buiten de kust valt erin. De schouders klimmen weg zoals een
  normale kust (`havenLee`: de afstand tot de strook begrenst de ring met `GROW_RISE` per hoek); zonder dat stond de
  hoek naast de strook, ver van het oude land en dus vrij om naar de hoogte van het grote eiland te stijgen, als een klif
  van drie eenheden naast de zeebodem van de strook. `settleWater` ziet de strook als kanaal: water dat erin afsnijdt krijgt
  zijn baan naar zee en wordt niet opgehoogd.
- **Richting uit het terrein, nooit een windstreek.** Bij het plannen worden 64 peilingen geprobeerd (binnen 75 graden
  van de eigen peiling van de vaargeul als er niets vast te houden is, anders rondom) en wint de peiling die vasthoudt
  wat de kade nodig heeft over de minste cellen land, met een kleine prijs voor wegdraaien. `tests/haven.test.mjs`
  plant hem op 17 seeds met monden aan alle vier de kusten: de strook begint bij de monding, loopt van het eiland af naar
  de gridrand en is langs zijn as voor minstens 85% water. Live is het bijna recht naar het zuiden; een rivier aan de
  noord- of oostkust geeft een strook naar het noorden of oosten.
- **Wat hij moet vasthouden** (`havenWanted`): de planken, de slip en de wal van de haven(s) en het quay-district
  binnen 26 cellen van het begin, elke ligplaats (`mooringsFor`), de kraan en de ligplaats van het galjoen (`shipBerth`,
  binnen 40 cellen). *Zacht*, alleen als het hooguit `HAVEN_SOFT_EXTRA` (2) cellen halve breedte kost: de kavels op
  zee in de buurt (de werf en de schepen, `afloat`). `half` is de gemeten breedte van de baai (mediaan van de
  waterstrook dwars op de as over de eerste 30 cellen, open zee niet meegeteld) of wat het vasthouden nodig heeft,
  tussen `HAVEN_HALF_MIN` 3 (zeven breed: de vaargeul is vijf) en `HAVEN_HALF_MAX` 8.
- **Bouwverbod.** Land dat al in de strook ligt (het zandtongetje en de kraan) blijft
  zoals het is. Wat niet meer kan: een polder erin. `keptWater` (de ladder en de survey) en `opPolder` (de hand van de
  keeper) houden de strook plus een ring van één cel als water, zoals een schip; `fillRingPonds` vult nooit een vijver
  die de strook raakt. `doomedBy` en `growStep` zijn niet aangepast: ze hoeven niets te weten, want de ring laat de
  planken, de kraan en de ligplaatsen in open water liggen. `unsettleQuay` en `migrateQuay` zijn niet aangeraakt.

**Gemeten op een kopie van de live-island** (terreinhash 9bead8fc; scan: `otherMoved` leeg en de tweede scan is een
no-op): de strook is `(151,287) -> (157,351)`, `half` 6 (13 breed, gelijk aan de baai), 700 cellen water en 133 land,
`from` 1. Eén extra ring (r 180, grid 352 -> 384) op dezelfde kopie:

| | zonder strook | met strook |
|---|---|---|
| kadehuizen | 9 weg | 9 blijven |
| kade, pier, kraan, pakhuis | alle vier weg | blijven |
| werf | weg | weg (de slip ligt 5 cellen buiten wat de kade nodig heeft) |
| andere kusten (vuurtoren, visserij, weeghuis, 3 schepen) | weg | weg (niet van deze strook) |
| cellen van de strook die zee waren en land zijn geworden | n.v.t. | 0 |
| ringplassen erbij / vaargeul open | 0 / ja | 0 / ja |
| waterbreedte door de nieuwe ring (oude baai 13) | dicht | 13 tot 14 |
| paden | 361 -> 240 | 361 -> 241 |

### Besluiten rond de strook (voor fase 3 en latere sessies)

- **De twee oevers hebben een vaste rol, afgeleid en niet opgeslagen.** De kade-oever is de oever waar het
  quay-district (planken, pier, kadehuizen) staat; de andere oever is de *piraten-oever* voor een piraten-taverne en de
  grote schepen (het galjoen, de Batavia-werf) in een latere fase. `havenBank(haven, cel, quayCel)` en
  `havenBanks(...)` (shared/terrain.mjs) geven `'quay' | 'pirate' | null` uit de kant van de as, met de kade als
  referentiekant; alleen lezen, er wordt niets gereserveerd of geplaatst. Live: alle 9 kadehuizen op de kade-oever,
  0 op de piraten-oever; de piraten-oever heeft 152 vrije droge cellen binnen
  15 van de strook, 140 daarvan in de eerste 15 cellen van de inham (de kade-oever 318 en 234). Open vraag: welke oever de
  taverne krijgt. Volgens deze regel de verre (de piraten-oever), en dat is ook waar de werf al staat.
- **De brug** komt aan de kop van de inham waar rivier en vaargeul de baai instromen, op het smalste stuk (ongeveer twee
  tot drie cellen water), en verbindt beide oevers. Niet gebouwd (fase 3). `havenBridgeSite(terrain, fairway)`
  wijst de plek aan: stroomopwaarts vanaf het landwaartse einde van de vaargeul de eerste dwarsdoorsnede van de langste
  rivier die hooguit 3 cellen water breed is met droog op beide oevers. Live: cel (147,267), dek langs x, breedte 3.
- **De werf** valt buiten de strook en wordt door de ring verplaatst, net als de schepen op de westkust; `placeAll` zet
  hem opnieuw neer. Wil de keeper de werf wel vasthouden, dan kan dat door `HAVEN_SOFT_EXTRA` te verhogen: met half 9
  houdt de strook ook de werf vast, maar hij wordt 19 breed en de waterbreedte door de ring 21 tot 29.

### Fase 3: de haven zelf, kade aan beide oevers

- **Vaargeul:** `planFairway` blijft het model (`FAIRWAY_HALF = 2`, 5 breed, `FAIRWAY_UP` = 10 cellen
  rivier). Stroomopwaarts blijft de rivier zo breed als ze is (ongeveer 2 cellen), en dat is precies
  wat de boogbrug overspant (`ARCH_OPEN`). De brug komt op dat smalle stuk, direct stroomopwaarts van
  de kade. `planBridge` en `opRoad` bouwen niet in de haven-sectie, zoals nu al voor de vaargeul.
- **Reparatie van een bestaande vaargeul:** een `repairFairway`-stap in `placeAll`, voor elk eiland:
  als het zeewaartse einde niet met open zee is verbonden, de lijn verlengen met `planFairway`,
  cellen toevoegen aan `layout.fairway.cells` en de hash direct na het graven opnieuw vastleggen
  (zoals bij polder-digging). Live: de landtong bij (150..152, 285..286) doorsteken; de kraan op
  (152,285) verhuist daarvoor één keer via `doomedBy`.
- **Quay op de oevers, niet in een put:** het quay-perceel en `parcelWaterField` (het uitgegraven
  bassin) gaan weg. Het water *is* de vaargeul. Kadehuizen staan op de twee oevers, planken
  (`pierCells`) langs de rand, deuren naar de geul, op het dek (0,44) met een echte oprit waar het
  wegdek de kade ontmoet. Geen `basin` meer, dus ook geen 1,6 diepe randen en geen naad. Het
  quay-district kiest zijn plek uit `layout.fairway.haven` (in plaats van `pickPier`/`nearestHarbour`); de
  bestaande `pickPier`-logica blijft voor de andere drie havens.
- **Pakhuis en weegbrug:** `harbourSite` neemt alleen een lot aan waarvan de deurtrede land of kade
  is (nu: deur naar water, weg naar de achterkant).
- **Diepte:** de haven-sectie krijgt een minimum bedhoogte (bijvoorbeeld `CHANNEL_H`) tot de
  aanlegplaatsen en de boeien, zodat boten niet op -0,02 liggen.
- **Twee delen verbonden:** elke oever heeft een dek, verbonden door de boogbrug. De bestaande
  `road:harbour:<n>:approach` wordt aan beide oevers gelegd en de brug sluit aan beide kanten aan.
  Dat sluit aan bij de open plannen `ingangen-en-bruggen` en `ingangen-verplaatsen`; er komt geen
  nieuwe brugsoort.

### Fase 4: migratie van de live-island

`QUAY_VERSION = 3` in `lib/layout.mjs`, via `migrateQuay`: `unsettleQuay` plus een nieuwe quay in
`layout.fairway.haven`, `layout.fairway` verlengd, ringplassen gevuld. Vooraf een back-up, zoals
`layout.before-plan-<ts>.json`. De negen kadehuizen verhuizen (met hun sheds en paden) en komen
opnieuw op de oevers te staan. De keeper wordt vooraf gewaarschuwd.

## Verificatie

1. `node --test "tests/*.test.mjs"` (met `npm install` in een verse worktree). De bestaande
   quay-tests (`quay-district`, `harbours`, `harbour-sites`, `quay-basin`, `layout-grow`,
   `canvas-grow`, `terrain-grow`, `bridge`) blijven groen waar het oude gedrag niet bewust
   verandert.
2. Nieuwe tests, met `tests/support/water-bodies.mjs`: (a) na een groeiring geen afgesloten
   waterlichaam en de vaargeul komt altijd uit in zee, over meerdere seeds en grid-groottes, ook met
   `relief`-stappen; (b) `layout.fairway.haven` blijft bij groei ongewijzigd en niets groeit erin; (c) een
   quay op **hellend** terrein zonder gat; (d) de oude stap (zonder `water: 1`) geeft nog dezelfde
   terreinhash (regressie tegen het live-hash `03aefc04`).
3. `tools/measure-water.mjs` op een kopie van de live-island, van voor naar na: 0 ringplassen,
   vaargeul verbonden, quay-parcel niet onder het maaiveld, `diff.plots.otherMoved` leeg voor alles
   behalve de quay.
4. Zelf kijken op die kopie met `island-worktree` uit `.claude/launch.json`: screenshot van de
   monding met dek, brug en boten, en een loop over de kade vanaf het plein. De echte islander niet
   stoppen tijdens het meten.
5. Pas daarna de echte island migreren (na akkoord) en de server herstarten.

## Risico's en open punten

- De migratie verplaatst kadehuizen op de live-island; dat moet de keeper vooraf weten.
- Fase 1 en 4 raken de hash-keten. Elke stap wordt geverifieerd met de regressietest, anders herkent
  de live-island zichzelf niet meer en plant `loadLayout` alles opnieuw.
- Fase 3 (quay op de oevers in plaats van een pier plus perceel) is de grootste ingreep. Valt hij
  tegen, dan zijn fase 1 plus de reparatie van de vaargeul los te leveren en lossen die de
  zichtbare breuken 1 en 2 al op.
- Het meetscript telt met 4-buren en middelt de vier hoeken zoals `isWater`; getallen uit een
  andere meting (7 ringplassen, 247 cellen) wijken daardoor licht af.

## Kust netjes dichtmaken (review en ontwerp, 30 september 2026)

Tiemen vond het lastig om de kust netjes dicht te krijgen na het uitgraven. Dit hoofdstuk zoekt uit
waarom, meet het op de live-island en stelt één regel voor in plaats van een pleister per plek. Er is
hiervoor geen code veranderd. De meetscripts en kaartjes staan in de scratchpad van de sessie (niet in
de repo), in `C:\Users\Martijn\AppData\Local\Temp\claude\D--git-Martijn-AgentVillage\911e1eaf-f06d-4ca0-87da-48616534b84c\scratchpad\kust\` (`measure.mjs`, `ring.mjs`, `ring2.mjs`,
`lane.mjs`, `purity.mjs`, `proto.mjs`, en `lib.mjs` met een PNG-encoder op `node:zlib`). Ze draaien op
`home-copy-kust`, een kopie van `home-copy-fase1` (terreinhash 9bead8fc, de live-island na fase 1),
en groeien de extra ring alleen in het geheugen.

### Wat er gebeurt aan een gegraven of gevulde rand

Een cel is het gemiddelde van vier hoeken, en elke hoek hoort bij vier cellen. Alles wat de layout
aan grond doet, doet het per cel op een constante hoogte, na de box-blur, zonder afstand of profiel:

| grondwerk | waar | wat het met de hoeken doet |
|---|---|---|
| vaargeul | `dig` in `makeTerrain` (shared/terrain.mjs:1815) | vier hoeken per cel `min` `CHANNEL_H` (-0,55) |
| reparatie (fase 1) | `repairFairway` (lib/layout.mjs:1091) | dezelfde `dig`, cellen achter aan `fairway.cells` |
| ringplas gevuld (fase 1) | `fairway.fill` (shared/terrain.mjs:1811) | vier hoeken per cel `max` `FILL_H` (0,398) |
| plas in een nieuwe ring (fase 1) | `settleWater` (shared/terrain.mjs:1289) | hoeken op `GROW_SHORE`, dezelfde plaat |
| baan door een nieuwe ring (fase 1) | `settleWater` (shared/terrain.mjs:1279) | hoeken terug op hun hoogte vóór de stap |
| haven-strook (fase 2) | `accrete` (shared/terrain.mjs:939) | hoeken van de strook terug op vóór de stap, oever op 0,40 ernaast (`havenLee`) |
| polder, dijk, pools | `setCell` in `makeTerrain` | vlak `POLDER_H` / `DIKE_H` |
| quay-bassin | `shared/quay-basin.mjs` | overlay, niet in de hash: eigen hoogtefunctie over het hele perceel |
| rivier (natuur) | `carveRiver` (shared/terrain.mjs:242) | vallei met profiel naar afstand, `min`, `RIVER_RISE` 1,5 per cel |

De eilandgrond zelf wordt twee keer geblurd (shared/terrain.mjs:1655) en daarna nooit meer: rivieren,
ringen, vaargeul, vullingen en polders komen er allemaal ná. Een blur achteraf kan niet, want die
verandert elke hoek van elk eiland en dus elke terreinhash. Wat per cel gestempeld wordt, is dus
precies zo scherp als de stempel.

### Gemeten (live-island na fase 1, seed 1337, grid 352)

"Trap" is het hoogteverschil tussen een landcel en de watercel ernaast, "helling" is `slope()` van de
landcel aan het water (hoogste min laagste hoek; `BUILD_SLOPE_MAX` is 0,6). "Rafelig" is de lengte
van de kustlijn gedeeld door dezelfde kustlijn na een 5x5-meerderheidsfilter.

| rand | trap mediaan / p90 | helling mediaan / p90 | landcellen aan het water met helling > 0,6 | rafelig | eenlingen land / water |
|---|---|---|---|---|---|
| natuurlijke kust (referentie) | 0,08 / 0,15 | 0,14 / 0,23 | 6 van 1432 | 1,08 | 0 / 0 |
| rivieroever (natuur, smalle vallei) | 0,63 / 0,79 | 1,31 / 2,01 | 164 van 171 | 3,52 | 0 / 0 |
| vaargeul (112 cellen, 2026-09-20) | 0,38 / 0,71 | 0,80 / 1,60 | 27 van 50 | 1,06 | 0 / 0 |
| reparatie-doorsteek (28 cellen) | 0,45 / 0,90 | 1,15 / 1,91 | 11 van 18 | 1,11 | 0 / 0 |
| polder 2 (dijk naar zee) | 0,30 / 0,57 | 0,91 / 1,13 | 14 van 25 | 1,00 | 0 / 0 |
| baan van `settleWater` in een nieuwe ring | 0,25 / 0,47 | 0,79 / 0,99 | 42 van 63 | 1,03 | 0 / 0 |
| oevers van de strook in een nieuwe ring | 0,17 / 0,49 | 0,18 / 0,79 | 24 van 113 | 1,12 | 0 / 0 |
| natuurlijke kust van diezelfde ring | 0,09 / 0,16 | 0,14 / 0,25 | 55 van 1806 | 1,07 | 1 / 0 |

Verder:

- **Het lek van een halve cel.** Een gegraven cel verlaagt vier gedeelde hoeken, dus de buurcel heeft
  twee hoeken op -0,55 en twee op de grond. Van de 30 landburen van de oude vaargeul zijn er **30** water
  geworden, van de 10 van de reparatie **8**. Die randcellen hebben een helling tot 1,91. De geul is dus
  aan elke kant een cel breder dan `fairway.cells` zegt, en die extra cel is een wand.
- **Gevulde plassen zijn tafels.** Alle 247 cellen van `fairway.fill` liggen exact op 0,398, geen
  enkele is strand, en op 195 van de 198 randen staat de vulling hoger dan de grond ernaast (mediaan
  +0,13, max +0,19): een vlakke olijfgroene plaat met een trapje erom, midden in het zand. De plassen
  die `settleWater` in een nieuwe ring ophoogt doen hetzelfde: 208 van 210 randen hoger.
- **Het quay-bassin** (overlay): 297 van de 300 cellen van het masker liggen op land, 204 op wei. Het
  graaft tot 2,49 diep, de getekende helling is p99 1,99 per eenheid tegen 0,22 voor de natuurlijke kust.
- **De strook na één extra ring** (r 180, grid 384): de strook houdt de hoeken op hun hoogte vóór de
  stap, en daar lag in de nieuwe zee de vlakke -2,5 van `embed` (de oude rand van het doek). In de
  ondiepte van de nieuwe ring (-0,4 tot -0,9) ligt nu een rechte geul van -2,5, met een wand onder water
  van -0,44 naar -2,50 over twee cellen (stations 66-78): een donkere liniaal door het lichte water.
  Belangrijker: **de strook is aan zijn kop dicht.** Op stations 16-22 ligt 9 tot 12 cellen land over
  de 13 cellen breedte (het zandtongetje; de strook "laat land dat er al ligt zoals het is", zie
  hierboven). Over water binnen strook en vaargeul kom je vanaf de monding maar 17,5 van de 64 cellen
  ver. `settleWater` graaft daarom tóch een eigen schuine baan naar zee, en er liggen er dan twee (zie
  `5-ring-met-strook.png`). De meting "waterbreedte door de nieuwe ring 13 tot 14" klopte, maar ging
  alleen over de ring.
- **Eenlingen en dambordjes zijn geen probleem**: 0 in elke rand. Rafeligheid ook niet (1,03 tot 1,12,
  gelijk aan de natuur). Het probleem is het *profiel*: waar de natuurlijke kust over enkele cellen
  van zee via strand naar wei loopt, springt elke gegraven of gevulde rand dat in één cel.
- **Kleuren versterken het.** De grond kleurt per hoek (`bandColour`, web/js/world.js:139: harde
  grens op -0,6 en 0,35, met een crossfade 0,25-0,6), het water op diepte (`smoothstep(-2, -0,1)` en
  branding `smoothstep(-0,65, 0,02)`, world.js:1942/1954). Een wand van één cel wordt dus een
  brandingslijn langs een liniaal, en een geul van -2,5 een donkere streep.

Kaartjes (in `scratchpad\kust\`; zwarte lijn = waar `isWater` per cel omslaat, dus wat de layout ziet):

- `0-eiland.png` het hele eiland met vaargeul (rood), vulling (oranje), bassin (wit), strook (cyaan).
- `1b-monding-voor-fase1.png` en `1-monding-grond.png` de monding voor en na fase 1 (rood oude geul,
  magenta reparatie, wit bassin-masker, cyaan strook). `2-monding-met-bassin.png` dezelfde plek zoals
  het bassin hem tekent: een rechthoekige put in de heuvel.
- `3b-plas-voor-fase1.png` en `3-gevulde-plas.png` de grootste ringplas (112 cellen) voor en na: de tafel.
- `4-polder0..2.png` de polders; polder 2 is door de ring ingesloten, een verzonken bak met een wal.
- `5c-voor-de-ring.png`, `5-ring-met-strook.png`, `5b-ring-zonder-strook.png` de extra ring: de strook
  als rechte donkere geul met het tongetje aan zijn kop, en de schuine baan van `settleWater` ernaast.
  `7-lane-zonder-strook.png` die baan ingezoomd, met de opgehoogde plassen (oranje) als tafels.
- `8-voorstel-monding-profiel.png` en `9-voorstel-plas-ingekleurd.png`: het voorstel hieronder, als
  prototype op dezelfde grond.

### Wat Tiemen eerder vond

- Het bassin is eerst in de grond gegraven, als "de polder achterstevoren" met `BASIN_H = -80/256`
  (a50c500, 2026-09-18, tak `feature/de-haven`, nooit op main). In `docs/next/de-haven.md` (480302a)
  schreef hij de twee valkuilen op die "zwijgend toeslaan": een terreinwijziging die het dorp wist
  (`placeAll` gooit de layout weg bij een andere hash, en een oudere server op een nieuwere layout doet
  dat ook), en een bekken dat de zee niet raakt (dan geeft de quay elke scan zijn planken terug).
- Op main werd het daarom een overlay die de hash niet raakt (f47bcc8, 2026-09-22): "A harbour basin is
  an overlay on the saved terrain, not a terrain migration" (shared/quay-basin.mjs:3). Mooi getekend,
  maar de layout ziet land waar de pagina water tekent (297 van 300 cellen).
- De kust zelf is eerder in de *verf* opgelost, niet in de grond: "shared/terrain.mjs is untouched on
  purpose ... what moved is the painting, not the rule" (48d9e3c, het duin in plaats van een contourlijn).
- De vaargeul mag bewust geen land in: "planFairway weigert elke cel ... die het eiland land noemt,
  zodat een geul nooit een kanaal door een heuvel wordt" (88605a7). Een stempel per cel door land
  geeft precies dat kanaal met wanden.
- Groei: de eerste versie hield alle bouwgrond vast en liet "jaarringen" achter
  (Plans/DONE/eiland-laten-groeien.md:225-227); een dijk die op één plek nog zee raakt blijft helemaal
  staan (:474); de pools achter een dijk kwamen niet in de bundel en dan weigert elke zee het eiland
  (2bec709). Elke nieuwe grondlijst moest op dertig plekken mee.

De rode draad: omdat alles plakkerig is en in de hash zit, is elke oplossing tot nu toe óf een stempel
op zijn eigen plek in de volgorde van `makeTerrain` geworden, óf naar de verf of een overlay geschoven
om de hash te ontlopen. Een gedeelde regel voor "hoe ziet een rand eruit" is er nooit geweest.

### Review van de niet-gecommitte fase 0/1/2 (ernstig eerst)

1. **De strook sluit zijn eigen kop niet open** (shared/terrain.mjs:939, dit plan "Bouwverbod"). Hij
   houdt vast wat er ligt, en aan de kop ligt het tongetje dwars over de strook. Na een ring loopt het
   water van de monding maar 17,5 van de 64 cellen de strook in, en graaft `settleWater` een tweede
   kanaal. Een haven die bij de eerstvolgende ring niet naar zee loopt, doet niet wat hij belooft.
2. **"Terug naar vóór de stap" is de verkeerde regel voor water dat water moet blijven** (strook
   :939, baan :1279). Vóór de stap lag daar diepe zee (tot -2,5, de vulling van `embed`), en de ring
   hoogt de omgeving op tot zijn eigen zeebodem (-0,4 tot -1). Het resultaat is een geul met wanden onder
   water, en boven water een oever van 0,40 direct naast een hoek van -1 of dieper.
3. **Vullingen zijn vlakke platen op `FILL_H`, banen zijn rechte kanalen** (:1289, :1811, :1279). Het
   ziet er nu al slecht uit en het wordt bevroren: een stap met `water: 1` tekent voor altijd zo.
   **Nog geen enkel echt eiland heeft een `water`-stap, een `fill` of een `haven`** (alleen de kopieën
   in de scratchpad). Dit is dus het moment om te veranderen wat `water: 1` betekent, zonder tweede
   versie ernaast.
4. **Een `water: 1`-stap hangt af van de vaargeul van vandaag, niet van die op het moment van de stap**
   (`dugCopy`/`inFairway` in `settleWater`, :1198/:1216). Het argument in het commentaar (:1111, "een
   vaargeul die nu open is, was eerder ook open") dekt alleen de baan, niet de vulling. Gemeten
   (`purity.mjs`): dezelfde stap met de vaargeul zonder zijn latere cellen verandert **160 cellen** ver
   van de geul van water naar land. Omgekeerd, en zo gaat het echt (een klein gesticht eiland groeit
   vóór 25 inwoners, daarna graaft `planFairway` of groeit `repairFairway` de geul), wordt land van een
   oudere stap water, ook onder huizen die er al staan. De hash wordt in dezelfde pas opnieuw
   vastgelegd, dus niemand merkt het: "a house never moves" breekt stil. Oplossing: wat een stap leest,
   legt hij vast op de stap (zoals `hold`, en zoals de polder zijn `pools`: "decided once in
   lib/layout.mjs and written into the polder, never worked out here").
5. **Oudere code op dezelfde HOME wist het dorp, zonder back-up** (lib/layout.mjs:3684 en
   `resetForNewTerrain` :3338). Oudere code negeert `fill` en `water` stil, bouwt andere grond, vindt een
   andere hash en plant alles opnieuw. De live-island krijgt `fill` al bij de eerste scan met deze code,
   niet pas bij groei. Een release en een checkout delen `~/.promptholm`. Dus: minor-release (dat stond
   er al), een back-up (`layout.before-works-<ts>.json`) vóór de eerste hash-verandering, en voortaan
   onbekende velden in een stap of grondwerk laten *weigeren* door `makeTerrain` (zoals `checkGrow` al
   doet met een onbekende `relief`). Dan gooit de volgende toevoeging een fout in deze code, in plaats
   van dat het dorp opnieuw gesticht wordt.
6. **Oudere zeeën en pagina's.** `parseBundle` van een oude zee bouwt de vaargeul veld voor veld op
   (`{ line, cells }`) en laat `fill` en `haven` vallen, en de groeistap laat `water` vallen. Hij rekent de
   hash na en weigert het eiland. Een oude pagina tekent zonder vulling en toont de skew-banner. De open
   zee (stack 28, handmatig) moet dus met deze code draaien voordat de live-island zijn nieuwe hash
   publiceert.
7. **`fill` en `haven` in het fairway-object** (lib/layout.mjs:1215, web/js/history.js:97). Het scheelt
   dertig plekken, maar het koppelt twee dingen aan de geul die er niets mee te maken hebben:
   `fillRingPonds` wacht op een geul (een eiland met `fairway: null` houdt zijn plassen), en de kroniek
   geeft vóór de datum van de geul `fairway: null` terug. Dan staan de plassen weer open en tekent een
   latere ring zonder strook. `groundSig` (main.js:5403) en de sleutel van de tuin laten `haven` weg; dat
   klopt alleen zolang `haven` nooit verandert.
8. **`planHaven` draait vóór er havens zijn** (lib/layout.mjs:3743). De geul wordt bij 25 inwoners
   gegraven, in dezelfde scan als de strook, en de havens en de quay komen later. Op een nieuw eiland kiest
   de strook dus blind een richting en houdt die voor altijd, en daarna kiest de quay zijn plek zonder de
   strook. Alleen de live-island, die achteraf zijn strook krijgt, heeft er wat aan. Fase 3 moet dit
   omdraaien: de quay komt uit de haven, niet andersom.
9. Klein: `repairFairway` en `fillRingPonds` leggen de hash correct vast (:1183 en in `growStep` :3660),
   en `haven` zit overal waar grond gebouwd wordt (bundel strikt, `growCanvas`, village.json, plan en
   survey via `keptWater`/`opPolder`). Daar zit het probleem niet.

"Accretion never lowers anything" klopt nog: de baan en de strook zetten hoeken hooguit terug op hun
hoogte vóór de stap, nooit lager. Het probleem is dat "terug op vóór" zelf de verkeerde vorm geeft (punt 2).

### Het ontwerp: grondwerk met een profiel

**Eén regel voor elke rand die de mens maakt: een grondwerk is een masker (cellen, wat de layout
beslist) plus een profiel naar afstand (wat de grond ervan maakt), toegepast met `min` of `max`, nooit
als stempel op een vaste hoogte.** Precies wat `carveRiver` al doet ("never up: `min` is what makes the
same numbers cut a ravine on the hill and no more than a dip on the coastal plain"), met een ander
profiel. Drie soorten, in `shared/terrain.mjs`, trig-vrij (alleen `Math.sqrt`, dat `distTo` al gebruikt),
gekwantiseerd op 1/256:

- **Graven** (`min`): `H = min(H, P(d))`, met `d` de afstand van de hoek tot het masker en `P`:
  vlakke bodem `CHANNEL_H` in het masker, een onderwateroever tot de waterlijn (0,35 per cel), dan
  **strand over een vaste breedte** van 0 tot `BEACH_MAX` (3 cellen, 0,12 per cel), dan de landoever
  (0,3 per cel) tot hij de grond raakt. Zo ontstaat altijd een strand, op zand graaft hij bijna niets
  buiten het masker, en tegen een heuvel komt er een helling in plaats van een wand. Voor vaargeul,
  reparatie, haven-kop en kadekant.
- **Openhouden in een ring** (`min` met een ondergrens): `H = min(ring, max(vóór, P(d)))`. De ring mag
  niet boven het waterprofiel komen, en nooit onder de grond van vóór de stap. Waar de ring zijn eigen
  zeebodem al dieper legde dan het profiel, blijft die staan: geen geul van -2,5. "Accretion never
  lowers anything" blijft letterlijk waar: `min(ring, x)` met `x >= vóór` ligt nooit onder `vóór`. Voor
  de baan van `settleWater` en de doorloop van de haven.
- **Vullen** (`max`): de hoeken van het masker worden ingekleurd vanaf de rand (een vast aantal
  Jacobi-rondes op het gemiddelde van vier buren, met de rand vast), met als ondergrens net droog
  (12/256). De plas wordt de grond die er had gelegen: zand als de rand zand is. Dat is eerlijk (een
  drooggevallen lagune is een zandplaat) en kost bouwgrond ten opzichte van `FILL_H`.

Een bijkomend effect: het masker plus het bereik van het profiel is de *voetafdruk*. De planner houdt
die vrij (`held`), zoals `dredgeHeld` nu al een cel afstand houdt tot alles wat staat. Het lek van een
halve cel bestaat dan niet meer, want de oever is geen toeval van gedeelde hoeken maar het profiel zelf.

**Prototype op de live-grond** (`proto.mjs`, alleen in het geheugen: dezelfde 140 vaargeulcellen met
profiel, dezelfde 247 vulcellen ingekleurd):

| | nu | met profiel |
|---|---|---|
| trap mediaan / p90 langs de geul | 0,36 / 0,70 | 0,12 / 0,24 |
| helling mediaan / p90 van landcellen aan de geul | 0,27 / 1,57 | 0,16 / 0,24 |
| landcellen aan de geul met helling > 0,6 | 30 | 3 |
| vulranden waar de vulling hoger staat | 195 / 198 | 0 / 198 |
| vulcellen die water blijven | 0 | 0 |
| cellen extra water (de oevers zijn breder) | | 66 |
| plots waarvan het profiel een hoek zou verlagen | | 5 (3 huizen, werf, kraan) |

Met profiel lijkt de geul op de natuurlijke kust (trap p90 0,15, helling p90 0,23). De prijs staat in de onderste twee
regels: de oevers nemen ruimte. Daarom wordt de **bestaande** geul van de live-island (in hash 03aefc04)
níet opnieuw geprofileerd. Het profiel geldt voor nieuw grondwerk, en klemt nooit een hoek van iets
wat staat (zoals `hold`). Daar blijft dan hooguit plaatselijk een steil stukje over.

**Afgewogen en niet gekozen:**

- *Alleen in de verf of een overlay* (de lijn van 48d9e3c en het bassin): raakt de hash niet, maar de
  layout, de zee (die loopt op de grond van de bundel) en de boten zien dan iets anders dan de pagina
  tekent. Goed voor kleur, niet voor waar water is.
- *Een lokale blur achteraf* over de gewerkte band: eenvoudig, maar onbeheersbaar. Een blur tilt de
  bodem van een smalle geul door de heuvel boven 0 (dan is hij dicht), verplaatst de waterlijn op een
  manier die je per ronde opnieuw moet controleren, en botst met "nooit verlagen" in een ring. Het
  inkleuren van een vulling is wel een begrensde blur, en die blijft.
- *Morfologisch open/close op cellen*: gemeten is er niets om te repareren (0 eenlingen, 0 dambordjes,
  rafeligheid gelijk aan de natuur). Wordt een assertie in de tests, geen mechanisme.
- *Een rechte strook als vorm van de haven* (de half-af fase 2): recht is prima voor een doorgebaggerde
  geul door nieuwe grond, maar als definitie van de haven zelf past hij niet op de baai die er ligt (133
  cellen land erin, dicht aan de kop), en "vasthouden wat er was" gaf de wanden en de geul van -2,5.

### Versies en hash

- **Niets hiervan is bevroren.** Geen echt eiland heeft een `water`-stap, een `fill` of een `haven`. Dus
  `WATER_VERSION` blijft 1 met de nieuwe betekenis, en de goldens van `water: 1` in
  `tests/water-growth.test.mjs` worden opnieuw vastgelegd. De goldens van de oude stap (03aefc04,
  `tests/support/hoogezand-ground.mjs`) blijven staan: een stap zonder `water` tekent bit voor bit als
  voorheen.
- **Beslissingen op de stap, niet in de terrain afgeleid** (punt 4). `growStep` rekent uit welke banen en
  plassen de ring krijgt en legt ze vast op de stap (`lane`, `ponds`, in lokale coördinaten zoals
  `hold`). `makeTerrain` past ze alleen toe, met het profiel. Een stap hangt dan alleen van zichzelf af, en
  een latere vaargeul verandert geen oude ring meer.
- **Eén nieuw veld voor al het grondwerk: `layout.works`** (voorkeur), met `{ v, dig, fill, haven }`,
  meegegeven als `works` aan elke `makeTerrain` zoals `grow`. Dat zijn eenmalig dertig plekken (de lijst
  van fase 2 van eiland-laten-groeien: layout, plan, survey, garden, fleet, islandbundle strikt,
  village.json, main.js incl. `groundSig` en de kroniek, guest-island, animal-places). Een test leest
  de bron na op elke `makeTerrain(`-aanroep zonder `works`, zodat "één plek vergeten" (2bec709) niet
  meer stil kan. Het alternatief, alles in het fairway-object laten (zoals nu), is verdedigbaar als
  `fillRingPonds` niet meer op een geul wacht en de kroniek `fill`/`haven` niet meer met de geul dateert.
  Maar dan betaal je die koppeling bij elk volgend grondwerk opnieuw.
- **Volgorde in `makeTerrain`**: grond, blur, rivieren, ringen (met hun eigen `lane`/`ponds` op profiel),
  de oude stempel van `fairway.cells` (ongewijzigd, voor de hash van wat er al is), dan `works` (vullen,
  daarna graven, zodat een vulling nooit een geul optilt), dan de polders (de dijk wint).
- **De hash van de live-island verandert één keer**, in de scan die `works` voor het eerst schrijft (de
  reparatie en de vulling van nu). Die legt de hash in dezelfde pas vast, met een back-up ervoor. Een
  minor-release. De open zee moet met deze code draaien voor die scan.

### Stappenplan

**Fase 1, overdoen (grotendeels herbruikbaar):**

1. `shared/terrain.mjs`: `profileDig`, `profileKeep`, `profileFill` (de drie soorten hierboven) met
   tests op synthetische grond. Helling van landcellen aan het water p90 ≤ 0,3 in de gewerkte band, 0
   eenlingen, `isWater` exact zoals verwacht, en identiek in Node en browser (geen trig, 1/256).
2. `settleWater` houdt zijn skelet (open water, lichamen, rondes, `belongs`, de BFS van de baan). Alleen
   de vorm verandert: de baan wordt `profileKeep`, de plas `profileFill`. De beslissing verhuist naar
   `growStep`, dat `lane`/`ponds` op de stap vastlegt.
3. `repairFairway` en `fillRingPonds` houden hun zoekwerk (Dijkstra, `DREDGE_LIFTS`, `liftCivics`,
   plassen van de ring zonder die van de stichting) en schrijven naar `works.dig` en `works.fill`, met het
   profiel. Back-up vóór de eerste hash-verandering. `makeTerrain` weigert onbekende velden in stap en `works`.
4. Opnieuw meten met `measure.mjs`/`ring.mjs`. Doel: gewerkte randen binnen 2x de natuurlijke kust
   (trap p90 ≤ 0,3, helling p90 ≤ 0,5), vulranden die hoger staan ≤ 5%, en `purity.mjs` op 0.

**Fase 2, de haven (houden, aanpassen, weggooien):**

- *Houden*: de strikte bundel en `growCanvas`, `from`, `havenWanted` (hard/zacht), de score van
  `chooseHaven` (om de richting te kiezen), `bayWidth` (voor `half`), `havenBank`/`havenBanks`,
  `havenBridgeSite` (goed zoals hij is), de haken in `keptWater`/`opPolder`/`fillRingPonds`, en
  `tests/support/hoogezand-quay.mjs`.
- *Aanpassen*: de haven is **de inham zoals hij er ligt** plus zijn doorloop. `works.haven = { cells, half,
  dir, from }`: `cells` is het water van de inham bij het plannen (flood vanaf de monding, begrensd door
  de gemeten baaibreedte), `dir` een richting in hele getallen. Bij het plannen wordt de kop één keer
  opengegraven met `profileDig` door wat lager ligt dan `BEACH_MAX` (het tongetje; de kraan via
  `liftCivics`, zoals de reparatie). Zo loopt het water echt door. Elke latere ring (`water: 1`, index ≥
  `from`) houdt de inham open met `profileKeep`, en zet hem door de nieuwe grond voort als een rechte
  geul van `2·half+1` breed langs `dir` (hier mag de straal van nu blijven, als *welke cellen*), ook met
  `profileKeep`. Geen wand, geen -2,5.
- *Weggooien*: de hoogte-regel van de strook (het terugzetten op `before` op :939, `havenCorners`,
  `havenLee`), de belofte "geen hoogte, geen hash" (de kop moet gegraven worden), en `planHaven` vóór de
  havens (punt 8). Op een nieuw eiland wordt de haven gepland zodra er een geul is, en daarna kiezen de
  quay en de kadehaven hun plek uit de haven.

**Fase 3, kade langs de oever en de brug:**

- De kade is het enige grondwerk dat wél een scherpe rand wil: een **kademuur**. Aan de waterkant
  `profileDig` tot `CHANNEL_H`, zodat boten niet op -0,02 liggen. Aan de landkant `max` naar een vlakke
  schort op `BASIN_DECK` (0,44), twee à drie cellen breed, langs de oeverlijn van de kade-oever. De wand
  valt op een celrand en wordt afgedekt met de stenen rand en de trappen die `web/js/quay-basin.js` al
  tekent. Kadehuizen staan op die schort op dekhoogte, dus zonder `HARBOUR_PIN`. De weg komt op
  maaiveld binnen, want de schort ligt op ongeveer grondhoogte.
- `parcelWaterField`/`quayWaterField`, de shader-discard en het perceel-als-bassin verdwijnen. De
  voetafdruk van het profiel is `held`. De kade-oever volgt uit `havenBank` (afgeleid, niet opgeslagen).
- De brug komt op `havenBridgeSite` (live (147,267), dek langs x, 3 breed; past `ARCH_OPEN`) als een
  gewone `layout.bridges`-record, aangesloten op de approach-wegen van beide oevers.
- De piraten-oever: er wordt niets gebouwd of gereserveerd behalve de voetafdruk van het haven-profiel
  (de oeverhelling). Die band moet de sessie van de piraten-taverne kennen en vrijlaten. Dat afstemmen,
  en dit plan niet laten bouwen op die oever.

**Fase 4** blijft zoals beschreven (`QUAY_VERSION` 3, back-up, de keeper vooraf waarschuwen). Met één
toevoeging: de migratie voegt `works` toe, en de eerste scan daarna is weer een no-op
(`diff.plots.otherMoved` leeg).

## Uitvoering: profielen, `works` en de haven als trechter (30 september 2026)

Gebouwd volgens "Het ontwerp: grondwerk met een profiel" hierboven, met de keuzes van de keeper van
30 september (A: profielen, B: de review-fixes, C: de haven is een trechter). Niet gecommit. Fase 2 is
als trechter gebouwd; de vorm (parameters hieronder) wacht nog op het akkoord van de keeper op de preview.

### Wat er nu is

- **Profielen** (shared/terrain.mjs): `workProfile` (bodem `CHANNEL_H`, onderwateroever 0,35/cel, 3 cellen
  strand tot BEACH_MAX, landoever 0,3/cel), `cornerDistance2` (exacte afstandstransformatie op het
  hoekenrooster: de afstand van een hoek tot een celvierkant is altijd die tot een van zijn hoeken),
  `profileDig` (`min`, met een `fixed`-masker dat nooit zakt), `profileKeep` (`min(ring, max(vóór, P))`) en
  `profileFill` (256 vaste Jacobi-rondes vanaf de rand, nooit onder 12/256, `max`). Geen trig, 1/256.
- **Beslissingen op de stap.** Een stap met `water: 1` draagt `lane`, `ponds` en (na het plannen van de
  haven) `haven`, lokaal zoals `hold`. `growStep` laat ze beslissen via de nieuwe `settle`-optie van
  `makeTerrain` (`settleRing`, elke ronde getekend met dezelfde `ringWater` die een latere tekening
  gebruikt, dus wat vastgelegd wordt tekent precies wat beoordeeld is). `purity` is nu 0: een stap tekent
  hetzelfde met of zonder de vaargeul van vandaag (test).
- **`layout.works = { v, dig: [{ cells, hold }], fill, haven }`**, top-level, meegegeven als `works` aan
  elke `makeTerrain` (30 plekken; `tests/works-everywhere.test.mjs` leest de bron na). `fairway.fill` en
  `fairway.haven` zijn weg. Volgorde in `makeTerrain`: ringen (met hun lane/ponds/haven), de oude stempel
  van `fairway.cells` (ongewijzigd, dus 03aefc04 blijft), `works.fill`, `works.dig`, polders.
- **Weigeren.** `makeTerrain` weigert een onbekend veld in een stap, `lane`/`ponds`/`haven` op een stap
  zonder `water`, een onbekend veld of versie in `works`, en een trechter die niet klopt (`checkFunnel`:
  velden, hele getallen, halven en 64sten). `parseBundle` idem, strikt.
- **Back-up**: de scan die via `works` de hash voor het eerst verandert, laat `layout.before-works-<ts>.json`
  achter (scan.mjs `backUpBeforeWorks`).
- **De trechter** (`works.haven = { top, dir, w0, open, max, from }`): top = `havenBridgeSite`, w0 = halve
  rivierbreedte daar, `open` zo dat hij bij het zeewaartse einde van de vaargeul zo breed is als de baai
  daar, `max` = 3 × die halve breedte (`HAVEN_WIDEN`), daarna recht door; een straal (`funnelHas`), dus
  `growCanvas` schuift alleen `top`. `dir` per seed afgeleid (±60° rond top → einde vaargeul, minste land,
  de kade binnen een cel ervan). `planHaven` wacht op de havens; een pass die de havens net plande, plaatst
  het eiland in dezelfde scan nog één keer (`havenPass`), zodat de scan erna een no-op blijft. De kop wordt
  één keer open gegraven (zand < BEACH_MAX in de trechter, bereikbaar vanaf de top, niets erop of ernaast;
  de kraan via `liftCivics`). `from` is alleen nog herkomst: de stappen erna dragen hun eigen kopie.

### Afwijkingen van het ontwerp hierboven

- `dig` is een lijst van `{ cells, hold }` in plaats van een platte cellenlijst: elke graaf onthoudt wat er
  binnen zijn profiel stond, zodat een latere graaf nooit grond teruggeeft die een eerdere onder een huis
  vandaan haalde dat er later kwam.
- `haven` is geen `{ cells, half, dir }` van de inham, maar de trechter (besluit C van de keeper).
- De haven wordt niet "op een latere scan" gepland maar in een tweede pass van dezelfde scan (de
  rede-test eist dat de tweede scan van een nieuw eiland niets verandert).
- `planFairway` (een nieuwe vaargeul op een nieuw eiland) stempelt nog zoals altijd: niet aangeraakt, open.
- Een bultje in de trechter hoger dan BEACH_MAX wordt niet gegraven (live ~9 cellen in het tongetje; het
  profiel eromheen maakt er een ondiepte van).
- `tests/support/hoogezand-quay.mjs` is opnieuw vastgelegd op de stand van vóór fase 1 (fairway zoals
  opgenomen, hash 03aefc04, kraan op 152,285).

### Gemeten (kopie van de live-island, alles in het geheugen of op een kopie)

| rand | trap p90 | helling p90 | steil (> 0,6) | vóór (stempel, fase 1 oud) |
|---|---|---|---|---|
| natuurlijke kust | 0,15 | 0,23 | 6 van 1434 | |
| vaargeul zoals opgenomen (niet opnieuw) | 0,65 | 1,40 | 25 van 50 | 0,71 / 1,60 |
| reparatie-graaf | 0,63 | 1,29 | 9 van 19 | 0,90 / 1,91 |
| idem zonder cellen naast iets wat staat | | 0,20 | 0 van 5 | |
| kop van de trechter | 0,55 | 1,18 | 10 van 51 | |
| idem zonder cellen naast iets wat staat | | 0,20 | 0 van 31 | |
| baan van een nieuwe ring (zonder trechter) | 0,16 | 0,23 | 3 van 64 | 0,47 / 0,99 |
| plassen van een nieuwe ring | 0,21 | 0,20 | 0 van 11 | |
| oevers van de trechter na één ring | 0,18 | 0,20 | 0 van 64 | 0,49 / 0,79 (strook) |

Alle steile cellen langs de gegraven randen liggen naast iets wat staat (`hold`: wegen, kavels) of
naast de oude vaargeul; daar blijft volgens ontwerp "hooguit plaatselijk een steil stukje over". Gevulde
plassen: 247 cellen, 0 water, 247 zand, 0 van 198 randen hoger (was 195 van 198). Een ring met trechter:
266 plascellen gevuld, 0 van 206 randen hoger, 0 trechtercellen van zee naar land, diepste bodem in de
ring -1,62 (geen -2,5 meer), 0 huizen verplaatst.

Echte scan (`scan.mjs`, tweemaal, op `home-copy-scan` = de live-layout 03aefc04): hash → b9665fbb, works
met reparatie (28 cellen, 56 vastgehouden), vulling (247) en trechter-kop (202, 83 vastgehouden); alleen
de kraan verhuist (152,285 → 159,289), verder geen enkel huis of civic (de vier weggevallen huizen zijn
vertrokken tenten); de tweede scan is een no-op; `layout.before-works-*.json` is geschreven.

## Fase 3 gebouwd: één haven met een stenen kade (30 september 2026)

Gebouwd volgens de preview die de keeper goedkeurde (scratchpad `fase3\preview.mjs`, kaartjes
`1-nu.png`/`2-voorstel.png`/`3-na-een-ring.png`); het resultaat staat in `fase3\4-gebouwd.png`.

### Wat er nu is

- **`works.kade = { cells, level, back, hold }`** (shared/terrain.mjs `checkKade`, `levelKade`): elke hoek
  van de kadecellen op `level`/256 (113 = BASIN_DECK, 0,4414), dus de rij hoeken aan de waterkant *is* de
  muur (door de kade gezet, niet vastgehouden); grond erboven wordt afgesneden met de landoever van de
  works (0,3/cel, tot 12 cellen), grond erachter (langs `back`) opgehoogd tot hij aansluit, nooit aan de
  waterkant. Na de digs, vóór de polders. Strikt in `makeTerrain` en `parseBundle`, `growCanvas` schuift
  `cells` en `hold`. `WORKS_VERSION` blijft 1: er is nog nooit een release met `works` geweest (zie
  "Versies en hash"); vanaf de eerste release is een nieuw soort grondwerk een nieuwe versie.
- **`planKade`** (lib/layout.mjs), één keer, zodra er een trechter is en een quay-district met planken en
  land (`kadeDue`; `undefined` = nog niet gevraagd, `null` = gevraagd en er past geen kade: een trechter die
  niet binnen ~27° van een gridas loopt, of een huis waar de kade zou komen). Alles in het frame van de
  trechter (`kadeFrame`). Muur één cel voorbij perceel+ring, kade 3 breed, van de eerste rij van het
  perceel tot de laatste rij waar alle drie de kadecellen droog zijn. Eén extra `works.dig`: bassin (vanaf
  één cel over de as tot de muur, de eerste 4 rijen west van het perceel niet: het zandhoekje aan de kop,
  zodat `havenBridgeSite` blijft), het westen (trechtercellen op de piratenkant, rijen 14-34 vanaf de kop),
  de oude werfvoetafdruk, het werfdok, de ankerplaats (16 rijen van het schepenwater tot -0,55) en 3 rijen
  zand voorbij het kade-einde (`KADE_TAIL`). De hold: alles wat staat (digHold-regel) behalve de kadehuizen
  (`p.quay`, op palen), hun paden en de approach van de kadehaven, plus een strook van 12 cellen achter de
  muur (daar beslist de kade) en de oprit (shore + slip) die land blijft. De werf verhuist in `planKade`
  zelf (zodat het dok ligt waar hij staat); kraan, pakhuis/weeghuis (als ze bij de haven staan) en de
  schepen worden opgetild en door de lussen opnieuw geplaatst.
- **Plaatsing**: `yardSite` legt de werf bij de kadehaven op de piratenoever en buiten `havenKeys(1)`;
  de kraan op `kadeCraneCell` (zee-eind van de muurkolom, giek naar het water); pakhuis en weeghuis via
  `kadeSite` achter de kade met de deurstap op de achterste kaderij (`strandedAtSea` telt een stap op de
  kade als "aan het water"); schepen via `kadeRedeSite` in het schepenwater, langs de as, in banen
  (`SHIP_LANE` + k × `FLEET_PITCH` van de as), `KADE_REDE_FAR` 64 in plaats van `REDE_FAR` 20 (het
  schepenwater begint pas voorbij het kade-einde, 24 rijen voorbij de pierkop, en de draaicirkel van het
  galjoen ligt over de eerste rijen).
- **Het schepenwater** (`shipWaterOf(works)` in shared/quay.mjs): piratenhelft van de trechter, ≥ 4 cellen
  van de as, voorbij het zeewaartse einde van de kade; alleen uit `works`, dus pagina, layout en bundel zijn
  het eens. `shipBerth(m, height, water)` zoekt daarin per cel in hele getallen (dichtstbijzijnde cel vanaf
  de eigen cel van de ligplaats, gelijkspel rij-voor-kolom); zonder `water` bit voor bit de oude 16 stralen.
  Aanroepers: `waterfront`, `havenWanted` (ongewijzigd, want vóór de kade), web/js/main.js `boatsFor`.
  Afwijking van de preview: de preview begon het schepenwater op rij 304 (einde van zijn kade), hier op 314
  (einde van de doorgetrokken kade), zodat een schip nooit langs de kade ligt; het galjoen ligt daardoor op
  (141,320) in plaats van (141,310).
- **Wegen**: `road:kade` over alle kadecellen behalve die van de kraan (één keer gelegd, daarna elke scan
  PATH, zoals de causeway); `road:kade:approach` alleen als niets de kade bereikt (op Hoogezand loopt de
  approach van de haven over de eerste kadecel). **Vlonders**: een geregistreerde padcel op gegraven water
  (`dugKeys`) blijft PATH in de replay (placeAll en `replayGrid`), en het dek van de quay neemt ze allemaal op
  (de approach op x154 z274-282 is nu dek; dek 51 → 58 cellen). Naast een kade houdt `growStep` de wegen van
  de kadehaven vast als hij de havens opnieuw plant (anders vond de approach vanaf de oprit alleen water;
  gemeten: dek 58 → 25).
- **Pagina en zee**: het bassin-overlay is weg (`parcelWaterField`, `quayWaterField`, `createQuayBasin`, de
  discard in de grondshader, het bassinmesh). De kade is grond die als plein bestraat wordt (world.js
  `squareCells`), zonder keien en strandplaten; de muur is `buildQuayKade` (web/js/quay-basin.js: één mesh,
  wand + deksteen over de voetcel, trappen vóór de wand) en voeten staan op `quayKade(...).height`
  (shared/quay-basin.mjs) in walk.js en settlerwalk `createStandHeight`. **De open zee moet opnieuw
  gedeployed worden** (settlerwalk) en, als altijd bij `works`, vóór de live island zijn nieuwe hash publiceert.

### Gemeten (kopie van de live-island, `home-copy-fase3-build`, echte scan tweemaal)

Hash b9665fbb → 9d792cbd (opnieuw getekend gelijk, tweede scan gelijk en een no-op). Dig 1411 cellen (578
vastgehouden), kade 141 cellen (x168-170, z267-313; 2 vastgehouden). 0 huizen verplaatst, niets weg of
erbij. Verhuisd: werf (141,286) → (129,291) rot 2; kraan (159,289) → (168,313) rot 3; pakhuis (154,294) →
(171,309) rot 3, deurstap (170,310) op de kade; schepen (46,214)/(41,214)/(36,216) → (130,323), (135,327),
(140,328), alle rot 2. Paden: `road:kade` en `road:keeper:8` erbij (de laatste komt ook zonder kade, uit de
replay van een keeper-weg), vijf opnieuw gelegd (werf, visserij, pakhuis, twee huispaden). Kade op niveau
141/141, water langs de muur 47/47 (voetcel -0,055, muur 0,496 hoog), trechter 2106 cellen water, 0 land,
brugplek nog (147,267) 3 breed, back-up `layout.before-works-*.json` geschreven. Galjoen op (141,320),
drijft, hele romp in het schepenwater.

Randen (preview-indeling, kust/lib.mjs): natuurlijke kust trap p90 0,15 / helling p90 0,23; west+dok 0,38 /
0,97 (7 van 46 steil); zuid van het bassin 0,38 / 0,82; alles behalve muur en oprit 0,38 / 0,82 (13 van 82
steil, allemaal cellen die vóór de graaf al zo steil waren: de rivieroever). Na één ring: alles behalve muur
0,18 / 0,26, 0 van 157 steil.

**Eén extra ring** (r 180, grid 352 → 384, op een kopie, daarna echte scan tweemaal): 0 huizen verplaatst;
pakhuis, kraan, werf en de drie schepen blijven (verschoven met k=16); kade 141/141 op niveau, muur 47/47
open water, dig 1411/1411 open water, 0 trechtercellen van zee naar land, galjoen drijft in het schepenwater.
Vuurtoren, visserij en weeghuis verhuizen (andere kusten, zoals zonder kade). De tweede scan na de ring
verschuift alleen de volgorde van `road:polder:3` in `layout.paths` (en `cleared`); de derde is een no-op.
Hetzelfde gebeurt zonder kade (gemeten op een kopie met `kade: null`), het komt van de ring buiten
`placeAll` om.

**Piratenkroeg** (op het Hoogezand-fixture van `tests/kade.test.mjs`, na `planKade`): vrije waterfront-3x3's op de piratenoever (strand toegestaan, deurstap open water bij de
haven, een weg bereikt het plein): (136,282) rot 1, (135,285) rot 1, (135,286) rot 1, (134,289) rot 1,
(126,297) rot 2 (en (143,265) zonder weg). `tests/kade.test.mjs` eist er ≥ 1.

### Open punten

- De brug op `havenBridgeSite` (147,267) is niet gebouwd.
- De piratenkroeg: de andere sessie plaatst hem met een eigen `pirateTavernSite`; werf, dok en ankerplaats
  laten de kavels hierboven vrij. Afgesproken (30 september 2026): zodra die commit (`8f59453`,
  `claude/salty-kraken`) op main staat, richt deze branch `pirateTavernSite` op de piratenoever met een regel en
  geen vaste cel. Die regel kiest het vrije waterfront-3x3 met `havenBank` 'pirate', buiten werf/dok,
  ankerplaats, schepenwater en trechter, met een weg naar het plein en een deur die een settler vindt, en neemt
  daarvan het kavel dat het dichtst bij de haven ligt. Een test legt vast dat dat op Hoogezand (136,282) geeft.
- Een nieuwe kadehuis-bewoner vindt in een perceel dat water is geen grond meer en logeert op de commons.
- Fase 4: de echte island migreren (en de open zee eerst redeployen).
