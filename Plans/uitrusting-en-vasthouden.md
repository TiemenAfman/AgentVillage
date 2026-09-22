# Uitrusting: dingen vasthouden, en een rugzak die uit kan

## Context

Aanleiding was een kleine bugfix (C-crouch die zichzelf saboteerde door herhaal-keydowns -
zie de commit "Laat C ingedrukt houden niet meer tegen zichzelf vechten"), maar wat Martijn
er eigenlijk mee wil is groter: settlers die iets in hun hand kunnen vasthouden, en een
rugzak die uit kan. Dat laatste is met opzet het eerste concrete doel - geen
context-gebonden gereedschap tijdens een actie (zoals "P om te zaaien" al heeft), maar een
losstaand uitrustingsconcept: je kiest wat iemand draagt, los van welke actie diegene
uitvoert.

Scope, na een kort gesprek: **beide** tekenpaden tegelijk (de speler én de rondlopende
settlers), maar alleen het eigen low-poly rig (`classic-avatar.js`) - niet het Kenney GLB-
personage, dat bijvangst is.

## Waarom dit geen kleine toevoeging is

Er zijn twee volledig verschillende tekenmechanismen, en "een rugzak aan/uit zetten" betekent
voor elk iets anders.

**De speler** (`web/js/avatar.js` + `web/js/classic-avatar.js`) is een echte hiërarchie: elk
lichaamsdeel is een eigen `THREE.Group`-pivot (`leftLeg`, `rightLeg`, `leftArm`, `rightArm`,
plus `core` voor de romp), en de pose wordt elke frame op die pivots gezet
(`classic-avatar.js:48-69`). Maar de rugzak bestaat vandaag niet als eigen object: hij zit
letterlijk *meegebakken* in de speler-geometrie. `playerGeometry()` in `web/js/walk.js:86-100`
merget het lijf, het zadeltasje (satchel), een riem en de hoed tot **één** statische
`BufferGeometry` via `mergeGeometries()`. Er is niets om aan of uit te zetten - de rugzak
verdwijnt pas als je de hele merge-functie herschrijft zodat hij een los onderdeel wordt, op
dezelfde manier als de vier ledematen dat al zijn.

Ook een hand om iets in te leggen bestaat nog niet: in `classic-avatar.js` zit "Left hand"/
"Right hand" gewoon mee in de `leftArm`/`rightArm`-merge (`classic-avatar.js:11-12`). Er is
geen los attach-point aan het eind van de arm-pivot om een object aan te hangen.

**De settlers** (`web/js/settler-figures.js`) zijn instanced: één crowd van honderden figuren
kost elf getekende meshes in totaal, niet elf per settler. Elk lichaamsdeel-*type* (torso,
trim, linker/rechterbeen, linker/rechterarm, linker/rechterhand, skinCore, hoofd, details) is
één `InstancedMesh`; elke settler is daarin alleen een instance-index met een eigen matrix en
instance-kleur. Er is hier al precies het patroon dat een uitrustingsstuk nodig heeft: **hoeden
werken al zo.** Elke hoedvorm heeft zijn eigen instanced mesh ("hat bucket",
`settler-figures.js:161-166`), en een settler wordt bij het inschrijven in precies één bucket
geplaatst naar gelang zijn `look.hatShape` (`settler-figures.js:194-198`). Een rugzak-bucket en
een vastgehouden-item-bucket zijn dezelfde constructie: een nieuwe instanced mesh (of een paar,
één per itemvorm) waar een settler wel of niet een slot in krijgt. En de handen
(`leftHand`/`rightHand`) zijn hier *al* losse merge-groepen (`settler-figures.js:79-80`) - het
enige attach-point dat vandaag al bestaat, staat toevallig aan de kant die verreweg de meeste
instanced settlers heeft en de speler niet.

De twee opgaven zijn dus niet symmetrisch: bij de speler moet er eerst een los onderdeel *en*
een hand-attach-point *gemaakt* worden waar nu een merge staat; bij de settlers bestaat het
patroon en het hand-attach-point al, en is het vooral een kwestie van een nieuwe bucket-soort
toevoegen naar het voorbeeld van de hoeden.

## Besluit: alleen de mechaniek, nog geen UI

Martijns antwoord op de vraag hierboven: voor nu alleen **mogelijk maken** - geen trigger-
logica, geen UI. Zonder iets dat de vlag omzet verandert er voor een speler dus zichtbaar
weinig, en dat is precies het punt: dit bouwt het fundament voor een latere, uitgebreidere
**equipment-UI, RPG-stijl** (denk aan losse slots - rugzak, in de hand - die je vanuit een
paneel aan- en uitzet), niet die UI zelf.

Dat beslist twee van de drie openstaande vragen uit de vorige versie van dit plan:

- **"Look of state?"** → **state**, geen afgeleid uiterlijk. Een equipment-slot is een
  eigenschap die iets aan- of uitzet, net als een instelling, niet iets dat uit
  `settlerLook()`'s eigen determinisme volgt (zoals de hoedvorm dat wel is). Dat maakt de
  toekomstige UI zinvol: een RPG-equipment-paneel dat een knop laat zien maar niets kan
  veranderen omdat de staat toch weer uit de naam van de settler wordt herberekend, is geen
  equipment-systeem. Voor déze fase betekent het concreet: een los stukje staat per speler/
  settler (`equip: { backpack: boolean, handItem: string | null }`), niet een berekening.
- **Wie bepaalt het, voor settlers?** Nog niemand - er komt geen trigger in deze fase. De
  staat moet er alleen *zijn* en getoond kunnen worden; of een settler 'm draagt omdat hij
  onderweg is, willekeurig is, of nog standaard `false`/`null` staat totdat er een UI is die
  'm zet, maakt voor de mechaniek zelf niets uit. Een handige, goedkope manier om de mechaniek
  te bewijzen zonder al op de trigger-vraag vooruit te lopen: een dev-only `/equip`-achtig
  commando (zie de `/roads`-familie in `lib/commands.mjs` voor het patroon), dat gewoon
  eenrichtingsverkeer een vlag omzet.

De derde vraag - welk vastgehouden ding het eerst komt, en of de geometrie een primitief of
een Blender-prop is - blijft open tot fase 3/4 hieronder, en hoeft niet nu beslist te worden:
de eerste fasen raken alleen de rugzak en het attach-point, geen item-geometrie.

## Voorstel voor de eerste fase

Gegeven "alleen mogelijk maken" en dat de rugzak zelf al bestaat als geometrie (alleen
meegebakken), is de kleinste zinnige eerste stap:

1. ✅ **Speler eerst, rugzak alleen.** De satchel/rugzak-onderdelen (`Shoulder strap`,
   `Canvas backpack`, `Bedroll`, etc. - elk `variant: 'gear'` in `SETTLER_PARTS`, op de
   hamer na) zijn uit `classic-avatar.js`'s `CORE`-piece getild naar een eigen `backpack`-
   piece, aangestuurd door een echte `equip.backpack`-vlag op de avatar-spec
   (`web/js/avatar.js`, default `true` - het uiterlijk verandert dus voor niemand tenzij
   iets de vlag omzet). Getest: aan/uit in de browser via `walk.setAvatar(...)`, geen
   trianglecount-regressie (`tests/avatar.test.mjs` blijft groen).
2. **Dezelfde vlag naar de settler-instancing.** Nog niet gedaan - blijft een rugzak-
   bucket naar het voorbeeld van de hoed-buckets in `settler-figures.js`, gevoed uit een
   `equip`-veld op de settler-state (standaard uit, tot iets 'm zet).
3. ✅ **Een hand-attach-point op de speler.** `rightHandAttach`, een lege `THREE.Group`
   als kind van de `rightArm`-pivot, positie berekend uit de bounding box van "Right hand"
   zelf. Getest met een tijdelijk paars blokje: kwam exact op de hand terecht.
4. ✅ **Het eerste echte item: de bestaande lounge-parasol, herbouwd op handschaal**
   (`parasolGeometry()` in `classic-avatar.js`, dezelfde kleuren als de strandparasol in
   `walk.js`), aan/uit via `equip.handItem: 'parasol' | null`. De arm krijgt een vaste
   uitgestrekte hoek (`HOLD_ARM_X`) zolang er iets wordt vastgehouden, in plaats van met de
   pas mee te zwaaien - anders zou de parasol door het lijf zwiepen. Bekende beperking: er
   is geen pols/elleboog, dus de parasol draait rigide mee met de arm en oogt vanuit
   sommige kijkhoeken (recht van voren) verscholen achter het lijf. Nog niet gedaan voor de
   settler-instancing (stap 2 hierboven eerst).

## Verificatie

Zoals bij de rest van dit project: `npm run watch` of een handmatige herstart, dan de speler
en een paar settlers in de browser bekijken - eerst met/zonder rugzak wisselen zonder de rest
van de pose te breken, dan controleren dat de instanced hoedbuckets niet per ongeluk zijn
geraakt (bestaande settlers moeten hun hoed houden). `tests/villagers.test.mjs` telt nu
`scene.children.length === 18` (elf lichaam, zes hoeden, één hamer) - een nieuwe bucket
verandert dat getal bewust, en die test moet expliciet worden bijgewerkt, niet toevallig gaan
falen.
