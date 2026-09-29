# Een paard om op te rijden, in plaats van de fiets

**🚧 Status: plan van 29 september 2026, nog niet gebouwd.** Vervangt [fiets.md](DONE/fiets.md);
die blijft staan als geschiedenis en krijgt bij het bouwen een regel bovenaan.

## Aanleiding

De fiets kwam op 24 september, vóór de stal, de houtkar en het paard dat op de rave danst. Nu
staat er een gezadeld paard met gewrichten in het spel (`fauna_horse`), en een dorp met een
stal is een dorp waar je te paard gaat. Dezelfde toets, dezelfde plek in walk-mode, een ander
dier. De fiets gaat weg; er komt niet een tweede voertuig naast.

Het plan zegt vooral wat *hetzelfde* blijft, want dat is bijna alles, en waar een paard écht
anders is dan een fiets, want daar zit het werk.

## Wat er al is

- **Het paard** (`scripts/build-fauna.py`, `web/js/fauna.js`): `fauna_horse` heeft **al een zadel**
  met een kleed, stijgbeugels en koperen gespen (`saddle(p)`, in het `body`-deel gebakken; de
  bovenkant ligt rond y = 0,50, de beugelijzers rond 0,30-0,32). Het is in zeven delen
  gebakken met de oorsprong op elk gewricht (`animalParts`); `createAnimal` hangt ze op pivots
  en `applyPose` zet de houding erop. `timberrun.js` en `rave.js` sturen het paard al van buiten
  aan, zonder zijn eigen brein: `stepPose` en `applyPose`.
- **De rit** (`web/js/bicycle.js`): `stepBike` is een pure functie zoals `stepBoat` (geen THREE,
  geen klok), met `walk.js`'s eigen `groundAt` en `blocked`. `walk.js` heeft de takken voor
  opstappen, afstappen, wegzetten (`mount`/`dismount`/`putBikeAway`, regel ~1058-1102) en het
  rijden (~1392-1441); de camera zwaait na `RECENTRE_AFTER` zonder rondkijken zacht achter de
  fiets.
- **De lijn**: `FLAG_RIDING` (128) is een bit in `POSE_MASK` (8191); de zee **relayt hem alleen**
  (`lib/players.mjs`, `POSE.RIDING`) en `peers.js` tekent er iets onder. Geen bericht, geen
  toestand op de zee. Alle dertien bits zijn vergeven, dus een nieuwe bit bestaat niet.
- **Wat aan de fiets vastzit**, uit een grep (zonder `.claude/worktrees` en `dist/`):
  `web/js/walk.js` (~65 regels), `web/js/peers.js` (~19), `web/js/net.js` (regels 36-38, 391-392, 485),
  `web/js/main.js` (642 het biertje, 2877 `wrapEye`, 6987 `bikes: true`),
  `web/js/classic-avatar.js` (`RIDE_*`, `pose.riding`), `web/js/keybinds.js:15`,
  `web/js/input.js:29`, `web/js/touchpad.js` (53, 71), `web/js/ui.js` (1114, 1120),
  `web/js/demo.js` (1174, 1204), `web/js/models.js:50` en de set `bicycle`,
  `tests/bicycle.test.mjs` (67 regels), `tests/models.test.mjs` (44, 69, 289, 300),
  `tests/combat.test.mjs:285`, `tests/dance.test.mjs:9,93`, `scripts/build-bicycle.py`,
  `assets/bicycle/`, `web/js/bicycle-mesh.js`, en de alinea "The bicycle is `state.bike`" in
  `CLAUDE.md` (plus twee losse zinnen over `wrapEye` en de touch-pad).

## Besluiten die hetzelfde blijven

| Vraag | Besluit | Waarom |
|---|---|---|
| De toets | F (Y op de pad) stijgt op en af, alleen op het land met je voeten op de grond, niet in een boot, op een kruk, liggend of zwemmend, en niet in een kamer. | Precies de regels van de fiets. |
| Wie onthoudt het paard | Niemand. Het komt uit het niets onder je en het gaat weg als je afstapt. | De wet van de fiets: "nothing about it has to be remembered by anybody", dus er is geen toestand om te synchroniseren. Fase 2 laat het paard blijven staan, zonder toestand. |
| Naam van de toestand | `state.mount`, niet `state.vehicle`: `vehicle` betekent in `main.js` en `net.js` overal "de boot". | Dezelfde reden als bij `state.bike`. |
| De lijn | `FLAG_RIDING` betekent voortaan "op een rijdier". Geen nieuwe bit, geen nieuw bericht, `POSE_MASK` en de zee veranderen niet; `lib/players.mjs` krijgt een andere comment. **De open zee hoeft niet opnieuw gedeployd.** | De zee relayt de bit al. Een pagina van vóór dit tekent een fiets onder een ruiter, en een nieuwe een paard onder een fietser van een oudere pagina: allebei onschuldig. |
| Zwaard, schild, dansen, biertje | Niet te paard, zoals op de fiets: `!s.bike` in `net.js:391` en `:485` wordt `!s.mount`, `dancing` weigert bij `ride`, `main.js:642` weigert bij `w.mount`. | Zelfde afspraak, andere naam. |
| De camera | Vrij te draaien; zwaait pas na `RECENTRE_AFTER` zonder rondkijken achter het paard, sneller naarmate je harder gaat; iets verder weg (`camBack * 1,6` tegen 1,35 bij de fiets). | Het paard is groter. |
| De snelheden | `MOUNT_TOP` 8,0 en galop 1,3 keer dat (10,4): dezelfde getallen als de fiets. | Alles wat aan die getallen hangt (de camera, `wrapEye`, "onder een boot van 9,5") hoeft dan niet opnieuw afgesteld. `tests/mount.test.mjs` leest ze uit `walk.js` en `boat.js`, zoals `bicycle.test.mjs`. |

## Besluiten die anders worden

| Vraag | Besluit | Waarom |
|---|---|---|
| Het model | **Geen nieuwe bake in fase 1.** Het rijpaard is `createAnimal('horse', material, { seed: 'mount:<id>' })` met het brein uit, aangestuurd met `applyPose`, precies als het paard van de houtkar. Zadelpunt en beugels worden uit de bake gemeten zoals `measure()` in `bicycle.js` dat voor de fiets doet (`MOUNT.seat` = hoogste punt van `body` bij |z| <= 0,07; `MOUNT.stirrup` uit de koperen gespen). | Het zadel is er al, en het meten uit de bake (in plaats van getallen in de code) is de reden dat een bijgestelde bake vanzelf goed blijft. Het zijn dezelfde zeven delen als de fiets: zeven draw calls per rijder. |
| Maat | Eerst 1,0. De ruiter zit met zijn heup (`HIP_Y`, 0,157) op het zadel, dus zijn zolen komen op 0,50 - 0,157 = ~0,34: een paar centimeter boven de beugelijzers (0,30-0,32). Ziet dat eruit als een pony onder een reus, dan groeit **één** constante `MOUNT_SCALE` (hoogstens 1,25) het paard en het zadelpunt samen. | De spelerspop is 1,12 en groter dan de dorpelingen (0,72) voor wie het paard gebakken is. Dit is een getal dat je in `/demo` ziet, niet uitrekent; de fiets kreeg zijn `RIDE_LEG` ook op het oog. |
| De rit | `stepMount(m, { rein, turn, gallop, hop }, dt, { ground, blocked, ceiling })` in `web/js/mount.js`, puur. Tegenover `stepBike`: versnelling trager (`MOUNT_ACCEL` ~3,2 in plaats van 4,5: bijna drie seconden tot draf-en-galop), remmen trager (`MOUNT_BRAKE` ~9 tegen 14), en **een bocht is ruimer naarmate je harder gaat** (2,6 rad/s stapvoets, 1,1 in galop, tegen 2,4 bij de fiets: een paard draait niet om zijn as in galop). S bij stilstand loopt achteruit, langzamer dan de fiets (1,0). De helling trekt zoals bij de fiets. | Een paard heeft massa, een fiets is een fiets. De constanten zijn beginwaarden voor het oog; de verhoudingen staan in de test. |
| Passen en botsen | `rideable` test het **midden én de borst** (`MOUNT_NOSE`, 0,32 vooruit; bij achteruit de kont). De fiets testte alleen het midden. | Een paard is 0,75 lang en de fiets 0,4. `stable.js` heeft dezelfde afstand al gemeten als `HORSE_CLEAR` ("half a horse, nose to rump, and a little"); anders steekt de kop door een muur of een hek. Drempel 0,45 (`STEP_UP` van `walk.js`) en waterkant 0,06 blijven. |
| Springen | Spatie is een sprong, iets hoger dan te voet (`MOUNT_HOP` ~3,6 tegen `JUMP_V` 3,1), en in de lucht is water geen muur. Landen in het water zet het paard weg en laat je zwemmen, zoals `splash`. | Een paard springt; het verschil met de fiets is een getal. |
| Wat een paard bijzonder maakt | **Draven en galopperen zijn banden van de snelheid, geen stand.** Stap tot `WALK_SPEED` (3,4), draf tot `RUN_SPEED` (6,6), kanter tot `MOUNT_TOP` (8,0) en galop met Shift (uit de lichaamsbeurs, zoals de turbo van de fiets). `gaitOf(v)` met een marge van 0,3 zodat een paard op een grens niet knippert. Zowel de rijder als een kijker rekenen het uit de snelheid: niets op de lijn. | Eén regel voor beide kanten, en de lijn hoeft niets te weten. |
| **De poten** | Dit is het echte werk. `stepPose` zet het loopritme uit de tijd met `pace = clamp(speed / K.walk, 0.5, 3)`: gemaakt voor een paard dat graast met 0,22 eenheden per seconde. Bereden op 3 tot 10 zou dat 15 hoefslagen per seconde geven. Dus `mountPose(pose, { gait, cadence... })` in `mount.js` schrijft `pose.legs`, `bodyY`, `bodyX` (voorover in galop), `headX` (de kop knikt mee) en `tailX` (de staart waait) zelf, en **de cadans verzadigt**: stap ~1,3 Hz, draf ~2,2, kanter ~2,8, galop ~3,4, nooit boven 4 Hz. De patronen: stap en draf in diagonale paren (`fl`+`br` tegen `fr`+`bl`, in draf met een zweefmoment in `bodyY`), kanter als diagonaal met een voorsprong, galop als sprong (voorbenen samen, achterbenen samen, een halve slag verschoven). Hoeven glijden dan over de grond; dat is de compromis van de fiets, met zijn `GEAR` die bewust te hoog is. | De fiets loste hetzelfde op ("a crank at a true gear would spin faster than a leg can be drawn"). De functie is puur en getest onder Node zoals `stepPose`, en schrijft alleen naar de houding, nooit naar een plek. |
| De ruiter | `pose.riding` wordt `{ gait, phase }`. Benen: zoals nu naar voren (`RIDE_LEG`), maar **gespreid** over `z` (~0,45 naar buiten) zodat ze om de romp hangen, en de voeten in de beugels. Nu draaien de benen alleen om `x`; de armen krijgen al een `z` (drink-houding, `classic-avatar.js` rond regel 690), dus het mechanisme bestaat. Armen naar voren en omlaag naar de teugels bij de schoft; in galop leunt het bovenlijf voorover. Het zadelpunt wordt na `applyPose` uit de eigen ruimte van het paard gehaald (`localToWorld`), zodat schommeling en stampen ook de ruiter meenemen. | Zo beweegt de ruiter met het dier zonder dat iets een tweede klok nodig heeft. |
| Opstappen | Het paard verschijnt op je plek in jouw richting en je zit erop in één frame: `mount()` weigert waar de fiets weigerde, en daarbij als er geen ruimte is voor een paard (midden, borst en kont op droog land zonder botsing). Afstappen naar links, anders rechts, op 0,45 (de fiets: 0,3). | Geen animatie in fase 1. |
| Onder iets door | Een ruiter zit ongeveer 0,35 hoger dan iemand te voet (zadel 0,50 tegen heup 0,157), dus `RIDE_HEAD` (0,07 bij de fiets) wordt zo'n 0,35 en **een laag dek, een brug of de kade stopt nu ook de rit, niet alleen de sprong** (`ceiling` beperkt bij de fiets alleen hoe hoog een sprong komt). | Dit is de plek waar een paard een hoofd meeneemt dat de fiets niet had. Te testen op een kade en een brug. |

## Wat weggaat

`web/js/bicycle.js`, `web/js/bicycle-mesh.js`, `assets/bicycle/`, `scripts/build-bicycle.py`,
`tests/bicycle.test.mjs` (de belofte-tests gaan mee naar `tests/mount.test.mjs`), de set
`bicycle` in `models.js` en in de drie lijsten van `tests/models.test.mjs`. Toetsnaam:
`'bike'` in `keybinds.js` wordt `'mount'` met het label "ride"; een zelf gekozen toets onder
de oude naam wordt één keer overgenomen (de opslag is per browser). `input.js` (`bike:` ->
`mount:`), `touchpad.js` (het pictogram wordt een paardenkop, het label "Horse"), `ui.js` en
`demo.js` (de sleutelrij) volgen. In `walk.js` wordt `bikes` `mounts`, `state.bike`
`state.mount`, en de `bikeMesh` een `mountRig`.

## Bestanden

- `web/js/mount.js` (nieuw) - `stepMount`, `gaitOf`, `mountPose`, `createMount`, `MOUNT` (uit de bake).
- `web/js/walk.js`, `web/js/net.js`, `web/js/main.js` - de hernoeming en de takken.
- `web/js/peers.js` - `ride()` wordt `mounted()`: snelheid uit afstand per tijd, bocht uit de
  draaisnelheid, en het loopritme uit `gaitOf` en de verzadigde cadans.
- `web/js/classic-avatar.js` - `pose.riding` met gespreide benen.
- `lib/players.mjs` - alleen de comment.
- `docs/manual.md` en `CLAUDE.md` - de alinea over de fiets herschreven; de zin over `wrapEye`
  (rijdier in plaats van fiets).
- `Plans/DONE/fiets.md` - bovenaan "vervangen door ../paard-in-plaats-van-fiets.md" (en dat plan
  gaat zelf naar `DONE/` als het gebouwd is).

## Tests

`tests/mount.test.mjs`, met de stub voor `document` die `bicycle.test.mjs` al gebruikt (het
bereikt `buildings.js`):

- Snelheden ten opzichte van lopen, rennen en de boot, uit de bron van `walk.js` en `boat.js`
  gelezen, niet overgetikt.
- Water is een muur; een richel boven `STEP_UP` ook; glijden langs een muur en botsen.
- De borst-sonde: een paard stopt met zijn kop een stuk voor een muur, niet erdoorheen.
- `gaitOf` loopt monotoon met de snelheid en heeft de marge; bocht-snelheid daalt met de gang.
- `mountPose` geeft nooit NaN, en de cadans is voor elke snelheid van 0 tot 12 hoogstens 4 Hz.
- Een kijker op de lijn krijgt uit dezelfde snelheid dezelfde gang als de rijder.
- De sprong komt af op `MOUNT_HOP` en landen in het water zet `splash`.
- Het zadelpunt en de beugels komen uit de bake en liggen binnen het paard.
- `combat.test.mjs`, `dance.test.mjs`, `models.test.mjs` hernoemd en bijgewerkt.

## Volgorde

1. `mount.js` met zijn tests, en het paard bereden in `/demo` (dat heeft `bikes: true`, straks
   `mounts`). Daar stel je `MOUNT_SCALE`, de beenspreiding en de cadans op het oog af, vóór
   `walk.js` erbij komt.
2. `walk.js`, `net.js`, `main.js`, `peers.js`, de toetsen en het touch-pad; dan de fiets
   weghalen. Dit is één stuk, want twee voertuigen op F bestaan niet.
3. Handleiding, `CLAUDE.md` en de plannen.

**Een aandachtspunt voor het bouwen.** De branch `touwladders-schip` werkt nu in dezelfde
bestanden: `walk.js` (de `state.bike`-regels ~332, 347, 360, 485, 511, 774, 1059-1100, 1250, 1397-1441,
1577, 1593-1630, 1735, 1757), `net.js` (391-392, 485), `lib/players.mjs` en `main.js`, en zij
verandert wat "aan boord" en "op een dek" betekent. Beter om deze pas op te pakken nadat die
branch is samengevoegd, dan het paard op de dan geldende `walk.js` te bouwen.

## Open vragen

- **Eerste persoon (V).** De camera zit in het hoofd van de ruiter en de kop van het paard
  ligt ervoor. Verberg je de kop en de manen in die stand (net als `FP_HIDDEN` het lichaam van
  de ruiter wegdoet), of kijk je over de nek heen? Op het oog te beslissen.
- **Voetstappen.** `sound.js` heeft, voor zover ik zocht, geen loopgeluid; hoefslagen komen dus
  niet ergens vandaan, ze zouden een eigen korte ruis per hoefslag zijn, uit dezelfde fase.
- **Een kleur per speler.** Het model heeft één vacht (bruin met een bles) en een groenblauw
  zadelkleed. Het kleed kon de tunicakleur van de ruiter volgen, maar de bake kleurt op
  materiaalnaam en niet per instantie.

## Later

- **Het paard wacht.** Na afstappen blijft het 20 seconden grazen waar je het liet, op elk
  scherm, en gaat dan weg. Afgeleid uit de pose (de bit gaat uit) en niet gestuurd, dus nog
  steeds geen toestand op de zee. Daarmee is ook het fietsenrek-idee uit `DONE/fiets.md` van tafel.
- Een fluitje: F laat het paard van een eindje komen in plaats van uit het niets te verschijnen.
- Het paard van de stal berijden (dan is het wél van iemand, en wordt het toestand zoals de boten).
- Doorwaden van ondiep water; over een laag hek springen (hangt af van of `blocked(x, z, y)` de
  hoogte kent); hoefslagen; een kleed in jouw kleur.
