# 🚧 De Salty Kraken op zee: een rots in de branding met een loopplank

Plan van 3 oktober 2026. Vervolg op [piratenkroeg.md](piratenkroeg.md) ("Het kavel op het strand").

## Waarom

Op Hoogezand staat de Kraken sinds 1 oktober op het strand aan de kop van de trechter, en de keeper
vindt het nu *"een gestrande boot in een weiland, dat is raar"*. Zijn schets: de rots een eindje uit de
kust in ondiep water, en een lange plankenloopbrug van het zand naar de voet van de trap. Daarnaast twee
fouten in de bake, vandaag gezien:

- de rotsen staan *op* de grond in plaats van eruit op te rijzen: een zichtbare naad waar rots en zand
  elkaar raken (`boulder()` plet elke rots op y = 0, dus elke rots heeft een platte onderkant);
- het eind van de onderste tentakel hangt in de lucht naast de rots, in plaats van erin te gaan.

De maat blijft (een landmark) en het kavel blijft 11 x 6.

## Besluiten

| Besluit | Waarom |
|---|---|
| **Eerst op zee, dan het strand, dan een ring.** `pirateTavernSeaSite` zoekt eerst; vindt die niets, dan het strandkavel van nu (`pirateTavernSite`), en pas als ook dat niets geeft de groeiring (`layout.pubRing`, ongewijzigd) | De zee is wat de keeper wil; het strand is een kroeg die nooit eeuwig wacht. Een eiland dat klein gesticht is heeft bij 52 settlers vrijwel altijd ondiep water voor de kust, en anders het strand. |
| **Het kavel op zee**: alle 66 cellen water (open water, `openWater`), elke hoek niet dieper dan `PUB_SEA_FLOOR` (-2.2), een ring van één cel open water eromheen. Niet in: de planken, hellingen en ligplaatsen (`wf.near`), de corridors van de havens, de draaicirkel van het galjoen (`wf.swings`), de vaargeul, wat polders opwierpen, de trechter en twee cellen eromheen (`havenKeys(layout, 2)`), het water van de grote schepen, `PUB_KADE_CLEAR` van de kade, alles wat gegraven is, het oord en zijn ring, en alles wat staat of bestraat is (`fairwayHeld`) | Dezelfde regels als een schip op de rede (`seaCell`), min de diepte: de kroeg mag niemand de weg versperren. |
| **De voorkant naar het land**: de loopplank loopt van de trede van de trap (`PUB_GATE`, `plotDoor`) recht vooruit (`LOOK[rot]`) over `PUB_PIER_MIN` (3) tot `PUB_PIER_MAX` (12) watercellen naar het eerste land. Elke plankcel voldoet aan dezelfde regels als het kavel | Zo zie je vanaf het strand de lange flank met de trap, de loopplank komt bij de voet van de trap aan, en hij is recht, dus één regel om af te leiden. |
| **Rangorde**: een plank zo dicht mogelijk bij `PUB_PIER_IDEAL` (5), dan het ondiepste kavel (gemiddelde diepte zo dicht mogelijk bij -0.9), dan dichtst bij de kadehaven, dan rot, gz, gx | "Een eindje uit de kust in ondiep water". |
| **De loopplank is de weg**: `path:civic:piratetavern` begint met de plankcellen (vanaf de trede), dan de weg over land vanaf de eerste landcel (een strandpad over het zand, `strandWalk`). De plankcellen staan ook in `paths[].pier`, die de replay elke scan terugzet als PATH over water (zoals `strand` voor zand) | Een kolonist vindt de weg bij de deur (`atDoor`, `houseGate`) en loopt over de planken naar binnen. `pier` blijft in layout.json: de bundel kent alleen `id` en `cells`, dus voor de zee is het een gewone weg. |
| **De pagina leidt de loopplank af** uit het plot en de grond (`shared/kraken.mjs pubGangway`, dezelfde som als de server), en tekent hem met de steigerset (`buildPierGeometry`, zonder kop), loopt erover als `levels` op `QUAY_DECK` plus één rechthoek tot in het kavel, en zet de cellen in de dekkaart die de zee krijgt (`placements.decks`), zodat de crowd van de zee erop staat | Geen nieuw veld in de bundel of village.json; de grond eronder blijft water (zie hieronder), dus de som valt overal hetzelfde uit. |
| **Het water blijft water**: kavel, ring, loopplank en de cel ernaast horen bij `keptWater` (geen polder), `fairwayHeld` (geen bagger) en de `lane` die een groeiring openhoudt (zoals het oord: `resortWater`) | Anders polderde de ladder de kroeg droog of sloot een ring hem in. |
| **Eénmalige verhuizing** van een kroeg die al op het strand staat, als `liftedPub` het al deed voor het 3 x 3: bovenaan `placeAll` opgetild, door de lus geplaatst, de oude weg weg, als het snoeien iets afsneed nog één ronde in dezelfde scan. `layout.pubSea` onthoudt dat het gevraagd is (ook als er geen plek op zee was: dan terug op zijn plek, en nooit meer gevraagd). De scan die hem verplaatst bewaart `layout.before-pub-<ts>.json` (`backUpBeforePub`, die al afgaat op elke verandering van het plot) | Een huis verhuist nooit vanzelf; dit is een bewuste migratie, en `pubSea` is de poort zodat hij niet elke scan opnieuw zoekt. |
| **De kist** staat bij een kroeg op zee naast het landeinde van de loopplank (`pubChestSpots`: naast de eerste landcel, dan een stap verder landinwaarts, dan twee opzij), met zijn voorkant landinwaarts. Geen plek: de tavernregel | Achter een kroeg op zee is zee. |
| **Het model**: de rotsen lopen door tot `SKIRT` (2.7) onder de voet van de trap en worden naar onder breder, in plaats van geplet op y = 0; de losse steentjes op de grond vervallen (ze zouden op zee boven het water zweven); aan de voet van de trap een **steiger** met palen tot de bodem, waar de loopplank op aankomt (een vloer tot de voorrand van het kavel); de voet van elke tentakel begint dieper, in de rots. Het hele model gaat aan het eind `SKIRT` omhoog, zodat het laagste punt y = 0 blijft (model-rules), en de pagina zet de groep op `QUAY_DECK - anchor.door.y` op zee en `laagste grond van de voorkant - anchor.door.y` op het strand | Een rots die uit het water oprijst, en op het strand een rots die de grond in loopt: geen naad meer, en één bake voor beide. Geen nieuw anker nodig: `anchor.door` ligt op de vloer van de steiger. |
| **Versie: een minor (0.9.0)**, nooit een patch | Een plot dat verhuist, nieuwe velden in layout.json (`pier` op een pad, `sea` op het plot, `pubSea`), en een oudere islander op dit layout zou de planken niet meer als weg terugzetten. De zee hoeft niet geredeployd: de bundel verandert niet van vorm (een pad met cellen over water, een plot dat binnen 16 blijft). |

## Wat ik níet doe

- Geen nieuwe veldnamen in de bundel of in `parseBundle`; een oudere zee neemt het eiland zoals het is.
  Een pagina van vóór dit tekent de kroeg wel zonder loopplank en met de rots tot de bodem.
- Geen knik in de loopplank: recht, of geen plek.
- De kroeg op het strand blijft bestaan als terugval; hij krijgt dezelfde bake (de rots loopt de grond in).

## Meten

Op een kopie van `~/.promptholm` (zonder `*.lock`/`*.log`, zee `single`, `network.public` false), met de
worktree-`serve.mjs` en `PROMPTHOLM_HOME` op de kopie: waar de kroeg landt, dat elk ander plot dezelfde bytes
houdt, dat de tweede scan een no-op is; kijken met de noclip-camera en over de loopplank en de trap lopen.

## Stand

Gebouwd op `claude/gifted-leavitt-465053` (3 oktober 2026), niet gemerged en niet uitgebracht.

### Gemeten

- **Ladder van 128** (seeds 5, 2024, 1337, 7, 11, alle bij 60 settlers): elke kroeg op zee, met een loopplank
  van 5 cellen; de tweede scan is een no-op. Op het kleine eiland (seed 3, gesticht op 40) staat hij op zee op de
  scan die hem verdient, zonder ring.
- **Kopie van Hoogezand** (`~/.promptholm` zonder locks en logs, zee `single`, `network.public` false): de kroeg
  gaat van het strand op (148,253) rot 2 naar **(115,308) rot 0**, op zee ten westen van de werf, met een
  loopplank van 7 cellen naar het strand op (118,300); de kist gaat mee naar (117,300), naast het landeinde. Verder
  verandert alleen de weg van de kroeg, `layout.pubSea` en (in volgorde) `cleared`; elk ander plot houdt zijn bytes.
  De twee scans erna zijn byte-identiek; er komt één `layout.before-pub-<ts>.json` bij.
- **Lopen** (de echte walk mode in de pagina op die kopie): van het strand over de loopplank, de steiger op, de
  onderste trap, het bordes, de bovenste trap, tot het stoepje (3,65) met "E step into the Salty Kraken"; nergens
  onder dekhoogte. Een eerste versie had een spleet van 0,03 tussen de onderste trap en de steiger, precies waar
  de loopplank uitkomt; nu overlappen ze, en `tests/pirate-stair-walk.test.mjs` loopt die weg recht.
- **Volgorde**: op een nieuw eiland wordt de haven (trechter, kade, oord) pas in de passes ná de havens gepland. Een
  rots die eerder werd neergezet nam op seed 90210 de baai van het oord in, en dan kwam er geen oord en geen kraan.
  Daarom wacht de kroeg met kiezen zolang de trechter of de kade in deze scan nog beslist wordt (`havenPass` < 2);
  in de laatste pass wordt hij hoe dan ook geplaatst.
- **Tests**: `node --test "tests/*.test.mjs"` 2173 van 2175 groen; `plan-scan` faalt alleen in de volle run (scan.lock),
  los groen.
- **Bake**: 81.104 driehoeken (was ~80k; de losse steentjes eruit, de steiger erbij), budget 95.000.

### Beweging (3 oktober 2026)

De keeper vroeg om beweging in het exterieur: wapperende vlaggen, slingerende lantaarns en wapperende zeilen.

| Besluit | Waarom |
|---|---|
| De twee Jolly Rogers, de drie bijgezette zeilen en de vier lantaarns aan een haak (achtersteven, boeg, voormars, deur) gaan uit de merge (`isKrakenMoving` in buildings.js) en worden **één** geometrie op de groep van het record (`web/js/kraken-motion.js`): één draw call per kroeg | Het lijf zit in de BatchedMesh en staat stil; een mesh per bewegend deel zou ~10 draw calls zijn. |
| Op de CPU, per vertex, zoals de Batavia haar vlaggen (`batavia.js`): een vlag golft vanaf zijn lijk aan de stok, een zeil ademt en rimpelt vanaf zijn ra (de voet beweegt het meest), een lantaarn draait klein om zijn haak | Geen nieuwe shader en geen extra programmasleutel; ~35k vertices, alleen voor een record dat zichtbaar is. |
| Alles gemeten uit de bake (deelnamen, lijk, ra, haak), niets met de hand | Een rebake verschuift de beweging mee. |
| Op de klok van de zee (`timeNow()`), fase uit de naam | Elk scherm ziet de vlag op dezelfde plek, zoals het uithangbord. |
| Lantaarns op een paal, de opgerolde onderzeil en de raas bewegen niet | Een lantaarn op een paal slingert niet; een ra staat vast aan de mast. |

De eerste versie scheurde de vlag: op een doek van zeven kolommen boog de golf tussen twee punten verder dan
doodshoofd en botten van het doek af stonden, en het doek kwam erdoorheen (de keeper zag het meteen). Nu is het
doek 19 x 9, staan ze verder van het doek en is de golf rustiger.

**HD buiten** (gebouwd): met Detail op HD en het pakket aanwezig vliegen beide Jolly Rogers de HD-vlag uit het
interieur (`civic_kraken_jollyroger`, `jollyroger.glb`). `hdOutside` in hd-pieces.js laadt een stuk van het pakket
voor buiten: zonder de pascontrole tegen de kit-bake (die zou de hele kit van 17 MB laden om een vlag te hijsen) en
zonder het warme kamerlicht. `kraken-motion.js` zet hem per as op de maat van het bake-doek (lijk op de stok, dikte
de eigen), laat hem golven met dezelfde som in een vertex-shader (38k vertices; de fase in JS teruggebracht, want
zee-tijd in seconden past niet in een shader-float) en vouwt het bake-doek, de schedel en de botten op één punt
zolang hij hangt. Wisselen gaat live (`applyDetail`, ook na het antwoord van het pakket). De HD-vlag is een
wandbanier met een eigen stokje bovenaan; dat leest buiten als een banier aan een ra. De rots blijft de bake: een RAW van Pixal3D op de 4090 (`refs/krakenkit/3d/kraken-rots-pixal3d-raw.glb`) is op
3 oktober in het spel onder het schip bekeken, en de keeper koos de bake-rots. Er is dus geen mechanisme om delen
van het lijf te vervangen; alleen de vlaggen gaan in HD.

Gasten krijgen het ook (`attachExtras` hangt het aan elk record); geen layout en niets op de draad, dus dit deel
alleen zou een patch zijn. `tests/kraken-motion.test.mjs`.

### Dieper in het water (3 oktober 2026)

De keeper tekende de waterlijn halverwege de rots: met de trapvoet op de grond van de rots stond die als een sokkel
onder het schip. Nu staat de voet van de trap (en de steiger, en `anchor.door`) `SINK` = 1 hoger op de rots; de pagina
zet die nog steeds op dekhoogte, dus alles zakt 1 en het water komt halverwege de rots. De twee trappen zijn korter
(van ~3,2 naar ~2,2 hoog), naar dezelfde deur. Rotsen die nu op traphoogte onder de treden door lopen, tellen daar
niet meer als muur (`pirateSolids`: een punt onder een vloer van de trap wordt beloopt, niet ingelopen). Mogelijk
iets te diep; de keeper beoordeelt het in het spel.

### Open

- De live-island migreert bij de eerste scan met deze code; omdat het een minor is, pas met de release (0.9.0).
- De rok wordt aan de rand van het kavel recht afgekapt (de rotsen blijven binnen 11 x 6); onder water zie je
  dat nauwelijks, maar van dichtbij onder water is het een rechte wand.
