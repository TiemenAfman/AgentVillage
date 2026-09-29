# Sneller tekenen: meten, dan de kwaliteit laten meebewegen

**🚧 Status: in aanbouw sinds 29 september 2026.**

## Waar dit vandaan komt

Tiemen kreeg een AI-gegenereerd "review plan" met vijf blokken Three.js-optimalisaties
(instancing, LOD, Draco, NavMesh, Web Worker, GOAP, GTAO/DoF, camera-lerp, translate3d-balken,
grid placement, een loader in assets.js, dynamische kwaliteit). Naast de code gelegd bleek het
meeste al gebouwd, of in strijd met een regel in CLAUDE.md:

| Voorstel | Besluit | Waarom |
|---|---|---|
| Instancing/merging voor flora, hekken, gewassen | Niet doen | Staat er al: het bos, de rotsen, het gras, de boomgaard en de struiken zijn `InstancedMesh` (`world.js`), `crops.js` en `hamlets.js` mergen. `*-mesh.js` is gebakken output. |
| `THREE.LOD` op kasteel en klokkentoren | Niet doen | Het budget is draw calls, niet driehoeken (één materiaal, één draw call per gebouw). De LOD voor verre eilanden bestaat al: `horizon.js` en `DETAILED`. |
| Draco/Basis | Niet doen | "Nothing is fetched at boot": een Draco-decoder is een asynchrone WASM-loader. |
| NavMesh, Web Worker, GOAP | Niet doen | Er is geen simulatie in de browser; de zee loopt elke crowd deterministisch in `shared/settlerwalk.mjs` (geen transcendente functies, ticks). Settlers zijn echte sessies, geen behoeften. |
| Spatial hash in `facetoface.js` | Niet doen | Dat bestand is de gesprekscamera; er is geen O(N²) daar. Pas als profiling op de zee het vraagt. |
| Dag/nacht, camera-lerp | Niet doen | Bestaan (`world.update`, `weather.js`, `director.js`, de tweens). |
| `agent-bars.js` naar translate3d/sprites | Niet doen | Is al 3D: twee InstancedMeshes voor alle balken. |
| Grid placement in `buoy-placement.js` | Niet doen | Dat bestand zet boeien langs de vaargeul. Groen/rood bestaat in `ghost.js` + de survey. |
| Loader/cache in `assets.js` | Niet doen | `assets.js` maakt URL's; een loader is precies de "Charting the island…"-fout. |
| GTAO, DoF, bloom | Niet doen (nu) | Te zwaar voor `modest`, en een EffectComposer die de alpha niet bewaart maakt elk CSS3D-bord leeg (`HOLE` in `panels.js`). Hooguit later een nachtgloed, alleen als er ruimte over is en de borden heel blijven. |
| Dynamische kwaliteit via `graphics-health.js` | **Doen**, maar apart | `graphics-health.js` is herstel na contextverlies, geen FPS-meter. `modest` wordt nu één keer bij het opstarten beslist, op GPU-naam. |

## Wat we wel doen

1. **Eerst meten.** `?stats` telde alleen de colour pass. Hij telt nu de shadow pass apart
   en de frametijd, zodat een verandering hieronder een getal heeft.
2. **Een kwaliteitsregelaar** (`web/js/quality.js`): puur, zonder DOM en zonder three.js,
   getest zoals `director.js`. Hij kijkt naar de frametijd over een venster van enkele
   seconden, met hysterese, en telt verborgen tabs en pauzes niet mee (zoals
   `graphics-health.js`). Hij draait aan knoppen die **geen shader-recompile** kosten:
   - pixel ratio,
   - hoe vaak de schaduwkaart ververst,
   - hoeveel imps er tegelijk staan.

   Niet `shadowMap.enabled` of het schaduwtype: dat compileert elk materiaal opnieuw, precies de
   hapering die je wilt voorkomen. Niet `DETAILED`: een eiland ophalen of neerleggen kost een
   halve seconde frame (islandsig.js) - een regelaar die dat doet om sneller te worden, stottert.
3. **De schaduw niet elk frame verversen** wanneer de regelaar het vraagt
   (`shadowMap.autoUpdate = false` en om de zoveel frames `needsUpdate`).
4. **Een lektest** in plaats van een dispose-sweep: een gastregio vaak opbouwen en afbreken
   moet `renderer.info.memory` terug op de baseline laten komen.
5. **Uitzoeken waar de driehoeken zitten.** De eerste meting (150 settlers, één wijk, 1280x720,
   SwiftShader) gaf 901 calls en 3,3 miljoen driehoeken in de colour pass.

## Metingen

Headless Chromium met SwiftShader in een Linux-container: de call- en driehoekaantallen zijn
echt, de frametijden niet (software-rendering). Testeiland: 150 nep-sessies, alles in één
wijk (de projectherkenning is voor Windows-paden geschreven), `--no-rescan`.

| Scenario | Calls (colour) | Driehoeken (colour) | Calls (schaduw) | Driehoeken (schaduw) |
|---|---|---|---|---|
| Boot, van boven, `?nointro` | 901 | 3.296.467 | – | – |

## Versie

Alleen paginacode; niets op de lijn, niets in `layout.json` of de bundle. Een patch mag dat.
