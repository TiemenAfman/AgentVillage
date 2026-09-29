# Een zeebodem, onder water zwemmen en duiken

**🚧 NOG NIET KLAAR** — alles gebouwd en getest op `feature/onderwater-zwemmen`; open: de telefoon en `?modest` zijn nog niet in een browser bekeken, en verdrinken werkt pas als de open zee opnieuw is gedeployed.

Begonnen op 29 september 2026. Gevraagd: "maak een plan voor zeebodem en onderwater zwemmen en
duiken". Doel: de zee wordt een plek. Je kunt eronder, er is een bodem met reliëf en leven, andere
spelers zien je, en wie te lang onder blijft verdrinkt.

## Hoe het zat

- Zwemmen was alleen aan het oppervlak: `walk.js` pint `y` op `WATER_Y - SWIM_SINK` (-0.07), diepte
  doet niets, `jump()` wordt in water geweigerd. Diepte-logica bestond niet.
- Buiten het eigen eiland bestond er geen zeebodem: de oceaanschijf (opaque, y = -0.2) verbergt alles
  eronder, gasteilanden slaan hun bodem over (`skipSeabed`) en tussen eilanden is de bodem het vlakke
  `OPEN_SEA` (-2.5). Onder water zag je de hemel en het eigen eiland en verder niets: het
  wateroppervlak (`waterMat`) is FrontSide en verdwijnt van onderen.
- Aan de zee-kant bestaat `POSE.SWIMMING` (2), de zee clampt `y` op [-4, 60] en relayt hem
  ongewijzigd, maar `peers.js` negeert die `y` voor een zwemmer. Geen enkele module beschadigt een
  speler behalve `health.hurt` (guards en lava).
- De getekende bodem is niet de logische bodem aan de rand van een eilandraster: de mesh stopt daar
  met de ruwe `H` (26–42% van de randhoeken ondieper dan -1.5), terwijl `placeIsland.worldHeight`
  over `BLEND_CELLS` = 4 naar `OPEN_SEA` afvlakt. Een duiker moet de *getekende* bodem raken.

## Besluiten

- **De zeebodem is een teken- en botslaag naast het terrein, nooit `H`.** Elke wijziging aan `H`,
  ook ver offshore, verandert `layout.terrainHash` en verplaatst alle huizen (`quay-basin.mjs` is
  het precedent). `shared/seabed.mjs` levert het veld, `archipelago.bedAt(x, z)` de bodem voor
  duikers, `web/js/seabed.js` tekent hem. `height()` blijft het logische wateroppervlak voor boten,
  guards en kleur; daarom blijven `water-patch.test.mjs` en de tegelbegroting van de eilandjes heel.
- **Diep tot -3.5, hoog tot -1.0.** Buiten de eilanden: geulen tot -3.5 (binnen de sea-clamp van
  -4), banken tot -1.0 (boten schuren pas vanaf 0.35, dus nooit). Vanaf een eilandrand mengt de
  bodem over `BED_BAND` (12) van de ruwe rand naar het veld, en het veld zelf komt over `BED_FADE`
  (40) op sterkte, zodat er nergens een klif ontstaat.
- **Duiken is een eigen toestand in walk.js** (`web/js/diving.js`, puur, naar model van `stepBike`).
  `state.dive` = `y` is vrij; `state.diving` = het hoofd onder water (`y + HEAD < WATER_Y`). Erin:
  zwemmend + de crouch-actie; eruit: terug op het oppervlak. Omlaag is crouch (C, pad B, touch B),
  omhoog is Space (pad A). Geen nieuwe ACTIONS-rij, dus herbindbaar zonder extra werk. Op de bodem
  kun je lopen. `ceilingAt` houdt je onder een steiger.
- **De camera volgt geen lichaam maar zichzelf**: onder water is het effect er zodra de *camera*
  onder het oppervlak zit. `camera-floor.js` krijgt naast `cameraFloor` een `cameraCeiling`, met een
  ease rond het oppervlak.
- **Verdrinken is van de zee, zoals health.** `shared/breath.mjs` (één kopie), `lib/breath.mjs` (na
  `lava.tick`, vóór `health.tick`), privé `{t:'breath', air, max, rate}` en een optioneel
  `why:'drown'` op `evicted`. De pagina voorspelt de balk met dezelfde `stepAir`. Geen nieuwe
  pose-bit en geen `SEA_V`: alles is additief. Wie zijn pose vervalst ontloopt het verdrinken, zoals
  bij elke pose.
- **Anderen zien je duiken zonder draadwijziging**: een zwemmer met een gestuurde `y` ruim onder
  het oppervlak wordt op die `y` getekend (geklemd op ≤ -0.07 en ≥ de bodem), de helling komt uit de
  verticale snelheid van de twee snapshots. Een oude pagina ziet een oppervlakzwemmer.
- **Onderwaterlook** (`web/js/underwater.js`): mist, licht, hemel verbergen, overlay en laagdoorlaat,
  na `sky.update` en `applyFogRange`, vóór render. Het oppervlak van onderen is **één schermvullende
  quad** die per pixel de straal met het wateroppervlak snijdt (Snell-venster) en die diepte in
  `gl_FragDepth` schrijft, dus alles boven water ligt erachter (ook `fog:false`, zoals de
  vuurtorenbundel). Dat werd het in plaats van drie BackSide-meshes, omdat de near-plane op 0,5 een
  plafond dichterbij wegknipt (precies waar een duiker de eerste seconden zit) en de deining een
  enkelvlaks plafond doorboort. Boven water is hij `visible=false` en kost niets.
- **De doorlopende bodem wint van de eilandmesh.** De eerste versie legde de bodem 0,03 *onder* de
  eigen ondergrond van een eiland, zodat die won; de onderwaterkleuren van de kust zijn een donkere
  plaat naast het zand van open zee en een duiker zag de rechte rand ervan bij de rand van het
  raster (gezien op een screenshot). Nu ligt de bodem `SEABED_LIFT` (0,02) erboven met een
  polygonOffset naar voren, en tekent hij ook over de eigen ondergrond van een eiland.
- **Leven** (`assets/sea` + `web/js/sea-life.js`): een nieuwe gebakken set (kelp, koraal, rots,
  schelp, zeester, twee vissen), per chunk deterministisch verstrooid rond de focus, één
  `InstancedMesh` per soort, alleen actief in of bij water, met caps per tier. Vissen en bellen zijn
  alleen op de pagina, niet op de draad.
- **Guards**: een duiker dieper dan 1.2 onder zee is onhitbaar (`hostility.mjs:258`) maar wordt wel
  achtervolgd. Dat laten we in deze ronde zoals het is.

## Compatibiliteit

| Situatie | Effect |
|---|---|
| Nieuwe pagina, oude zee | Duiken, bodem en leven werken; de adem-balk is lokaal voorspeld, maar er is **geen schade** tot de open zee opnieuw is gedeployed |
| Oude pagina, nieuwe zee | Negeert `breath` en `why`; verdrinkt nooit (stuurt altijd y = -0.07) |
| Oude pagina ziet een duiker | Ziet een oppervlakzwemmer |

Alles additief, dus een patch-release. Na de release de open zee zelf redeployen (stack 28 heeft
geen webhook).

## Stappen

Alles op `feature/onderwater-zwemmen`, elk pakket met eigen tests; uitgevoerd met een aantal agents
naast elkaar op losse bestanden.

0. ✅ Plan en worktree (af van `main` na het eilandjes-werk).
1. ✅ Duiken: `diving.js`, walk.js, `cameraCeiling`/`applyCeiling`, lokale pose, touch B, `?dive`.
2. ✅ Zeebodem: `shared/seabed.mjs`, `bedAt` + `setBedHome`, `seabed.js`.
3. ✅ Onderwaterlook: `underwater.js`, de quad in `world.js`, overlay, geluid.
4. ✅ Adem en verdrinken: `shared/breath.mjs`, `lib/breath.mjs`, `breath`/`why`, vitals.
5. ✅ Anderen zien je: `peers.js` (`divers()` voor bellen en vissen).
6. ✅ Leven: de set `sea`, `sea-life-plan.js`, `sea-life.js`, vissen, bellen, caps per tier.
7. ✅ Afwerking: docs (`manual.md`, CLAUDE.md), metingen. De steigerpalen staan onder water op de
   bodem (de palen van de kade zijn lang genoeg); boeiketting en steigerhuizen zijn niet gedaan.

## Gemeten

- Tests: 1487 van 1488 slagen; de ene die faalt (`a Codex island has its own stable layout`) faalt
  ook op een schone `main`. `plan-scan` flakt onder load en slaagt los.
- Live, in de Chrome van de DevTools-MCP: duiken, hangen, op de bodem lopen, terug omhoog; de camera
  gaat zacht onder het oppervlak en weer terug; bodem, kelp, rotsen, vissen, bellen en caustics zijn
  zichtbaar; de rand van het eilandraster is een naadloze overgang. Verdrinken werkt end-to-end op de
  lokale zee (de toast "out of breath" kwam van de echte sea).
- Bodem: 17,8k driehoeken in één draw (modest 7,9k), een herbouw kost ~1,3 ms in Node.
- Onderwaterlook: 100 fps met het venster vooraan. `?stats` op het thuiseiland, kleurpas: aan het
  oppervlak 52 calls en 375k driehoeken, onder water 65 en 470k (de bodem, het leven en de
  bellen: +13 calls, +95k driehoeken); boven water kost het niets.

## Open vragen

- Moet `afoot` duikers buiten het bereik van guards houden (nu onhitbaar, wel achtervolgd)?
- Wordt het een minor of een patch? Niets breekt, dus beide kan.
- De telefoon (`STANDALONE`, tier `phone`) en `?modest` zijn alleen in Node getest, niet in een browser.

## Later, niet nu

Rig-zwemanimatie, wrakken en schatten, zwemmende settlers en dieren, dieper dan -3.5, banken die
van boven zichtbaar zijn (dichte watertegels kosten driehoeken), zwemgeluiden.
