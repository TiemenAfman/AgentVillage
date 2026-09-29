# Strandpaden: een weg die over het zand tot aan de havengebouwen loopt

**✅ DONE**: gebouwd op 29 september 2026.

Begonnen op 29 september 2026, als vervolg op `civicRoad` (commit `52fe602`). Martijn vroeg
"wat dacht je van strandpaden", bij de opdracht om `coastSite` alleen kavels te laten nemen waar
een weg komt.

## Wat er mis was

Het pakhuis, de waag en de vissershut staan volgens `coastSite` met hun deur op open water. Hun
deurstap is dus zee, en de weg moet het kavel van opzij vinden. `civicRoad` deed dat zo:

- eerst zoals altijd, via `nearestWalkable` rond de stap;
- lukt dat niet, dan loopt hij vanaf het kavel over het strand naar de dichtstbijzijnde grond die
  met het plein verbonden is.

Het zand daartussen werd niet bestraat. Dat gaf drie problemen, gemeten op de ladder tot 200 op
een eiland van 128 (`tests/harbour-sites.test.mjs`, seeds 1–40 en 2024):

1. **Een kavel zonder weg.** Op seed 2024 kwam de waag op een landtong van strand. Die hangt
   alleen diagonaal aan het vasteland, om de hoek van het pakhuis heen, en kreeg nooit een weg.
   Een kavel blijft staan waar het staat, dus die waag hield voorgoed geen weg. Een strandpad
   helpt daar ook niet: wegen lopen vier-verbonden.
2. **Een weg die niet bij de deur komt.** Bewoners lopen alleen naar een deur als er een wegcel
   binnen `GATE_REACH` (3) ligt (`houseGate` in `shared/roads.mjs`, dezelfde vraag als
   `gateOf` in settlerwalk). Op zes seeds had een havengebouw wel een `path:`, maar begon die
   te ver weg:
   - seed 10 en 11: de waag. Op seed 11 lag er 7 cellen strand tussen de oostgevel en de weg, en
     was de weg 9 cellen van de deur. Op seed 10 begon de directe weg op een laan 5 cellen van de
     deur, over het water heen.
   - seed 20, 29 en 34: de vissershut.
   - seed 33: het pakhuis.
3. **Geen plek.** Op seeds 12, 17, 20, 21, 30 en 39 vond het pakhuis of de waag bij geen enkele
   haven een vrij 3x3-kavel waarvan de stap open water is. Per haven zijn dat er 0 à 2. Weigeren
   alleen voegt daar seed 19 en 2024 aan toe.

## Besluiten

### 1. `coastSite` neemt alleen een kavel waar een weg bij de deur komt

Dit is de regel van `standAt`. Elke kandidaat gaat in de vaste volgorde (`[d², rank, gz, gx]`,
dezelfde als het oude minimum):

- hij wordt op het grid gezet;
- `civicRoad` wordt gevraagd;
- de cellen gaan terug naar wat ze waren, niet naar FREE, want een kustkavel mag op strand
  staan en strand is BLOCKED.

Hij telt alleen als de weg binnen `GATE_REACH` van de deur begint (`atDoor`). De eerste die
daaraan voldoet wint. `COAST_TRIES` (12) begrenst de zoektocht, net als `MINE_TRIES`: na 12
pogingen gaat `harbourSite` door naar de volgende haven.

### 2. Tweede ronde: de deur op het strand

Heeft geen enkele haven zo'n kavel, dan volgt een tweede ronde langs alle havens. De stap mag
dan één cel strand zijn, met direct daarachter open water: het gebouw staat een cel van de
waterlijn, met het gezicht naar zee. Omdat de strenge ronde overal voorgaat, krijgen alleen
eilanden iets anders die eerst niets of een kavel zonder bereikbare weg kregen. Op seed 2024
komt de waag nu op de kadehaven, naast de hellingbaan.

Alleen voor het pakhuis en de waag. De vissershut heeft al een eigen laatste terugval (elke
kust, het dichtst bij het dorp) en kwam in de metingen nooit zonder plek.

### 3. Het strandpad

De BLOCKED landcellen, meestal strand, die een civic-weg oversteekt tussen de deur (of het
kavel) en grond waar de router mag lopen, worden gewoon bestraat. Ze worden twee keer
vastgelegd:

- **In `cells` van het pad.** Zo heeft elke lezer ze als weg zonder iets nieuws te leren: de
  pagina die hem tekent, de bundel (`path()` in `lib/islandbundle.mjs` houdt `{ id, cells }`),
  de looproutes van de zee, `pruneUnreachable` en `layout-measure`.
- **In een nieuw veld `strand` op het padrecord** (alleen in layout.json). Daarmee zet de
  replay (die van `placeAll` en `replayGrid`) ze elke scan terug op PATH. Dat is dezelfde reden
  als bij de `slip` van een hellingbaan: de replay bestraat alleen FREE-cellen, en zonder dit
  zou strand onder een pad vrije grond lijken voor het volgende kavel dat op strand mag bouwen.

Terugzetten gebeurt alleen waar de cel nog BLOCKED land is. Het veld leeft en sterft met zijn
pad: gaat de weg weg (`pruneUnreachable`, `clearRoads`), dan gaat het strandpad mee, en de relay
legt ze samen opnieuw (`layCivicRoad`). `growCanvas` verschuift `strand` net als `cells`.

### 4. De volgorde in `civicRoad`

1. **De stap is begaanbaar**: precies zoals altijd, voor verreweg de meeste gebouwen.
2. **De stap is strand** (de deur op het strand): eerst een pad vanaf de stap zelf, zodat de
   weg aan de deur begint. Alleen bij echt strand: een civic in het binnenland met een steile
   stap houdt de weg die hij altijd kreeg.
3. **De stap is water** (de deur op zee): eerst de tocht vanaf het kavel. Die begint naast het
   kavel en dus altijd binnen `GATE_REACH`. Pas daarna `nearestWalkable`, die over het water
   heen kan grijpen (seed 10).
4. **De stap is bebouwd** (het kasteel, ingebouwd door de buren): `nearestWalkable` zoals
   altijd, en daarna de tocht vanaf het kavel.

## Gemeten na de bouw

- **Seeds 1–40 en 2024** (ladder tot 200 op 128): elke civic-deur heeft een eigen `path:` en een
  wegcel binnen bereik, en geen enkel havengebouw is zonder plek. De enige uitzondering is de
  scheepswerf op seed 9; die heeft een andere oorzaak en valt buiten dit plan. Bij het kasteel
  op seed 29 is het probleem verdwenen.
- **Op een kopie van het echte eiland** (Hoogezand, 29 september):
  - er zijn alleen de twee wegen bij gekomen die `52fe602` ook al legde: naar het pakhuis
    (18 cellen, waarvan 3 strand) en naar de waag (7 cellen, waarvan 4 strand);
  - de bomen daaronder zijn gerooid, en het kadedek groeit mee met de weg van het pakhuis
    (hetzelfde als met `52fe602`);
  - geen kavel is verschoven en het dorp is bit-identiek;
  - de tweede scan is byte-identiek;
  - met `52fe602` hadden die twee wel een `path:`, maar bereikte geen bewoner de deur. Nu is
    elke civic-deur bereikbaar.

## Compatibiliteit

`paths[].strand` is nieuw in layout.json, en dat hoort bij de **volgende minor** (0.7), niet bij
een patch. Een oudere 0.6 op hetzelfde eiland (`~/.promptholm`) tekent en loopt het strandpad
wel, want het staat in `cells`. Maar zijn replay laat het zand BLOCKED. Zijn router hergebruikt
het strandpad dus niet, en een oudere `coastSite` zou er een kavel overheen kunnen zetten. Voor
de zee en de pagina verandert niets: de bundel draagt alleen `cells`, dus er is geen `SEA_V`
nodig.

## Tests

In `tests/harbour-sites.test.mjs`, zonder coördinaten:

- op seeds 5, 2024 en 1337 heeft bij 200 elk civic-kavel met een deur (`plotDoor`) een
  `path:<id>` en een wegcel binnen `GATE_REACH` van die deur (`houseGate`). Op HEAD en op
  `52fe602` faalt dat op seed 2024;
- een strandpad staat in `cells`, ligt op land waar geen weg mocht, speelt terug als PATH, en de
  scan daarna verandert niets. Dat er zo'n pad is, wordt over de drie seeds geteld;
- "front opens on the open sea" is nu "open zee, of één cel strand en dan open zee".
