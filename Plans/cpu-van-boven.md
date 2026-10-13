# CPU van boven: waar de ~40 ms per frame in zit

**🚧 Status: gemeten op 9 en 13 oktober 2026, nog niets gebouwd. Welk voorstel eerst kiest de keeper.**

## Aanleiding

[sneller-op-igpu.md](sneller-op-igpu.md) vond dat de pagina van boven ~40 ms eigen werk per frame kost (`?stats`
"work"), ook op de RTX: daar is de main thread het plafond, niet de GPU. Dit plan zoekt uit waar die tijd zit.

## Hoe gemeten

- Het live eiland van de keeper (Hoogezand, ~980 gebouwen, ~490 inwoners en ~880 leerlingen, main op c459d4a en
  2ab5195), via de islander op 4747. Eén islander, geen kopie.
- Een eigen Chrome (eigen `--user-data-dir`, `--remote-debugging-port`, `--force_high_performance_gpu`,
  `--disable-gpu-vsync --disable-frame-rate-limit`), 1584x905, pixel ratio 1, `?stats&nointro&quality=0`
  (trede `full` vastgehouden; de governor zakte anders naar `lighter`).
- **CPU-profiel** over 8 s via CDP `Profiler` (sample elke 0,1 ms), per functie de inclusieve tijd, gedeeld door
  het aantal frames. De `three`-objecten zijn bereikbaar via `window.__THREE_DEVTOOLS__`
  (`Page.addScriptToEvaluateOnNewDocument` vóór het laden: three meldt renderer en scènes daar bij aanmaak).
- **A/B op de pagina zelf** voor de grootste posten: zes paren van 1,5 s om en om aan/uit, mediaan van het
  verschil in frame-interval (de CPU is het plafond, dus interval ≈ kosten).
- Standpunten: **boven** = de camera na het laden (`122,192,177`, ~290 van het dorp), **uitgezoomd** = 250
  verder naar achteren langs de kijkrichting, **straat** = te voet op het plein (walk-knop).

Twee meetvalkuilen erbij, naast die in CLAUDE.md:

- **`work` in `?stats` telt te hoog.** Het loopt vanaf de tijdstempel van `requestAnimationFrame`, niet vanaf het
  begin van de callback: van boven 40 ms "work" bij 31-36 ms frame-interval. Het profiel geeft voor `frame()`
  34-39 ms. Als `work` het werk van de pagina moet zeggen, hoort `begin()` `performance.now()` te nemen.
- **Achter een ander venster tekent Chrome op ~1 fps** (1600 ms "work"). Het venster naar voren halen
  werkt, maar pakt de focus van de keeper. Geminimaliseerd met `--disable-backgrounding-occluded-windows
  --disable-renderer-backgrounding --disable-background-timer-throttling` draait het door (23 fps tegen 26-30
  vooraan): goed genoeg voor A/B, en het stoort niemand.

## Wat een frame kost (ms per frame, inclusief, uit het CPU-profiel)

Twee runs van boven om de spreiding te tonen (zelfde stand, een minuut uit elkaar).

| Stap | boven (1) | boven (2) | uitgezoomd | straat |
|---|---:|---:|---:|---:|
| frame-interval | 38,5 | 42,1 | 47,2 | 25,1 |
| draw calls kleur / schaduw | 992 / 307 | 989 / 308 | 1012 / 326 | 192 / 243 |
| **`frame()` totaal** | **34,2** | **39,1** | **43,9** | **22,9** |
| **three `render()` totaal** | **22,6** | **26,7** | **30,0** | **10,7** |
| — kleurpas (`renderScene`) | 10,4 | 12,0 | 13,8 | 2,1 |
| — schaduwpas | 6,6 | 7,9 | 8,9 | 4,6 |
| — `projectObject` (lijsten opbouwen) | 3,1 | 3,9 | 4,1 | 2,1 |
| — `updateMatrixWorld` (scènegraaf) | 2,6 | 3,1 | 3,3 | 2,2 |
| — record-batch `onBeforeRender` | 0,8 | 0,7 | 1,8 | 1,0 |
| — *waarvan `setProgram`, beide passes* | *7,6* | *8,7* | *10,1* | *2,2* |
| **crowd-view `draw`** (eigen eiland) | **5,6** | **6,3** | **7,1** | **4,5** |
| — settler-figures `draw` | 4,5 | 4,7 | 5,5 | 3,3 |
| — `poseSkinned` | 1,8 | 1,6 | 2,0 | 1,1 |
| — `poseJoints` (resident-skin) | 1,1 | 1,0 | 1,1 | 0,7 |
| **`animateExtras`** (alle records) | **2,9** | **2,8** | **3,1** | **2,1** |
| — `updateKrakenMotion` (vlaggen/zeilen Kraken) | 1,3 | 1,1 | 1,4 | 0,9 |
| minimap `update` (`drawTerrain`) | – | – | – | **3,7** (3,2) |
| `updateLabels` (hover-pick) | 0,9 | 0,8 | 1,0 | – |
| world.update, cullRecords, timberRun, goldRun, peers, director, sound, islets, panels, GC | elk ≤ 0,5 | | | |

Wat erachter zit:

- **De kostprijs per draw call is de grote post.** `renderBufferDirect` + `setProgram` kosten samen ~8,5 µs per
  call (uniforms, textures en VAO per object), keer ~1300 calls in twee passes. Programmawissels zelf zijn
  goedkoop: ~65 per frame, 1,7 ms (`getParameters` + `getProgram`), vooral omdat één `MeshStandardMaterial`
  afwisselend door gewone, skinned, instanced en batched meshes gaat.
- **519-575 van de ~990 kleurcalls zijn de beletterde gezichten van de naambordjes** (`nameplate.js`: een
  vlak met eigen `MeshBasicMaterial` en canvas van 768x293 per bordje, doorzichtig, dus ook gesorteerd).
  A/B: **6,5 ms** per frame (spreiding 3-11).
- **De schaduwpas** (~307 calls; `WebGLShadowMap.renderObject` loopt bovendien de hele scènegraaf nog eens af).
  A/B met `shadowMap.autoUpdate = false`: **7,1 ms** (spreiding 3-13).
- **Kleine riggen tellen per stuk.** Per pass: de spelersrig en de dorpelingen met een eigen rig (smid,
  bakker, slager, visser, de geparkeerde speler; `mount [Skinned]` en `mount/clavicle`) ~70 calls, de twee
  harpoenen van het galjoen samen 22 calls (de GLB, elke node een mesh), losse onbenoemde meshes van de scène ~17.
  Van boven zijn dat een paar pixels, en ze tellen dubbel (kleur + schaduw): ~270 calls, ~2-2,5 ms.
- **De scènegraaf** is 5495 objecten (1639 stand-ins, 2071 groups, 481 bones), drie keer per frame doorlopen
  (`updateMatrixWorld`, `projectObject`, de schaduwpas). `matrixAutoUpdate = false` op alles wat niet beweegt
  gaf in een A/B **geen meetbare winst** (mediaan −2 ms, binnen de ruis): het afdoorlopen zelf kost de tijd, niet
  het opnieuw samenstellen van de matrices. Geen voorstel.
- **De inwoners**: `settler-figures draw` (2,1 ms eigen tijd) loopt elke frame door alle ~880 figuren, en
  `poseSkinned`/`poseJoints` stellen voor elke getekende bewoner 17 gewrichtsmatrices samen, ook als die van boven
  2 px hoog is.
- **Op straat** valt de minimap op: `drawTerrain` tekent de radar elke frame opnieuw uit honderden
  `sea.height`-samples (3,2 ms van 23).

## Voorstellen, de grootste winst eerst

1. **Naambordgezichten alleen waar ze leesbaar zijn**: bouw [naambord-gezichten-op-afstand.md](naambord-gezichten-op-afstand.md)
   (al uitgewerkt, nog niet gebouwd: weg onder ~16 px, een crème vlakje in de batch-vorm). Verwacht van boven
   **~6,5 ms** (gemeten met alle gezichten weg), op straat ~0. Klein, laag risico, geen layout of sea.
2. **Schaduw van boven goedkoper**: van boven (orbit, en de camera verder dan een te kiezen afstand (bijvoorbeeld 60) van het doel) de schaduwmap om
   de andere frame verversen, met het mechanisme dat de governor al heeft (`shadowEvery`, inclusief de
   `info.render.frame`-fix voor skinned lijven); en kleine dingen die van boven niets toevoegen geen schaduw
   laten werpen (de rigs van de dorpelingen en de geparkeerde speler, de harpoenen). Verwacht **~3,5 ms** voor
   om-de-andere-frame plus **~1 ms** voor de werpers; op straat ongewijzigd. Risico: een schaduw die een frame
   achterloopt (van boven niet te zien; de governor doet het al op `lighter`).
3. **Inwoners van boven minder vaak poseren**: een bewoner die kleiner dan een paar pixels op het scherm staat,
   de gewrichten om de 2-3 frames laten samenstellen (`poseSkinned`/`poseJoints`) en de pas-/zwaai-sinussen
   overslaan. Verwacht **~2 ms** van boven, ~1 ms op straat. Middelgroot werk in `settler-figures.js` /
   `resident-skin.js`; `tests/settler-batches.test.mjs` en `resident-poses` moeten blijven slagen.

Samen: van ~36-40 naar ~24-28 ms van boven (van ~26 naar ~37 fps op de RTX).

Kleiner, los op te pakken:

- **Minimap op straat cachen**: het terrein op een offscreen-canvas tekenen en alleen opnieuw als de speler een
  paar eenheden verschoven is, elke frame alleen blitten en de stip zetten. ~3 ms op straat.
- **Kraken-vlaggen en zeilen** (`kraken-motion.js`, 1,1-1,4 ms): per vertex op de CPU, ook van ver weg. Van ver om
  de paar frames, of het golven naar de vertex shader zoals de HD-vlag al doet.
- **`?stats` work eerlijk maken**: `begin()` op `performance.now()` in plaats van de rAF-tijdstempel (zie boven).
- De harpoen-GLB samenvoegen tot één mesh per bewegend deel (22 calls → ~8).

## Open: kiest de keeper

- Welke voorstellen, en in welke volgorde (aanbeveling: 1, dan 2, dan 3).
- Mag de schaduw van boven een frame achterlopen?

## Opnieuw meten

De scripts stonden in de scratchpad van deze sessie: `cdp.mjs` (CDP-client, `measure` = rAF-teller + profiel),
`devtools.mjs` (`__THREE_DEVTOOLS__` registreren, dan laden), `analyze.mjs` / `table.mjs` (inclusieve tijd per
functie per frame), `probe*.js` (calls per object, programmawissels per materiaal), `ab.js` (A/B om en om). De
opzet staat hierboven onder *Hoe gemeten*; met ongeveer 150 regels is het na te bouwen.
