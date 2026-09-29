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

**Wat een gebouw verder draagt** (het goud, het erts, een vlag, een vlam, een naambord) heeft
een eigen material en wist niets van de dither. `followFade` in `buildings.js` laat zo'n
ingebouwd material meevervagen met de gebouwen (zelfde band, zelfde uniform, eigen cache key
behouden plus een achtervoegsel) en geeft zijn mesh de depth-tweeling; `sweepFadeDepth` doet
dat voor elke record. Een `ShaderMaterial` heeft geen chunks om in te splitsen en blijft zoals
hij is (de rookdeeltjes: een paar pixels).

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

De zon tekent het eiland een tweede keer met three's `MeshDepthMaterial`, die niets van de patch
weet. Zonder meer liet een weggeditherd huis zijn hele schaduw liggen: met Object Distance onder
de orbit-afstand was het dorp onder je een veld schaduwen zonder huizen. Daarom heeft elk
building material een **depth-tweeling** (`mat.userData.fadeDepth`): dezelfde band en hash,
gemeten tegen `uFadeEye`, de camera in wereldcoördinaten (in die pass is de view die van de
zon). `adoptFadeDepth` zet hem als `customDepthMaterial` op elke mesh met dat material, eens per
seconde over de scene zolang er een fade gecompileerd is (`sweepFadeDepth`). Zonder fade is de
tweeling ongepatcht en precies het material dat three zelf gebruikt (`RGBADepthPacking`;
`getDepthMaterial` kopieert side, map en clipping ook naar een custom material).

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

- `tests/fade.test.mjs` — de band, bereik 0 is uit, `fadeNeeded` met het plafond en de hoek van
  het beeld, `cullNext` (pas knippen na de pad, hysterese binnen de pad), dezelfde constanten in
  de GLSL, de hook points in three's `standard` én `depth` shader, en de depth-tweeling.
- `tests/graphics-settings.test.mjs` — opslaan en laden per veld, klemmen, en dat
  `onGraphicsSetting` aan `createUI` hangt en niet aan `createNet`.
- In een echte browser (headless Chromium, SwiftShader): geen shaderfouten, de vier
  schuifregelaars werken live en overleven een reload, de schaduwdoos volgt Shadow Distance
  beide kanten op, en bewoners voorbij NPC Distance worden niet getekend terwijl hun `f.to`
  blijft staan.
- **Pop-in, gemeten.** Alleen de gebouwen in beeld op een effen achtergrond, Object Distance 60,
  de camera in stappen van 2 units van het dorp weg, en per frame geteld hoeveel pixels gebouw
  zijn. Met de dither uitgezet springt de dekking bij elke knip (595 → 410, 374 → 210,
  177 → 53). Met de dither loopt ze vloeiend af en is ze al op de achtergrondruis (~50 pixels)
  voordat de eerste record geknipt wordt. De eerste meting liet nog een stap van ~27 pixels
  zien: het goud op de kuil en het erts in de mijn, met een eigen material. Daarvoor is
  `followFade` er: elk ander ingebouwd material in een record vervaagt mee.
- **Door de mist (tweede ronde).** Op `?modest` sluit de mist op 550 in plaats van 1035 en komt het
  eiland op ~420 uit de nevel; schuifregelaar, opslag per sleutel en "This machine's defaults"
  werken; geen shaderfouten, en de radiale `fog_vertex` staat erin. De pixelmeting (elk frame met en
  zonder huizen) bleef te ruizig om een stap te bewijzen of uit te sluiten — zee en wolken bewegen
  tussen de twee opnamen, een ruisvloer van ~400-700k tegen 1.3M voor het hele dorp. Dat er geen
  stap is volgt hier uit de constructie: bij de knip ligt elk punt van het huis ≥ Object Distance
  ver, de mist is daar `fogFactor = 1`, en dan is de kleur *exact* de mistkleur — dezelfde als van
  het land en de lucht erachter.

## Open vragen

- **Orbit van ver.** De afstand is tot de camera, zoals gevraagd. Van boven met Object Distance
  onder de orbit-afstand verdwijnt het dorp waar je naar kijkt. Een ondergrens op "afstand tot
  het doel + marge" zou dat opvangen, maar verandert de betekenis van de knop.
- **Het bos** (`treeMat`, instanced per eiland) valt onder het landschap en dus onder View
  Distance, niet onder Object Distance: een instanced mesh voor het hele eiland kan niet per boom
  op de CPU geknipt worden, en een dither zonder schaduw-tweeling zou zwevende boomschaduwen
  geven.
