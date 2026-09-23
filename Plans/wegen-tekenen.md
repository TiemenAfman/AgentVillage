# Wegen tekenen in de planner, met een brug op maat

Gebouwd op 23 september 2026. De planner is dé manier van stadsonderhoud; de oude Build-modus
(losse vormen met de hand neerzetten) staat standaard uit en is alleen nog een schakelaar
onder **Settings → Debug** (per browser, `localStorage` `promptholm.debug.build`).

## Wat het doet

Tool **6 Road** in plan-mode: sleep een weg vanaf een weg die het plein bereikt. De weg is
één cel breed en loopt waar je sleept. Waar hij over grond gaat waar geen weg op kan liggen
(de rivier, de natte rand, een te steile oever) wordt dat stuk een brug, precies zo lang als
het gat tussen de twee oevers. Blauw in de overlay = wordt brug, met de lengte in de HUD en
in de ledger ("Road: 31 cells, a bridge of 5"). Apply schrijft hem net als elk ander plan.

## Besluiten

- **Een nieuwe op, `road`, door dezelfde deur als de rest** (`POST /api/plan`, `opRoad` in
  `lib/plan.mjs`). Dry run na elke streek, server is de waarheid; de browser stuurt alleen de
  streek bij (recht houden over het dek, terug-slepen = terugnemen) en rekent niets toe.
- **Grond vs. dek** volgt het grid van de server: grond = land en `FREE`/`PATH`/`SQUARE` (of
  een bestaande brug); alles daartussen is dek. Dek is dus breder dan het water — de rand van
  het dal is nooit land (zie `crossingSpan`) en een brug die bij de waterlijn stopt hangt in
  de lucht.
- **Weigeringen**, in de woorden van het eiland: dek zonder rivier ("not a river" / "too
  steep or too sandy"), een bocht op het dek, langer dan `PLAN_CAPS.span` (12; de router zelf
  stopt bij 5 omdat die ongevraagd bouwt), de fairway, een dijk/zone, een pier, iets wat er
  staat, beginnen/eindigen op het dek, en een weg die niet aansluit op het plein.
- **Sticky zoals een huis.** Vastgelegd zoals `markRoad` een weg vastlegt (dek in
  `layout.bridges`, verse grond in `layout.paths`, één id `road:keeper:<n>`) én heel in
  `layout.roads`. Dat laatste omdat `clearRoads` en een `ROAD_VERSION`-bump alle paden
  weggooien en ze vanaf de deuren opnieuw routeren — en geen deur vraagt om de weg van de
  keeper. `replayKeeperRoads` in `placeAll` legt hem dan opnieuw. Een plan dat de bestrating
  van zo'n weg weghaalt (een wijk eroverheen, een zone, afgesneden van het plein) haalt hem
  ook uit `layout.roads`, anders kwam hij met gaten terug door de nieuwe huizen.
- Geen nieuwe mesh: `buildBridgeGeometry` maakt al een dek van elke lengte.

## Nog niet

- Een getekende weg weer weghalen (nu: Undo vóór Apply, of Restore previous erna).
- Diagonale of bredere wegen.
