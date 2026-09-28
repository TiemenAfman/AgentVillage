# Het kroniekhuis

**🚧 NOG NIET KLAAR** — er staan nog losse eindjes in dit plan.

Begonnen op 28 september 2026. De laatste trede van de ladder (trede 200 in
`Plans/mijlpalen-tot-tweehonderd.md`): het dorp gaat zijn eigen geschiedenis opschrijven.
Referentie: een archief of museum in Hollands classicisme, zoals een zeventiende-eeuwse waag of het
Mauritshuis. Een bakstenen zaal op een zandstenen plint, lichte hoekpilasters en een licht
hoofdgestel rondom, een portiek van vier zuilen onder een fronton, hoge rondboogramen aan elke
kant, een schilddak van terracotta, en op de nok een achtkantige lantaarn onder een koepel van
patina met een bronzen armillairsfeer erop. In het timpaan, in brons, een open boek met een
ganzenveer erover.

## Stand van zaken

Het model staat op `/demo` (rij "Civic", "Chronicle house"), `civic()` tekent het, en de deur
werkt. **Nog niet op het eiland**: de trede in `MILESTONES` en de plek (`TRADES`, of naast het
kasteel) horen bij het werkpakket van de ladder. Tot die er zijn bestaat er geen record
`civic:chronicle`, en dan gebeurt er ook niets.

Gemeten op de bake, met het stadhuis ernaast:

| | breed | diep | hoog | driehoeken |
|---|---|---|---|---|
| kroniekhuis (`civic_chronicle`) | 1,91 | 1,55 | 2,44 | 1306 van 1500 |
| stadhuis (`townhall`) | 1,93 | 1,56 | 2,91 | 2492 |

De zaal is één hoge verdieping: een leeszaal, geen woonhuis. De muren zijn 0,90 hoog boven de plint
(3,6 m) en de zuilen ook 0,90. De deur is 0,26 breed, met deurbladen van 0,48 en een bovenlicht.
Ter vergelijking: de deurnis van het stadhuis is 0,48 bij 0,72, en een settler is 0,43. De
raamopeningen zijn 0,55 hoog.

Wat het opent:

- **Een klik van boven, of E bij de deur te voet, opent de kroniek.** Dat is de balk onderaan het
  scherm: ▶ vanaf de stichtingsdag, op de snelheid waarop de balk staat. Hetzelfde
  `state.chronicle` dat `onPlay` verzet, via hetzelfde `setChronicleTime`.
- **Te voet eerst omhoog** (`exitWalk`). De balk hoort bij het uitzicht van boven (`ui.js` verbergt
  hem te voet), en een terugspoeling haalt elk huis rond de loper weg. `exitWalk` brengt het hele
  eiland in beeld, en dat is precies het beeld dat een terugspoeling nodig heeft.
- **Een klik opent geen dossier.** Het dossier van een gemeentegebouw is een naam en een datum; de
  kroniek is die datum en alle andere. Onder de naam staat daarom "click to read the chronicle".
- **Niet alleen voor de bewaarder**, anders dan het register van het stadhuis. De kroniek komt uit
  `village.json`, en die heeft elke bezoeker al.

## Besluiten

- **Gewone Blender-pijplijn**: `scripts/build-chronicle.py` → `assets/chronicle/chronicle.blend` →
  `web/js/chronicle-mesh.js`. Eén gemeente-asset, `civic_chronicle`, waarin niets beweegt. Eén
  materiaal, dus één draw call.
- **Hollands classicisme, geen trapgevel.** Een portiek met zuilen en een fronton maakt het na het
  stadhuis het deftigste gebouw van het dorp. Een trapgevel met een klok zou de klokkentoren
  herhalen. De baksteen is die van het dorp (de school, de kerk), de pannen die van de taverne en
  de patina die van het stadhuis. Alleen het lichte zandsteen en het brons zijn van het kroniekhuis
  zelf.
- **Nooit groter dan het stadhuis.** Breedte, diepte en hoogte blijven elk onder die van het
  stadhuis; `tests/chronicle.test.mjs` houdt dat vast. Daarom heeft de portiek geen eigen trede:
  de civic-stoep van `buildings.js` heeft er al twee, en met een derde werd het huis 1,63 diep.
- **Het boek en de sfeer zijn de borden.** Er staan geen letters op, want zonder textures kan dat
  niet. Het boek in het timpaan heeft alleen lijnen, als suggestie van schrift, en de ganzenveer
  zegt dat het nog geschreven wordt. De armillairsfeer heeft een meridiaan, een horizon en een
  evenaar, maar geen ecliptica. De evenaar staat op zijn kant precies wanneer je de meridiaan recht
  van voren ziet, en een ecliptica op 23,5 graden staat dan mee op zijn kant. De eerste versie liet
  van voren-rechts daardoor één ring en twee strepen zien. De horizon leest als ring van overal
  boven hem, en van de andere twee is er altijd één open.
- **Het licht.** 's Nachts gloeien de negen hoge ramen, acht spleten in de lantaarn, het bovenlicht
  van de deur en twee lantaarns in de portiek (`emissive`).
- **Geen schoorsteen**, en dus geen `anchor.smoke`: een archief houdt zijn vuur weg van zijn
  papier.
- **De deur.** `anchor.door` staat aan de voet van de portiek. De prompt hangt 0,3 daarvoor en
  antwoordt tot 1,2 (`web/js/chronicle-house.js`): van voren en vanaf de voorhoeken, niet langs de
  zijkanten, waar je de deur niet ziet. De test legt vast dat de prompt voor alle vier de
  draaiingen aan de kant zit die `DOOR_DIR` zegt.
- **Op een gast-eiland: geen prompt, en een klik doet niets.** De kroniek is van ons dorp:
  - `chronicleBounds` leest onze stichtingsdag;
  - `applyVisibility` spoelt alleen `state.byId` terug;
  - de gast-crowds zijn verborgen zolang de kroniek teruggespoeld staat.

  Een kroniekhuis van de buren staat onder `guest:<regio>:<id>` en komt nooit in `state.byId`. Het
  krijgt dus geen prompt, en een klik erop doet wat een klik op elk gastgebouw doet: niets. De
  geschiedenis van een ander eiland laten zien vraagt een projectie van hun bundel en een tweede
  set records om terug te spoelen. Dat is een eigen plan, geen deur.
- **Op de telefoon niets**: daar is geen eigen eiland, en `exitWalk` weigert er.
- **Geen versiepoort en geen veld in de bundel.** Het is een nieuw civicType, dat een oudere pagina
  als stenen blokje tekent (de `default:` in `civic()`), net als elke nieuwe trede. Dat hoort bij
  de volgende minor, zoals de ladder zelf.

## Later

- **De trede zelf**, in het werkpakket van de ladder:
  - `{ id: 'chronicle', at: 200, civicType: 'chronicle', label: 'The chronicle house' }` in
    `MILESTONES`;
  - een plek;
  - de lijsten die daarbij horen: `MOVABLE_CIVICS` en `CIVIC_NAMES` in `lib/plan.mjs` als de
    bewaarder hem mag verplaatsen, en `docs/manual.md`.
- **Een archivaris als bewaarder** (`KEEPERS`), bij wie je de kroniek opent zoals bij de
  burgemeester het register.
- **Een armillairsfeer die langzaam draait**: een bewegend deel met `skip`, zoals het zaagblad van
  de zagerij.
- **Te voet lezen**: de balk ook te voet tonen en de loper door een terugspoeling laten lopen. Dan
  moet walk-mode om kunnen gaan met gebouwen die er even niet zijn.
