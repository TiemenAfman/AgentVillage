# 🚧 Een nieuwe sloep in plaats van het galjoen

Plan van 9 oktober 2026, met de keeper in een Fable-sessie opgezet; de bouw gaat in chips (Opus).
De opdracht, letterlijk: *"beter idee: hele boot opnieuw maken"* — *"maar ik wil het model alleen als
input gebruiken en niet als eindresultaat"* — *"goede plekken voor harpoons en kanonnen. misschien dat
je naar binnen kan?"*

## Waarom

Het galjoen (`pirateship`, een gedecimeerde Sketchfab-download van 13 lang, `scripts/build-pirateship.py`)
deugt niet meer, gezien in het spel op 9 oktober:
- de geschutspoorten zijn gaten dwars door de romp: door elk luik zie je het water aan de andere kant;
  de luiken zijn losse grijze blokken;
- het boord is één gele balk;
- bovenaan de touwladder moet het lijf over de bulwark heen, waar Mixamo's *Climbing Up A Ladder To
  Standing* niet voor gemaakt is: het zit half op de reling, één hand in de lucht, en schuift daarna over
  het dek ([Plans/DONE/ladder-op-en-af.md](DONE/ladder-op-en-af.md)).

De keeper kocht een Sea of Thieves-sloep (`C:\Users\Martijn\Downloads\Sea_of_Thieves_-_Sloop\*.gltf`,
378k driehoeken, één massieve STL-achtige mesh in vier stukken, geen texturen, geen binnenkant, één
materiaal). Die is **alleen maatlat**: nooit eindresultaat, nooit in git (`refs/` is gitignored).

## Besluiten (keeper, 9 oktober)

- **Route**: een eigen parametrisch Blender-bouwscript in de huisstijl, zoals de Batavia
  ([DONE/batavia.md](DONE/batavia.md)) en de Kraken-romp: de maten van het gekochte model één keer gemeten
  en als letterlijke getallen in het script.
- **Maat**: romp 9 lang van steven tot spiegel, de boegspriet erbij (~11 totaal); lage vrijboord; crew 5.
- **Bewapening**: 1 kanon per boord in de waist, in een open geschutspoort met opgeklapt luik; 1 harpoen
  midden op de boeg boven de boegspriet. Mounts `[kanon SB, kanon BB, harpoen]` (de index staat op de
  draad; stuurboord blijft 0 zoals nu).
- **Ingang** per boord: de bulwark open tot dekniveau, in de waist achter het kanon ter hoogte van de
  mast, met de touwladder eraan. De afstap-clip eindigt op het dek, nooit op de reling.
- **Dichte geschutspoorten** elders: binnenwand en luik, geen doorkijk. **Echt boord**: kaprail, stutten,
  houtkleuren.
- **Open achterhut** onder het achterdek, open naar de waist (kooi, kaarttafel, lantaarn), inloopbaar.
  Het achterdek mag omhoog tot er ≥ 0,75 vrije hoogte is.
- **Zeil** als bewegend deel dat de zeilstand (`b.underSail`) volgt, de vlag ook; het kraaiennest via
  pennen op de mast (verticaal, op `RUNG_STEP` gesneden); want en stagen decoratief.
- **Ligplaats opnieuw** berekenen voor de kleinere romp: `QUAY_VERSION`-bump, **minor 0.11.0**, open zee
  eerst redeployen.
- De codesleutel blijft `galleon` (`kindOf`, `CRAFTS.galleon`, lib) en de set blijft `pirateship` /
  `pirateship hull` (boat.js `SHIP`, models.js, build-shipwalk): geen renames op de draad; alleen tekst
  zegt "sloep".

Gemeten alternatieven, afgewezen: Pixal3D van een referentiebeeld (een schip van één foto is niet in te
lopen: dekken, trappen, binnenkant) en een ander Sketchfab-model (dezelfde gaten, geen ingangen).

## Wat er aan het model hangt (inventaris)

`shared/crafts.mjs` (dekrechthoeken, rails, ladders op z 1.85, aloft, nest, mounts, `sail.probes`,
`SHIP_TALL`/`SHIP_DRAUGHT` = 12.29·7/58.56 uit de verhoudingen van de download), `scripts/build-shipwalk.mjs`
→ `web/js/shipwalk-map.js` (GRID/ALOFT/SIDE), `shared/hullwalk.mjs`, `shared/deck.mjs` (`ladderPath` over
de bulwark), `web/js/boat.js` (`SHIP`, `ladderBoxes`, `layGun`, `HELM_AT`, `SHIP_NEAR`, `createSide`),
`walk.js` (`stepHull`, `manGun`, `pullLanding`, ladder- en mastklim), `shared/cannon.mjs` `HULL_BOX`,
`harpoon-play.js` `HULL_R`/`HULL_Y`, `hull-bars.js`, `lib/players.mjs` `clampToDeck`/`DECK_HEIGHT`,
`shared/quay.mjs` `shipBerth` (uit `sail.probes`; layout-rekenwerk) en zo'n 25 tests die getallen van de
oude bake pinnen. De zee leest van het galjoen alleen `crew`, `clampToDeck(deck)` (2-D), `kindOf`,
`HULL_BOX`/`HULL_HITS` en de mount-index (`i < 8`); nooit mountposities, rails, ladders of het zeil.

## Hoe het landt: vier chips, in volgorde, elk groen mergebaar

Chip 1 en chip 2 (a/b/c) kunnen parallel; chip 3 wacht op checkpoint A; chip 4 op chip 2 en 3.

### Chip 1 — Meetlat: `scripts/measure-sloop.py` → `refs/sloop/measure.json` + renders

- Importeert het gekochte glTF (pad buiten git als argument, default Downloads), bakt de node-rotatie in
  de vertices, bepaalt lengte-as en boeg uit de romp (laagste 25 %: langste as; boeg = smalste eind én
  het eind met de boegspriet; stop als die twee het oneens zijn), draait naar +Z boeg (Blender −Y),
  schaalt `k = 9 / romplengte op kaprailhoogte` (boegspriet uitgesloten), kiel op z 0, x gecentreerd,
  z 0 midden van de romp. Schrijft de matrix mee.
- Snijdt stations elke 0.25 (plus steven en spiegel) met **ray casts op een `BVHTree`** (geen bisect op
  378k faces): halve breedte per hoogte (0.05-stappen, uitschieters van want/ra weg), dekprofiel (kaprail,
  dek, binnenkant bulwark), kiel.
- Leest af: dekken (clusters op hoogte: hoofddek, achterdek + breuk, voordek/ramp), mast (x, z, truck),
  nest (vloer, straal, rand), ra, roer, trappen (z-bereik, breedte, treden), boegspriet (lengte, hoek),
  geschutspoorten (inkepingen), spiegel. Diepgang: kandidaten (90 %-breedte, 0.3/0.35/0.4 van de hoogte)
  plus een liniaal op de zijrender; de keeper kiest `W`.
- Renders (`refs/sloop/renders/`: side met liniaal en stations, top, body-plan, quarter, deck) met de
  workbench-opzet van build-batavia.py (`SHOTS`).
- **Checkpoint A (keeper)**: boeg/boven/schaal goed, `W` gekozen, hoogte van het achterdek boven het
  hoofddek gelezen (< 0.75 → omhoog in de bouw).

### Chip 2a — Anchor-grammatica, generator en bevroren oude getallen (vóór de bake; in-game niets anders)

- `scripts/model-rules.mjs`: `ANCHORS += helm, nest, cargo`; `SHIP_ANCHOR` krijgt `port.<n>.lo|hi`;
  `WALKED_ANCHOR`-namen met koppelteken; nieuw `MOUNT_ANCHOR = mount.(cannon|harpoon)(-naam)?.(lo|hi)`
  (**lo = waar de schutter staat, hi = midden affuit/voet op de planken; de peiling lo→hi is de yaw**, zodat
  een empty nooit een richting hoeft te dragen); `PAIRED` uitgebreid. `tests/models.test.mjs`: cases
  geaccepteerd/geweigerd. `assets/README.md` alinea.
- `shared/deck.mjs`: `CLIMB_OUT` exporteren.
- **`scripts/build-craft.mjs`** (patroon: build-shipwalk.mjs; draait vóór de walk-map, want
  build-shipwalk importeert `SHIP_DRAUGHT`): leest `PIRATESHIP.anchors` + `height`, schrijft
  `shared/craft-galleon.mjs` (alleen literals, `source` = sha1 van anchors+height): `draught`, `tall`,
  `length`, `beam`, `helm`, `deck` (uit `deck.*`/`stair.*`), `rails` (uit `rail.*`/`solid.*`/`mast.*`),
  `ladders` (uit `climb.side-*` + `port.*`: x = lo.x ∓ CLIMB_OUT, top = dekhoogte bij land, `port` = halve
  poortbreedte), `aloft` (uit `climb.mast` + `mast.main` + `deck.nest`), `nest` (uit `anchor.nest`),
  `mounts` (vaste naamvolgorde; yawLim/pitchLim per soort uit een tabel), `probes` (uit de side-cut), `box`
  (HULL_BOX), `near`. Craft-y = anchor-y − waterline − DECK_Y. Dockerfile.sea kopieert `shared/` als map,
  dus de zee krijgt de module vanzelf (`tests/sea-image.test.mjs`).
- `shared/crafts.mjs`: hand-getuned blijft `crew`, `BULWARK`, `hw` 0.14, `sail`-dynamiek, `swell`,
  `nest.reach`; de rest spreidt uit `GALLEON`. `SHIP_DRAUGHT = GALLEON.draught`, `SHIP_TALL` weg. boat.js:
  `HELM_AT`, `SHIP_NEAR`, `beam`, `cargoAt` uit het craft; deck-bake-, batavia- en ship-runout-tests lezen de
  afgeleide getallen.
- **Eerst op de oude bake**: `build-pirateship.py` krijgt empties met de huidige gemeten getallen; een
  tijdelijke test houdt `GALLEON` ≈ de oude hand-getypte `CRAFTS.galleon` (1e-3). Zo is de pijplijn bewezen
  zonder dat in-game iets verschuift. `scripts/models.mjs` + `package.json` (`models:craft`).
- Test `tests/craft-bake.test.mjs`: een stale module faalt; generated == derived.

### Chip 2b — Poortladder, landingspunt, camera-lid (vóór de bake)

- `shared/deck.mjs ladderPath`: met `ladder.port` drie punten (voet, dekniveau buiten, land) in plaats van
  over de bulwark; zonder `port` ongewijzigd. `boat.js ladderBoxes`: touwen tot dekniveau, belegklamp vlak.
- `walk.js landingOf(b, ladder)` = `nearestStand(walk, land, floor + 0.2)`, gebruikt door `startClimb`,
  `hoistOnto` en peers' `ladderAt` (zelfde eindpunt in `climbWay`), zodat de afstap-clip exact eindigt waar
  `ladderUp` landt. `ladderAhead`/`ladderAt` "binnen 7" → `GALLEON.near`.
- Camera in de hut: `shared/hullwalk.mjs createSurface.ceilingIn(x, z, y)`; `walk.js hullForCamera`
  begrenst `reach` op het plafond en `solidPoint` ziet het plafond als plaat (zoals `plank()`), via het
  bestaande `applyCeiling`. Test: 360°-sweep in een hut op een synthetisch craft.
- Test `tests/port-ladder.test.mjs` op een synthetisch craft met `port`.
- *Stand 9 oktober*: gebouwd (branch `claude/epic-babbage-2daa62`): `ladderPath` met `port`, `ladderBoxes`,
  `ladderLanding` (ladder-way.js, de ene som voor `startClimb`/`hoistOnto`/`ladderAt`), `near` van het craft,
  `ceilingIn` + camera-lid (alleen terwijl het lijf onder een lid staat: ongegated trok een ra de boom een
  eenheid in), de test en de workbench-optie *Poortladder*. Open: bij de hutdeur (lijf buiten, camera binnen)
  tilt het achterdek de camera nog door de plaat - een regel daarvoor veranderde de camera van het galjoen
  onder de nagelbank en is eruit gehaald; in chip 4 op het echte craft opnieuw meten.

### Chip 2c — Zeil en vlag als bewegende delen (vóór de bake; no-op zonder die parts)

- `boat.js isShipMoving = /^pirateship (sail|flag)( .+)?(:\d+)?$/` (eigen predicaat; de kraken-motion-test
  houdt het Kraken-regex); `createBoat` last ze als laatste runs in de ene geometrie (het
  `gunRuns`-mechanisme), bewaart basisposities en maten (ra = hi.y, voet = lo.y).
- Pure `moveSail(m, t, share, out)`: elke vertex blendt tussen gebakken plek en opgerolde plek onder de ra
  op `1 − share`, plus de Kraken-ripple op de zeeklok; `moveFlag` = de Kraken-vlagsom. Aangeroepen in
  `bob(time)`. `share`: eigen romp `sailOf(b)`, gevolgde romp `b.underSail` of uit `hullSpeed/sail.top`,
  ge-eased over ~2 s. Test `tests/ship-sail.test.mjs`.
- Count-agnostische mount-tests (cannon, harpoon-ship, harpoon-play); `shared/cannon.mjs` importeert
  `HULL_BOX` uit crafts.mjs.

### Chip 3 — Bouwscript `scripts/build-sloop.py` (na checkpoint A; vervangt build-pirateship.py)

- Frame: `xyz(p) = (x, −z, y)` als build-batavia; +Z boeg; kiel y 0; origin midden romp; `W` als
  `anchor.waterline`. Alles aanraakbaars in **één** statisch part `pirateship hull`, één materiaal
  `plain:pirateship paint`, kleuren als CORNER-attribuut `Paint` (boat.js's merge draagt geen sheet);
  glas en ramen in `pirateship glow` (emissive 1; `withLadders` neemt het mee, de walk-map niet).
- Hergebruik uit build-batavia.py: `Part`, `face` (Newell + hint), `box/tube/rod/spar/slab/plate`,
  `ray_down`, `measured`/`deck_rect`/`anchor`, `figure`, `SHOTS`; uit build-pirateship.py `clip()` en de
  planklus (0.18 × 1.15, gap 0.007, toonhash); vormideeën uit krakenkit `gunport.py` en `mast.py ladder()`.
  **Geen bpy.ops op geometrie, geen join, geen late matrix_world**: byte-identiek door constructie.
  `RUNG_STEP`/`RUNG_FROM`/`RUNG_R` per regex uit shared/deck.mjs (mast.py `_deck()`).
- Met checkpoints:
  - **B Romp**: stations-tabel (letterlijk uit measure.json), 12-14 strakes met `PROUD`-rand, wales,
    bodem, kiel, steven, spiegel met ramen, roer. Renders side/quarter/top/pair naast de Batavia;
    driehoeken per label.
  - **C Dekken**: hoofddek, achterdek (≥ 0.75 vrij; omhoog indien nodig), hutvloer (= hoofddek, één vlak
    tot de spiegel), voordek-ramp, planken; bulwark met binnenkant, kaprail (dek + 0.30: boven `STEP_UP`
    0.25, onder de sprong 0.38), stutten, **twee ingangen** (bulwark weg tot dek, dek loopt door tot de
    huid, post + handgreep), **open poort** per boord (uitsparing dek + 0.06 tot kaprail, 0.6 breed, luik
    55° open op scharnieren) en 2 dichte poorten per boord (recess 0.03 met binnenwand en plat luik); twee
    trappen (treden 0.10-0.11, wangen, leuning); achterdekplaat 0.04 met balken (≥ 0.6 vrij onder de balk).
    Anchors deck/stair/rail/port. `build-shipwalk.mjs`: GRID/SIDE uit de bake-maten met een guard op
    uitloop, ALOFT uit `deck.nest`/`mast.main`, lift uit `anchors.waterline` (gelijk aan `SHIP_DRAUGHT` of
    throw). De snede bewaart al elk vlak per kolom, dus de hutvloer onder het achterdek is zonder nieuwe
    code beloopbaar zodra er ≥ `HEAD` 0.55 lucht boven staat. Flood-fill-test; renders deck/cabin/port.
  - **D Beslag**: mast, ijzerbanden, ra, kraaiennest (12-kant, vloer-annulus met **lubbergat** aan de
    achterkant waar de pennen aankomen, rand 0.3, zitblok), pennenladder (rods, elke `RUNG_STEP` vanaf de
    planken tot nestvloer − 0.06, klimlijn `RUNG_FROM` achter de houdlijn), want naar rustijzers buiten
    het boord, stagen, brassen (nooit door de pennenkolom), 6 weeflijnen per kant; boegspriet, gammoning,
    voorstag; kaapstander, luikrooster, roer (12-kant rim, 8 spaken, voetstuk, geen plint), nachthuis,
    lantaarns (glas in `glow`), hutmeubels (massief). Parts `pirateship sail` (regelmatig rooster 10 × 14,
    twee kanten, origin midden ra, alle y ≤ 0) en `pirateship flag`. Anchors climb/mount/helm/nest/cargo.
    Renders nest/iso/deck; budgetregel.
- Budget: `HERO_BUDGETS.pirateship` 30000 → **20000** (doel ≤ 16k statisch), boven `batavia` 8000.
  `scripts/preview-model.py`: `color_type = 'VERTEX'` als er kleurattributen zijn.
- Nieuwe test `tests/sloop-bake.test.mjs` (alleen PIRATESHIP + SHIPWALK): waterline == SHIP_DRAUGHT; elke
  `deck.*` vlak en `floorIn` op anchor-hoogte (hut: van de hutvloer de hut, van achterdek + 0.1 het
  achterdek); `stair.*` monotoon ≤ STEP_UP; flood-fill vanaf het hoofddek bereikt elk dek, elke
  `mount.*.lo`, helm en `climb.*.hi`, en verlaat de romp nooit; ingangen open tot dek en ≥ 0.4 breed;
  mastpennen exact `dek + k·RUNG_STEP + RUNG_R`; nestvloer geen vlak boven het gat; mounts op dek,
  schootslijn van het kanon vrij door de poort, harpoen |x| < 0.05 richting +z; helm vrij; sail/flag-parts
  exact die twee, zeil een regelmatig rooster; budget; `SHIPWALK.source` van de romp.
- Opruimen: `scripts/build-pirateship.py` en `assets/pirateship/source/` weg, `assets/pirateship/README.md`
  herschreven (herbouw, anchors, "maatlat gekocht, niet in git"), `build-batavia.py` (regel ~1151) leest de
  waterline-empty in plaats van de formule. Bake twee keer, `git diff` leeg.

### Chip 4 — Landing in het spel (na chip 2 en 3; één branch, zodat deck-bake niet tussendoor rood is)

- `npm run models -- pirateship` → craft-galleon.mjs + shipwalk-map.js; de tijdelijke "oude getallen"-test
  uit 2a weg.
- Hermeten: shipwalk, deck-bake, boat-ships, cannon (`out > 2.5` weg), cannon-man, crows-nest,
  ladder-carry/step/climb, harpoon-ship (3 mounts, harpoen midboeg), harpoon-play, harpoon-rope-walk,
  rowboat-hoist (roeiboot bij de poortvoet), ship-runout, camera-boom, boat, batavia, deck, models.
- Nieuwe tests: craft-bake map-checks, cabin-walk, mounts-on-deck, port-ladder op het echte craft.
- **Ligplaats opnieuw**: `shipBerth` in `shared/quay.mjs` uit de nieuwe `GALLEON.probes`;
  `QUAY_VERSION`-bump in `lib/layout.mjs` die rede en galjoen-ligplaats één keer herplant (`GALLEON_ROOM`
  7 mag kleiner); scan.mjs bewaart `layout.before-<ts>.json`; ship-berth/kade/rede opnieuw pinnen. Meting
  op een kopie van Hoogezand: nieuwe ligplaats, verder byte-gelijk.
- Tunables: `MASS.galleon` ~30, `HULL_R`/`HULL_Y`/`HOLD` uit `GALLEON.box`, `LOOK.ship.top`, `camScale`
  ~7, `lib/players.mjs DECK_HEIGHT` ≥ nesthoogte.
- `/demo` (demo.js ~1035): tag "Sloop", een `lives`-lus die `underSail` 0→1→0 stapt;
  `/avatar-motion.html`: Klimmen-optie "poort" (climbWay van een poortladder) naast de mast.
- CLAUDE.md: de galjoen-alinea's herschreven; "een mount is een anchor-paar, lo = stand, hi = plek,
  peiling = yaw"; "de ligplaats is opnieuw gepland (QUAY_VERSION n)".
- Dit plan ✅ naar `Plans/DONE/`.

### Release

**Minor 0.11.0** (QUAY_VERSION-bump en de nieuwe ligplaats). Volgorde: open zee (stack 28) redeployen
(clampToDeck-rechthoeken, HULL_BOX) → exe-release → `/play` → Android neemt de pagina. In het venster van
gemengde versies alleen zijwaartse verschuivingen van peers op boeg en achterdek; niets wordt geweigerd.

## Verificatie (keeper-checkpoints)

- A: renders van de meetlat (boeg, liniaal, stations); keuze `W`.
- B/C/D: renders na romp, dekken en beslag; de budgetregel per label.
- Na chip 4, in-game: zwemmen naar een ingang en naar binnen klimmen zonder over de reling; de hut in
  (camera blijft onder het achterdek); W/S aan het roer en het zeil zien rollen op een tweede pagina;
  kanon vuren over het open luik; harpoen op de boeg richten en een losse boot binnenhalen; kraaiennest via
  de pennen, zitten; over het boord springen; het galjoen op zijn nieuwe ligplaats op elk eiland; de
  Batavia en de Kraken onveranderd.
- De volledige suite in de coördinator na elke merge; chips draaien alleen hun eigen tests.
