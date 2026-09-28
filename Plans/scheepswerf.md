# De scheepswerf

**🚧 NOG NIET KLAAR**: het model en de tekening staan, maar de werf staat nog niet op het
eiland. De trede (95), de plek en het veld `stage` komen uit andere werkpakketten van
[mijlpalen-tot-tweehonderd.md](mijlpalen-tot-tweehonderd.md).

Begonnen op 28 september 2026. Referentie: de VOC-werf op Oostenburg in Amsterdam. Daar ligt een
houten helling die op palen het water in loopt, met stapelblokken en schoren. Aan de landkant
staan een geteerde loods met rode pannen en een witte boeiboord en een bok (twee spieren met een
takel), met stapels stammen en planken en een teerketel op een gemetselde haard.

## Stand van zaken

Het model, de tekening, `/demo` (blok "Shipyard", alle vijf stadia naast elkaar, elk op een
strook land boven een strook zee) en `/editor` (groep "Shipyard") zijn klaar. De werf staat nog
niet in `MILESTONES` en heeft nog geen plekregel. De islander schrijft ook nog geen `stage`.

- **Het kavel is 5 bij 16**, loodrecht op de kust. De voorkant van het model (+z) is de
  zeekant. De zes landrijen dragen de loods, de bok, de stapels, de teerketel en de kop van de
  helling. Bij een oneven `rot` stempelt de layout `w: 16, d: 5`. De tekening centreert zich op
  het midden van het kavel (`cellCentre` rekent al met `w` en `d`) en draait zoals elk gebouw.
- **De stadia** (`spec.stage`, 0 tot en met 4, een ontbrekende of kapotte waarde telt als 0):
  - 0: lege helling met stapelblokken;
  - 1: kiel, voor- en achtersteven, met eigen schoren;
  - 2: spanten op de kiel, sentlatten, dekbalken en het raamwerk van de spiegel;
  - 3: beplankte romp met wit onderwaterschip, zwarte berghouten, bruin geteerde huid, vier
    dekken, de platte spiegel met kajuitramen, het roer en het galjoen;
  - 4: de ondermasten staan, met marsen en ezelshoofden, zonder tuig en zonder zeilen.
- **De romp, gemeten op de bake**:
  - 12,04 lang op de waterlijn, 13,86 over alles (galjoen tot kroon van de spiegel), 2,80
    breed;
  - diepgang 0,95, hoofddek 1,10 boven de waterlijn, kampanje 1,79 en de kroon van de spiegel
    2,53 daarboven;
  - de grote mast staat 7,75 boven de kiel.

  `tests/shipyard.test.mjs` houdt die maten vast.
- **Driehoeken**: het hele model 3308 van de 4000 van een hero.

  | stadium | 0 | 1 | 2 | 3 | 4 |
  |---|---|---|---|---|---|
  | driehoeken getekend | 926 | 1038 | 2384 | 1930 | 2074 |
  | hoogte boven het land | 4,42 | 4,42 | 4,42 | 4,42 | 7,97 |

  Tot stadium 4 is de bok het hoogste punt, daarna de grote mast. Alles blijft één draw call.
- **Hoogtes**: het nulpunt van het model is de voet van de palen (`y = 0`, zoals bij de
  steigers). Het datum `LAND` ligt 1,90 daarboven: de grond onder de loods.
  - `buildings.js` leest `LAND` af aan de oorsprong van `shipyard slipway`
    (`SHIPYARD_LAND`) en laat het model met dat getal zakken. In het gebouw is `y = 0` dus het
    land, net als bij elk ander gebouw.
  - De kop van de helling steekt 0,22 boven het datum uit. Waar de zes landrijen ophouden is
    dat nog 0,06, en de knik ligt 0,30 eronder.
  - De teen van de afloop ligt 1,25 onder het datum en de voet van de palen 1,90 eronder.
  - De kiel ligt midscheeps 0,20 boven het datum, bij de voorsteven 0,43 en bij de hiel -0,03.

## Besluiten

- **Eén hero-asset, geen vijf civic-assets.** Het model heet `shipyard`, en elk stadium is een
  groep delen met `s<a>-<b>` in de naam: `shipyard s2-2 frames` wordt alleen in stadium 2
  getekend, `shipyard s1-4 keel` vanaf stadium 1. Een deel zonder token hoort bij de werf zelf.
  Een eigen asset per stadium kan niet: de grondregel van `scripts/model-rules.mjs` wil het
  laagste punt van elk asset op `y = 0`, en een kiel op stapelblokken halverwege een helling
  ligt daar nergens in de buurt. `shownAtStage` in `web/js/shipyard.js` is de enige kopie van de
  regel. Een later stadium laat weg wat het bedekt: de huid gaat over de spanten, en de
  zijschoren nemen het over van de schoren van de stevens.
- **Het achterschip naar zee.** Schepen liepen met het achterschip eerst van stapel: dat is het
  volle eind en het drijft het eerst op. Een boeg die eerst wegzakt kan zich vastboren.
- **De helling helt 1 op 24**, zoals een kiel gelegd werd, en het schip ligt daar evenwijdig op.
  Een echte helling loopt onder water op dezelfde helling door. Op een kavel van 16 gaat dat
  niet samen met een droge kiel. Daarom loopt de laatste 1,3 cel steil het water in: de afloop.
- **De kop van de helling steekt boven de grond uit**, op een stenen bed. Toen de kop op de grond
  lag, verdwenen op vlak land de stapelblokken twee rijen voor het strand in het gras. De
  werf wordt immers op het hoogste land van de landrijen gezet. Zo ligt de helling over alle
  zes landrijen boven het datum.
- **Op het land zetten, niet in het midden.** `shipyardGround` neemt het hoogste land van de
  hoeken van de zes landrijen, en nooit minder dan `YARD_FLOOR` (0,65 boven zee). Op een lager
  strand zou de achtersteven in het water staan. Wat lager ligt dan het datum, vangen de rokken
  van de plint, de haard en het bed op. Hoeken in het water tellen niet mee.
  - `poseOnPlot` in `main.js` en `raise` in `guest-island.js` gebruiken allebei deze functie.
  - `turnLocal` draait precies zoals de yaw van `makeRecord`, en de test controleert dat voor
    alle vier de `rot`s.
- **Botsen**: de werf staat in `APART`, dus de delen worden niet samengevoegd. Samengevoegd
  werd het hele kavel één blok, ook de strook naar het water.
  - De helling is één blok. Er loopt niemand over de sleephelling, want die heeft geen
    dekhoogte, en het schip valt er binnen.
  - De loods, de stammen, de planken en de haard zijn elk een eigen blok.
  - De strook aan stuurboord (x 1,96 tot 2,5) is vrij, van de poort tot het water. Daar zit
    `anchor.door`, op (2,2, land, -8): daar hoort een weg aan te komen. Een deur aan de
    voorkant zou een deur in zee zijn.
- **Geen porch** (`NO_PORCH`). Alles onder 0,45 is zestien cellen helling, en daaronder zou
  een stenen kade over het hele kavel komen.
- **'s Nachts** gloeien de lantaarn aan de loods en het vuur onder de teerketel. Op het schip
  brandt niets, want een schip op stapel is niet verlicht. De teerketel rookt (`anchor.smoke`).
- **Een nieuw stadium is een refit**: `applyVillage` bouwt de werf opnieuw op zijn plek, met
  een wolkje stof. Een gastiland doet hetzelfde, omdat `stage` geen zacht veld is in
  `islandsig.js`.
- **Geen versiepoort.** Er verschuift niets, het is een nieuw gebouw.

## Later

- **De tewaterlating**, bij 120 (en daarna bij 158 en 192): een lokale animatie voor wie kijkt.
  - De romp van stadium 4 glijdt achterschip eerst de helling af, drijft op en vaart naar de
    rede, waar het schip van het andere werkpakket ligt.
  - `sailIn` in `main.js` is het voorbeeld: een wachtrij-item met een `instant` voor wie niet
    kijkt.
  - De romp moet daarvoor uit de samengevoegde geometrie, als bewegend deel. `shownAtStage`
    heeft al de delen die erbij horen: kiel, stevens, huid, dekken en masten.
  - Daarna staat de werf weer leeg (stadium 0) en begint het volgende schip.
- **Lopen op de helling**: dekhoogtes per cel voor het middelste deel van het kavel, zoals de
  bruggen hun `decks` hebben. Dan kun je langs het schip de afloop af, het water in. De romp en de
  blokken worden dan de botsers in plaats van de hele helling.
- **Werkers**: een scheepstimmerman met een dissel op een steiger langs de romp, en een
  teerkoker bij de ketel. Het zijn passieve settlers, zoals de smid.
- **Het tweede en derde schip**: in andere kleuren, en de werf mag dan zien welk schip het is,
  bijvoorbeeld aan een vlag op de bok.
- **Voor wie de plek kiest**: de teen van de helling ligt alleen onder water als het land van
  de zes landrijen niet hoger ligt dan ongeveer 1,2 boven zee. De plekregel moet dus laag,
  vlak land aan de kust zoeken, met de afloop naar open water.
