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

## Solide, dan een dither, dan een knip — en de knip pas als de dither klaar is

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
`fadeNeeded(range, fogCap, cos)`.

De eerste versie vroeg `range < scene.fog.far` en dat was op drie punten fout:

1. **De mist is lineair in diepte, de knip is een afstand.** In de hoek van een 16:9-beeld op 45°
   is iets maar ~0.76 zo diep als het ver is. Een huis op 300 in de hoek staat op diepte 229, in
   heldere lucht onder een mist die op 260 dichtgaat. `cornerCos(fov, aspect)` is die verhouding.
2. **`scene.fog.far` is geen constante.** `applyFogRange()` beweegt hem met de zoom, de buren, de
   rand van de wereld en het weer, soms elke frame. Een besluit tegen de mist van dat moment liet
   de dither eruit terwijl een opklarende lucht de knip in beeld bracht. Nu wordt gevraagd tegen
   het plafond, `FOG_CAP * camera.far`, dat alleen View Distance verschuift.
3. **Hercompileren is niet gratis**, dus het besluit valt bij een schuifregelaar, een resize of de
   planner (`applyObjectDistances`), nooit per frame.

Gevolg: bij de standaardinstellingen (view 400, object 300) staat de dither aan. Dat is de prijs
van geen pop-in; hij gaat er pas uit als het object-bereik zo ver ligt dat zelfs de hoek van het
beeld al in volle mist zit.

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

## Open vragen

- **Standaardwaarden.** Met object 300 onder view 400 zijn de gebouwen van buureilanden (ring 1
  op ~432) standaard weg terwijl hun land nog zichtbaar is. Graceful door de dither, maar het is
  een verschil met vroeger. Object ≥ View als standaard is het overwegen waard.
- **Orbit van ver.** De afstand is tot de camera, zoals gevraagd. Van boven met Object Distance
  onder de orbit-afstand verdwijnt het dorp waar je naar kijkt. Een ondergrens op "afstand tot
  het doel + marge" zou dat opvangen, maar verandert de betekenis van de knop.
- **Het bos** (`treeMat`, instanced per eiland) valt onder het landschap en dus onder View
  Distance, niet onder Object Distance: een instanced mesh voor het hele eiland kan niet per boom
  op de CPU geknipt worden, en een dither zonder schaduw-tweeling zou zwevende boomschaduwen
  geven.
