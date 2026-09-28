# Grafische afstanden — vier losse schuifregelaars

**Status: 🚧** (start 28 september 2026)

Vier instellingen in Instellingen → Weergave, elk met een eigen knop om weer op de
standaardwaarde te zetten: **View Distance**, **Object Distance**, **NPC Distance** en
**Shadow Distance**. Ze bestonden al als schuifregelaar (`web/js/ui.js`) en als
`opts.shadowDistance` bij het opstarten (`web/js/world.js`), maar er hing geen
`onGraphicsSetting`-handler aan en `camera.far` stond vast op 1400.

Het doel is niet "de instellingen toevoegen". Het doel is dat iemand op een
ouderdere laptop de stad echt zichtbaar zakt zien gaan zonder dat het dorp een
pop doet.

## De vier, en waarom ze alle vier bestaan

Ze lijken vier sliders van dezelfde soort en dat zijn ze niet. Ze zitten op vier
verschillende dingen in de renderer en daarom op vier verschillende plekken in de code.

| Instelling | Wat het eigenlijk doet | Waar het landt |
|---|---|---|
| **View Distance** (`camera.far` + 150) | hoe ver de camera kijkt, en dus hoe ver de mist reikt | `applyViewDistance()` → `applyFogRange()` |
| **Object Distance** | hoe ver een *gebouw, prop of stuk decoratie* nog getekend en bijgewerkt wordt | dither in de buildingshader + `withinObjectDistance()` |
| **NPC Distance** | hoe ver een *inwoner* nog getekend en bijgewerkt wordt | eigen dither + een knip in de crowd-loop |
| **Shadow Distance** | hoe ver de zon nog een schaduw werpt | de breedte van de shadowfrustum |

View en Object mogen niet samenvallen. `camera.far` bepaalt de *wereld*: het
strand, de zee, de verre eilanden, de horizon. De huizen van een dorp staan op
misschien 80 units van je af terwijl de zee 600 units verderop nog ligt. Als je
alleen `camera.far` kon draaien, dan zou je óf de zee in de mist smoren óf de
huizen allemaal laten staan. Dus twee knoppen.

## Hoe de pop-in verdwijnt: de mist doet het al

Het belangrijkste wat hier ontdekt is: **de pop-in hoeft niet weggewerkt te worden,
want de mist sluit vlak vóór de camera-cut al dicht.**

`setFogRange()` in `web/js/world.js` zet de mist dicht op `0.95 * camera.far` —
"Closed just inside it, the cut is in full fog and the sea runs into the horizon
colour". Een gebouw dat op 300 units verdwijnt in een mist die op 522 dicht is,
is op dat punt al zo onzichtbaar als een gebouw dat wél verdwijnt. Dat is de
bestaande, werkende oplossing voor precies dit probleem, en het is de reden dat
`applyFogRange()` die 0.95 háns.

Dus is de regel simpel:

- **Snijd je af buiten de mist** (objectDistance ≥ wat de mist haalt), dan is de
  knip onzichtbaar en is er geen fade nodig.
- **Snijd je af ín de mist** (objectDistance 100 bij een mist die op 218 sluit),
  dan is de knip wel zichtbaar en moet er een fade bij.

Die ene regel is de hele reden dat de fade-shader in dit plan *aan en uit kan*.
Zie hieronder.

## De fade: geen tweede material, geen tweede draw call

Alle gebouwen, props, boten, dieren, gewassen en alle bewoners delen **één**
`buildingMat` (`web/js/main.js`). Eén material, één programma, en dat is een
bewuste invariant uit `CLAUDE.md` ("one material, one draw call per building").
Dat verbiedt de voor de hand liggende oplossing: `material.opacity` aanpassen zou
alle huizen van het hele eiland tegelijk laten vervagen.

Ook `transparent = true` valt af. Dan gaan alle gebouwen naar de transparente
sorteerpass en krijg je precies de artefacten die je van een stad vol
doorzichtige huizen ziet — en de hele stad gaat naar de verkeerde draw-pass
terwijl ze er niets voor terugkrijgt.

Wat dan wel, met de bestaande `onBeforeCompile`-aanpak van `createBuildingMaterial`
(die al `aEmissive` en `aSheet` als vertex-attributes doet):

- In de vertex shader, na `<fog_vertex>` (waar `mvPosition` nog in scope is):
  `vFade = uFadeRange > 0.0 ? clamp(-mvPosition.z / uFadeRange, 0.0, 1.0) : 0.0`.
  `mvPosition` ligt in kijkruimte, dus `-mvPosition.z` is de afstand tot de camera —
  en dat klopt óók voor de bewoners, want `project_vertex` rekent de
  `instanceMatrix` vóór de `modelViewMatrix`.
- In de fragment shader een `discard` op een schermruimte-hash. Gestippeld, geen
  alpha, en omdat het `discard` is blijven zitten in de **opaque** pass: geen
  sorteerproblemen, geen depth-write-problemen, één draw call per gebouw.

Er is dus **geén** uniform voor de camera nodig en **geén** per-frame
attributenschrijfwerk. Alleen `uFadeRange` verandert er, en alleen als er aan de
schuifregelaar gedraaid wordt.

## Waarom de fade in de shader gecompileerd en niet aan-uit geknipd zit

Een `discard` in de fragment shader kost de vroege diepte-test. Op het hele eiland
zou dat eenisu voor een paar huizen in de mist zijn, en dat is een prijs die je
niet betaalt als er niets te vervagen valt.

Dus de patch zit in de shader **alleen als hij iets doet**: `customProgramCacheKey`
krijgt een `-fade`-toevoeging, en `main.js` zet `mat.needsUpdate = true` op het
moment dat de boolean omslaat — niet eerder. Bij de standaardinstellingen
(objectDistance 300, mist dicht op 218) is de knip diep in de mist en staat de
shader er onveranderd in, precies zoals nu. Haal je de schuifregelaag helemaal
terug, dan gebeurt er verder niets.

Dat zijn er twee programma's op zijn hoogst, en de hercompile is er per sessie
hoogstens een paar keer. Niet iets om je zorgen over te maken terwijl je sleept.

## Bewoners: een eigen material, want twee afstanden

Object Distance en NPC Distance zijn per definitie verschillend, dus de shader
moet twee bereiken kunnen kennen. Eén gedeeld material heeft één `uFadeRange`.

Daarom krijgt de crowd een tweede instantie van `createBuildingMaterial()` in
`web/js/main.js`, alleen voor `createCrowdView()`. Dat is geen tweede programma:
`customProgramCacheKey` geeft dezelfde string terug, three deelt de cache, dus
beide materialen draaien hetzelfde gecompileerde programma. Het kost één extra
uniform-upload per frame. De texturen worden gedeeld, en `sheetUsers` zet ze op
beide, want de dag-nacht-sheets moeten ook op de bewoners zitten.

Zelfde regel als bij de objecten: de bewoners-cut staat standaard op 250 en de
mist sluit op 218, dus ook hier is de knip vanzelf onzichtbaar en staat de
fade-patch uit.

En wat er wél gebeurt op de crowd is de andere helft van de opdracht: buiten het
bereik een inwoner niet meer bijwerken. De snelle reis door `draw()` gaat dan niet
langer door de interpolatie naar `f.to`, en de figuur gaat met het bestaande
`f.visible = false; view.hide(f)` uit de instanced meshes. **De multiplayer-state
gaat er niet aan.** `f.pos`, `f.to`, `f.at` en het slot blijven staan; de positie
wordt alleen niet meer in een matrix gestopt. De volgende keer dat de inwoner
binnen bereik komt, staat hij waar de sea zei dat hij stond.

Dat is het verschil tussen *niet tekenen* en *niet weten*, en het tweede is hier
niemand zijn zaken.

## De knip op de CPU, en waarom hij `visible` niet aanraakt

`rec.group.visible` is het vlaggetje dat je zou nemen, en het is precies het verkeerde
vlaggetje. Het is geen tekenbeslissing maar een *toestand*: `applyVisibility()` in
`main.js` is de eigenaar (door de filters heen, levend in de kroniek, aangekomen),
`popIn()` houdt hem laag terwijl een huis nog binnenvaart, en een bouwzet hem weer
laag terwijl het geplaatst wordt. Een keer per frame vanuit hier schrijven zou een
weggefilterd code-huis weer op het eiland zetten op het moment dat iemand het
Code-filter uitzet.

Dus de knip landt op twee plekken die van niemand zijn: de dither in de shader, die
pixels bezit, en `withinObjectDistance()` in de record-loop, die de frame bezit. Een
huis voorbij Object Distance wordt niet meer getekend en zijn molen loopt niet meer
— de duurste helft is voorbij de dither, want een weggegooide pixel hoeft geen
verlichting, geen schaduwmap en geen enkele textuur te betaald hebben. Wat overblijft
is de vertexshader en de rasterisatie, en dat is de prijs van niet op een gedeeld
vlaggetje te schrijven.

Bij de bewoners kan het wél, want `f.visible` is in `crowd-view.js` van niemand anders:
daar betekent het "in de instanced meshes gezet deze frame", en `view.hide(f)` geeft
het slot terug. Datzelfde patroon, maar dan schrijft niemand anders ernaar.

## Twee dingen die bewust buiten de knip vallen

- **Wie in een boot zit.** De `rides`-loop plaatst de passagier en de boot samen, en de
  boot is een gewoon scene-object: de dither over `buildingMat` doet zijn werk. Een
  passagier die wél gekapt en een boot die niet is erger dan het omgekeerde, en op 250
  meter is een bootje twee pixels breed.
- **De plannen-modus tekent alles**, en dat is geen uitzondering maar de regel: daar
  staat de mist op 4000 en gaan beide knippen uit, in `enterPlan()` weer aan in
  `leftPlan()`. Een stad van boven zien met de helft eruit stippelen is erger dan geen
  schuifregelaar.

## Shadow Distance: de breedte van de doos, niet `camera.far`

Het sluitstuk, en de enige plek waar het voor de hand liggende antwoord fout is.

`shadowDistance` stond al in `world.js` als `key.shadow.camera.far = opts.shadowDistance
|| 150`, met de oude regel erboven uitgecommentarieerd. Die regel deed niets, want
`followShadow()` overschrijft `cam.far` bij elke zoom met `2 * f + 90`. Zodra je
inzoomde was de schuifregelaag dood.

En er kan niet zomaar in `far`: het licht staat op `f + 60` van het middelpunt, dus
de diepte die de doos nodig heeft is ongeveer `2 * f + 60`. Bij `far = 150` mag `f`
dus niet groter worden dan 45, en dat is praktisch `SHADOW_SPAN[0]` — de knop zou
alle schaduwen uit zetten in plaats van ze in te korten.

Daarom is de afstand een **plafond op de breedte**: `f = min(zoom, shadowDistance / 2)`,
en `cam.far = 2 * f + 90` volgt daaruit zoals altijd. Inzoomen werkt nog precies
zoals het werkte — de doos volgt de camera en haalt dichterbij als je dichterbij komt —
en de schuifregelaar is de plek waar hij stopt met meegroeien. Bij de standaard van 150
doet hij dus niets tot je verder dan 150 uitzoomt, en dat is wat "150" betekent.

`setShadowDistance()` herbouwt de doos meteen in plaats van te wachten op de volgende
kamerabeweging, zodat de schaduwen onder je vinger mee bewegen. Omhoog schuiven terwijl
je verder uitzoomt doet niets (de doos staat al tegen `SHADOW_SPAN[1]` aan) en dat is
ook juist.

## Wat er níét verandert

- `applyFogRange()` blijft de mist dichtzetten op `0.95 * camera.far`, en de
  aansluiting op `hazeRange()`, het archipel en het weer gaat ongemoeid. De
  View Distance raakt `camera.far` aan en laat de rest met rust.
- De mist wordt niet aan de wereldgrootte (±3000) gekoppeld. Dat is een andere
  beslissing, die nu een keer is genomen en hier geen tweede keer.
- De plannen-modus tekent alles, en dat is geen uitzondering maar de regel.
- `applyCameraRange()` rekent nog steeds `state.bounds` en de `maxDistance` van de
  besturing uit. View Distance zit er *niet* in: dat is `camera.far`, en het heeft
  niets te maken met hoe ver je terug mag zoomen.
- De dieren (`state.herds`, `FAR`) en het eiland-detail (`DETAILED`) hebben hun
  eigen, oudere mechanismen en blijven zoals ze zijn. Ze worden niet overgenomen en
  niet met de nieuwe knoppen bestuurd.
- De texturen, de sheet en de draw-call-count (`?stats`): ongewijzigd. Ook het aantal
  programma's, zolang de fade uit staat — wat op de standaardinstellingen zo is.

## Getest

- `tests/fade.test.mjs` — de band (steeds tot 80% vol, dan omlaag), een bereik van 0
  betekent uit, `fadeNeeded()` voor de vier gevallen, de cijfers in de GLSL komen uit
  dezelfde constanten, en: **dat de drie stukken GLSL waar de fade in gespleit wordt
  nog in three zitten.** Die laatste is de belangrijkste test in dit plan. `three` is
  een vendored bestand, en een `#include <fog_vertex>` die hernoemd is faalt zonder
  foutmelding — de slider doet dan niets en ziet eruit of hij werkt.
- `tests/syntax.test.mjs` — de parse-gate.
- De hele suite: 1285 van de 1286 slagen. De ene is `layout-measure.test.mjs`, die de
  live `data/layout.json` meet en op deze machine ook zonder deze wijziging faalt.

## Open vragen

- De standaard van 400 voor View Distance is een gok; de oude 1400 gaf een
  uitzicht dat bij het dorp hoorde. Die 1400 was echter nooit iemands beslissing,
  het was een constant. Echt uitzoeken wat een goed uitzicht is vraagt om te
  kijken, en dat is handwerk.
