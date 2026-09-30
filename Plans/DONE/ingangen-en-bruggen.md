# Ingangen, uitgangen en handgebouwde bruggen

**✅ KLAAR** — het bord, het hek, de bruggen als weg en de planner-markeringen staan; de ingangen zijn te
verplaatsen ([ingangen-verplaatsen.md](ingangen-verplaatsen.md)). Bruggen worden bewust geen vaste ingang.

Een dorp heeft een naam op een poort boven elke weg die zijn land in- of uitgaat, en de
planner laat die plekken zien. Dit plan zegt wat daar al van staat, wat er nog niet automatisch
gaat, en waar de *ingang-verplaatser* (de editor) op aansluit.

## Wat er staat

- **Ingangen zijn afgeleid, nooit opgeslagen** (`hamletEntrances`, `web/js/hamlet-sign-placement.js`):
  waar het wegennet de rand van het land van een dorp kruist - twee bestrate cellen naast elkaar,
  één binnen en één buiten - een per windstreek (N/O/Z/W), hooguit vier, minder voor een klein dorp
  (`maxEntrances`). Polder- en havenwegen tellen niet mee; een weg die er doorheen loopt wel.
  Nooit twee opeenvolgende cellen van één pad: een pad legt alleen vast wat het zelf bestraat heeft.
- **Het bord** staat precies op de lijn van het hek, boven de weg, met "North entrance" op de
  voorkant en "North exit" op de achterkant zodra er meer dan één ingang is. Geen plek zonder
  paal op wegdek = geen bord (ook niet ernaast: dat las als een fout).
- **De planner** tekent dezelfde ingangen (`setGates` in `plan-overlay.js`): balk, groene pijl in,
  oranje pijl uit, de naam van de kant. De bogen zelf zijn daar verborgen.
- **Een handgebouwde brug** (een `archbridge` of `bridge` uit `props.json`, dus niet uit
  `layout.bridges`) telt als weg: `bridgeRoadCellsOf` geeft de hartlijn plus drie cellen oever
  aan elk eind, en gaat naar `hamletEntrances`, `hamletSignSites`, het hek (`setBridgeRoads` in
  `world.js`: de grens gaat open waar de brug landt) en de planner. Verandert de set (een brug erbij,
  eraf), dan tekent `handOutDecks` alles opnieuw.
- **De brug is loopbaar**: `deckCellsOf` geeft walk mode per cel het *midden* van wat het dek daar
  doet, niet de top. Met de top was de tweede trede van een boog van tien precies `STEP_UP`
  (0,45) en viel je voor de brug in de rivier.

## Besloten: een brug is een toevalligheid

Een handgebouwde brug is geen vaste ingang en legt geen wegen aan. Ze ligt er nu toevallig, waar de keeper
haar zette, en telt als weg voor de afleiding zolang ze staat: zonder brug is er geen ingang meer. Er komt
dus geen aanrijroute per brug en geen brug in `layout.json`.

De wegen sluiten daarom ook niet vanzelf aan. Wie een brug wil laten uitkomen op een dorp, legt zelf de
verbinding: hij zet de ingang van het dorp op de landing (de Gate-tool, [ingangen-verplaatsen.md](ingangen-verplaatsen.md)
- de cel is de rand van het land en de aanrijroute legt de weg naar het plein), of hij trekt een weg met
de Road-tool.

## De ingang-verplaatser (de editor)

Staat in een eigen plan en is gebouwd: [ingangen-verplaatsen.md](ingangen-verplaatsen.md). De keeper legt vast waar
de ingang van een dorp is (`layout.gates`), met een Gate-tool in de planner.

## Open vragen

- Een brug schuin over de rivier (`rot` is vrij): de deksterkte per cel houdt het niet onder
  `STEP_UP` op een diagonaal. Vastleggen op kwartslagen, of bruggen ondersteunen die ervoor gemaakt zijn?
