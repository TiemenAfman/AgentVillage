# De zagerij

Begonnen op 25 september 2026. Referentie: een lowpoly houtzagerij ("Lumber mill / Woodworks"):
een roodbruine plankenschuur met een puntgevel, een bord boven de grote deur, een afdak vol
stammen, een trap en een lopende band aan de linkerkant, en voor de deur een zaagbank in zijn
eigen zaagsel.

## Stand van zaken

Eerst alleen het model en de animatie, op `/demo` (rij "Civic", "Sawmill"). **Waar en wanneer hij
op het eiland komt is nog niet besloten**: een nieuwe trede in `MILESTONES` (bv. 60 settlers,
tussen de vuurtoren en het standbeeld) met een gewoon gemeentekavel rond het plein, of een eigen
plek aan de bosrand. Dat laatste vraagt een bosregel op de server, want het bos wordt nu pas in
de browser verspreid (`createLandscape`).

## Wat er beweegt

- Het zaagblad draait (16 rad/s, bewust langzaam genoeg om de tanden te zien).
- Een stam schuift over de bank door het blad (5 s), de bank staat daarna even leeg (1,4 s); de
  stam groeit erop en krimpt eraf in plaats van te verschijnen.
- Zolang er hout bij het blad is, spuit er zaagsel omhoog en naar achteren: één `InstancedMesh`
  van 28 spaanders, dus één draw call.
- De rollen van de lopende band draaien, en twee blokken rijden de band op de schuur in.
- De lamp boven het bord gloeit 's nachts (`emissive`), en de kachelpijp heeft een `anchor.smoke`.

## Besluiten

- **Gewone Blender-pijplijn**: `scripts/build-sawmill.py` → `assets/sawmill/sawmill.blend` →
  `web/js/sawmill-mesh.js`. Twee gemeente-assets onder het budget van 1500: `civic_sawmill` (de
  schuur, 864) en `civic_sawmill_yard` (de werf, 923).
- **Bewegende delen zitten ín de werf-asset**, met hun oorsprong op hun eigen as. Een asset moet
  op de grond staan (`scripts/model-rules.mjs`), een zaagblad op bankhoogte niet; zo gelden de
  grond- en budgetregels toch voor alles. `buildings.js` laat ze uit de samengevoegde geometrie
  (`meshAsset(..., { skip: isSawmillMoving })`), `web/js/sawmill.js` hangt ze aan hun eigen
  draaipunt en leest elke afstand (hoe ver de stam gaat, hoe lang de band is, hoe groot een rol
  is) uit de bake.
- **Geen letters op de borden**: zonder textures kan dat niet, dus een bord is een plank met een
  donkere inleg waar de woorden zouden staan.
- De animatie loopt op de eigen klok van de zagerij en een vaste rng-seed, dus
  `tests/sawmill.test.mjs` kan hem twee keer draaien en hetzelfde verwachten.

## Nog te doen voor het eiland

- De trede en de plek kiezen (zie boven), dan `lib/village.mjs` + `lib/layout.mjs`.
- In `main.js` `attachSawmill` hangen zoals de fontein en de vuurtoren, gedraaid met het kavel
  (`attachSawmill(..., yaw)` kan dat al).
