# Een ronde wereld: een kaart met maat, een rand die je rondvaart

Wens (Martijn, 2026-09-28): de wereld voelt als een bol. Je kunt rechtdoor varen en komt
dan weer bij je eigen eiland uit. De wereldkaart laat zien hoe groot de wereld is, met een
raster, en is ook vanuit de lucht (orbit) te openen. De kleine eilandjes staan erop. En de
starter-eilanden liggen rondom de vulkaan in plaats van op één lijn.

Stap 1 en 4 gebouwd op 28 september 2026:
- `nextOrigin` legt ring 1 nooit binnen één pitch en gaat rond het kompas (O, Z, W, N).
- De kaart toont `WORLD_HALF` met een km-raster en de islets, en gaat ook in sky view open
  (M, de Map-chip).
- De open zee draait dit pas na een redeploy.

Stap 2 en 3 gebouwd op 28 september 2026, met twee afwijkingen van het plan hieronder:
- `worldBound` op de zee is 4000 gebleven. De zee hoeft niets te weten, dus teleporteren
  vraagt geen redeploy, en een oude pagina die verder vaart wordt niet vastgezet.
- De islets lopen (nog) niet om. Ze worden alleen binnen `ISLET_RANGE` (800) van de eigen
  berth getekend, en de rand ligt verder weg dan dat.

`?edge` zet je te voet 12 eenheden voor de oostrand, om de sprong te proberen. Stap 5 (de
kromming) staat nog.

Twee dingen hier bewust *niet*:
- **Een echte bol** (terrein, raster en super-cells op een bol): dat zou het hele project
  herschrijven.
- **Over de rand heen kijken en rekenen** (`wrapDelta` overal): in plaats daarvan
  teleporteren we bij de rand, over een brede band lege zee, zodat niemand de sprong ziet.

De **kromming** (vertex-shader die verre dingen achter de horizon laat zakken) is het
sluitstuk en staat onderaan als stap 5. Zonder kromming werkt alles al; met kromming voelt het
als een bol.

## Hoe het nu zit (gemeten 28-09 op de open zee, `/world`)

- 1 eenheid = 1 cel = 4 m. De vloot: vulkaan `[0,0]` (grid 192), Hoogezand `[336,0]` (352),
  starters op `[-336,0]`, `[768,0]` en `[-768,0]` (64, `reach` 192). Bezet: x −960..960,
  z −192..192. Alles op één lijn.
- De zee kapt poses af op `worldBound = 4000` (`lib/sea.mjs:283`, `lib/players.mjs`). Er is
  geen wereldmaat, alleen die grens.
- **Waarom op één lijn:** `nextOrigin` (`shared/regions.mjs:125`) legt ring 1 op
  `centre.half + gap + biggest` = 96 + 48 + 192 = 336. De afstand tussen twee eilanden
  (`pitch`) is `2·192 + 48` = 432. Punten op een ring met straal 336 liggen dus dichter bij
  elkaar dan 432, en `clearOf` houdt alleen oost en west over. Ring 2 (768) begint daarna
  weer met oost en west, want `BEARINGS` = O, W, Z, N. Bij 64-grids (pitch 112 < 176) speelde
  dit niet, en daarom is het nooit opgevallen.
- De wereldkaart (`createWorldMap`, `web/js/minimap.js:489`) past zich aan de eilanden aan
  (`fitMap(mapBounds(...))`). Hij heeft geen raster en geen schaal, toont geen islets, en is
  alleen in walk mode te openen (M, `setMinimapMode` in `main.js:2344`).
- Islets (`shared/islets.mjs`) liggen op een rooster van `ISLET_PITCH` 96, met één hash per
  vak: `islet:i:j`.
- Wolken zijn één tegel `CLOUD_TILE` 288, herhaald over de wereld (`world.js:108`).

## De beslissingen

**De wereld is 4032 × 4032, rond de vulkaan: `WORLD_HALF = 2016`.**
- 4032 = 14 × 288 = 42 × 96. Wolken en islets naden dus vanzelf op de rand.
- De vloot haalt met `MAX_ISLANDS` 16 (starters tellen mee) hooguit ring 2. Na de fix
  hieronder ligt die op 864, met reach tot ±1056. Dan blijft er aan elke kant ~960 open zee
  over als band.
- Eén copy in `shared/regions.mjs`, naast `SEA_GAP`.

**Teleporteren, niet omrekenen.**
- Kruist jouw eigen oog de lijn (wereld-x of wereld-z voorbij ±2016), dan springen je lichaam,
  je boot of fiets en de camera ±4032.
- Dat gebeurt op de pagina, op één plek in `main.js` na de stap van walk mode. Het is een
  translatie in de scène: alles is relatief aan `state.homeOrigin` getekend, dus één frame
  later staat alles zoals ervoor.
- De zee hoeft niets te weten: hij krijgt een pose binnen zijn grens. Er is geen nieuw bericht
  en geen `SEA_V`, dus het kan in een patch-release.

**Islets lopen mee om.** `candidate(i, j)` hasht `mod(i, 42)` en `mod(j, 42)`.
- Binnen −21..20 is dat hetzelfde als nu, dus geen enkel bestaand islet verandert.
- Wie vlak voor de lijn staat, ziet de islets van de overkant al liggen. Na de sprong liggen ze
  precies daar.

## Stappen

### 1. Starters rondom de vulkaan (`shared/regions.mjs`)

- **Ring 1 moet een ring kunnen vullen:** `first = max(centre.half + gap + biggest, pitch)`.
  Met reach 192 wordt dat 432 in plaats van 336: dan liggen O, Z, W, N en de hoeken allemaal
  vrij van elkaar.
- **De volgorde verspreidt:** O, W, Z, N wordt O, Z, W, N (dan de hoeken). Zo ligt het tweede
  eiland niet tegenover het eerste maar er haaks op, en loopt de ring rond in plaats van heen
  en weer.
- **Bijgevolg:**
  - Een zee die herstart, berth iedereen opnieuw. Er staat niets op schijf, dus er is geen
    migratie; de pagina's volgen via `rehome`.
  - De getallen in CLAUDE.md (176/208/272) en in de fleet-/regions-tests gaan mee.
  - Een pagina berekent zelf geen origins, dus een oude pagina volgt gewoon.
  - Wel moet de open zee opnieuw gedeployd worden (stack 28, handmatig).
- **Vraag voor Martijn:** "random" is hier deterministisch-verspreid, geen toeval. Echte
  willekeur zou per herstart anders liggen en het "een eiland beweegt nooit" onderuit halen
  zodra twee zeeën verschillen.

### 2. De wereldmaat en de grens

- `WORLD_HALF` in `shared/regions.mjs`.
- `nextOrigin` weigert een origin waarvan de reach binnen `BAND` (900) van de lijn komt en
  geeft dan `null`. De fleet maakt daar `full` van.
- `worldBound` in `lib/sea.mjs` wordt `WORLD_HALF + 64`, en dat getal geeft de zee door.
- Test: 16 eilanden met reach 192 passen, en geen enkele komt in de band.

### 3. Teleporteren (`web/js/main.js`, `web/js/timeline.js`)

- **Eén functie `wrapEye()` in het frame, na de stap van walk mode:** als
  `|pos + homeOrigin| > WORLD_HALF` op een as, dan krijgen het lichaam, `state.vehicle` (de
  hull), `state.bike`, de camera en eventuele smoothing-state dezelfde `±4032`.
- **In orbit:** de target-clamp op `state.bounds` blijft; vanuit de lucht kun je niet over de
  rand.
- **Andere spelers:** `pushSample` in `timeline.js` gooit de track weg als een nieuw sample
  meer dan `WORLD_HALF` van het vorige ligt. Anders glijdt iemand in 120 ms de wereld over.
  Dat geldt voor peers en voor `glideBoats`.
- **De telefoon (skiff):** dezelfde functie, omdat ook die in walk mode op de boot zit.
- **De mist bij de lijn:** vlak voor de lijn liggen de eilanden van de overkant op ruim 1000
  afstand, en die "ploppen" bij de sprong in beeld. Daarom in `applyFogRange`:
  `far ≤ afstand tot de dichtstbijzijnde overkant-kust`, zodat ze pas na de sprong opdoemen.
  Stap 5 maakt dit overbodig.

### 4. De wereldkaart

- **Vaste maat:** de kaart toont altijd het wereldvierkant (±2016 in wereldcoördinaten, dus
  in de scène `− homeOrigin`) in plaats van `mapBounds`. `fitMap` blijft zoals hij is.
- **Raster per kilometer** (250 eenheden, 16 lijnen per as), dun en licht, met
  km-getallen langs de rand, een schaalbalk rechtsonder, en de wereldrand als stippellijn
  ("hier kom je aan de overkant uit").
- **Islets erop:** `isletsNear(fleet, [0,0], { range: WORLD_HALF })` (1764 vakken, één keer
  per vlootwijziging) wordt geschilderd in `paintGround`, via `isletHeight`. In de key van
  `groundKey` komt een hash van de vloot, zodat de kaart opnieuw geschilderd wordt als de
  islets veranderen. Bij hover: "An islet".
- **Kosten:** `paintGround` vraagt per pixel `sea.height`. Bij een vaste 4032 is dat evenveel
  werk als nu; alleen de schaal verandert (~0,4 px per eenheid op een breed scherm, Hoogezand
  zo'n 150 px). Inzoomen of pannen op de kaart is voor later.
- **In sky view (orbit):**
  - M opent en sluit de kaart. In orbit is er geen radar, dus `off ↔ map`.
  - `showMinimap` toont de kaart ook als `state.mode === 'orbit'`.
  - `worldMapData` neemt in orbit `controls.target` als `pos` en de azimut van de camera als
    `yaw`.
  - Escape sluit hem.
  - Een chip in de HUD naast Build/Plan, zodat het zonder toetsenbord ook kan.
  - Plan mode houdt zijn eigen scherm.

### 5. Later: de kromming

`onBeforeCompile`-patch `y -= d² / 2R` op elk wereldmateriaal, met schaduwen, CSS3D-borden
en picking erbij. Dan zakt de overkant vanzelf achter de horizon en mag de mistregel uit
stap 3 weer weg. Dat wordt een eigen plan zodra 1 t/m 4 staan.

## Toetsen

- **Unit-tests:**
  - `nextOrigin`: ring 1 houdt 8 eilanden met reach 192, de volgorde is O, Z, W, N, en er komt
    niets in de band.
  - `candidate`: identiek binnen ±21, en `candidate(i+42, j)` geeft hetzelfde islet op
    +4032.
  - `pushSample` wist de track bij een sprong.
  - `wrapEye` als pure functie.
- **Handmatig:**
  - de kaart in orbit en walk, met raster, islets en vlootlabels;
  - naar de rand varen, de sprong niet zien, en je eigen eiland aan de andere kant zien
    opdoemen;
  - een tweede browser die je ziet teleporteren zonder dat je over de zee glijdt.
