# De scheepswerf

**🚧 NOG NIET KLAAR**: er staan nog losse eindjes in dit plan (de tewaterlating, lopen op de
helling, werkers).

Begonnen op 28 september 2026. Referentie: de VOC-werf op Oostenburg in Amsterdam. Daar ligt een
houten helling die op palen het water in loopt, met stapelblokken en schoren. Aan de landkant
staan een geteerde loods met rode pannen en een witte boeiboord en een bok (twee spieren met een
takel), met stapels stammen en planken en een teerketel op een gemetselde haard. Op de helling
bouwt de werf de Batavia, in de Hollandse volgorde van haar eeuw.

## Stand van zaken

De werf staat op de ladder, op 95 settlers (`MILESTONES` in `lib/village.mjs`), op een kavel dat
de kern voor haar kiest (`yardSite` in `lib/layout.mjs`). De islander schrijft het stadium
(`yardStage`) op haar record, en de bundel draagt het mee. Op `/demo` staat het blok
"Shipyard", met alle vijf stadia naast elkaar, elk op een strook land boven een strook zee. In
`/editor` staat de groep "Shipyard".

- **Het kavel is 5 bij 16**, loodrecht op de kust. De voorkant van het model (+z) is de
  zeekant. De zes landrijen dragen de loods, de bok, de stapels, de teerketel en de kop van de
  helling. Bij een oneven `rot` stempelt de layout `w: 16, d: 5`. De tekening centreert zich op
  het midden van het kavel (`cellCentre` rekent al met `w` en `d`) en draait zoals elk gebouw.
- **De stadia** (`spec.stage`, 0 tot en met 4, een ontbrekende of kapotte waarde telt als 0). Ze
  volgen de schaalbouw zoals Witsen hem beschrijft: eerst de bodem, dan pas de spanten.
  - 0, **lege helling**: de helling met haar stapelblokken.
  - 1, **kiel en stevens**: de kiel, de voorsteven, de achtersteven met de hekbalk erover, en
    de schoren die de stevens overeind houden.
  - 2, **bodemhuid**: een ondiepe schaal van bodemplanken op de kiel, tot een paar gangen voorbij
    de kim. Klampen aan de buitenkant houden de gangen bijeen. Er staat nog geen spant, en de
    zijschoren komen erbij.
  - 3, **spanten**: dertien spanten in die schaal, die tot de hoogte van haar zijden oprijzen.
    Er lopen sentlatten langs de berghoutlijnen, de dekbalken liggen op de hoogte van elk dek,
    en de spiegel staat als los raamwerk boven de bodem. De klampen en de schoren van de stevens
    zijn weg, en er staat een ladder naar de ingangspoort.
  - 4, **romp**: de bovenhuid, de dekken en het hoge achterschip met spiegel, galerij en
    kampanje. Dit is de bake van de Batavia zelf, geen eigen model (zie Besluiten). Er staan
    geen masten op: die komen er na de tewaterlating in, aan de afbouwkade. Op de rede ligt ze
    op 120 dus meteen getuigd.

  Op 95, 102, 109 en 115 begint telkens een nieuw stadium, en op 120 gaat ze te water. Het tweede
  en derde schip volgen hetzelfde ritme (`yardStage`, ongewijzigd).
- **Stadium 4 tegen de Batavia op de rede**, gemeten op wat er getekend wordt, teruggedraaid naar
  haar eigen frame:

  | | op de helling (stadium 4) | op de rede (de Batavia) |
  |---|---|---|
  | lengte op de waterlijn | 11,98 | 11,98 |
  | breedte | 2,80 | 2,80 |
  | diepgang | 1,00 | 1,00 |
  | kuil boven de waterlijn | 1,10 | 1,10 |
  | bak | 1,60 | 1,60 |
  | halfdek | 1,65 | 1,65 |
  | kampanje | 2,10 | 2,10 |
  | reling bij de hek | 2,57 | 2,57 |
  | kroon van de spiegel | 3,03 | 3,03 |
  | hoogste punt boven de waterlijn | 3,49 (de lantaarns) | 11,50 (de grote mast) |

  De verschillen liggen onder een micrometer. Het is hetzelfde schip, maar dan in kaal hout en
  zonder wat ze pas drijvend krijgt.
- **Driehoeken**: het eigen model telt 3290 van de 4000 van een hero. In stadium 4 komt de
  gefilterde bake van de Batavia daarbij, 3191 van haar 6181.

  | stadium | 0 | 1 | 2 | 3 | 4 |
  |---|---|---|---|---|---|
  | driehoeken getekend | 926 | 1110 | 1872 | 3118 | 4261 |
  | hoogte boven het land | 4,42 | 4,42 | 4,42 | 4,42 | 4,42 |

  Tot en met stadium 3 is de bok het hoogste punt. In stadium 4 komen de lantaarns op haar kroon
  op dezelfde hoogte, doordat de helling de hek omlaag brengt. Alles blijft één draw call.
- **Hoogtes**: het nulpunt van het model is de voet van de palen (`y = 0`, zoals bij de
  steigers). Het datum `LAND` ligt 1,90 daarboven: de grond onder de loods.
  - `buildings.js` leest `LAND` af aan de oorsprong van `shipyard slipway`
    (`SHIPYARD_LAND`) en laat het model met dat getal zakken. In het gebouw is `y = 0` dus het
    land, net als bij elk ander gebouw.
  - De kop van de helling steekt 0,22 boven het datum uit. Waar de zes landrijen ophouden is
    dat nog 0,06, en de knik ligt 0,30 eronder.
  - De teen van de afloop ligt 1,25 onder het datum en de voet van de palen 1,90 eronder.
  - Haar kiel ligt midscheeps 0,19 boven het datum. Het midden van het schip staat 1,1 zeewaarts
    van het midden van het kavel.

## Besluiten

- **Stadium 4 is haar eigen bake, geen kopie.** `bataviaOnStocks` in `web/js/buildings.js`
  tekent haar delen, met haar driehoeken:
  - een halve slag gedraaid, zodat het achterschip naar zee ligt (zij is gemodelleerd met de boeg
    naar +z);
  - op de helling van 1 op 24 gelegd, op haar kiel.

  Waar ze ligt, leest de code af aan de gebakken oorsprong van de kiel van de werf, en haar
  helling aan het verloop van die kiel. Het getal staat dus maar op één plek. Zo is het schip op
  115 per constructie het schip op 120. Nagemeten kan niet anders dan op een paar centimeter
  kloppen, en dat was het alternatief: de romp in `build-shipyard.py` naar haar maten
  nabouwen. Het budget laat dit toe, omdat het een tweede asset in hetzelfde gebouw is (net als
  de schuur en de werf van de zagerij). De grondregel geldt per asset en speelt dus niet.
- **Wat eraf gaat, gaat per driehoek.** Haar tuig, vlaggen, boegspriet en ankertouw zitten in
  eigen delen (`batavia rig`, de vlaggen) en blijven weg. De staatsietrap met zijn vlonder en
  het reserveanker onder de kraanbalk zitten midden tussen haar `fittings`. Die gaan eraf op de
  plek waar ze in haar frame hangen:
  - de trap is alles naast de ingangspoort dat verder dan haar zij uitsteekt. Onder de rusten is
    dat voorbij 1,42 (haar grootste breedte is 1,40), en naast de rusten voorbij 1,5, omdat die tot
    1,47 uitsteken. Er wordt gekeken naar de buitenste hoek van de driehoek, niet naar het
    midden, zodat het bordes heel verdwijnt in plaats van langs een diagonaal doorgesneden;
  - het reserveanker is ijzer en hout onder de bakboordkraanbalk;
  - de marsen van het tuig zijn verf van haar trim en gaan op hoogte (boven 4,8).

  `mesh()` kreeg daarvoor een optie `keep`. Die komt niet in wat een deel van zijn opties
  onthoudt, net als `skip`.
- **Op de helling is ze hout, want verf hoort bij de afbouw.** De eik van haar zijden blijft, en
  ook het witte onderwaterschip en de teer: een bodem werd vóór de tewaterlating gesmeerd,
  omdat dat drijvend niet kan. Kaal eiken wordt:
  - het groen van haar panelen;
  - het rood van haar lijsten en haar verschansing;
  - het verguldsel van het snijwerk en de rode leeuw;
  - de geschilderde lucht op de spiegel.

  Ramen en lantaarns zijn donker en er brandt niets. Dat gaat op haar gebakken kleur
  (`STOCKS_PAINT`), niet op de naam van het deel, zodat een kleur die in de bake naar een ander
  slot schuift nog steeds gevonden wordt.
- **Stadium 1 tot 3 staan op haar lijnen.** De tabellen van `build-batavia.py` staan
  overgenomen in `build-shipyard.py`: breedte per hoogte, voor- en achtereinde, spiegel,
  bolheid van de boeg, dekken en relingen. Importeren kan niet, want die builder bouwt haar
  zodra hij draait. `tests/shipyard.test.mjs` houdt de kopie eerlijk: haar bake wordt door het
  vlak van elk spant gesneden, en elk spant moet binnen haar huid liggen en er hoogstens 0,12
  binnen. Ook moet de bodemschaal even breed zijn als haar huid op dezelfde hoogte.
- **Eén hero-asset, geen vijf civic-assets.** Het model heet `shipyard`, en elk stadium is een
  groep delen met `s<a>-<b>` in de naam: `shipyard s3-3 frames` wordt alleen in stadium 3
  getekend, `shipyard s2-4 shores` vanaf stadium 2. Een deel zonder token hoort bij de werf zelf.
  Een eigen asset per stadium kan niet: de grondregel van `scripts/model-rules.mjs` wil het
  laagste punt van elk asset op `y = 0`, en een kiel op stapelblokken halverwege een helling
  ligt daar nergens in de buurt. `shownAtStage` in `web/js/shipyard.js` is de enige kopie van de
  regel, en `HULL_STAGE` zegt vanaf welk stadium haar bake erop staat.
- **Het achterschip naar zee.** Schepen liepen met het achterschip eerst van stapel: dat is het
  volle eind en het drijft het eerst op. Een boeg die eerst wegzakt kan zich vastboren.
- **Het schip 1,1 zeewaarts.** Zo ver als haar galerij toelaat (die eindigt 0,3 binnen het
  kavel). Zo ver moest ze, omdat haar galjoen met de leeuw anders in de stag van de bok liep. Nu
  gaat de stag er 0,2 boven langs, en de poten van de bok 0,46 ernaast.
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
    dekhoogte, en het schip valt er binnen, ook haar bake in stadium 4.
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
    rede, waar ze getuigd en geschilderd weer verschijnt.
  - `sailIn` in `main.js` is het voorbeeld: een wachtrij-item met een `instant` voor wie niet
    kijkt.
  - De romp moet daarvoor uit de samengevoegde geometrie, als bewegend deel: wat
    `bataviaOnStocks` teruggeeft, als eigen mesh.
  - Daarna staat de werf weer leeg (stadium 0) en begint het volgende schip.
- **De tweede en derde romp**: de werf kan op de helling al laten zien welk van de drie het
  wordt, met de kleuren van `shipLivery` in de grondverf, of met een vlag op de bok.
- **Lopen op de helling**: dekhoogtes per cel voor het middelste deel van het kavel, zoals de
  bruggen hun `decks` hebben. Dan kun je langs het schip de afloop af, het water in. De romp en de
  blokken worden dan de botsers in plaats van de hele helling.
- **Werkers**: een scheepstimmerman met een dissel op een steiger langs de romp, en een
  teerkoker bij de ketel. Het zijn passieve settlers, zoals de smid.
- **Voor wie de plek kiest**: de teen van de helling ligt alleen onder water als het land van
  de zes landrijen niet hoger ligt dan ongeveer 1,2 boven zee (`YARD_LAND_MAX` in de plekregel).
