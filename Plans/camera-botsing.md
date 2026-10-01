# Een camera die niet door dingen heen kijkt

**🚧 Status: plan van 1 oktober 2026, gebouwd op `claude/camera-clipping` (vanaf `claude/samenvoegen` b733574),
niet gecommit. Keuzes van de keeper: lijf verbergen bij een korte arm, boomkruinen erdoor. Open: waar het
ongevraagd draaien zat (vraag 1).**

## Aanleiding

De keeper, in walk mode: camera's die clippen en draaien. De follow-camera (`placeCamera` in `web/js/walk.js`)
kent buiten maar één regel: niet onder de grond (`cameraFloor`) en, voor een duiker, niet boven het water
(`applyCeiling`). Er is geen botsing met gebouwen, bomen, de romp van een schip of de Salty Kraken. Binnen houdt
`clampCam` (`web/js/interior.js`) de camera in de rechthoek van de kamer, maar niet uit wat er in die kamer staat.

## Wat er gemeten is

Een meetscript onder Node (het patroon van `tests/diving-walk.test.mjs`: een echte `createWalkMode`, frame voor
frame) zet het lijf op een rooster rond elk gebouw (tot 1,2 van zijn box, alleen waar je kunt staan), draait de
camera rond (12 richtingen × pitch 0,28 / -0,4 / 0,8) en schiet een raycast van het oog naar de camera tegen de
**echte geometrie** van het gebouw. *Bedekt* = er zit iets van het gebouw tussen camera en oog.

| plek | modus | wat je ziet | gemeten |
|---|---|---|---|
| naast een huis / manor / keep | lopen | de muur of het dak tussen camera en lijf, of de camera in het huis | 9% / 13% / 11% van de standen |
| naast het stadhuis / de kroeg / de smidse | lopen | idem | 16% / 12% / 6% |
| naast de Salty Kraken (buiten, 80k driehoeken) | lopen | de rots, de romp, de trap | 17% |
| voet van de trap van de Kraken, pitch 0,28 | lopen, camera rond | camera springt 0,24 omhoog in één frame als hij over de trap komt | 0,24 bij yaw 61° |
| de kroeg | binnen | de muur naar de wc, de bar | 16% |
| het kasteel (rave) | binnen | podium, palen | 7% |
| de Kraken | binnen | galerijpalen, trappen, het ruim, de rots | 37% (deur 55%, ruim 62%, kelder 39%) |
| de kelderboog van de Kraken, van hal naar kelder | binnen, lopen | camera springt 2,25 in één frame en klimt naar 3,18 boven een kelder met plafond 1,46 | gemeten |
| bovenste westgalerij van de Kraken | binnen, rondkijken | het dak gaat er 6× af en weer op in 12 s | gemeten |

En uit de code, niet gemeten maar eenduidig:

| plek | modus | wat je ziet | oorzaak |
|---|---|---|---|
| op het dek van het piratenschip | lopen op dek, muis omhoog | camera onder het dek, in de romp | `groundAt` kent de romp niet: de vloer is water + 0,5. Op 4,05 terug (`leaveHelm`) zakt de camera vanaf pitch ≈ -0,4 onder een dek dat 1,2+ boven het water ligt. `CAM_TILT` draait de camera daarna nog om het lijf, ná de vloer. |
| zwemmend langs de kade | zwemmen | camera schiet ~0,5 omhoog als hij over de kademuur komt; de zwemmer zit achter de steen | `kadeAt` zit in `groundAt` (vloer springt), de muur is geen solid |
| langs een steiger, brug, vingersteiger | lopen/zwemmen, muis omhoog | dezelfde sprong als bij de Kraken-trap | `cameraFloor` leest elke `surface`/`deck`/`level` onder de camera |
| in het bos | lopen | camera door de kruinen | stammen zijn cirkels zonder hoogte, kruinen bestaan niet als vorm |
| first person in een kamer | V | het oog staat 0,08 te hoog (gehurkt 0,24), kijk je omhoog dan wordt de camera opgetild | `clampCam` tilt naar voeten + aim + 0,18 = 0,50, ook in first person (oog 0,423) |
| dicht tegen een muur | lopen | het near plane (0,5) snijdt de muur naast je weg | elke ingetrokken camera komt binnen 0,5 van iets |

**Draaien.** Het terugdraaien achter fiets en boot (`riddenSinceLook`, `RECENTRE_AFTER`) doet wat het commentaar
zegt: alleen horizontaal kijken zet de klok terug, na 0,5 s rijden trekt hij in 0,5 s bij. Daar vond ik geen fout.
Wat wél ongevraagd draait: de kelderboog (hierboven, de camera wisselt in één frame van kamer), de rol van de
horizon op een schip (`CAM_TILT` 0,25 van haar deining, bewust) en de vloersprongen, waarbij `lift` het
mikpunt meeneemt zodat het beeld ook kantelt. **Vraag aan de keeper: waar zag je het draaien?**

## Ontwerp

### 1. Een camera-arm buiten, tegen blokken met een echte hoogte

In `placeCamera`, alleen in third person: van het mikpunt (lijf + `camStep` + aim) naar waar de camera wil staan
één segment; de eerste botsing langs dat segment kort de arm in. Waar het tegen botst is een eigen, camera-only
lijst, naast de blockers (niet in de blockers: een dak is geen muur voor je voeten):

- **Gebouwen: de box van elk onderdeel**, in `buildBuilding` vóór de merge opgemeten (`built.camBoxes`, met
  de schaal van het gebouw mee), en door `main.js` op dezelfde momenten als `walkableBlockers` met het gebouw
  meegedraaid (`solidAt`, met `y0`/`y1`). Guest-eilanden hetzelfde. Gemeten in het prototype: met een arm die
  tot 0,25 in mag lost dit **95–99%** van de bedekte standen op (huis 99%, Kraken 95%), en kort het 5–10% van
  de vrije standen voor niets een stuk in (de Kraken 15%: de box van een schuin dak is een prisma).
- **Wat je voeten al kennen, met een hoogte**: keien (`top`), hekken, de solids van gebouwen.
- **Vloeren als plaat**: `surfaces`, `decks`, `levels` en de kade worden voor de camera een dunne plaat (van
  hun hoogte tot een hand eronder), zodat een camera die zakt tegen een steiger *stopt* in plaats van erop te
  springen. De kademuur is een plaat van bodem tot bovenkant.

`cameraFloor` leest daarna alleen nog terrein en water, niet meer de planken: dat haalt alle vloersprongen
weg, en daarmee ook het kantelen via `lift`.

Gekeken en afgewezen: **een raycast tegen de echte meshes**. Een huis kost 0,02 ms, maar de buitenkant van de
Kraken (80k driehoeken, zonder BVH) 1,2 ms per straal, en de `BatchedMesh` houdt de enige kopie van elk gebouw
(de losse geometrie wordt bij `add` weggegooid) - dat vraagt de interne bereiken van de batch. Een
**hoogtekaart per gebouw** (zoals de shipwalk-map) was in het prototype slechter dan de boxen (49–77%). De
raycast blijft wel: als **meetlat in de tests**.

### 2. Het segment, exact en goedkoop (`web/js/solids.js`)

`segmentEntry(shape, a, d, len, r)`: de eerste `t` waarop het segment de vorm (gegroeid met de straal van de
camera) in gaat - slab-test in het eigen frame van de vorm (`local`, met de al gecachte `c`/`s`), cirkel
analytisch, hoogte-interval op dat punt. Een vorm waar het mikpunt al in staat telt niet (daar kom je niet uit).
De index loopt de emmers langs het segment af (DDA over `BUCKET`) in plaats van punten te vragen. Puur, geen
three.js - dus te testen zoals `tests/walk-solids.test.mjs`.

Kosten: het prototype deed de boxen lineair, 3–10 µs per frame per gebouw (Kraken 55 µs voor 1293 boxen);
met de index zijn het er een paar dozijn. Geen draw call, geen geometrie bewaard: ~100 boxen per huis als
`Float32Array` is ~2 MB voor 800 huizen. Wordt het meer, dan eerst per gebouw samenvoegen (`joinTight`).

### 3. Een arm die niet pompt

In: meteen (nooit een frame met iets ertussen). Uit: rustig, exponentieel (~3/s), zodat langs een gevel draaien
niet heen-en-weer springt. Kort dan 0,6 zakt het near plane mee (`near = clamp(0,4 × arm, 0,05, 0,5)`, net als
`FP_NEAR`, alleen zolang de arm kort is) en onder ~0,4 gaat het lijf weg zoals in first person (`FP_HIDDEN`,
de armen blijven). **Keuze voor de keeper**: dat, óf de camera boven het hoofd laten klimmen zoals binnen.

### 4. Binnen (`interior.js`)

- De arm uit 1 doet het ook binnen, met de blockers van de kamer (die hebben al `y0`/`y1`) en de vloeren
  (`def.surfaces`) als platen; `clampCam` blijft de kamer zelf bewaken.
- **Geen sprong bij de boog**: `areaAt` kiest de kamer van het mikpunt met wat hysterese, en de wissel van box
  wordt over ~0,25 s overgevloeid. Een kamer met een eigen plafond (de kelder) laat de camera er niet meer
  doorheen klimmen: de klim stopt een hand onder `a.ceiling`, de arm doet de rest.
- **Het dak**: `roofWanted` met hysterese (af onder −0,04, pas weer aan boven +0,2), en tegen de hoogte van het
  dak bóven de camera (een optionele `def.roofAt(x, z)`; de Kraken: van `EAVES` aan de muren naar `CEILING` op
  de nok), niet tegen de nok overal.
- **First person**: de bodem `p.y + aim + 0,18` alleen in third person.

### 5. Op een romp

De camera-vloer op een schip is de hoogste stavloer onder de camera in haar eigen frame, uit de shipwalk-map
(`shared/hullwalk.mjs`), plus een hand; de kanteling (`CAM_TILT`) gaat vóór de vloer in plaats van erna. De
romp zelf (`shipSolids`, `hull`) en de masten doen mee in de arm.

### 6. Bomen - keuze voor de keeper

Stammen tellen mee (een cirkel tot de kruin). Kruinen: (a) **niet** (aanbevolen - in een bos zou de camera
anders voortdurend inschuiven; de meeste spellen laten blad door), of (b) als bol, met de rustige uitgaande arm.

## Tests

`tests/camera-boom.test.mjs`, frame voor frame met de echte walk mode en de raycast als meetlat:

- per gebouw (huis, manor, keep, stadhuis, kroeg, smidse, Kraken): na de arm ≤ 3% van de standen bedekt;
- langs een gevel 1° per frame draaien: de camera beweegt nooit meer dan de draai zelf + 0,05 (geen pompen,
  geen sprong) - ook aan de voet van de Kraken-trap en zwemmend langs de kade;
- de Kraken binnen: ≤ 5% bedekt; door de boog nooit meer dan 0,3 per frame; het dak hooguit 1× om bij rondkijken;
  first person op ooghoogte, ook gehurkt;
- op het dek van het schip, muis helemaal omhoog: de camera nooit onder haar dek.

## Fases

1. `segmentEntry` + de index langs een segment, met tests.
2. `camBoxes` in `buildBuilding`, overdracht in `main.js` (en `guest-island.js`), de arm in `placeCamera`, de
   vloer zonder planken, near plane en lijf bij een korte arm.
3. Binnen: arm met de blockers van de kamer, boog, dak, first person.
4. Het schip.
5. Bomen, na de keuze.

Alleen `web/js/` (en tests): geen layout, geen bundle, geen `SEA_V` - past in een patch.

## Gebouwd - gemeten

Met dezelfde meting als hierboven, na de bouw (`tests/camera-boom.test.mjs` houdt het vast):

| | voor | na | lijf verborgen |
|---|---|---|---|
| huis / manor / keep | 9% / 13% / 11% | 0% | 6–8% van de standen |
| stadhuis / kroeg / smidse | 16% / 12% / 6% | 0,1% / 0% / 0% | 7–12% |
| Salty Kraken buiten | 17% | 0,5% | 14% |
| kroeg / rave / Kraken binnen | 16% / 7% / 37% | 0,7% / 2,2% / 1,8% | 18% / 4% / 30% |
| kelderboog | sprong 2,25 | 0,01 | |
| dak bovengalerij, 12 s rondkijken | 6× om | 3× | |
| rondkijken aan de voet van de trap | sprong 0,78 (2,16 met de boxen, zonder zijstralen) | ≤ 0,40 | |
| dek van het schip, muis omhoog | 1,27 in het dek | erboven | |

*Lijf verborgen* is waar de arm korter wordt dan 0,45: tegen een muur, tussen palen. Kosten: ~40 µs per frame
naast een straat van veertig huizen en de Kraken (zonder arm ~20 µs voor heel `walk.update`).

Afwijkingen van het ontwerp: de vloerplaten en de romp zijn gesampled langs de arm in plaats van als vormen
(één route voor `surfaces`, `decks`, `levels`, kade en romp); de arm kijkt met drie zijstralen per kant vooruit
(`ARM_SIDES`), want een hoek kwam anders in één frame binnen; de romp telt alleen onder haar dek (masten en
kasteel niet - de walk map kent alleen hun bovenkant).

## Open vragen

1. Waar zag je de camera ongevraagd draaien? (2 en 3 zijn beslist: lijf weg, kruinen erdoor.)
