# De zagerij

Begonnen op 25 september 2026. Referentie: een lowpoly houtzagerij ("Lumber mill / Woodworks"):
een roodbruine plankenschuur met een puntgevel, een bord boven de grote deur, een afdak vol
stammen, een trap en een lopende band aan de linkerkant, en voor de deur een zaagbank in zijn
eigen zaagsel.

## Stand van zaken

Model en animatie op `/demo` (rij "Civic", "Sawmill"), en **sinds 25 september op het eiland:
een trede op 55 settlers**, tussen de vuurtoren (50) en de smidse (60). De bosrand is het niet
geworden; dat vroeg een bosregel op de server, want het bos wordt pas in de browser verspreid
(`createLandscape`).

Besloten bij het op het eiland zetten:

- **Geen kavel op het plein.** `TRADES` in `lib/layout.mjs` geeft de zagerij en de smidse het
  dichtstbijzijnde vrije 3x3-blok op het rooster van de stad (`findBlockAround`, de regel van de
  goudkuil), nooit een van de kavels rond het plein. Die zijn voor het stadhuis, de kapel en de
  school en vaak al te weinig (seed 1337 had er zes), en de school telt leerlingen in plaats van
  settlers, dus op een jong eiland komt hij soms pas ná de zagerij. `tests/trades.test.mjs` houdt
  vast dat de kavels met en zonder werkplaatsen precies hetzelfde bezet raken.
- Geen versiepoort: een nieuwe trede zet een nieuw kavel en verschuift niets. Op de kopie van het
  echte eiland (103 settlers) kwamen ze naast elkaar, ~8 cellen van het plein, en bleef elk ander
  kavel staan.
- `main.js` hangt de bewegende delen in `attachExtras` aan de groep van het gebouw (de draaiing van
  het kavel zit daar al in, dus `yaw` blijft 0), `animateExtras` beweegt ze, `disposeRecord` en
  `guest-island.js` ruimen ze op. De kachelpijp rookt zoals die van de herberg.

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

## Later

- Een zager bij de zaagbank, een passieve settler zoals de smid.
