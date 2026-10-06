# Eigen karakters en een eigen paard, met echte clips

**🚧 Status: plan van 1 oktober 2026, nog niet gebouwd.** Koerswijziging ten opzichte van
`geleende-karakters.md` (een geparkeerd plan dat alleen lokaal bestaat, niet in deze repo). Het doel is nu een **eigen** personage en een **eigen**
paard, vrij van Blizzard-IP, die gewoon in de repo, de release, de APK en op de zee mogen. Ze krijgen
een echte clip-set. De WoW-modellen zijn alleen nog referentie. Het rijden zelf bouwt voort op
[paard-in-plaats-van-fiets.md](paard-in-plaats-van-fiets.md); hieronder staat wat daaraan verandert.

## Aanleiding

Op 1 oktober reed Martijn in `/demo` als Benny Blaanco op het WoW-paard (npc 385). Dat was een lokale
patch, nooit gecommit: `~/.promptholm/characters/benny-blaanco/demo-walk.patch`, tegen `fb49ab4`. De
mechaniek werkt. De vraag was daarna of Benny en het paard "door Blender gehaald" konden worden om van
de IP af te komen.

Dat kan niet (algemeen principe, geen juridisch advies). Een mesh of animatie van Blizzard bewerken,
opnieuw texturen of retargeten blijft een afgeleid werk. Schoon is alleen: **nieuw maken**, en hun
modellen gebruiken als visuele referentie en als bron van getallen (verhoudingen, loopcycli,
snelheden). Martijn koos: eerst het WoW-paard in `/demo` als prototype van de mechaniek (gedaan), dan
dit plan.

## Wat er al is

- **Het prototype** (de patch hierboven). Dit leerde het:
  - **F voor het paard.** F wordt als Benny vóór `walk.js`'s eigen listener afgevangen (capture op
    `window`), dus F is het paard en niet de fiets.
  - **Snelheden.** Walk mode loopt door op `setSpeeds({ walk, run, swim, swimRun, crouch })`.
  - **Positie.** Het paard volgt `state.pos`/`state.yaw` na `walk.update`.
  - **De ruiter hangt aan het zadelpunt van het paard** (WoW-attachment 0) met de Mount-clip. Zo deint
    hij vanzelf mee, zonder tweede klok. Dat is de belangrijkste les.
  - **Een clip per toestand:** Stand, Walk, Run, Jump, JumpEnd, Swim en SwimIdle, en MountSpecial
    (steigeren) op R.
  - **De fiets deugt niet voor een paard.** Hij doet 8 u/s, helt over en trapt.
- **Ons paard** `fauna_horse` (`scripts/build-fauna.py:290-310`, `web/js/fauna.js`).
  - Zeven starre delen op pivots: `body` (met het zadel erin gebakken, bovenkant y ≈ 0,50), `head`,
    `tail` en vier benen die alleen bij de heup scharnieren. **Geen knie, geen hak, geen kogel.**
  - Eén gang: een sinus in diagonale paren (`fauna.js:341`). Het tempo is geklemd op 0,5-3. Er is geen
    draf, kanter of galop.
  - Goed genoeg voor een grazend paard in de stal, de houtkar en de rave. Een galop met stokbenen ziet
    er niet uit.
- **Onze speler** (`web/js/classic-avatar.js`).
  - Gebakken settler-delen onder vier pivots plus een hoofd. Elk gewricht draait om één as, er zijn
    geen ellebogen of knieën.
  - Alles is procedureel: sinussen voor lopen, keyframes in code voor slaan, drinken, graven en
    dragen.
  - Het zadel-haakje bestaat al: `HIP_Y` (`classic-avatar.js:64-66`), `seatAt = RIDER.saddle - HIP_Y`
    (`walk.js:1956`).
- **De bake is statisch** (`scripts/export-models.py`): alleen meshes en `anchor.*`-empties, geen
  armature, vertex groups of actions ("No glTF, no loader", regel 10-13). Het enige skinned model in
  het spel is de imp, een gecommitte GLB (`web/models/hostile-settler.glb`), lui geladen na de boot.
- **De lijn.**
  - `POSE_MASK` is nu 32767 en alle vijftien bits zijn vergeven (`CARRYING` 8192, `DIGGING` 16384;
    `lib/players.mjs:37-41`). Het paard-plan van 29 september noemt nog 8191.
  - `FLAG_RIDING` 128 wordt door de zee alleen doorgegeven.
  - `lookOf` (`lib/players.mjs:108-117`) bouwt een vers object, dus een onbekend veld valt stil weg.
    `normalizeAvatar` (`web/js/avatar.js:78-97`) doet hetzelfde.
- **De referentie.** De skill `wowhead-character-extract` levert renders, `character.json` met
  clips, duur en `moveSpeed`, en verhoudingen. Voor het paard staan die in
  `~/.promptholm/characters/horse/`: 2,59 yd hoog, Walk 0,8 s @ 2,5 yd/s, Run 0,8 s @ 6,94 yd/s.
  Daarnaast liggen Benny, Thrall en Hogger klaar.
  - **Gemeten op 6 oktober 2026**, als getallen: de rijhouding (Benny's `Mount`) en de stap en galop van
    het paard (`Walk`, `Run`: volgorde, tijd aan de grond, paslengte in beenlengtes, buiging per
    gewricht). Zie "De ruiterhouding, gemeten" en "De gangen van een referentiepaard, gemeten" in
    [paard-in-plaats-van-fiets.md](paard-in-plaats-van-fiets.md). Let op: het referentiepaard houdt
    1,27 Hz van stap tot galop, dus de "cadans verzadigd op ~3,4 Hz" van besluit 3 is te hoog.

## Besluit 1: clips komen uit Blender, via een nieuwe rig-bake

**De keuze: een rig-bake met Blender-actions, geen uitbreiding van de procedurele sinussen.**

Een paard dat draaft en galoppeert heeft knieën, hakken en kogels nodig, en een rug die golft. Met
zeven starre delen kan dat niet, hoe goed de sinussen ook zijn. Voor de speler geldt hetzelfde zodra
hij ellebogen en knieën krijgt.

Een gecommitte GLB zoals de imp breekt "Nothing is fetched at boot". Het spelerslichaam moet er
staan voordat `main.js` begint. Een lui geladen speler is een settler die na een seconde verandert.

Daarom komt er **een tweede soort bake naast de statische**, met dezelfde belofte: een gewone module,
synchroon geïmporteerd, zonder loader en zonder fetch.

```
assets/<set>/<set>.blend  --(scripts/export-rig.py)-->  web/js/<set>-rig.js   (gecommit, nooit met de hand)
```

- **Het formaat** (alles in units, Y-up, voorkant +Z zoals de statische bake):
  - `bones`: een lijst van `{ name, parent, t, q }` in rust.
  - `mesh`: `positions`, `normals`, `colors`, `sheet`, en `skin` + `weights` met hoogstens vier
    invloeden per vertex. Optioneel opgedeeld in **delen** (`body`, `arms`, `head`), die één skelet
    delen. Dat is nodig voor de first-person-view (alleen de armen) en voor verfslots (tuniek, rand,
    huid).
  - `sockets`: `{ saddle, handL, handR, back, head }`, elk een bot met een offset. Dit zijn de
    attachments die het prototype nodig had.
  - `clips`: `{ <naam>: { seconds, loop, speed, tracks: { <bot>: { times, q, t? } } } }`. `speed` is
    de grondsnelheid waarvoor de pas gemaakt is, in u/s. Er zit **geen root motion** in een clip; de
    beweging is van walk mode.
- **Het exporteren** bemonstert elke action op 24 fps en gooit keys weg die lineaire interpolatie
  binnen 0,001 rad of unit nabootst. Getallen krijgen drie decimalen en een vaste volgorde, zodat
  `npm run models` idempotent blijft. Een schatting: 25-35 bones en tien clips komen ruim onder de
  100 kB per set.
- **`web/js/rig.js`** (nieuw):
  - `createRig(module, material)` bouwt een `SkinnedMesh` met een eigen `Skeleton` per instantie op
    **één gedeelde geometry** per set, plus een `AnimationMixer` met de `AnimationClip`s uit de
    tracks.
  - Het geeft `{ object, play(name, { fade, timeScale }), socket(name), parts, update(dt) }`.
  - Er is geen GLTFLoader en geen SkeletonUtils nodig: het skelet is uit de lijst te bouwen.
  - De materiaalbasis is `createBuildingMaterial` (een `MeshStandardMaterial`, dus skinning werkt
    vanzelf, met de nacht, de mist en de radiale fog). Of het gladde materiaal van de reiziger
    (`classic-avatar.js`).
- **Een rig hangt nooit onder een andere rig, en hun botnamen botsen niet.** Dit is in het prototype
  in `/demo` misgegaan. three's `PropertyBinding.findNode` zoekt het doel van een track op naam,
  depth-first vanaf de root van de mixer. Benny hing onder het zadelpunt van het paard, beide GLB's
  noemen hun botten `bone_<n>`, en de tracks van de achterbenen van het paard vonden eerst Benny's
  botten: stilstaande achterbenen en een overschreven rijhouding. Twee regels, allebei:
  - **Elke familie heeft een eigen voorvoegsel** (`steed_`, `body_`), en `checkRig` weigert een bot
    zonder het voorvoegsel van zijn set.
  - **Een ruiter staat los in de scène.** Elk frame, ná het neerzetten van het paard, wordt de
    `matrixWorld` van de socket ontleed naar positie, quaternion en schaal van de ruiter, plus een
    zitoffset in zijn eigen frame. Zo doet `walk.js` het al met de fiets: `seatAt` via
    `localToWorld` (`walk.js:1956`). `rig.js` heeft daar `followSocket(rider, rig, 'saddle', offset)`
    voor, en hangt nooit een object aan een socket dat zelf een mixer heeft.
    Handitems zonder skelet mogen wél aan een socket hangen.
- **De regels** (`scripts/model-rules.mjs`, `checkRig`; `tests/models.test.mjs` draait ze over wat
  gecommit is, zonder Blender):
  - hoogstens 4 invloeden en gewichten die optellen tot 1;
  - de verplichte clips per soort (`STEED_CLIPS`, `HUMANOID_CLIPS`);
  - van een loop-clip is de eerste key gelijk aan de laatste;
  - in de rustpose staan de voeten op y = 0 (`GROUND`);
  - de driehoeken binnen `fauna_` 1200 (paard) en hero 4000 (personage);
  - geen `bpy.data.libraries`, en elk beeld in de .blend uit de repo (zie besluit 2).
- **Wie de clips maakt.** De build-scripts schrijven ze **in code**, zoals `build-fauna.py` nu al zijn
  geometrie maakt. Een gang is een tabel: per been een fase en een amplitude per gewricht, plus de
  golving van de rug, de knik van de nek en de staart. `build-steed.py` zet daar keyframes uit.
  - Dat is deterministisch, te reviewen in een diff, en vraagt niemand om met de hand in Blender te
    animeren.
  - Iemand die dat wél wil, kan een action in de .blend bijstellen. Het script laat bestaande actions
    met de naam `hand:<clip>` dan staan.
- **De terugvaloptie.** Lukt de rig-bake niet op tijd, dan kan het rijden van besluit 3 op het
  bestaande `fauna_horse` met de procedurele `mountPose` uit het paard-plan. Het rijpaard zit achter
  één interface (`{ object, gait(g, speed), socket('saddle') }`), dus het wisselen van paard raakt
  `walk.js` niet.

## Besluit 2: WoW als referentie, zonder iets over te nemen

| Mag | Mag niet |
|---|---|
| **Getallen.** Verhoudingen als verhouding (paard/mens 2,59/2,03 = 1,27 kop tegen kop), cyclusduur, de verhouding van `moveSpeed` tussen gangen (Run/Walk = 2,78), en welke clips een rijdier heeft (een checklist). | Een mesh, textuur, UV-layout, skelet met hun botposities, keyframes of een geretargete animatie importeren, ook niet als startpunt "om over te modelleren". |
| **Kijken.** Hun renders naast de onze leggen, in `/demo` lokaal of als losse PNG's. | Een silhouet overtrekken, of een render als achtergrondplaatje in een .blend onder `assets/`. |
| **Een generiek type**: een paard, een struikrover met een doek voor zijn mond, een orc als genre. | Een herkenbaar ontwerp of een naam: Benny Blaanco, Thrall, Hogger, hun kleding en hun kleuren. |

- **Betere bronnen voor beweging bestaan en zijn vrij.** Eadweard Muybridge's fotoreeksen (*The Horse
  in Motion*, 1878, en *Animal Locomotion*, 1887) zijn publiek domein. Ze laten stap, draf, kanter en
  galop beeld voor beeld zien, en mensen die lopen, rennen en klimmen. Daar komen de fasetabellen van
  besluit 1 uit. WoW levert alleen het gevoel van "zo leest een spelpaard op afstand", plus de
  verhoudingen.
- **De referentie blijft waar hij is**: in `~/.promptholm/characters/` (daar schrijft de skill), plus een
  kopie in `characters/` op de lokale branch `claude/pensive-chatelet-edbee6`. Die branch wordt niet
  gepusht of naar `main` gemerged (zie `CLAUDE.md`).
  - Geen build-script leest daaruit. `tests/no-borrowed.test.mjs` faalt op `.promptholm/characters`,
    `zamimg`, `wowhead` of `.m2` in `scripts/`, `assets/`, `web/`, `shared/` en `lib/`.
  - `export-rig.py` weigert een .blend met een gelinkte library of met een beeld van buiten de repo.
- **De vergelijking in `/demo`** blijft een lokale patch op Martijns machine: ons paard naast het
  WoW-paard, dezelfde gang naast elkaar. Die patch wordt nooit gecommit; hij laadt van
  `~/.promptholm/characters/` zoals nu.
- **De skill blijft**, nu als referentie-gereedschap. Later kan er een `--reference`-blad bij: een PNG
  met de gangen in zijaanzicht op een tijdlijn en een tabel van verhoudingen. Niet nodig om te
  beginnen.

## Besluit 3: rijden wordt een functie van het spel, en vervangt de fiets

Het paard-plan van 29 september blijft de basis: F en pad Y, `state.mount`, `FLAG_RIDING` met de
betekenis "op een rijdier", geen nieuwe bit, de fiets gaat weg, en de lijst van bestanden. Dit
verandert eraan:

| Vraag | Besluit | Waarom |
|---|---|---|
| Het paard | Het eigen **`steed`** uit de rig-bake (`assets/steed`, `scripts/build-steed.py`, `web/js/steed-rig.js`), niet `fauna_horse`. De stal, de houtkar en de rave houden voorlopig `fauna_horse`. | Het rijpaard moet gangen hebben, het stalpaard niet. Eén paard tegelijk veranderen. |
| Clips van het paard | `stand`, `walk`, `trot`, `canter`, `gallop`, `jump` (afzet, zweef, landing in één), `land`, `rear`, `swim`, `swimIdle`, `back` (achteruit) en `turn` (op de plaats). | De clip-lijst van het WoW-paard als checklist, de vorm uit Muybridge. |
| Het zadel | Socket `saddle` op het rugbot. De ruiter volgt die elk frame (`followSocket`, `HIP_Y` eronder), maar hangt er **niet als kind** aan (zie besluit 1). | Wat de rug doet in draf of galop, doet de ruiter mee, zonder tweede klok. Als kind zouden de tracks van het paard de botten van de ruiter met dezelfde naam vinden. |
| De ruiter | Fase 1: de reiziger (`classic-avatar.js`) met `pose.riding = { gait, phase }`: benen gespreid om de romp (uit het paard-plan), en in galop voorover. Met een eigen personage (besluit 4) komt er een clip `ride_<gang>` per gang. | De reiziger heeft geen knieën; gespreide benen om één as zijn genoeg tot besluit 4 er is. |
| Sturen | **`stepMount` volgt de besturing van walk mode, niet die van de fiets.** WASD blijft relatief aan de camera, zoals te voet (dat voelde in het prototype goed). Het paard draait naar die richting met een bochtsnelheid die daalt met de gang (2,6 rad/s stapvoets, 1,1 in galop), en **schuift nooit zijwaarts**. S alleen, bij stilstand, loopt achteruit. Versnellen en remmen zijn trager dan de fiets (`MOUNT_ACCEL` ~3,2, `MOUNT_BRAKE` ~9). | Het prototype liet zien dat walk mode volgen prettig stuurt. Walk mode zelf laat een lichaam zijwaarts schuiven en meteen omdraaien, wat een paard niet kan. `stepMount` blijft puur, in `web/js/mount.js`. |
| Snelheden | **De snelheden van het spel, niet die van het paard.** Stap tot 3,4, draf tot 6,6, kanter tot 8,0 (W), galop 10,4 met Shift, betaald uit de lichaamsbeurs. Op de pad geeft de stick de snelheid traploos; op het toetsenbord houdt C (hurken kan te paard niet) de teugel in tot stap. | De prototype-snelheden (stap 0,57 u/s) zijn de WoW-schaal en veel trager dan iemand te voet (3,4). Met de getallen van de fiets hoeft de camera, `wrapEye` en "onder een boot van 9,5" niet opnieuw afgesteld. |
| Pas en snelheid | `timeScale = v / clip.speed`, geklemd op 0,6-1,8, met de cadans verzadigd op ~3,4 Hz. Elke clip is gemaakt voor de snelheid van zijn band. Daarbuiten glijden de hoeven over de grond, dezelfde compromis als de fiets met zijn `GEAR`. Banden met een marge van 0,3 (`gaitOf`), zodat het paard op een grens niet knippert. | Een echte paspas bij 10 u/s is 15 slagen per seconde; dat valt niet te tekenen. |
| De lijn | Er gaat niets nieuws over. De gang is `gaitOf(snelheid)`, aan beide kanten uit de positie per tijd gerekend. **Steigeren is RIDING + DANCING** (R is de danstoets): twee bits die er al zijn. | Er is geen vrije bit. Een oudere pagina tekent bij die combinatie een dansende fietser, wat onschuldig is. De zee hoeft niet opnieuw gedeployd voor het rijden. |
| Andere spelers | `peers.js`: een ruiter krijgt lazy een eigen `steed` (`createRig`, gedeelde geometry), en zijn mixer slaat over buiten `ANIMATE_RANGE` of als hij vorig frame niet getekend is, zoals bij de imp. | Het zijn een paar spelers, geen dorp. Een paar skinned meshes kost hetzelfde als de imps. |
| Water | Landen in diep water: het paard zwemt (`swim`/`swimIdle`), de ruiter blijft zitten, tot de grond weer draagt. Duiken kan niet te paard. De fiets gaf hier op en liet je zwemmen. | Een paard zwemt echt, en het prototype had de clip al. Zakt het water onder `canDive`-diepte, dan stap je af en zwem je zoals nu. |
| Onder iets door | Uit het paard-plan: `RIDE_HEAD` ~0,35, en een laag dek, een brug of de kade stopt ook de rit. | Ongewijzigd. |

Het paard-plan noemde nog een wachtpunt op `touwladders-schip`. Die branch is samengevoegd, dus dat
punt vervalt. Ook zijn feit "alle dertien bits" klopt niet meer: het zijn er nu vijftien, en
`POSE_MASK` is 32767.

## Besluit 4: eigen personages op één eigen skelet

- **Eén humanoïde skelet voor elk personage**, het Promptholm-skelet (`shared/skeleton.mjs` heeft de
  namen, de enige kopie):
  - `root`, `hips`, `spine`, `chest`, `neck`, `head`;
  - links en rechts: `shoulder`, `upperarm`, `forearm`, `hand`, `thigh`, `shin`, `foot`;
  - samen 21 bones, met sockets `handL`, `handR`, `back` en `head`;
  - in het bestand allemaal met het voorvoegsel `body_` (`body_spine`). Het paard heeft `steed_`,
    want ook een paard heeft een `spine`, `neck` en `head` (zie besluit 1).
  - **Clips horen bij het skelet, niet bij een personage**: `scripts/build-humanoid-clips.py` maakt ze
    één keer (`web/js/humanoid-clips.js`), elk personage (`web/js/<naam>-rig.js`) levert alleen mesh,
    gewichten en sockets. Zo kost een tweede personage een model, geen tweede clip-set. De
    verhoudingen mogen per personage wat verschillen (een kop groter), zolang beenlengte en heuphoogte
    binnen een marge blijven die `checkRig` bewaakt, anders glijden de voeten.
- **De clip-set van een personage**:
  - `stand` en `idle` (variaties), `walk`, `run`, `sprint`;
  - `jump` en `land`, `crouch` en `crouchWalk`;
  - `swim`, `swimIdle` en `dive`;
  - `sit` (kruk), `lie` en `sleep`;
  - `ride_walk`, `ride_trot`, `ride_canter` en `ride_gallop`;
  - `dance_<n>` (de passen van `web/js/dance.js`, met dezelfde namen).
- **Handelingen liggen er bovenop als additieve clips.** Het gaat om slaan per hand, blokken, drinken,
  graven, dragen, vissen en de hamer. Ze gaan via three's `AnimationUtils.makeClipAdditive` met
  alleen de tracks van de bovenrug en de armen. Zo loopt slaan over lopen heen, zoals nu met de
  sinussen. De logica van wanneer en welke hand blijft in `classic-avatar.js`; alleen het uitvoeren
  wordt een clip in plaats van een keyframe in code.
- **Een gedeelde toestand-naar-clip-functie**: `web/js/body-pose.js`, puur, zonder THREE.
  - `clipFor(state, has)` met terugvalketens, bijvoorbeeld `sprint → run → walk`, `crouchWalk →
    walk`, `ride_gallop → ride_canter`.
  - Hij wordt gevoed door walk mode (de eigen speler) en door de pose-bits (`peers.js`, andere
    spelers). Het is hetzelfde ontwerp als `borrowed-pose.js` in het geleende plan, nu voor eigen
    lichamen.
- **Handitems** hangen aan `handL`/`handR` met dezelfde `HELD_ITEM_PROCEDURAL`-tekeningen als nu, en
  ze worden per socket uitgelijnd. **First person** toont alleen het deel `arms`.
- **Het eerste personage is de reiziger zelf, op het nieuwe skelet.** Hij heeft dezelfde vorm,
  dezelfde verfslots en dezelfde uitrusting. Dat bewijst dat clips de sinussen kunnen vervangen,
  zonder dat iemand een ander gezicht ziet. Pas daarna komt een nieuw ontwerp.
  - Het concept komt uit 2D-schetsen via `/perchance` (een eigen prompt, géén "zoals Benny").
  - Het model komt uit een build-script, zoals `build-settler.py`.
- **De settlers van het dorp blijven de instanced figuren.** Driehonderd skinned meshes kunnen niet
  (zie "A settler who is not drawn is not an instance"). Personages zijn alleen voor spelers.

## Besluit 5: `/character` kiest tussen onze eigen karakters

- **`shared/characters.mjs`** is de enige lijst: `{ id, name, rig, status: 'live' | 'planned' }`,
  naar het model van `shared/equipment.mjs`. `traveller` (de huidige reiziger) staat altijd vooraan
  en is de standaard.
- **De look krijgt `body: <id>`.**
  - `normalizeAvatar` neemt alleen een `live` id over.
  - De zee neemt het in `lookOf` over als slug (`/^[a-z][a-z0-9-]{0,15}$/`).
  - Een oudere zee laat het weg, en dan ziet iedereen je als reiziger. Dat is onschuldig, maar wel een
    reden om de open zee mee te deployen.
  - Het is een toevoeging die een oudere 0.x negeert. Of het in een patch of een minor gaat, beslis je
    bij de release; niets in `layout.json`, `config.json` of een bundel verandert.
- **`/character` is niet meer geheim.**
  - `lib/commands.mjs`: `/character` opent de keuze (`character_open`) en `/character <id>` kiest
    meteen (`character_set`). Het staat in de `/help`-lijst.
  - Elke speler mag het, ook een bezoeker, want het is alleen zijn eigen look.
  - Het paneel (`web/js/character-select.js`, in `PANELS`) heeft per karakter een preview met een
    eigen renderer, die bij het sluiten `forceContextLoss` doet (zie "A temporary renderer gives its
    context back"). Daarin speelt `stand`, en `walk` bij hover.
  - Later komt dezelfde keuze als tab in de inventory (`studio.js`).
- **Verfslots en uitrusting** gelden voor elk personage met dezelfde slotnamen. Een personage dat een
  slot niet heeft (geen hoed op een helm), laat het weg.
- **Het geleende spoor** (WoW, keeper-only, uit HOME) is geen hoofddoel meer. Het blijft hooguit een
  lokaal, optioneel spoor voor Martijn zelf, met alle regels van
  `geleende-karakters.md` (alleen lokaal), en zou in dezelfde keuze kunnen verschijnen onder
  een kopje dat alleen de keeper ziet. Het wordt niet gebouwd tenzij hij erom vraagt.

## Fasen

1. **De rig-bake.**
   - `scripts/export-rig.py`, `web/js/rig.js`, `checkRig` en `tests/rig.test.mjs`.
   - Bewijs: een proefset met drie bones en een loop-clip, gebakken, idempotent, en in `/demo` aan
     het bewegen.
   - `tests/no-borrowed.test.mjs`.
2. **Het eigen paard.**
   - `scripts/build-steed.py` en `assets/steed/`: mesh met zadel en hoofdstel, het skelet en de clips
     uit de fasetabellen (Muybridge).
   - In `/demo` op een eigen rij, met een gangkeuze en een snelheidsschuif.
   - Lokaal (patch) naast het WoW-paard, om op het oog af te stellen.
3. **Rijden in het spel.** `mount.js` (`stepMount`, `gaitOf`), dan `walk.js`, `net.js`, `main.js`,
   `peers.js`, de toetsen en het touch-pad, de fiets eruit, en `tests/mount.test.mjs`. Dit volgt de
   volgorde van het paard-plan; de ruiter is nog de reiziger met gespreide benen.
4. **Het Promptholm-skelet en de clips.**
   - `shared/skeleton.mjs`, `build-humanoid-clips.py` en `body-pose.js`.
   - De reiziger op het skelet, achter een vlag (Settings → Debug) naast de oude rig, tot hij alles
     kan wat de oude kon: slaan, blokken, drinken, graven, dragen, dansen, zwemmen, duiken, fietsen
     (dan rijden) en first person.
   - Pas dan wordt hij de standaard en gaan de sinussen weg.
5. **`/character` en een tweede personage.**
   - `shared/characters.mjs`, `body` in de look (pagina en zee), het commando en het paneel.
   - Het concept via `/perchance`, dan het model, dan in de lijst.

Fase 1-3 leveren een eigen paard en rijden op de zee, zonder dat het personage verandert. Fase 4-5
zijn het grotere werk, en kunnen pas beginnen als de rig-bake zich bij het paard bewezen heeft.

## Tests

- **`rig.test.mjs`**:
  - het formaat (gewichten, invloeden, sockets);
  - `createRig` onder Node met een stub-`document`;
  - elke clip loopt rond;
  - geen botnaam komt in twee families voor;
  - een paard en een ruiter in één scène: elke track van elke mixer bindt aan een bot van zijn eigen
    rig (`PropertyBinding` op het eigen root), en met `followSocket` staat de heup van de ruiter na
    een frame op het zadel;
  - een tweede `export-rig.py` verandert geen byte (in `npm run models`).
- **`no-borrowed.test.mjs`**: geen pad naar of naam van WoW-materiaal in de bronmappen, en geen GLB
  onder `web/models/` buiten de bekende drie.
- **`mount.test.mjs`**: uit het paard-plan, met daarbij:
  - `stepMount` schuift nooit zijwaarts;
  - de bochtsnelheid daalt met de gang;
  - de gang van een kijker komt overeen met die van de rijder;
  - RIDING + DANCING is steigeren.
- **`body-pose.test.mjs`**: elke toestand geeft een clip die bestaat, ook na een terugval.
- **`characters.test.mjs`**:
  - `normalizeAvatar` en `lookOf` laten een onbekende `body` vallen en een live id door;
  - `/character` staat in `/help`;
  - de lijst en de gebakken rigs komen overeen.

## Open vragen

- **Maat van het paard.** De WoW-verhouding (1,27 kop tegen kop) is gestileerd groot. Een echt paard
  heeft de schoft rond de schouder van de ruiter. Begin bij de schoft op schouderhoogte van de
  reiziger (`PLAYER_SCALE` 1,12) en stel af in `/demo`.
- **Eén paard of een keuze.** Een vachtkleur per speler kan via een verfslot op het paard (`coat`,
  `blanket`), naar het model van de look. Dat zou dan in de look meegaan, en daarvoor is de
  zee-deploy nodig.
- **First person te paard.** Over de nek heen kijken of de kop verbergen. Op het oog.
- **Het tweede personage.** Welk ontwerp? Het moet eigen zijn; een struikrover, een ruiter of een
  zeeman passen bij het eiland.
