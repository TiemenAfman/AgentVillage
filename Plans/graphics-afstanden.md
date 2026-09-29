# Grafische afstanden — vier losse schuifregelaars

**Status: 🚧** (start 28 september 2026, herzien 29 september)

Vier instellingen in Instellingen → Graphics: **View Distance**, **Object Distance**, **NPC
Distance** en **Shadow Distance**. Ze bestonden als schuifregelaar (`web/js/ui.js`) en als
`opts.shadowDistance` in `web/js/world.js`, maar er hing niets aan en `camera.far` stond vast op
1400.

Het doel is niet "de instellingen toevoegen". Het doel is dat iemand op een oudere laptop de
stad echt minder ziet tekenen, zonder dat er ooit een gebouw of een inwoner in beeld wegpopt.

## De vier, en waarom het vier systemen zijn

| Instelling | Wat het doet | Waar het landt |
|---|---|---|
| **View Distance** | hoe ver de camera kijkt: `camera.far = view + 150`, en de mist sluit daarbinnen | `applyViewDistance()` → `applyFogRange()` |
| **Object Distance** | hoe ver een gebouw, prop, boot of stuk decoratie nog getekend wordt | dither in de buildingshader + `keepRecord()` (layer mask) + de schaduw-tweeling |
| **NPC Distance** | hoe ver een inwoner nog getekend en bijgewerkt wordt | eigen dither (`crowdMat`) + `beyond()` in `crowd-view.js` |
| **Shadow Distance** | hoe breed de schaduwdoos van de zon mag worden | `setShadowDistance()` in `world.js` |

View en Object mogen niet samenvallen. `camera.far` bepaalt de *wereld*: het strand, de zee,
de verre eilanden. Een dorp staat op 80 units terwijl de zee 600 units verderop nog ligt.

**De mist wordt niet aan de wereldgrootte gekoppeld.** Een wereld van ±2000 betekent niet dat
`camera.far` 4000 moet zijn; `applyFogRange()` houdt zijn bestaande logica (archipel, rand van de
wereld, weer) en krijgt alleen een lager plafond (`FOG_CAP * camera.far`, 0.95) als View
Distance omlaag gaat. De +150 is bewust: de mist moet vóór de harde knip van de far plane al
helemaal dicht zijn, anders zie je een gebogen rand over de zee.

## Huizen komen door de mist tevoorschijn (29 september, tweede ronde)

Het verzoek: *speelbaar op oudere toestellen, en huizen moeten niet spontaan verschijnen maar door
de mist tevoorschijn komen.* De dither hieronder deed het eerste half en het tweede niet: een huis
dat in heldere lucht uit stippels opbouwt verschijnt nog steeds, alleen zachter.

Nu **sluit de mist nooit verder dan Object Distance** (`fogCeiling()` in `main.js`:
`min(0.95 · far, objectDistance)`). Een huis wordt pas `CULL_PAD` voorbij die afstand uit de
render list gehaald, en is dan al volledig mistkleurig; op de terugweg wordt het uit de mist
opgebouwd door dezelfde lineaire nevel die het land en de zee al hebben. De dither is voor de
gebouwen daardoor nooit meer nodig (`fadeNeeded(objectDistance, fogCeiling())` is altijd onwaar)
en de gebouwshader blijft zoals hij altijd was — ook op een zwak toestel scheelt dat de vroege
diepte-test. Voor bewoners blijft hij: NPC Distance kan ruim binnen de nevel liggen.

Daarvoor moest **de mist op afstand rekenen in plaats van diepte** (`web/js/radial-fog.js`, één
patch op three's `fog_vertex` vóór er iets compileert). Met diepte-mist was een huis in de hoek van
het beeld (~0.76 zo diep als ver) bij de knip nog niet helemaal in de mist. De far plane knipt
nog op diepte, en afstand is nooit kleiner dan diepte, dus die knip zit met méér marge in volle
mist dan eerst.

De prijs, bewust: Object Distance onder View Distance trekt nu ook de nevel over land en zee naar
binnen. View Distance blijft de far plane en het plafond van de mist; Object Distance is de knop
die op een zwak toestel het verschil maakt, en die ziet er dan uit als een heiige dag in plaats
van als een dorp dat ophoudt.

**Standaard per soort toestel** (`GRAPHICS_TIERS` in `graphics-settings.js`), gekozen met de
bestaande `modest`-detectie in `main.js` (integrated graphics via `MODEST_GPU`, of `?modest`) en
`STANDALONE` voor de telefoon:

| | View | Object (= waar de mist dichtgaat) | NPC | Shadow |
|---|---|---|---|---|
| `full` | 1250 (far 1400) | 2000 | 1000 | 380 |
| `modest` | 800 | 550 | 300 | 160 |
| `phone` | 600 | 380 | 200 | 110 |

Alleen wat iemand zelf verschuift wordt bewaard (`saveGraphic`, sleutel `.v3`): de eerdere versies
bewaarden alle vier bij elke wijziging, en dan zou een laptop die later als `modest` herkend werd de
desktopwaarden houden. "This machine's defaults" in het paneel vergeet alle keuzes.

## Solide, dan een dither, dan een knip — en de knip pas als de dither klaar is

*(Dit was de eerste ronde. Voor gebouwen is de dither nu nooit nodig, zie hierboven; het
mechanisme blijft voor bewoners, en als vangnet.)*

Voor Object en NPC Distance is de regel voor elk bereik `r`:

```
0 – 0.8 r        volledig zichtbaar
0.8 r – r        dither (screen-space hash + discard), van 0 naar 100% weg
r + pad          uit de render list (CPU) - pas als er echt niets meer te zien is
```

Bij Object Distance 500: 0–400 solide, 400–500 vervagen, vanaf 516 niet meer getekend.

**De dither** zit in `createBuildingMaterial`'s `onBeforeCompile` (`web/js/fade.js`): een
`discard` op een hash van `gl_FragCoord`, dus het blijft in de opaque pass. Geen
`transparent`, geen sorteerproblemen, één draw call per gebouw — de invariant uit CLAUDE.md
blijft staan. Alle gebouwen delen één material, dus opacity kan niet; een per-pixel afstand kan
wel, en die kost geen uniform voor de camera: `length(mvPosition.xyz)` ís de afstand tot het oog,
ook voor de instanced crowd.

**Wat een gebouw verder draagt** (goud, erts, vlag, vlam, naambord) volgde in de eerste ronde de
dither via `followFade`. Sinds de mist de huizen afhandelt is dat weg (zie "Review"): een huis
wordt in volle mist geknipt, met al zijn materialen tegelijk.

**De knip op de CPU** is wat de performance oplevert: een record voorbij `r + CULL_PAD` (16)
krijgt `layers.mask = 0` op al zijn objecten (`keepRecord` in `main.js`). Dat haalt hem uit de
colour pass, de shadow pass en de raycaster, en de frame loop slaat zijn `animateExtras` over
(molens, klokken, rook). `CULL_PAD` is groter dan het verste dat iets vanaf zijn oorsprong
reikt (een schip is 4 x 16, de Batavia heeft masten), dus op het moment van de knip is elk
punt van het gebouw al volledig weggeditherd. `CULL_HYST` (2) houdt een record op de grens uit
het flikkeren en ligt binnen de pad, dus ook terugkomen gebeurt onzichtbaar.

**Waarom niet `rec.group.visible`.** Dat vlaggetje is state, geen tekenbeslissing:
`applyVisibility()` is de eigenaar (filters, kroniek, aangekomen), `popIn()` en een bouw zetten
hem laag. Er per frame naar schrijven zou een weggefilterd code-huis terugzetten. Layers
gebruikt verder niemand in dit project; het oude masker wordt bewaard in `userData.cullMask` en
teruggezet, en kinderen die erbij komen terwijl een record weg is (een naambord, een steiger)
worden in dezelfde frame gemaskeerd.

**Bewoners** krijgen hetzelfde, met hun eigen material (`crowdMat`, zelfde programma, eigen
uniform) omdat Object en NPC twee getallen zijn. Voorbij `r + NPC_PAD` gaat een inwoner met het
bestaande `view.hide(f)` uit de instanced meshes en wordt de dure helft van de loop (glijden,
gang, gezicht, grond) overgeslagen. **De multiplayer-state gaat er niet aan**: `f.to`, `f.pos` en
het slot blijven staan; wie terug binnen bereik komt staat waar de zee zei. Een imp (skinned
mesh, eigen material zonder dither) wordt niet meer gegeven aan een wachter in de band
(`inBand`); die wordt een gewone figuur en vervaagt mee.

## Wanneer de dither in de shader zit

Een `discard` kost de vroege diepte-test voor het hele material, en dat material is elk gebouw
op het eiland. Dus de patch zit er alleen in als een knip zichtbaar zou kunnen zijn:
`fadeNeeded(range, fogCap)`.

De eerste versie vroeg `range < scene.fog.far` en dat was op drie punten fout:

1. **De mist was lineair in diepte, de knip is een afstand.** In de hoek van een 16:9-beeld op 45°
   is iets maar ~0.76 zo diep als het ver is. Eerst opgevangen met een cosinus van de hoek van het
   beeld; nu rekent de mist zelf op afstand (radial-fog.js) en is die correctie weg.
2. **`scene.fog.far` is geen constante.** `applyFogRange()` beweegt hem met de zoom, de buren, de
   rand van de wereld en het weer, soms elke frame. Een besluit tegen de mist van dat moment liet
   de dither eruit terwijl een opklarende lucht de knip in beeld bracht. Nu wordt gevraagd tegen
   het plafond, `fogCeiling()`, dat alleen View en Object Distance verschuiven.
3. **Hercompileren is niet gratis**, dus het besluit valt bij een schuifregelaar, een resize of de
   planner (`applyObjectDistances`), nooit per frame.

**Standaardwaarden: hoog** (29 september, op verzoek) voor een gewone machine: View 1250 (dus
`camera.far` 1400, het oude uitzicht), Object 2000, NPC 1000, Shadow 380 (de breedste doos die
`SHADOW_SPAN[1]` toelaat). Zwakkere toestellen hebben hun eigen, lagere standaard (zie boven).

De oude bewering dat de dither bij de standaard niets kostte klopte alleen omdat er toen ook
geen CPU-knip was: voorbij Object Distance werd niets weggehaald, alleen de molens stonden
stil — en dat stilvallen was zelf een zichtbare pop in heldere lucht.

## Schaduwen vervagen mee

De zon tekent het eiland een tweede keer met three's `MeshDepthMaterial`, die niets van de dither
weet: een weggeditherde inwoner liet zijn schaduw liggen. Daarom heeft het material een
**depth-tweeling** (`mat.userData.fadeDepth`): dezelfde band en hash, gemeten tegen `uFadeEye`, de
camera in wereldcoördinaten (in die pass is de view die van de zon). Elke mesh van de crowd krijgt
hem bij het aanmaken (`createFigures`). Zonder fade is de tweeling ongepatcht en precies het
material dat three zelf gebruikt. Huizen hebben hem niet nodig: die worden in volle mist geknipt,
en een geknipt record werpt ook geen schaduw meer.

## De lucht wordt nooit een zwart vlak

De hemelkoepel was een bol met straal 1340 rond het oog, "binnen de far plane van 1400". Met View
Distance 400 lag de far plane op 550 en viel de hele koepel erachter: de lucht was de clear
colour, zwart. Nu tekent de vertex shader hem óp de far plane (`gl_Position = p.xyww`, dezelfde
truc als three's eigen background cube), wat de far plane ook is; de kleur hing al alleen van de
richting af. Onder ooghoogte is hij de horizonkleur, die van de mist, dus waar de far plane de
zee afsnijdt loopt die over in lucht in plaats van in zwart. Zon en maan zijn schijven zonder
mist en moeten wél binnen de far plane hangen: `world.setFar()` legt ze op
`min(430, 0.8 · far)`, verkleind zodat ze op het scherm even groot blijven.

## Shadow Distance: de breedte van de doos, niet `camera.far`

`key.shadow.camera.far = opts.shadowDistance` deed niets, want `followShadow()` overschrijft
`far` bij elke zoom met `2 * f + 90`. En het licht staat op `f + 60` van het middelpunt, dus een
diepte van 150 zou de doos tot de minimumspan dwingen: de knop zou schaduwen uitzetten in plaats
van inkorten.

Daarom is Shadow Distance een **plafond op de breedte**: `f = min(zoom, shadowDistance / 2)`,
`far = 2 * f + 90` volgt daaruit zoals altijd, en de follow-logica blijft precies wat hij was.
`setShadowDistance()` rekent vanaf de laatste zoom opnieuw, beide kanten op — de eerste versie
nam het minimum van de huidige doos en het nieuwe plafond, en dan deed omhoog schuiven niets tot
de camera bewoog.

## Live en bewaard

`onGraphicsSetting(key, value)` staat op de handlers van **`createUI`** — hij stond op die van
`createNet`, die hem nooit aanroept, en elke schuifregelaar veranderde alleen zijn eigen label.
De waarden zijn per browser (`web/js/graphics-settings.js`: defaults, grenzen, localStorage),
zoals Build mode: hoe ver dit scherm tekent is de videokaart van deze machine, niet het eiland.
ui.js tekent de schuifregelaars uit dezelfde tabel als waar main.js tegen klemt.

`createWorld()` krijgt alleen `shadowDistance` mee: de andere drie zijn geen eigenschap van de
wereld maar van de camera en de frame, en worden live gezet.

## De planner tekent alles

`enterPlan()` zet de mist op 4000 en beide bereiken op 0 (uit): een stad van boven met de helft
weggestippeld is erger dan geen schuifregelaar. `leftPlan()` zet ze terug.

## Getest

- `tests/fade.test.mjs` — de band, bereik 0 is uit, `fadeNeeded` en `fogCeilingOf`, de radiale
  mist, `cullNext` (pas knippen na de pad, hysterese binnen de pad), dezelfde constanten in
  de GLSL, de hook points in three's `standard` én `depth` shader, en de depth-tweeling.
- `tests/record-cull.test.mjs` — maskeren en terugzetten met echte three-objecten: kleinkinderen,
  lichten (op 0, niet uit de lijst), bakens, wat erbij komt terwijl een record weg is, herbouw.
- `tests/graphics-settings.test.mjs` — opslaan en laden per veld, klemmen, en dat
  `onGraphicsSetting` aan `createUI` hangt en niet aan `createNet`.
- In een echte browser (headless Chromium, SwiftShader): geen shaderfouten, de vier
  schuifregelaars werken live en overleven een reload, de schaduwdoos volgt Shadow Distance
  beide kanten op, en bewoners voorbij NPC Distance worden niet getekend terwijl hun `f.to`
  blijft staan.
- **Pop-in, gemeten (eerste ronde, met de dither).** Alleen de gebouwen in beeld op een effen achtergrond, Object Distance 60,
  de camera in stappen van 2 units van het dorp weg, en per frame geteld hoeveel pixels gebouw
  zijn. Met de dither uitgezet springt de dekking bij elke knip (595 → 410, 374 → 210,
  177 → 53). Met de dither loopt ze vloeiend af en is ze al op de achtergrondruis (~50 pixels)
  voordat de eerste record geknipt wordt. De eerste meting liet nog een stap van ~27 pixels
  zien: het goud op de kuil en het erts in de mijn, met een eigen material. (Dat was de reden
  voor `followFade`; sinds de mist de huizen afhandelt is die weg.)
- **Door de mist (tweede ronde).** Op `?modest` sluit de mist op 550 in plaats van 1035 en komt het
  eiland op ~420 uit de nevel; schuifregelaar, opslag per sleutel en "This machine's defaults"
  werken; geen shaderfouten, en de radiale `fog_vertex` staat erin. De pixelmeting (elk frame met en
  zonder huizen) bleef te ruizig om een stap te bewijzen of uit te sluiten — zee en wolken bewegen
  tussen de twee opnamen, een ruisvloer van ~400-700k tegen 1.3M voor het hele dorp. Dat er geen
  stap is volgt hier uit de constructie: bij de knip ligt elk punt van het huis ≥ Object Distance
  ver, de mist is daar `fogFactor = 1`, en dan is de kleur *exact* de mistkleur — dezelfde als van
  het land en de lucht erachter.

## Review (29 september, derde ronde)

Drie achtergrond-workers: een onafhankelijke code review, een deterministische pop-in-meting en
een meting per soort toestel. Uit de review, gerepareerd:

- **Lichten.** Een gemaskeerd record haalde zijn kampvuur-, smidse-, oven- of vuurtorenlicht uit
  three's lichtlijst, en het aantal lichten zit in de sleutel van elk belicht programma: elke keer
  dat zo'n record de grens passeerde hercompileerde elk material in beeld. Een licht wordt nu op 0
  gezet in plaats van gemaskeerd (`web/js/record-cull.js`, nu een eigen, geteste module).
- **Mistvrije onderdelen.** De straal van een vuurtoren en de vlam van een kampvuur hebben
  `fog: false`; "geknipt in volle mist" zegt voor hen niets en ze verdwenen op de grens. Een record
  met zo'n onderdeel is een baken en wordt nooit geknipt.
- **De lucht achter een mast.** Volledig mistig is de mistkleur, en die paste bij land en zee maar
  niet bij de lucht: een mast of kasteel boven de horizon was een mistkleurige vorm tegen iets
  ander blauw. De koepel is nu langs de horizon exact de mistkleur (`uFog`, bij referentie).
- **Een sweep die elke seconde de hele scene doorliep**, terwijl de gebouwfade nooit aan kon. Weg,
  met `followFade`; de crowd krijgt zijn tweeling bij het aanmaken.
- **Lampjes aan de horizon** (`fog: false`) knipperden tegen de far plane zodra View Distance
  omlaag ging; ze vervagen nu over het laatste vijfde van 0.9 · `camera.far`.
- Kleiner: een imp wisselt alleen naar een gewone figuur als de dither echt aan staat; een
  gastcrowd die tijdens de planner binnenkomt krijgt bereik 0; Shadow Distance begint op 85
  (daaronder deed de schuif niets); `clampGraphic(true)` weigert.

Uit de deterministische pop-in-meting (frameloop stilgezet, per stap vier renders: met knip,
nog eens met knip als ruisvloer, zonder knip, zonder huizen; verschil zonder drempel): **wat de
knip weghaalt is 0 bij elke stap** om 12:00 en 07:00, ook bij elke stap waarin een record geknipt
wordt, met een ruisvloer van 0. De controle (mist niet naar binnen getrokken, wel op 60 geknipt)
laat een duidelijke pop zien (7097 bij de eerste knip, oplopend tot 44k), dus de meting vangt er
een als die er is. Om 17:30 en 22:00 bleef 1-9 pixels over: de **vuurvliegjes**, `fog: false`,
die een volledig mistig huis afdekte en die bij de knip weer tevoorschijn kwamen. Die gaan nu uit
in de nevel (hun alpha, niet hun kleur: additief licht naar de mistkleur zou grijs gloeien). En
de knip wordt nu genomen vlak voor de render (`cullRecords`), waar elke tak van de frame de camera
al heeft neergezet; eerder in de frame mat hij van waar de camera wás.

Uit de meting per soort toestel (headless SwiftShader, dus alleen relatief): de lichtere
standen waren 2.5-3x sneller dan `full`, maar 85-90% daarvan kwam uit wat `modest` al deed
(half zo dicht water, `DETAILED` 2, minder bomen, 1024-schaduw). De vier afstanden hielpen alleen
bij de vulkaan (de imps) en over zee (de far plane); huizen knippen scheelde weinig op dit kleine
eiland. Wat domineerde en buiten de afstanden viel, en wat eraan gedaan is:

- **Het landschap van gasteilanden** (bos, velden, grond) werd in volle mist getekend: een heel
  gasteiland wordt nu gemaskeerd zodra zijn dichtstbijzijnde rand voorbij de mist ligt
  (`keepRegion`). Op `?modest`: over zee 611k → 543k driehoeken, bij de vulkaan 550k → 481k.
- **Imps** (25k driehoeken, met schaduw): een `modest` pagina zet er maximaal zes neer, als een
  telefoon.
- **Telefoon**: één gasteiland volledig (`DETAILED` 1) en pixel ratio 1.
- **Het waterraster**: 2.53M van de 2.75M driehoeken op `full` was één watervlak over de omhullende
  rechthoek van álle eilanden, lege zee inbegrepen. Nu in tegels per eiland (`waterPatchPlan`):
  fijn binnen 16 units van een eilandraster, grof in de overgang naar de oceaan, één quad per rij
  open zee; hetzelfde omtrek en dezelfde overgang. Water op `full` 2.53M → 182k driehoeken, de hele
  pagina 2.74M → 396k; op `?modest` 484k → 237k. Uiterlijk gelijk (screenshots rond het eiland, een
  buur en de vulkaan). De donkere rechthoek in de mist die een worker zag was echt: radiale mist
  per vertex, geïnterpoleerd over de reusachtige driehoeken van de oceaanschijf, rekende die te
  mistig; de watershader rekent de afstand nu per pixel.
- **Golven onder je boot, ook ver van een eiland.** Na het tegelen lag er alleen binnen 16 units
  van een eilandraster water met deining; daarbuiten vlakke grove tegels, en voorbij de oude omtrek
  de oceaanschijf 0.2 lager - daar ging een boot zweven (al gezien vóór deze sessie). Nu vaart er
  een klein fijn watervlak mee met je boot of het kijkpunt (`nearWaterPlan`, 5 x 5 tegels, ~6.5k
  hoekpunten), gemaakt van alleen de tegels die het plan grof tekent; het plan laat daar zijn grove
  fragmenten weg (`uNear`), dus niets dubbel. De deining loopt naar nul aan de randen, en voorbij
  de omtrek zakt de rand in 8 units naar de oceaanschijf in plaats van een trede.
- **Een harde lijn aan de horizon** (van hoog boven zee, `?modest`): de horizonband van de koepel
  kreeg de lineaire mistkleur, terwijl three de mist aan elk material in de uitvoer-kleurruimte
  geeft (na `colorspace_fragment`) en de koepel zijn kleuren rauw schrijft: 171,206,243 tegen
  214,232,249. De band krijgt de mistkleur nu omgezet zoals three dat doet (`sky.onBeforeRender`);
  gemeten naadloos van hoog en van laag, met het blauwe verloop erboven intact.
- Niet gedaan: de eilandjes (~52k driehoeken, één InstancedMesh over de hele zee, per eilandje
  maskeren vraagt de buffers elke frame opnieuw) en een schaduwkaart van 512 op de telefoon.

Niet gedaan, bewust: de zon kan bij View 100 vóór heuvels op 200 hangen (de prijs van een
mistvrije schijf binnen de far plane); vlaggen van geknipte huizen blijven in de gedeelde
InstancedMesh staan, bevroren en in volle mist.

## Open vragen

- **Orbit van ver.** De afstand is tot de camera, zoals gevraagd. Van boven met Object Distance
  onder de orbit-afstand verdwijnt het dorp waar je naar kijkt. Een ondergrens op "afstand tot
  het doel + marge" zou dat opvangen, maar verandert de betekenis van de knop.
- **Het bos** (`treeMat`, instanced per eiland) valt onder het landschap en dus onder View
  Distance, niet onder Object Distance: een instanced mesh voor het hele eiland kan niet per boom
  op de CPU geknipt worden, en een dither zonder schaduw-tweeling zou zwevende boomschaduwen
  geven.
