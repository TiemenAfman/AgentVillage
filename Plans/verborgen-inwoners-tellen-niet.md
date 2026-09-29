# Verborgen inwoners tellen niet mee

**✅ Status: gebouwd op 29 september 2026.** Open: alleen wat onder *Later* staat.

## Het probleem

NPC Distance (Plans/graphics-afstanden.md) haalt een inwoner voorbij het bereik uit de loop in
`crowd-view.js`: niet glijden, geen gang, geen grond onder de voeten. Dat is de CPU-helft en die
werkt. De GPU-helft werkt niet: `hide(f)` in `web/js/settler-figures.js` zet de instance op
y = -999 met schaal 0.0001, maar `m.count` blijft het hoogste slotnummer. De vertex shader draait
dus nog steeds voor elke verborgen inwoner, in de kleurpas én de schaduwpas. Het commentaar bij
`beyond` in crowd-view.js ("the instanced slots are handed back") klopt voor de CPU en niet voor
de GPU.

Twee kleinere bronnen van hetzelfde:
- **Rokken en haar** hebben een slot voor iedereen, en wie ze niet draagt krijgt `HIDDEN` op dat
  slot (`enrol` en elke `draw`). Op `full` ~166k driehoeken per pas.
- **Vrijgekomen slots** (`spare`) blijven binnen `count` staan tot iemand ze weer inneemt.

### Gemeten door Martijn, 29 september, op een kopie van Hoogezand

368 settlers, 766 apprentices, 40 wijken, de vulkaan en drie startereilanden in de zee.
"Geparkeerd" = driehoeken van instances met een matrix-schaal < 0.001, geteld over elke
InstancedMesh met count > 0 die niet door `layers.mask` is uitgezet.

| Toestel / NPC Distance | Waar | Kleurpas | Schaduwpas | Mensen zichtbaar | Mensen geparkeerd |
|---|---|---|---|---|---|
| ?modest, 300 | van boven (zoals het eiland opent) | 3.698.126 | 2.660.312 | 9.880 | 1.767.004 (48%) |
| ?modest, 300 | ingezoomd op een huis | 3.685.844 | 2.449.882 | 155.455 | 389.675 |
| ?modest, 300 | te voet op het plein | 3.156.143 | 2.439.687 | 142.524 | 385.584 |
| full, 1000 | van boven | 5.475.209 | 3.839.739 | 312.908 | 213.424 |
| full, 50 | van boven | 5.474.777 | 3.839.355 | 604 | 2.004.892 |

NPC Distance van 1000 naar 50 veranderde het totaal met 432 driehoeken.

## Waarom niet NPC Distance weghalen

Dan tekent de GPU precies hetzelfde (de instances staan er nu ook al) en verliest de CPU de
besparing die wel werkt. Het probleem zit niet in het bereik maar in wat "verborgen" betekent
voor een InstancedMesh: alles onder `count` wordt getekend, geparkeerd of niet.

## De aanpak

**Wie getekend wordt staat aaneengesloten vooraan.** Elke batch houdt zijn figuren in drie
stukken: `[0, live)` wordt dit frame getekend, `[live, n)` is ingeschreven maar niet getekend,
voorbij `n` is leeg. `count = live`. Een wissel tussen getekend en niet getekend is één
**swap-remove**: de figuur ruilt van slot met de laatste getekende (of, bij verbergen, met de
eerste niet-getekende), en matrix én `instanceColor` gaan mee in *alle* meshes van die batch,
met `f.slot` en de rij figuren (`figs`, wat `figureAt` leest). Niet elk frame alles herpakken:
alleen wie van kant wisselt kost iets, en dat is een paar honderd floats.

Batches, elk met zijn eigen `live`:
- **het lichaam**: de elf gelede meshes (torso t/m details) — sleutel `f.slot`;
- **de hoeden**: één batch per vorm, zoals ze al eigen slots hadden — `f.hatSlot`;
- **rokken** en **haar**: nu ook eigen batches, zodat wie ze niet draagt er geen instance in
  heeft — `f.skirtSlot`, `f.hairSlot` (-1 = draagt het niet).

Zwaard en fakkel (alleen op een vijandig eiland) gaan naar hetzelfde patroon als de hamer: per
frame opnieuw geteld (`swordCount`, `torchCount`), in plaats van een slot per inwoner met
`HIDDEN` erop zodra de hand iets anders vasthoudt.

**`draw()` beslist wie er getekend wordt.** Een figuur met `f.visible` wordt vooraan gezet, een
zonder naar achter — ook als niemand `hide()` riep. `hide()` blijft voor wie het nu moet
(crowd-view's pad zonder `draw()`: de kroniek teruggespoeld). `enrol()` schrijft een figuur in
aan de niet-getekende kant: wie nog nooit door `draw()` is neergezet wordt ook niet getekend, dus
nooit meer een identiteitsmatrix of de laatste houding van een vorige bewoner in het midden van
het eiland. `free()` haalt uit elke batch: eerst naar achter, dan ruilen met de laatste
ingeschreven, `n--`. De `spare`-lijsten zijn daarmee weg: een gat bestaat niet meer.

Een batch zonder iemand erin krijgt `visible = false` (zoals de gereedschappen al hadden): een
gasteiland voorbij NPC Distance kost dan ook geen program-setup meer per mesh per pas.

### Wat slotnummers nog meer betekenen, nagelopen

- **Hamers, gereedschap, bundels, kruiwagens, pinten**: al per frame geteld, niet per slot.
  Onveranderd.
- **flinch / strike / drinkBeer**: lezen `f.slot` alleen als "ingeschreven"; de rode gloed wordt
  op het *huidige* slot geschreven, en de kleuren ruilen mee, dus een figuur die tijdens een
  flinch van slot wisselt houdt hem en krijgt zijn eigen kleur terug.
- **Raycast/hover** (`pickables`, `figureAt`): `InstancedMesh.raycast` loopt tot `count`, dus
  een verborgen figuur is niet meer te raken. `figureAt` controleert daarnaast `i < count`.
  De bounding sphere voor de raycast is sinds `bounds` (Plans/sneller-tekenen.md) die van het
  eiland; zonder `bounds` (tests, de rave) rekent three hem één keer uit en bewaart hem, dus daar
  zetten we hem na elke `draw()` op null.
- **Imps**: een bewaker onder een imp krijgt elk frame `f.visible = false` + `hide()` vóór
  `draw()`. Dat is na de eerste keer een no-op: hij staat al achteraan.
- **Eén materiaal, één draw call per batch**: er komt geen mesh bij; rokken en haar waren al
  twee batches. Het aantal calls blijft of daalt (count 0 tekent niets).
- CLAUDE.md's regels blijven: `f.visible` in crowd-view is "dit frame getekend", en de cut raakt
  de zee-state (`f.to`, `f.pos`) nooit aan — dit zit volledig in settler-figures.js.

**Een slotnummer is niet meer vast.** Het verandert zodra iemand anders van kant wisselt. Niets
buiten settler-figures.js mag er één over een frame heen bewaren; wie een instance leest, leest
`f.slot` op dat moment (zoals de tests en `figureAt` doen).

De boekhouding per figuur (in welke batches, welk hoedenmesh) staat in een `WeakMap` in
`createFigures` en niet op het figuur-object: het figuur is van de aanroeper, en een figuur dat
zijn batches vasthield hield elk mesh en elk ander figuur vast — een mislukte assert probeerde dat
allemaal af te drukken en liep na 80 s vast op "Array buffer allocation failed".

### Tests

Wat verandert is de betekenis van "verborgen": niet meer "op -999", maar "niet binnen `count`".
Tests die op -999 controleerden (villagers, imp) controleren nu `f.slot >= count`; tests die
vóór de eerste `draw()` al op `count` rekenden (crowd-view: de ray en de bewapening,
volcano-guest: slot hergebruiken) tekenen nu eerst. Nieuw: `tests/settler-batches.test.mjs` legt
vast dat een verborgen figuur niet in `count` zit (ook via `hide()` zonder `draw()`), dat niemand
getekend wordt vóór `draw()`, dat wie geen rok/haar/hoed draagt er geen instance in heeft, dat
matrix en kleur (ook een flinch) meeverhuizen bij een wissel, dat `figureAt` na elke wissel de
juiste figuur noemt, dat vertrekken en aankomen de batches dicht houden, en dat een inwoner
voorbij NPC Distance in `crowd-view` uit elke `count` gaat. Alle vijf falen op de oude code.

## Metingen

Op een kopie van `~/.promptholm` (Hoogezand) met eigen zee op loopback, in het ingebouwde
browservenster van de desktop-app (800 x 600, RTX 4090 → `full`), met `?stats&nointro&quality=0`
(de kwaliteitsregelaar vastgezet, anders schuift het aantal imps en de schaduwfrequentie mee).
"Van boven" is de camera waar `?nointro` het eiland opent (289 van het doel, dichter dan
Martijns scherm), "ingezoomd" is `focusOn` op het eerste huis-id op alfabet, "te voet" is de
Walk-knop (het plein). "Mensen" = InstancedMeshes met het crowd-materiaal, alle eilanden.

| Toestel / NPC | Waar | | Kleurpas | Schaduwpas | Mensen zichtbaar | Mensen geparkeerd |
|---|---|---|---|---|---|---|
| ?modest, 300 | van boven | vóór | 4.122.705 | 2.701.337 | 1.413.820 | 578.908 |
| | | **na** | **3.705.997** | **2.506.973** | 1.581.064 | **0** |
| ?modest, 300 | ingezoomd op een huis | vóór | 3.171.979 | 2.364.839 | 1.610.720 | 383.148 |
| | | **na** | **2.995.995** | **2.183.375** | 1.610.864 | **0** |
| ?modest, 300 | te voet op het plein | vóór | 3.168.011 | 2.437.105 | 1.610.720 | 383.148 |
| | | **na** | **2.992.003** | **2.254.223** | 1.610.840 | **0** |
| full, 1000 | van boven | vóór | 5.344.601 | 3.789.817 | 1.209.732 | 795.280 |
| | | **na** | **5.019.381** | **3.541.747** | 1.672.440 | **0** |
| full, 50 | van boven | vóór | 5.354.325 | 3.829.411 | 0 | 2.004.328 |
| | | **na** | **3.356.493** | **2.448.115** | 0 | **0** |

Hoe je het leest:
- **Geparkeerd is overal 0**, op elk eiland (de vulkaan en de starters ook).
- **full, 50**: 37% minder in de kleurpas, 36% minder in de schaduwpas. NPC Distance 1000 en 50
  liggen nu 1,66 miljoen driehoeken uit elkaar (vóór: 9.724 hier, 432 bij Martijn) — precies wat
  er aan mensen zichtbaar is.
- **Ingezoomd en te voet**, met evenveel zichtbare mensen vóór en na: 5,5% minder in de kleurpas
  en 7,5% minder in de schaduwpas. Dat is wat rokken, haar en hoeden op wie ze niet draagt
  kostten, plus de bewakers onder hun imp; de geparkeerde mensen van gasteilanden buiten beeld
  vielen in de kleurpas al weg op de bol van hun eiland (`bounds`).
- **Van boven** stonden er "na" meer mensen getekend dan "vóór" (560 tegen 418 figuren op full;
  het aantal dat de zee al geplaatst heeft of op een boot zit, schuift met de tijd), dus daar is
  de winst groter dan het verschil laat zien: kleurpas ≈ vóór − geparkeerd + extra zichtbaar.
- Calls: iets minder (full, 50: 1.909 → 1.868 kleur, 1.449 → 1.414 schaduw), doordat een batch
  zonder iemand erin nu `visible = false` is.

Na de wijziging ook nagelopen op de kopie: voor elke menigte (eigen eiland, vulkaan, drie
starters) staat elke getekende figuur binnen `count` met zijn eigen positie en shirtkleur op zijn
slot, geen verborgen figuur erbinnen (op de vulkaan de 7 bewakers onder een imp), en een ray op de
dichtstbijzijnde getekende inwoner komt via `figureAt` terug als diezelfde inwoner.

## Later

- `instanceMatrix` wordt elk frame in zijn geheel geüpload (640 instances x 64 bytes, per mesh,
  per menigte — ook voor een gasteiland waar niemand getekend wordt). Met `count = live` kan dat
  `addUpdateRange(0, live * 16)` worden. Dat is bandbreedte CPU→GPU, niet vertexwerk, en hoort
  bij een meting van de frametijd, niet van driehoeken.
- Een lage settler voor ver weg (Plans/sneller-tekenen.md) blijft de volgende stap voor wie
  wél getekend wordt.

## Versie

Alleen paginacode; niets op de lijn, niets in `layout.json` of de bundle. Een patch mag dat.
