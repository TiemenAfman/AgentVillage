# De Batavia

**✅ Status: gebouwd en op main** (nagekeken tegen de code op 29 september 2026): het model, het deinen en drijven, een romp waar
boten en zwemmers tegenaan komen, en de trede 120 met de rede die haar op het eiland zetten. Niet
gebouwd, onder *Later*: aan boord lopen (`CRAFTS.batavia`; `lopen-op-de-boot` is alleen voor het
galjoen gebouwd), varen, echt licht uit de lantaarns en een sloep.

Begonnen op 28 september 2026, als het schip uit `Plans/DONE/mijlpalen-tot-tweehonderd.md` ("Het
VOC-schip"). Referentie: de Batavia van 1628, de replica in Lelystad. Een spiegelretourschip met
een hoog achterschip, de platte beschilderde spiegel met een galerij, zijgalerijen op de hoeken en
drie lantaarns op de kroon, drie masten, een boegspriet met de blinde en de bovenblinde, en een
rode leeuw op het galjoen. Hij ligt voor anker: de zeilen zijn opgegeid, een ankertouw loopt uit
de stuurboordkluis het water in, het reserveanker hangt aan de bakboordkraanbalk en de vlaggen
waaien (de Prinsenvlag op de hek, een geus voor, een vlag op de grote mast, wimpels op de fokkemast
en de bezaan; alleen banen, geen letters of monogram).

## Stand van zaken

- **Het model**: `scripts/build-batavia.py` → `assets/batavia/batavia.blend` →
  `web/js/batavia-mesh.js`, één hero-asset `batavia`. **6181 driehoeken**, tegen een eigen budget
  van 8000 in `HERO_BUDGETS` (het galjoen heeft er 15000). Alles is in Blender Python gebouwd, in
  eilandcoördinaten, uit één functie voor de romp (breedte per hoogte en per station), waar de
  zijkant, de verschansing, de dekken, de berghouten, de poorten en de rusten allemaal uit komen.
- **Gemeten op de bake**, in eenheden (1 = 4 m): de romp 11,98 op de waterlijn, 15,1 over alles
  (galerij tot boegspriet), 2,80 breed, de top van de grote mast 11,50 boven het water. Het
  hoofddek (de kuil) ligt 1,10 boven het water, de bak 1,60, het halfdek 1,65 en de kampanje
  2,10; de reling staat overal 0,25 boven zijn dek en loopt bij de hek op tot 2,57, met de kroon
  tot 3,03. Diepgang 1,00. Naast het galjoen (13 lang, 3,9 breed, top ~10,8) is hij langer,
  slanker en hoger getuigd.
- **Op `/demo`**: een eigen rij "Ships", met de drie schepen in hun drie kleuren op een strook zee
  en het galjoen ernaast op dezelfde waterlijn. Met Hitbox aan zie je de rompvakken waar
  zwemmers en boten tegenaan komen.
- **Tekenen**: `civic()` in `web/js/buildings.js`, `case 'ship'`. `main.js` (`poseOnPlot`,
  `attachExtras`, `animateExtras`, `disposeRecord`, `blockersOf`) en `web/js/guest-island.js`
  doen mee, net als bij de zagerij en de smidse. `web/js/batavia.js` laat hem deinen, stampen en
  slingeren en laat de vlaggen waaien.
- **Getest** in `tests/batavia.test.mjs`: de maten en het budget, de dekken en de treden, de
  vlaggen, de stand op een kavel van 4 bij 16 bij alle vier de draaiingen, de drie kleuren, en
  een Benchy en het galjoen die tegen zijn zij varen en stoppen.
- **Nog niet op het eiland**: de trede in `MILESTONES` en `redeSite` in `lib/layout.mjs` zijn van
  een ander werkpakket. Dit pakket maakt het kavel `civic:ship` (en `:2`, `:3`) te tekenen en
  te raken.

## Besluiten

- **Eén frame, de kiel op y = 0.** Zoals de steigers en het galjoen: de regels van
  `scripts/model-rules.mjs` gelden voor hem als voor elk gebouw, en het eiland zet hem neer met
  één getal, de diepgang. Dat getal zit in de bake als `anchor.waterline` (een nieuw anker in
  `ANCHORS`); `shipDraught()` in buildings.js leest het, verlaagt het hele schip ermee, en
  `floats` laat main.js de oorsprong op de zee zetten in plaats van op de bodem eronder.
- **Het midden van het hele schip op het midden van het kavel, niet het midden van de romp.** De
  boegspriet steekt 8,7 voor het midden uit en de hek 6,5 erachter. Op de romp gecentreerd zou
  de boegspriet 0,7 over de rand van het kavel hangen. Nu ligt alles binnen de 16 en ligt de romp
  1,1 achter het midden van het kavel. `floatingPose` in batavia.js is de ene kopie; main.js
  (ook voor de spookjes van de planner) en guest-island.js vragen hem allebei. Hij draait zoals
  `housePlacement` elk niet-vierkant kavel draait: rot 0 met de boeg naar -z, 1 naar +x, 2 naar +z,
  3 naar -x.
- **Deinen op de mesh, niet op de groep.** De groep is waar het kavel hem neerzette, en
  `blockersOf` leest zijn botsers af van de stand en de draai van die groep. Kantelt de groep,
  dan wandelen de botsers bij elke golf over de rede. De vlaggen hangen aan de mesh en hellen
  mee. Deining 0,028, stampen 0,0045 rad, slingeren 0,012 rad (0,14 in de top van de grote mast),
  met perioden van 5,3, 7,1 en 9,7 s en een fase uit het id. Niets gaat over de lijn.
- **De vlaggen zijn de bewegende delen**, in het ene asset gebakken met hun oorsprong midden op de
  hijs en wapperend naar achteren, omdat een schip voor anker met de kop in de wind ligt.
  buildings.js laat ze uit de romp (`isBataviaMoving`); batavia.js maakt er één geometrie van
  (een draw call per schip, geen vijf) en beweegt de hoekpunten: hoe verder van de hijs, hoe
  verder het hoekpunt uitslaat.
- **Botsen met rechthoeken die een hoogte dragen, niet met levels.** `shipSolids()` meet de romp
  op de bake in vakken van één eenheid lang, van net onder het water tot de reling van de kuil.
  Daarbij tellen alleen de huid-delen: de vlonder, de trap, de zijgalerijen en de relingen van het galjoen
  steken erbuiten. Elk vak draagt `hull`, de hoogte van het hoofddek boven het water.
  - Voor lopers en zwemmers zijn het gewone botsers.
  - walk.js houdt ze ook apart (`takeBlockers`) en geeft een boot de grond met de zij van het
    schip erop (`hullOver` in `web/js/boat.js`). Zo stuit de punt van de Benchy, of een probe van
    het galjoen, erop als op een oever.
  - Levels vielen af. Een level is één cel, en de zij van het schip valt op geen celrand: hij ligt
    0,6 binnen de rand van het kavel. Een level op zijn cellen liet een Benchy dus 0,6 voor de zij
    stoppen, of liet zijn boeg er 0,4 in. En een level naast hem was een vloer in de lucht, waar
    "step ashore" je op kon zetten.
- **Drie schepen, één bake.** `civic:ship` is hij zoals hij gemodelleerd is (eiken, groene panelen,
  rode lijsten). `civic:ship:2` is blauw en goud, `civic:ship:3` rood en zwart, gekozen uit het id
  (`shipLivery`). De bake verzamelt elk vlak in een van de drie liverykleuren in eigen delen:
  `batavia livery ...` voor de huid, `batavia trim ...` voor wat erop zit. Die worden per schip
  overgeschilderd, dus het blijft één materiaal en één draw call. De Prinsenvlag en de geus zijn
  op alle drie gelijk; de vlag op de grote mast en de wimpels krijgen de kleuren van het schip.
- **Wat je belopen kunt, is gemeten en als anker meegebakken**, zodat later werk het leest in
  plaats van het na te meten (`SHIP_ANCHOR` in model-rules, die ook een halve rechthoek weigert).
  Een straal naar beneden bevestigt elke hoogte bij het bakken:
  - `deck.<naam>.lo|hi`: waist, forecastle, forecastle-mid, forecastle-bow, quarterdeck, poop,
    poop-aft, gangway (het bordes in de ingangspoort) en float (de vlonder);
  - `stair.<naam>.lo|hi`: fore-, quarter- en poop-, elk port en starboard, en side (de
    staatsietrap). `lo` is de hoek aan de voet, op de vloer waar hij begint; `hi` is de
    tegenoverliggende hoek aan de kop, op de vloer waar hij uitkomt;
  - `mast.fore|main|mizzen`.
  De treden zijn blokjes van 0,10 à 0,11 hoog, ruim binnen `STEP_UP` (0,45); de staatsietrap
  heeft negen open treden van 0,10.
- **Stuurboord is -x.** Wie naar de boeg kijkt (+z), heeft -x aan zijn rechterhand (walk.js: rechts is
  `(-cos yaw, sin yaw)`). De staatsietrap hangt aan stuurboord, zoals hij hoort, en het
  ankertouw komt uit de stuurboordkluis.

## Later

- **Aan boord lopen.** De dekken, de trappen en de vlonder zijn er als ankers, maar walk.js kan er
  nog niet mee overweg:
  - Een botser heeft geen hoogte: de romp blokkeert iedereen, ook wie op het dek zou staan.
  - Levels zijn per cel en vlak, dus een trap is er geen.
  - Wat nodig is, is het dekstelsel van het galjoen (`shared/deck.mjs`, `stepOnDeck`) met een
    stilliggende romp, of een `CRAFTS.batavia` in `shared/crafts.mjs` met de dekken uit deze
    ankers, met een test dat die twee gelijk blijven.
  - Instappen: vanuit het water op de vlonder, dan via de staatsietrap naar het bordes.
- **Varen**, op de techniek van het galjoen (`CRAFTS`, `stepBoat` met probes).
- **De uitjes van de zee eromheen** (`openWater` in `shared/boating.mjs`). Nu varen de bootjes van
  de zee dwars door hem heen; alleen de boot die je zelf stuurt stopt ertegen.
- **Echt licht uit de hek-lantaarns** (nu gloeien ze alleen), en een sloep aan dek of aan de
  davits, als er budget over is.
- ~~**Gelijktrekken met de werf.**~~ **Opgelost (28 september):** de werf tekent in stadium 4 deze
  bake zelf op de helling (`bataviaOnStocks` in `web/js/buildings.js`), zonder tuig, vlaggen,
  staatsietrap, vlonder en reserveanker, en in kaal hout. Wie hier een deel hernoemt of een kleur
  verplaatst, moet dus ook naar de werf kijken: `tests/shipyard.test.mjs` houdt vast dat de romp
  op de helling haar romp is, en dat er geen verf, licht of tuig op staat.
