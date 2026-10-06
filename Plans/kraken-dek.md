# 🚧 Het dek van de Salty Kraken: een deur, een luik en een touwladder

Plan van 3 oktober 2026, vervolg op [kraken-op-zee.md](kraken-op-zee.md). De keeper wil "hier nog een functionele
deur": in de voorwand van het achterkasteel, naar het middendek. Binnen kom je er via een luik in de lofts, en
buiten via een touwladder langs de romp.

## Besluiten (van de keeper, 3 oktober)

| Vraag | Keuze |
|---|---|
| Waar binnen | Een **luik in de lofts**: een ladder op de oostelijke bovengalerij omhoog, E bij het luik. |
| Wat beloopbaar | Het **middendek** tussen voorkasteel en achterkasteel, plus de **daken** van beide kastelen via korte trapjes. |
| Toegang van buiten | **Ook een touwladder** langs de romp, vanaf het bordes van de zigzagtrap. |

## Ontwerp

**Alles in de bake, als ankers** (scripts/build-piratetavern.py). Zo zitten de getallen op één plek en lopen
tekening en voeten niet uit elkaar. Het vocabulaire is dat van de trap: `anchor.deck.<naam>.lo|hi` voor een vloer,
`anchor.stair.<naam>.lo|hi` voor een helling, `anchor.rail.<n>.a|b` voor een leuning en `anchor.solid.<naam>.lo|hi`
voor een blok met een hoogte.

- **Dek**: het middendek volgt de zeeg en de 3° slagzij. Daarom wordt het een rij hellingen langs x (de zeeg), in
  stroken over de breedte (de slagzij), elk punt door `world_of` op zijn plek. De kasteeldaken zijn vlakke stroken.
- **Muren**: de verschansing langs het middendek en de balustrades van de daken worden leuningen. Masten, luiken,
  kaapstander, vaten en kisten op het dek worden blokken. De wanden van beide kastelen ook, met de deur als gat.
- **De romp-solid** (`solid.hull`) loopt nu tot het dak van het kasteel. Hij stopt voortaan onder het dek, anders
  sta je op het dek in een muur. `pirateSolids` leest alle `solid.*`-blokken, niet alleen de romp.
- **De deur**: een boogdeur zoals die bij de trap, in de voorwand van het achterkasteel op dekhoogte. Ervoor ligt
  een vloer `deck.door-step`; het midden daarvan is waar je uitkomt en waar E werkt.
- **Trapjes** naar beide daken, getekend als treden zoals de zigzagtrap.
- **Touwladder** van het bordes van de zigzagtrap langs de romp tot over de verschansing. Gelopen als steile
  helling (een ladder in een kamer doet hetzelfde), met binnen een opstapje terug naar het dek.

**De overgang** (main.js, interior.js):
- Op het dek: E bij de kasteeldeur brengt je naar binnen, op de plek van het luik in de lofts (`spot`, zoals de
  kamer-herinnering).
- In de zaal: E bij het luik brengt je naar buiten, op `deck.door-step` van de Kraken waar je binnenkwam.
- Het luik en de ladder ernaartoe worden in de kamer getekend uit eenvoudige vormen. Hun maten staan in
  kraken-layout.js, zodat de zaal niet opnieuw gebakken hoeft te worden (34 MB).

**Wat niet verandert**: niets in de layout, niets op de draad en geen nieuw veld in de bundel. Anderen zien je
op het dek staan via je gewone positie. Het is dus een patch, al gaat hij mee in de minor van kraken-op-zee.

## Stand

Gebouwd op `claude/gifted-leavitt-465053` (3 oktober 2026).

- **Het luik zit in het kraaiennest, niet in de oosthoek van de lofts.** Daar was het pikkedonker: geen van de zeven
  lampen reikt ertot, en een extra lamp mag niet (het aantal lichten zit in de programmasleutel). Het kraaiennest is
  een van de lofts en wordt verlicht door de twee kaarsenboten en de maan. Het luik heeft een ladder langs de oostkant
  van de mast naar een luik in de nok (`HATCH` in kraken-layout.js, getekend met een paar blokken in pirate-tavern.js).
- **De ingang van de ladders in de dakleuningen** is een hand breder dan de ladder. Door de slagzij ligt de rand van
  het dak een paar centimeter verder naar het water dan de voet van de ladder.
- **Blokken krijgen het grondvlak van hun voet**: met de top meegerekend helde de mast 0,4 opzij en sloot hij het dek af.
- **Twee vaten bij de kaapstander zijn weg**: ze stonden aan de voet van de dakladder. De deur staat aan de landzijde
  (z -0,36), de dakladder aan de waterzijde.
- Gemeten met de echte walk mode (`tests/pirate-stair-walk.test.mjs`): van het bordes de buitenladder op, over de
  plank aan dek, om luik, mast en kaapstander naar de deur, de dakladder op naar het kasteeldak; en van het middendek
  naar het voorkasteel. In de pagina op een kopie van Hoogezand: E bij de deur zet je in het kraaiennest, E bij het luik
  weer bij de deur, en door de voordeur van de zaal kom je op het stoepje van de trap uit.
- Bake: 85.080 driehoeken.
