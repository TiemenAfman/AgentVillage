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

In aanbouw op `claude/gifted-leavitt-465053`.
