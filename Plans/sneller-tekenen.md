# Sneller tekenen: meten, dan de kwaliteit laten meebewegen

**✅ Status: gebouwd op 29 september 2026.** Open: een lage settler voor ver weg (Blender), zie *Metingen*.

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
| Van boven, vóór | 902 | 3.302.467 | 716 | 852.461 |
| Van boven, na | 708 | 1.179.313 | 502 | 670.617 |
| Te voet, vóór | 144 | 3.050.298 | 750 | 863.444 |
| Te voet, na | 102 | 933.144 | 536 | 681.600 |

64% minder driehoeken in de kleurpas, 21% minder calls, 30% minder schaduwcalls. De uitsplitsing
komt van `__renderStats.breakdown()` (alleen met `?stats`: één frame lang elke draw call met
zijn eigen calls en driehoeken, per pas). Wat het opleverde, elk een eigen commit:

- **Het water** was 2,3 miljoen van de 3,3 miljoen driehoeken: één vlak met een hoekpunt per
  eenheid over ruim een kilometer, bijna allemaal open zee op een vaste -2,5 waar kleur, normaal
  en glinstering toch per pixel worden uitgerekend. Nu tegels van 16: fijn waar een eiland onder
  ligt (dezelfde hoekpunten als voorheen), twee driehoeken daarbuiten (`waterPatchMesh`).
- **Naamborden**: palen, balk en bord één mesh in één materiaal, 151 calls per pas minder.
- **Settlers**: vest, hals en ogen gooien geen eigen schaduw meer (154k schaduwdriehoeken); ze
  liggen binnen de omtrek van wat wel schaduw gooit.
- **Menigten** krijgen de bol van hun eiland als bounding sphere in plaats van
  `frustumCulled = false`: de vier gastmenigten werden in een schaduwkaart honderden eenheden
  verderop getekend.

Blijft over, bewust: onze eigen menigte is nu 40-47% van elke pas (een settler is ~3.100
driehoeken, drie knopen samen 300). Een gebakken lage versie voor verre figuren is de volgende
stap, en die vraagt Blender.

## Wat de lektest vond

Gemeten in headless Chromium op het testeiland (de vulkaan en drie startereilanden): de fleet
acht keer leeggemaakt en teruggezet, met de GL-objecten zelf geteld (create/delete van buffers,
texturen, programma's en VAO's), omdat `renderer.info` de instance-buffers van een
InstancedMesh nooit telt en twee van de vier lekken dus niet had kunnen zien.

| | boot | na 8 keer |
|---|---|---|
| Voor: GL-buffers | 4143 | 4700 (+92 per keer) |
| Voor: texturen | 184 | 215 (+5 per keer, ~7 MB: de grondmaskers en -vellen van de vulkaan) |
| Na: GL-buffers | 4143 | 4133 |
| Na: texturen | 184 | 184 |

Vier lekken, elk een eigen commit: de bewegende delen van gebouwen (klok, fontein, ertshoop,
oven; nu één lijst in `web/js/record-extras.js`), de InstancedMeshes van het bos, die van de
menigte, en de texturen van de grond (DataTextures en geladen vellen, die `Material.dispose()`
niet vrijgeeft als ze alleen via `onBeforeCompile` bereikbaar zijn). `tests/guest-leak.test.mjs`
bouwt een echte `starterBundle(0)` met elke bewegende civic op en weer af, en faalt op elk van
de vier. De inventaris maakt per bezoek twee contexten en geeft ze beide terug met
`forceContextLoss`; daar hoefde niets.

Nog open, klein: `awaitingSheet` in `hamlets.js` houdt weggegooide veldmaterialen vast (alleen
CPU-geheugen) als het veldvel nooit laadt.

## Versie

Alleen paginacode; niets op de lijn, niets in `layout.json` of de bundle. Een patch mag dat.
