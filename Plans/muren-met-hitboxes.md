# Muren met hitboxes

**🚧 Status: plan van 1 oktober 2026; deel A en B gebouwd (niet gecommit), op `claude/gracious-lehmann-ab4896` (7dfed32). Wacht op review van de keeper.**

## Aanleiding

De keeper, lopend over het eiland: "muren moeten hitboxes krijgen". Twee sessies delen het werk:

- **Hitboxes en looppaden** (`Plans/hitboxes-en-looppaden.md`, branch `claude/gracious-lehmann-ab4896`): de
  grenzen van wijkjes, erven en akkers (`buildBorders`: rail / schutting / heg / muur, met `hop` onder 0.4), bos,
  keien, props, en de motor in `walk.js` — `web/js/solids.js` met gedraaide rechthoeken (`yaw`), een index in
  emmers, blockers met een bovenkant (`top`) en de ontsnapping `astride` voor `hop`-blockers.
- **Dit plan**: de solids van de gebouwen zelf (`footprintOf` in `web/js/buildings.js`), hoe `blockersOf` ze
  draait, en dat je nooit vast komt te zitten in een gebouw.

Een stadsmuur bestaat niet: de stad zet geen grens neer. De enige ringmuur is die van het grote kasteel.

## Wat er gemeten is

Een audit bouwt elk gebouw onder Node en legt de solids tegen de echte geometrie in de lichaamsband (boven een trede,
tot 0.55; de veranda telt niet mee). *Spookmuur* = solid waar een lichaam zou passen en van buitenaf bij kan;
*deur* = hoe dicht een lichaam bij het deuranker komt (tussen haakjes de waarde met de echte geometrie).

| | spookmuur m² | deur | |
|---|---|---|---|
| groot kasteel (7x7) | **6.2** | **0.54** (0.14) | één blok over de hele ringmuur, de poort is niet in te lopen |
| goudkuil | **4.5** | – | open silo, dicht als één blok |
| goudmijn | **3.4** | **1.29** (0.50) | |
| brouwerij / zagerij | 2.6 / 2.4 | – | een erf met losse dingen wordt één blok |
| kapel / stal / kasteel 3x3 | 1.3 / 0.9 / 0.9 | – / – / 0.28 (0.18) | |
| manor / keep | 0.4–0.6 | – | |

In het eigen frame loop je nergens door een gebouwmuur. Wel:

- **Gedraaide huizen en pleingebouwen** (`housePlacement`: 9° tot 25° uit het kwart, `SQUARE_BUILDINGS`) krijgen
  in `blockersOf` de omsluitende as-rechthoek, die 0.09 tot 0.21 per kant groeit: je botst tegen lucht op de
  hoeken en voor de deur staat een onzichtbare muur.
- **Vast komen te staan**: `blocked` laat een stap alleen toe als het doel vrij is. Wie *in* een gebouwblocker
  staat (er verschijnt een gebouw om je heen bij een scan, een Apply of een gast-eiland dat laadt; of je landt na
  een sprong in een blocker met een hoogte), kan geen kant meer op.

## Besluiten

### A. Gebouwen zo solide als ze eruitzien (buildings.js; nu)

| Vraag | Besluit | Waarom |
|---|---|---|
| Waaruit | Per part de rechthoek van **elk stuk driehoek dat in de lichaamsband valt** (de driehoek op de band geknipt), niet van alle hoekpunten van het part onder 0.55. | Eén Blender-object is vaak een hele ringmuur of een open silo; zijn rechthoek sluit de binnenplaats in. |
| Samenvoegen | Twee rechthoeken worden er één **alleen als dat ≤ 5% leegte insluit**. `mergeRects` met `WALK_GAP` en de uitzonderingslijst `APART` vervallen. | `blocked` laat elke rechthoek een lichaam groeien, dus een spleet smaller dan een lichaam is vanzelf dicht; plakken hoefde alleen om het aantal klein te houden, en dat doet de nieuwe regel ook. |
| Band | Van `WALK_STEP` (0.15) tot `WALK_CLEARANCE` (0.55), gemeten voor de veranda en de schaal, zoals nu. | Wat lager is, is een trede, zoals de veranda van 0.18 al: een sokkel of dorpel zet anders de hele gevel dicht (bibliotheek, pakhuis en snoepwinkel waren één blok). |
| Rond | `ROUND` blijft één cirkel. | Put, fontein, perk, vuurtoren: rond wordt rond omlopen. |
| Eigen solids | `ownSolids` (schip, Kraken) blijven wat ze zijn. | Die zijn met de hand gemeten. |
| Bovenkant | Elke solid krijgt `y0`/`y1` in het frame van het gebouw: `y1` de hoogste punt van wat erin viel, `y0` tot onder de rok van de veranda. `blockersOf` geeft ze pas door in deel B. | Over een lage kist of ton kun je dan springen; de onderkant zo laag dat je nooit onder een huis door loopt aan de lage kant van een helling. |

Prototype (dezelfde audit): kasteel 7x7 6.2 → ±0.5 m² en de poort 0.54 → 0.14 (= de echte muren); goudkuil
4.5 → 0.1; goudmijn 3.4 → 0.1; brouwerij 2.6 → 0.1; zagerij 2.4 → 0.1; kapel 1.3 → 0.3. Hooguit ~90 rechthoeken
per gebouw, een huis 1–12; de index van `solids.js` houdt dat goedkoop.

### B. Draaien en ontsnappen (main.js, guest-island.js, walk.js; na de motor)

- `blockersOf` (en de kopie in `guest-island.js`) geeft `yaw: rec.group.rotation.y` met de onverdraaide
  `hx`/`hz`, en `y0`/`y1` opgetild met `rec.group.position.y` — de regel die de Kraken-sessie al schreef.
- In `blocked`: sta je al in een gebouwblocker (op je eigen hoogte), dan mag elke stap die je **er minder diep in**
  brengt. Dit is de `astride`-regel van de andere sessie, breder getrokken: daar alleen voor `hop`.
- Gebouwd op 7dfed32. `solidAt` (solids.js) is de ene omrekening; een cirkel en een scheepsromp (`hull`) blijven een
  doos langs de assen, omdat `boat.js hullOver` alleen die leest. Een havenhuis op palen houdt zijn oude blok zonder
  hoogte: zijn wanden beginnen op `HARBOUR_DECK`, en met een bovenkant liep je vanaf de boardwalk door de wanden.
- De ontsnapping is `leaving` in `blocked` (`depthInSolid`): elke stap die minder diep in de solid komt, mag; plaatsen
  blijft streng.

### Wat dit niet doet

Grenzen, props, bos (andere sessie); trappen en vloeren (`surfaces`, `STEP_DOWN`); randen van kades, steigers en
boardwalks en het havenhuis op palen (sessie "Repareer vallen van kaderanden en steigers"); muren binnen in kamers.
Niets gaat over de draad: geen `SEA_V`, geen layout-gate, geen bundle-veld, dus een patch.

## Tests

- `tests/building-solids.test.mjs`: de audit als test. Voor elk gebouw: geen spookmuur boven een grens, elk
  deuranker bereikbaar tot binnen een lichaam van de echte muur, de poort van het grote kasteel in te lopen, de
  goudkuil open aan de voorkant, en geen lichaam midden in echte geometrie.
- Deel B: een walker in een gebouwblocker loopt eruit, naar binnen blijft dicht; een gedraaid huis blokkeert
  zijn eigen rechthoek en niet de hoeken van zijn omsluitende.
- Bestaand: `tavern`, `pirate-tavern-building`, `castle`, `harbourhouses`, `shipyard`, `fountain`, `lighthouse`,
  `dwellings` en de andere die op `solids` zoeken.
