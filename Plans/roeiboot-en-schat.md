# Een roeiboot voor de schat, en de Benchy eruit

**🚧 Status: plan van 8 oktober 2026, keuzes liggen bij de keeper.** Vervolg op
[schatkaarten.md](schatkaarten.md). Wens van de keeper, letterlijk: *"Er moet een klein roeibootje klaar
liggen op het eiland van de schat. Als je de schat opgegraven hebt en je loopt tegen de roeiboot aan, dan
staat de schat op de roeiboot. Met E kun je de boot boarden. Als je weer aan land komt of bij je galjoen,
dan moet je de schat over kunnen zetten zodat je hem terug kan brengen naar de piraat. Vervang Benchy ook
voor de roeiboot."*

## Wat er nu is (uitgezocht, 8 oktober)

- **Het eiland van de schat is een eilandje** (`shared/islets.mjs`), niet het eigen eiland, geen starter en
  niet de vulkaan: `cardOf` → `pickIslet` kiest er een op 150 tot 900 eenheden van je berth, de kaart
  onthoudt zijn `isletId`. De eerste jacht komt uit `FIRST_HUNT_SEED(islandId)`, de rest uit de dagfles.
- **Het beeld is uniek en raakt nooit kwijt**: `finds.statue` (localStorage) houdt de plek op het eilandje
  zolang het niet staat; `treasure.json` van het eiland zegt `buried`/`lifted`/`placed`. Een pagina die
  laadt met `lifted` stuurt `dropped`, `pagehide` doet hetzelfde met `keepalive`. Dragen (`walk.carry`) is de
  pose-bit `CARRYING`; op een romp is het `walk.cargo` = `{ item, hull }`, **niet op de lijn**: alleen deze
  pagina ziet het beeld op de boot.
- **Hoe het beeld nu op een boot komt**: E bij een boot met het beeld in de armen (`layOnBoat`), of
  instappen met het beeld in de armen (`walk.board` → `putOnBoat`). Aan land stappen (`unboard`) geeft het
  terug in de armen.
- **Het gat dat deze wens dicht**: alleen een *Benchy* heeft een E-toets. Het galjoen (`boat:<region>`,
  `isShip`) heeft er bewust geen: je klimt erop via de touwladder, en een touwladder weigert wie draagt
  (`blockedBy('carry')`). Een eiland heeft pas Benchies in zijn havens als de keeper ze bouwt (B) of ze
  verdient (`earnedBoats`, vanaf `FLEET_AT`); een jong eiland heeft alleen zijn galjoen. **Daar kan het beeld
  vandaag dus niet mee naar huis.** De telefoon en het web zonder eiland hebben hun skiff (een Benchy).
- **De skiff is al precies "een eigen bootje"**: `boat:w-<speler>`, alleen de eigenaar vaart hem, de zee maakt
  hem op `launch` (elke socket mag zijn eigen skiff te water laten, ook een islander-pagina), een tweede
  `launch` is dezelfde boot op een nieuwe plek, en hij zinkt als de socket sluit (`sink`). `isletSpot`
  (`shared/start.mjs`) geeft voor een eilandje al een standplaats én een plek voor de skiff op water
  `SKIFF_DEPTH` diep recht uit de kust.
- **"Benchy" zit in**: `assets/benchy` + `scripts/build-benchy.py` → `benchy hull` in `web/js/benchy-mesh.js`;
  `createBoat(kind: 'benchy')` in `web/js/boat.js` (`BOW` gemeten uit de bake, `beam` 0.35, `camScale` 2.2,
  `cargoAt` op het voordek); `CRAFTS.benchy` + `DEFAULT_CRAFT` + `kindOf` in `shared/crafts.mjs`;
  `DRAUGHT`/`CABIN_FLOOR`/`DECK_Y` in `shared/hull.mjs` (gelezen door **de zee**: `lib/crowd.mjs` geeft elke
  uitje-romp `deckY: DECK_Y` mee, de pagina zet de settlers daarop); `demo.js`; tests (`boat`, `deck`, `crew`,
  `models`, ...). Elke niet-galjoen-boot is een Benchy: de havenboten `boat:<region>-<side><k>`, de skiffs,
  de uitjes van de settlers (`shared/boating.mjs`) en het aankomstbootje (`sailIn`).
- **Varen ziet eruit als staan aan een helmstok**: de piloot staat midden in de Benchy (`helm: [0, 0]`), de
  toast zegt al "W en S voor de riemen". Er zijn geen riemen en geen roeihouding.

## Het verhaal, met de gaten gevuld

1. De piraat geeft schep en kaart (ongewijzigd). Je vaart naar het eilandje: met je galjoen, een havenboot,
   of (zonder eiland) je skiff.
2. **Op het eilandje ligt je roeibootje klaar.** Het is je skiff: zodra je met een wakkere kaart binnen
   `ROWBOAT_CALL` (±60) van het eilandje komt en je skiff ligt daar niet al, laat de pagina hem te water op
   `isletSpot(islet, wie)`.skiff en laat hem meteen los (`launchBoat` + `dropBoat`, zoals de telefoon bij de
   start). Per speler, want een skiff is van één speler; anderen zien een bootje liggen (de zee stuurt het
   als elke boot). Ben je met je skiff gekomen (telefoon/web), dan ligt hij er al en verplaatst niets.
3. Graven, het beeld uit het zand, E tilt het (ongewijzigd).
4. **Tegen de roeiboot aanlopen zet het beeld erop**: geen toets. Met het beeld in de armen en de romp van je
   eigen skiff binnen `BOW + 0.5` van de voeten (waden mag, zwemmen kan met het beeld niet) gaat het naar
   `cargo` (`putOnBoat`), toast "Je legt het beeld in de roeiboot." Daarmee is de stap `boarded` gedaan.
   Geldt voor elke roeiboot die je mag varen (je skiff, een havenboot zonder andere piloot), zodat E bij een
   boot met het beeld in de armen niet meer nodig is - die blijft wel werken.
5. **E boardt** (`takeBoat`, zoals nu; het beeld blijft cargo). Je roeit.
6. **Aan land**: aan wal stappen (E, `stepAshore`) geeft het beeld terug in de armen (bestaat al). Dan naar
   het plein (en de piraat, zie vraag 4).
7. **Bij je galjoen**: zie vraag 1. Aanbevolen: met de roeiboot bij een van haar touwladders zegt E *"hoist the
   statue aboard"*: het beeld wordt cargo van het galjoen (bestaat in boat.js, `cargoAt` voor het schip) en jij
   staat op het dek aan de kop van die ladder; de roeiboot blijft aan de ladder liggen. Thuis, op het dek bij
   het beeld, zegt E *"lower the statue into the rowboat"*: de pagina laat je skiff te water aan de voet van de
   ladder aan de kant van het land (`launch` verplaatst hem gewoon), het beeld gaat erin, jij aan de riemen.
   Zo is "de sloep van het schip" de enige manier om het beeld van het schip te krijgen, en een galjoen hoeft
   nooit bij een kade te kunnen komen.
8. **De pagina sluiten of laten liggen**: de skiff zinkt met de socket, het beeld gaat terug naar het eilandje
   (`dropped` / `finds.statue`, zoals nu). Op een boot laten liggen terwijl je wegzwemt kan niet: `unboard` in
   het water weigert met cargo, en over de reling springen neemt het mee in de armen (bestaat). Een roeiboot
   met het beeld erin die je verlaat via de galjoen-ladder: zie 7, het beeld gaat dan mee omhoog.

## De Benchy wordt een roeiboot

Een nieuwe set `assets/rowboat` (`scripts/build-rowboat.py`, Blender-pipeline, `prop_`-achtig budget maar als
boot: ~600 driehoeken), gemodelleerd in één frame zoals de Benchy: kiel op y = 0, boeg naar +Z. Klinkergebouwd
open bootje, twee doften, een paar riemen in dollen, ruimte voor het beeld achterin of voorin. Ongeveer de maat
van de Benchy (0.8 lang, een settler van 0.54 past erin), zodat `BOW`, de havenplaatsen (`berthOf`) en de
uitjes niet hoeven te schuiven. Daarna:

- `boat.js` leest `rowboat hull` in plaats van `benchy hull` (de oude bake blijft niet staan: een set die niet
  meer gelezen wordt is dood gewicht van ±200 kB); `kind: 'rowboat'`, `CRAFTS.rowboat` (helm op de doft),
  `DEFAULT_CRAFT = 'rowboat'`. `kindOf` geeft nu `'benchy'` voor een onbekende boot: dat woord gaat over de
  lijn nergens heen (de zee rekent met `craftOf(id)`), dus een hernoeming is een patch.
- `shared/hull.mjs`: `DRAUGHT`/`CABIN_FLOOR` nieuw gemeten op de roeiboot. **De zee leest `DECK_Y`** voor de
  uitjes (`lib/crowd.mjs`): zolang de open zee niet herdeployd is zitten settlers op een uitje op de oude
  hoogte (enkele centimeters verschil). Geen `SEA_V`, wel herdeploy voor een nette zit.
- **Zichtbaar roeien** (vraag 3): de riemen zijn losse delen in de bake (oorsprong op de dol, de
  sawmill-aanpak: `meshAsset(..., { skip })` houdt ze uit de merge), geroteerd op de afgelegde afstand van de
  romp, dus elke pagina roeit elke boot op dezelfde maat zonder iets op de lijn. De roeier zit op de doft met
  het gezicht naar achteren: `walk.js` geeft het rig een `rowing`-houding (zitten zoals `sitOn`, armen naar de
  handgrepen, fase van de riemen); `peers.js` doet hetzelfde voor een piloot (`aboard`), de settlers op een
  uitje (`settler-figures.js`) krijgen `sitPose`. Een Mixamo-clip voor roeien bestaat (*Rowing*), maar de
  Reiziger heeft geen clips; de procedurele houding werkt voor beide lichamen en is de eerste stap.
- Het aankomstbootje (`sailIn`), `/demo` en de tests volgen.

## Wat over de lijn gaat

Niets nieuws in de aanbevolen versie: launch/drop/take bestaan, cargo blijft van deze pagina, de roeiriemen
zijn afgeleid. Dus **een patch**; de open zee alleen herdeployen voor de `DECK_Y` van de uitjes. Wil de keeper
dat anderen het beeld in je roeiboot zien (vraag 2), dan krijgt een boot-record een `cargo`-woord
(`lib/boats.mjs`, strikt: alleen `'statue'`), dat een oude zee weggooit: nog steeds geen `SEA_V`, wel een
herdeploy voordat iemand het ziet.

## De quest-stappen

Geen nieuwe events nodig: `lifted` (optillen), `boarded` (het beeld ligt in de roeiboot - nu door ertegenaan te
lopen), `delivered` (op het plein), `talked` (de piraat). De `goal`-teksten van *Bring It Home* worden
"Put the statue in the rowboat" en "Bring the statue home"; `QUEST_STATE_V` blijft 1.

Het bekende gat (CLAUDE.md, "Known gap"): staat het beeld al in het centrum, dan graaft de eerste-jachtkaart van
een tweede browser een gewone kist en blijft *The First Dig* wachten op `dug statue` - die browser komt nooit
verder. Voorstel: staat het beeld er al, dan meldt die graafbeurt `dug statue` met `already: true`, de piraat
zegt dat ze al op het plein staat, en het boek slaat de drie tussenstappen van *Bring It Home* over (een
`skipIf`-regel in `advance`, `{ placed: true }` als detail). Klein, en zonder dat geen enkele tweede speler het
verhaal kan afmaken.

## Wat niet kan / blijft open

- **Zonder eiland** (telefoon, web) is er geen plein: optillen en roeien wel, afleveren niet (zoals nu).
- Een galjoen dat je onderweg verlaat (eruit springen) met het beeld op het dek: het beeld blijft aan boord tot
  je terug bent; een herlaad legt het op het eilandje terug.

## Fasen

1. De roeiboot-bake en de Benchy eruit (boat.js, crafts, hull, tests, demo).
2. Roeien zichtbaar: riemen uit de merge, roeihouding voor de speler, peers en settlers.
3. De roeiboot op het eilandje (skiff te water), tegenaan lopen = beeld erop, E boardt.
4. Overzetten bij het galjoen (vraag 1).
5. Het gat van de tweede browser; quest-teksten; docs (CLAUDE.md, manual, dit plan naar DONE).
