# Het eiland laten groeien

> "Kunnen we die islandsize van 256 dynamisch maken? Stel ik wil dat die nog verder
> uitgroeit, of ik wil iets van 50×50 inpolderen." — en daarna: "Die 256 kan dan wel voor
> nieuwe mensen eerst 16×16 worden, en dan laten we het eiland écht groeien."

**Status:** fase 1 (het terrein), fase 2 (de layout, de Grow-knop, klein stichten) en fase 4 (het doek groeit, ook voor een bestaand eiland) gebouwd op 24 september 2026, zie "Fase 1/2/4, gebouwd". Ook gebouwd, los hiervan,
op dezelfde dag: een handmatige polder mag nu ook een super-cel nemen waar de kustlijn doorheen
loopt (`polderCandidate(…, { shore: true })`). Dat was de reden dat polderen langs een kust
met een strook ondiep water vóór het strand onmogelijk was.

## Context

`gridSize` is nu één getal dat drie verschillende dingen tegelijk betekent:

1. **Het doek:** de heightfield is `size+1` hoeken in het vierkant. `layout.json` bewaart elke
   cel als grid-index `0..size-1`.
2. **De vorm:** de kust ligt op `coastScale = half * 0.9375` (`shared/terrain.mjs:752`).
   Rivieren mikken op `half - 2` (:852), en hun kronkel hasht op de grid-index (:226).
3. **De ligplaats:** op de zee bepaalt `half` de afstand tot de buren (`shared/regions.mjs:75,
   87, 125-145`).

Daarom kan het getal niet veranderen. Een ander `size` verschuift de kust, en dan gebeurt dit:

- de terrain-hash verandert;
- `placeAll` ziet dat als een nieuw eiland (`resetForNewTerrain`);
- `loadLayout` gooit het dorp al eerder weg op `l.size !== size` (`lib/layout.mjs:139`).

Wat wél al meevalt:

- De ruis zelf werkt op absolute celcoördinaten rond het midden (`x = i - half`), met een
  vaste frequentie. De heuvels, meren en schouders liggen dus op vaste afstanden.
- Het afhankelijke deel zit alleen in de kust-falloff, de rivieren en de rand van de blur.
- Er is geen lijst met toegestane groottes: `parseBundle` kent alleen `GRID_MIN = 16` en
  `GRID_MAX = 512`.

## Het principe

**Groeien is aanwas, geen herberekening.** Het eiland van gisteren blijft bit voor bit
hetzelfde eiland. Wat erbij komt, is land dat eerst zee was. Dat is precies het mechanisme van
een polder: een lijst cellen in `layout.json`, meegegeven aan `makeTerrain`, en de hash wordt
ná het graven vastgelegd. Alleen is dit land geen vlakke polder met een dijk. Het krijgt de
vorm van een groter eiland met hetzelfde zaad.

Er zijn dus twee losse assen:

| | wat | wanneer |
|---|---|---|
| **vorm** (`layout.growth`) | welke ringen zee al land zijn geworden, en met welke straal | per stap, net als de polder-ladder: een zuivere functie van het aantal settlers |
| **doek** (`layout.size`) | hoe groot het vierkant is waarin dat past | alleen als de aanwas de rand bijna raakt |

## Besloten door Martijn (24 september 2026)

- **Startgrootte `minSize` = 32 cellen** (8×8 super-cellen). Eerst meten of het plein met
  zijn civic-kavels daarop past. Past het niet, dan is dat de eerste groeistap, niet een
  grotere `minSize`.
- **Groeien op vraag:** alleen als de volgende wijk niet meer past (open vraag 5). De stap
  valt één scan later, en de scan daarna is byte-gelijk.
- **Havens schuiven mee** (open vraag 4). Haven, kade, vuurtoren en de kadewijk verhuizen
  als geheel naar de nieuwe kust. De corridor-variant vervalt.
- **Een Grow-knop in de planner, meteen** (open vraag 2). Die komt in de eerste fase die
  echt land maakt (fase 2), als plan-op `grow`, net als `polder`.

## Besluiten (voorstel, nog te bevestigen)

| Vraag | Voorstel | Waarom |
|---|---|---|
| Hoe groeit de vorm? | **Gebouwd, zie Fase 1.** Een stap is `{ r, hold }`: straal plus de cellen waar iets staat. De grond wordt uit de stappen afgeleid, er wordt geen cellenlijst bewaard. | Compact in `layout.json` en de bundel. Een grotere versie van dezelfde formule, dus reproduceerbaar. |
| Wanneer groeit het? | **Besloten: op vraag** (zie boven). | De stap valt een scan later, en de scan daarna moet byte-gelijk zijn. |
| Hoe loopt de nieuwe rand over in de oude? | **Gebouwd:** een helling vanaf de oude kust (`GROW_SHORE` + `GROW_RISE`), en het oude strand groeit mee. | Anders ontstaat er een trede, of een zandring in de wei. |
| Rivieren | Blijven waar ze zijn. Een rivier wordt niet verlengd naar de nieuwe kust. De aanwas sluit hem af of laat hem in een meer eindigen. | Verlengen hasht op grid-indices en verandert het oude verloop. Uitstellen, want het is fase 5+. |
| Het doek groeien | Centraal met `+2k`: elke opgeslagen index `+k`, in één migratiefunctie `growLayout(layout, k)`. | De lokale wereldposities blijven gelijk (`cellWorld = gx - half + 0.5`), dus er verschuift niets zichtbaars. |
| Of: meteen een groot doek? | Alternatief: elk eiland krijgt eenmalig `GRID_MAX` en alleen de vorm groeit. | Geen tweede migratie ooit. Maar 512² is 4× de cellen van 256², voor terrein, A*, het mesh en elke gast. Kiezen na een meting (fase 3). |
| De ligplaats op zee | Een eiland reserveert bij zijn komst ruimte voor een maximum (`growCap`, voorstel 256) in plaats van zijn huidige `half`. | Nu springt een eiland dat groter publiceert en een buur raakt naar een nieuwe ligplaats (`lib/fleet.mjs:195-207`). Dat breekt "een eiland verhuist nooit". Groei voorbij de cap wordt geweigerd. |
| Beginnen op 16×16 | Nog niet besloten, zie open vraag 1. | `GRID_MIN` is 16, maar het plein, de civic-kavels en `MIN_HAMLET` passen daar waarschijnlijk niet in. |

## Wat breekt en moet mee (uit de verkenning)

**Het terrein** (`shared/terrain.mjs`)
- `coastScale` moet uit een eigen parameter komen, niet uit `half`.
- De blur en "buiten het grid is zee" (`:201, :918`) zorgen dat het groeien van het doek ook de
  2 hoeken langs de oude rand verandert. Die moeten gelijk blijven, of in de migratie
  bevroren worden.
- Het shared-verbod op `sin` / `cos` / `pow` blijft gelden.

**De layout** (`lib/layout.mjs`)
- Alles wat een grid-index opslaat, verschuift bij `growLayout`: plots, paden, bruggen,
  `cleared`, polders (cellen, pools, dike), fairway, havens, zones, wegen,
  `town.centre` / `square` en `lattice.anchor`.
- Super-cel-coördinaten ten opzichte van het anker blijven gelijk.
- Sleutels gemaakt als `gx + gz * size` veranderen, maar die worden niet opgeslagen.
- `seaMask` en `enclosedWater` vullen vanaf de rand van het grid. Na het groeien zijn dat
  andere randen: controleren dat havens en de fairway niet herplannen.

**De zee**
- `regions.mjs` `replace` houdt de oude `levelBase` terwijl de stride `size² + 1` is. Een
  gegroeide regio loopt dan over in de sleutels van de volgende. Dat is een bestaande bug die
  pas zichtbaar wordt zodra dit gebouwd is.
- `parseBundle` controleert cellen tegen `0..size-1`. Dat is prima zolang de bundel zijn eigen
  nieuwe `size` meestuurt.
- `horizon.js` bouwt silhouetten uit `seed` + `gridSize`, dus die moeten ook `growth` meekrijgen.

**Het scherm** (`web/js/`)
- `createLandscape` bouwt het mesh eenmalig op `N * N`. `reshape` gaat uit van dezelfde `N`,
  dus bij een groter doek moet het landschap opnieuw gebouwd worden, zoals bij een polder via
  `layLandscape` / `sea.replace`.
- Ook deze dingen lezen `half` / `size` eenmalig: water-patch, mist, camerabereik, minimap,
  de zoomgrens in plan mode en de sleutel van het concept in localStorage.

## De havens, de kade en de vuurtoren gaan mee

Een eis van Martijn: als de kust naar buiten schuift, moet alles wat óp de kust staat mee
naar buiten. Anders ligt de kade straks midden in een weiland. Het gaat om:

- de kade (quay) met zijn planken en huizen;
- de vier havens (`layout.harbours`) met hun steigers, slipways en boten;
- de landing;
- de vuurtoren.

Dat botst met "een huis verhuist nooit", en dat is hier bewust. De regel beschermt settlers
tegen de scanner. Een kade die niet meebeweegt, beschermt niemand. Voorstel:

- **De aanwas laat een corridor vrij voor elke haven.** Zo'n corridor is een strook zee in de
  richting van de steiger, en die blijft zee. De haven blijft dan aan open water liggen, en
  er hoeft niets te verhuizen.
  - Nadeel: het eiland krijgt inhammen. Dat oogt als echte havens, dus dat is misschien juist
    goed.
  - Dit is de goedkope variant en de default.
- **Of: de haven schuift mee met de stap.** Elke groeistap die voor een haven land maakt,
  plant die haven opnieuw op de nieuwe kust.
  - Dat gaat met hetzelfde mechanisme als `QUAY_VERSION` (`planHarbours` / `standingQuay`),
    maar dan getriggerd door de stap, niet door een versie.
  - De kadehuizen en hun wijk verhuizen dan als geheel, zoals een `move` in de planner:
    delta per super-cel, met dezelfde validatie.
  - De boten keren terug naar hun (nieuwe) ligplaats, zoals `lib/boats.mjs` al doet na vijf
    stille minuten.
  - De vuurtoren is een civic-kavel en schuift met de delta van zijn eigen haven mee.
  - De approach-wegen (`road:harbour:<n>:approach`) en de slipway worden opnieuw gerouteerd.
- **Wat hoe dan ook moet:** een groeistap mag nooit land maken óp een kade- of havencel. Dat
  zijn dezelfde regels als `fairwayHeld` bij een polder. Ook de fairway zelf blijft water,
  anders is hij zinloos.

Beslissing nodig: een corridor, of meeschuiven? Zie open vraag 4.

## Instelling: `gridSize` wordt een bereik

Nu staat er één `gridSize` in `config.json`. Met groei betekent één getal niets meer: het
eiland heeft dan een huidige grootte, een ondergrens om mee te beginnen en een grens waar
het ophoudt. Voorstel:

```json
"island": { "minSize": 64, "maxSize": 256 }
```

- **`minSize`** is waar een nieuw eiland begint. Het is ook de ondergrens voor de optimalisatie
  hieronder: kleiner wordt het nooit, al zou het dorp erin passen.
- **`maxSize`** is de wens van de gebruiker voor hoe groot het mag worden.
  - Het is ook de `growCap` die het eiland bij aankomst op zee reserveert (zie Besluiten).
  - Een zee mag hem begrenzen: een host die geen 512-eilanden wil, weigert ze bij `publish`.
    Een eiland dat groter wil dan de zee toestaat, blijft op de grens van de zee staan.
- **De huidige grootte staat níét in de config.** Het is een feit over het eiland, geen
  wens. Dus hoort hij in `layout.json` (`layout.size`, zoals nu), naast de groeistappen. Zo
  is `layout.json` het ene bestand dat zegt hoe het eiland eruitziet, en kan een config-edit
  het eiland niet stilletjes resetten. Dat kan nu wel: een ander `gridSize` in `config.json`
  gooit het dorp weg.
- **Migratie:** een bestaand `gridSize: N` wordt `{ minSize: N, maxSize: N }`. Een bestaand
  eiland verandert dus niet en groeit pas als de gebruiker `maxSize` ophoogt. Dat is het
  veilige default voor iemand die niets heeft gevraagd.
- De Settings-pagina krijgt twee schuifjes in plaats van geen. `maxSize` omlaag zetten tot
  onder de huidige grootte kan niet: het eiland krimpt nooit (zie hieronder).

## De kleinst mogelijke eilandvorm voor het dorp

Martijns wens: een eiland dat niet groter is dan de dorpsindeling nodig heeft. Nu is het
precies andersom: het eiland is een vaste 256, en het dorp beslaat daar 51% van
(`layout-measure`: huizen 169×157 op land 232×226, 343 huizen). De rest is bos en strand
waar niemand woont.

**Wat "kleinst mogelijk" betekent:** de kleinste straal waarbij alle super-cellen die het dorp
nu gebruikt, en de volgende groeistap ervan, gewoon land zijn. Dat is inclusief de parcels
van de wijken, het plein, de havens, de wegen en een bos-marge. Dat is een zuivere functie
van het model, net als de polder-ladder, dus een rescan geeft hetzelfde antwoord.

Het werkt twee kanten op:
- **Voor een nieuw eiland (de hoofdzaak):** het groeit alleen nog als de dorpsindeling ruimte
  vraagt, niet op een vast aantal settlers. Dus: "de volgende hamlet past niet meer" →
  groeistap. Dat is `rec.guest` uit `ensureParcel`, precies het signaal dat de
  polder-ladder niet mocht gebruiken, omdat het pas ná de plaatsing bekend is. Voor groei
  is het wél bruikbaar als de stap één scan later valt, en die scan daarna niets meer
  verandert. Dat moet een test afdwingen: scan, groei, scan, en daarna twee scans byte-gelijk.
- **Voor een bestaand eiland (zoals het live eiland op 256):** de vorm krimpt **nooit**. Zee
  terug laten komen over land dat al getekend is, is precies wat `unpolder` alleen per
  polder en met toestemming mag. Wat wél kan: het *doek* inkrimpen tot de bounding box van
  het land plus zee-marge. Dat scheelt terrein-, mesh- en bundelgrootte zonder dat er één
  cel verandert. Dat is een migratie met `-k`, het omgekeerde van `growLayout`. Pas doen
  als fase 4 er is.

**De randvoorwaarde die dit lastig maakt:** de dorpsindeling hangt nu af van de grond. Een
wijk krijgt land waar het vlak genoeg is, en een kleiner eiland heeft minder vlak land op
dezelfde plek. Kleinst mogelijk wordt dus iteratief: kleine straal → plaatsen → past het
niet → één stap groter. Hetzelfde `placeAllToFixedPoint`-idee als in `lib/plan.mjs`, met een
harde bovengrens op het aantal iteraties (`maxSize`).

## Fase 1, gebouwd (24 september 2026): het terrein kan groeien

`makeTerrain(seed, { size, grow: { base, steps } })` in `shared/terrain.mjs`. Nog niemand roept
het aan, dus op het eiland verandert niets. `tests/terrain-grow.test.mjs` houdt de beloften vast.

- **`base`** is het grid waarop het eiland gesticht is. `groundOf` bouwt het daar precies zoals
  altijd (hill, meer, rivieren) en `embed` legt het in het midden van het grotere doek. Zonder
  `grow`, of met `base === size` en geen stappen, is de hash bit voor bit die van vandaag.
  Dat is gecontroleerd op 5 seeds × 5 groottes, de vulkaan, open zee en het live eiland.
- **Een stap is `{ r, hold }`.**
  - `r` is de kustafstand van het grotere eiland, in dezelfde eenheid als `coastScale`
    (`foundingCoast(size)` = `half * 0.9375`).
  - `hold` is de lijst met cellen waar iets staat, in **lokale** coördinaten (`gx - half`),
    zodat een groter doek ze niet verschuift.
- **Wat een stap belooft:**
  - Alles boven strandhoogte (`BEACH_MAX`) en elke hoek van een `hold`-cel blijft exact gelijk.
  - Verder wordt alleen zee en strand die met de rand verbonden zijn opgehoogd, nooit
    verlaagd. Het meer en de rivierbedding (4 hoeken ruimte) blijven met rust.
  - De nieuwe grond is die van `groundForCoast(r)`: dezelfde formule met `r` op de plaats van
    de gridkust, met hetzelfde hill, schouder en meer. Aan de oude kust loopt hij op met een
    helling (`GROW_SHORE` + `GROW_RISE` per hoek).
- **Waarom `hold` en niet "alle bouwgrond vast":** dat was de eerste versie. Elke oude
  kustlijn bleef dan als zandring in de wei staan: jaarringen. Het terrein weet niet wat er
  staat, dus de layout geeft het mee wanneer hij de stap zet.
- **Doek-onafhankelijk:** `gridForCoast(r)` is het kleinste doek waarop een kust `r` getekend
  mag worden (1,53 r + 4 aan elke kant, zodat de rand in vlak diep water ligt). Een groter
  doek geeft exact dezelfde hoogtes.
- **Nog niet:** heuvels en rivieren in het aangegroeide land. Dat land is nu vooral glooiende wei.

## Fase 2, gebouwd (24 september 2026): de layout groeit mee

- **`layout.grow`** (`{ base, steps }`, `null` op een eiland gesticht op het hele grid) reist
  overal mee waar grond gebouwd wordt:
  - `lib/layout.mjs`, `plan.mjs`, `survey.mjs`, `garden.mjs`, `fleet.mjs`;
  - `village.json` (`grow`) en de bundel (`growth` in `lib/islandbundle.mjs`, strikt;
    stralen zijn hele getallen, omdat `real` afrondt en de hash dat niet overleeft);
  - `main.js` (eigen eiland, buren, geschiedenis, `groundSig`) en `horizon.js`.
  - De grootte in de bundel komt nu uit `village.grid.size` in plaats van uit de config.
- **Een stap onthoudt zijn grid** (`{ r, grid, hold }`). De marge van 1,53 r uit fase 1 is weg:
  op 256 stopte die bij een kust van 77, nu bij 120, precies wat een eiland heeft dat op dat
  grid gesticht is. Een later groter doek legt de stap ongewijzigd in het midden, net als `base`.
- **Groeien op vraag** (`growStep`, onderaan `placeAll`): blijven er huizen over, dan zet hij
  een ring, legt de hash vast en plaatst opnieuw. Dat gebeurt in dezelfde scan, tot 12 stappen.
  - `nextCoast`: een derde erbij, minimaal 4. De laatste stap wordt afgekapt op de kust van
    het grid.
  - Een huis zonder plek in zijn eigen wijk **wacht één ring** in plaats van het plein te
    nemen (`waited`). Anders stonden 38 van de eerste 41 huizen rond het plein. Maar het wacht
    maar één keer, anders joeg één ingesloten wijk het eiland in één scan van 59 naar 120.
  - De polder-ladder wacht tot het eiland volgroeid is. Anders groef hij 8 polders rond een
    kust van 15, waarvan de dijken daarna midden in de wei lagen.
- **Wat de nieuwe grond verdrinkt, verhuist** (`doomedBy`):
  - de kade (`unsettleQuay`, uit `migrateQuay` getild, met kraan);
  - de havens (`layout.harbours = null`, en wegen die daardoor nergens meer heen gaan
    verdwijnen via `pruneUnreachable`, nu in `layout.mjs`);
  - de landing en de vuurtoren.

  Alles wat blijft staan en een lage hoek heeft, gaat in `hold`.
- **De Grow-knop:** plan-op `grow` (`opGrow`), dezelfde `growStep`, met wat er verhuist als
  `touched`. Hij staat alleen in de planner als het eiland `grow` heeft.
- **Stichten:** `config.minGridSize`. Nieuwe eilanden krijgen `FOUNDING` (256 / 32) in
  `loadConfig` zonder config, en via `setup.mjs --first-run`. Bewust niet als default,
  want een oude config zonder `gridSize` zou dan 256 krijgen en opnieuw gesticht worden.
- **Gemeten**, geleidelijk groeiend (4 settlers per scan, tot 240):
  - Alle huizen staan. Er zijn 7-10 op het plein, tegen 3-11 op een eiland gesticht op het
    hele grid.
  - Het eiland blijft veel kleiner: kust 77 bij 200 huizen, tegen 120.
- **Het zwaarste geval**, het hele register (344) in één keer op een nieuw eiland: 326 huizen,
  49 op het plein, 18 zonder plek, 8 polders. Byte-gelijk vanaf de tweede scan. Beoordeeld
  in de browser (`PROMPTHOLM_HOME` op een proefmap, eigen zee).

**Bekend, nog niet gedaan:**
- Een wijk die meegroeit krijgt aanbouwwijken (lobes), en `hamletCaptions` zet boven elke
  aanbouw een naam. Op het proefeiland stond CLAUDE drie keer.
- Je huidige eiland is op het hele grid gesticht (`grow: null`) en kan pas groeien als het
  doek kan groeien (fase 4). Zijn kust ligt al op de rand van 256.
- Heuvels en rivieren in de aangegroeide grond.

## Fase 4, gebouwd (24 september 2026): het doek groeit, ook onder een bestaand eiland

- **`gridSize` is het maximum, het doek is van de layout.**
  - `loadLayout` gooit het dorp niet meer weg om een andere grootte. Alleen een nieuw zaad of
    `LAYOUT_VERSION` doet dat nog.
  - `scan.mjs` rekent met `cap` (de config) en `size` (`layout.size`, opnieuw gelezen na
    `placeAll`). `placeAll`, de planner, de tuin, de survey en het parcel lezen zelf `layout.size`.
- **`growCanvas(layout, newSize)`** schuift het doek centraal op, in stappen van 32.
  - Elke grid-index gaat +k. Super-celvelden (lobes, commons, zones, de `supers` en `seed` van
    een polder) blijven staan, want die hangen aan `lattice.anchor`.
  - Een eiland gesticht op het hele grid krijgt de eerste keer `grow.base` = dat grid.
  - `tests/canvas-grow.test.mjs` loopt de hele layout door en faalt op elk paar dat niet
    meeschoof en ook geen bekend super-celveld is.
- **`growStep`** vergroot eerst het doek als de ring niet past maar binnen `cap` valt.
  `canGrowFurther` is de ene vraag die `placeAll`, de polder-ladder en de knop stellen.
- **`diffLayouts`** vergelijkt plots in lokale coördinaten. Anders leest een groter doek als
  "elk huis verhuisd" en weigert de planner de knop.
- **Een brugsteen gaat mee met de kade:** `planBridge` legt de brug opnieuw als de nieuwe kade
  ernaast komt te liggen. Gemeten op de kopie van het live eiland.
- **De pagina herlaadt** als `grid.size` verandert. Het grondmesh, het water, de mist, de camera
  en de minimap zijn allemaal op de oude N gebouwd, en een doek groeit zelden.
- **`regions.replace`** deelt de strides opnieuw uit als het formaat verandert. Dat was de
  `levelBase`-bug uit de verkenning.
- **Gemeten op een kopie van het live eiland** (`gridSize` 384, eigen zee):
  - Een gewone scan verandert niets.
  - Grow zet het doek van 256 naar 352 en de kust van 120 naar 156.
  - 12 gebouwen verhuizen: 9 kadehuizen, vuurtoren, kraan, brugsteen.
  - Alle andere staan in de wereld op dezelfde plek, en beide scans erna zijn byte-gelijk.
  - In de browser ziet het er goed uit, en het eiland houdt zijn ligplaats (320,0).
- **Ook gevonden en gerepareerd:** bij het splitsen van hunks in fase 2 waren `onGrow` en
  `grow: bundle.grow` op de verkeerde plek in `main.js` beland. Het eerste was een
  syntaxfout, het tweede geldig JavaScript (een label), dus onzichtbaar. De andere sessie
  zette het ook recht (`cf5202f`). `tests/syntax.test.mjs` draait nu `node --check` over
  `web/js` en `shared/`.

**Nog open voor fase 5 (de zee):** een eiland dat groeit en daardoor een buur raakt, krijgt nu
van `lib/fleet.mjs` een nieuwe ligplaats, en verhuist dus. Een eiland zou bij aankomst ruimte
moeten reserveren voor zijn `gridSize` (`growCap`).

## Fasen

1. **Vorm los van het doek.** Voeg `makeTerrain(seed, { size, radius })` toe, met als default
   de huidige `half * 0.9375`. Test: elk bestaand eiland (64/128/256, met en zonder polders)
   hasht exact hetzelfde. Er verandert niets zichtbaars.
2. **Aanwas binnen het huidige doek.** `layout.growth`, de ladder, de blend-band en de
   causeway-/wegaansluiting zoals bij de polder. Voor het live eiland (256) betekent dat de
   kust schuift naar de rand van het vierkant. Dat is al veel ruimte.
3. **Meten:** kost van 384² / 512² voor terrein, A*, het mesh en een gast. Daarna kiezen tussen
   stapsgewijs groeien (`growLayout`) en meteen een groot doek.
4. **Het doek groeien.** De migratie, en een test die elk celveld in `layout.json` opsomt en
   controleert dat het verschoven is. De bundel-parser kent ze al allemaal en is dus de lijst.
5. **De zee.** `growCap` bij het uitdelen van een ligplaats, de `levelBase`-fix, en gasten en
   de horizon herbouwen bij een ander `gridSize`.
6. **Klein beginnen.** `island.minSize` / `maxSize` in plaats van `gridSize`, met migratie. Een
   nieuw eiland start op `minSize` en groeit op vraag van de dorpsindeling.
7. **Het doek optimaliseren.** Een bestaand eiland inkrimpen tot de bounding box van zijn land
   plus marge. De vorm verandert niet, alleen het vierkant eromheen.

## Open vragen

1. **"16×16": cellen of super-cellen?** 16×16 cellen is 64 m. Dat is kleiner dan het plein
   met zijn civic-kavels. 16×16 super-cellen is 64 cellen, en dat is de huidige default
   `gridSize: 64`. Het tweede lijkt bedoeld.
2. **Groeit het eiland alleen vanzelf, of ook op de knop?** Een "Grow"-tool in de planner kan
   dezelfde stap een sprong vooruit zetten, zoals de handmatige polder een trede van de
   ladder telt.
3. **Wat doet de vulkaan?** Die is vast 192 en van niemand. Voorstel: hij groeit niet.
4. **Havens bij aanwas: een corridor vrijhouden, of de haven laten meeschuiven?** Een
   corridor is goedkoop en verhuist niets. Meeschuiven houdt het eiland rond, maar verplaatst
   bewust een wijk. Beide staan hierboven uitgewerkt.
5. **Groeit een eiland op vraag of op aantal settlers?** Op vraag (de volgende hamlet past
   niet) geeft het kleinste eiland, maar het maakt de terrein-vraag afhankelijk van de
   plaatsing, dus een groeistap valt pas één scan later. Op aantal settlers is eenvoudiger,
   maar groeit ook als het dorp nog ruimte heeft.
