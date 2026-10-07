# ✅ Paard: gewrichten, gesloten model en kloppende gangen

De huidige vier starre poten zwaaien door de grond en verliezen hun aansluiting op de romp.
De hoekige hals en romp passen onvoldoende bij de verfijnde avonturier. Verbeter het bestaande
paard in de Blender-bron, met behoud van zijn schaal, zadel en gebruik op het eiland.

1. Geef elke poot een keten met bovenbeen, knie/spronggewricht en koot/hoef; geef hals,
   hoofd en staart eigen botten en vloeiende huidgewichten. Sluit alle oppervlakken.
2. Verfijn silhouet, borst, achterhand, snuit, oren, ogen, manen, hoeven en tuig.
3. Stuur hoeven langs een grondfase en een geheven terughaalbeweging; houd stap,
   diagonale draf en galop duidelijk verschillend. Controleer stoppen, achteruit en springen.
4. Op verzoek: twee rijsnelheden, draf (0,72) en galop (1,18); galop via sprintknop/Shift.
   Natuurlijk grondcontact heeft voorrang boven de oude spelsnelheden.
5. Controleer zadelcontact, benen om de flanken, voeten in de beugels en ontspannen armen.
6. Bekijk alle gangen vanuit meerdere hoeken in /avatar-motion.html. Test gesloten geometrie,
   vervorming, grondcontact, ruiterpasvorm en bestaande paarden-/avatarfuncties.

Bron en export reproduceerbaar houden; geen nieuwe modellenloader.

Uitgevoerd: 17 Blender-botten, genormaliseerde huidgewichten, gesloten oppervlakken en
hoef-IK met diagonale draf en vier afzonderlijke galoplandingen. De rug is onder het zadel
versmald zodat de bestaande ruiterhouding vrij blijft.

Validatie: 54 gerichte tests geslaagd; apart sprint/Shift in de browser gecontroleerd.
Grondcontact ook gecontroleerd bij gedraaide en hellende romp. Een tweede Blender-export
is identiek; geometrie van andere dieren is ongewijzigd.

## Verfijning naar Preston Blair (7 oktober 2026)

Nagemeten tegen de vellen *Horse Trotting* (p. 358) en *Horse Galloping* (p. 359) uit
*Cartoon Animation*, in `web/js/horse-gait.js` en `web/js/mount.js`:

- **Draf**: de diagonalen landen samen en tussen twee diagonalen is een korte zweeffase
  (`duty` .46 in plaats van .54). Hoofd, borstkas en bekken gaan samen op en neer, twee keer
  per pas: laagst midden in de steun, hoogst in de zweeffase vlak vóór het contact
  (`horseBody`). De rug ligt daarbij net laag genoeg (-.038) dat de voorpoot die bij de
  landing naar voren reikt de IK niet laat klemmen - een geklemde hoef glijdt, en
  `tests/horse-rig.test.mjs` ziet dat.
- **Galop**: geen deining maar een wip (`bodyX` ±.06): borstkas hoog en bekken laag terwijl de
  achterbenen dragen ("most compressed", hoofd hoogst), borstkas laag en bekken hoog op de
  voorbenen ("most stretched", hoofd laagst). De voorbenen reiken naar voren en de
  achterbenen slepen (`reach`), zodat het gestrekte beeld gestrekt leest.
- **Hoeven**: de koot buigt in de zwaai (`flex`, per gang en per voor/achter; de voorhoef
  klapt tot onder de onderarm, de achterhoef minder), hoogst en meest gevouwen vroeg in de
  zwaai (`peak`), en horse-rig.js draait de hoef erin in het waterpas-frame zodat een
  belaste hoef vlak blijft.
- **Rave**: `poseHorse` leest nu ook de dansbeweging van stepDance (de stijve-poten-taal,
  `pose.legs`) als hoefdoel, en steigerend hangen de achterbenen recht - `rise` in stepDance
  rekent met een stijve poot, een gebogen spronggewricht zette het paard in de lucht. De
  test `rave-stable` meet een skinned mesh via `applyBoneTransform`.

## De galop opnieuw, naar de metingen (7 oktober 2026)

De galop van hierboven las als joggen op de plek: bij 2 Hz en 1,18 u/s was de pas 1,9 beenlengte
en bleef elke hoef binnen 0,08 van zijn rustplek. Opnieuw opgebouwd met de metingen van het
referentiepaard (`Plans/paard-in-plaats-van-fiets.md`, "De gangen van een referentiepaard,
gemeten": 1,27 Hz, pas 4,3 beenlengtes, 18-28% aan de grond, rug 0,22 beenlengte op en neer en
3-22 graden kanteling) en de beschrijving van het wiegen van de galop (kop omhoog als de
achterbenen onder komen, laagst als het leidende voorbeen landt):

- **Cadans 1,25-1,4 Hz** in plaats van 1,85-2,05: een pas van drie beenlengtes op 1,18 u/s.
- **De zwaai is niet de steun achteruit**: `trail` neemt de geheven hoef eerst terug en omhoog
  (voorbeen onder de borst gevouwen, achterbeen achteruit geslagen), `over` brengt hem voorbij zijn
  landingsplek (voorbeen reikt uit, achterbeen ver onder de buik) en de hoef blijft hoog terwijl
  hij reikt. Beide zijn bulten zonder helling aan de uiteinden, dus een landing komt nog op de
  steunlijn met de snelheid van de steun.
- **Romp**: kanteling ±7 graden (het belaste eind is altijd het lage, dus de kanteling maakt
  een belast been alleen korter), op en neer 0,026, kop omhoog bij de achterbenen en laagst als
  het leidende voorbeen (rv, 0,6) landt.
- Gemeten in Node: geen enkele heup-hoefafstand boven de beenlengte (0,307) bij 0,9 en 1,18
  u/s, en geen hoef midden in de zwaai op de grond. In het verzamelde moment staan de
  achterhoeven binnen 0,08 van de voorhoeven, gestrekt ligt er 0,7 tussen de voorste en de
  achterste hoef.

## De ruiter rijdt mee (7 oktober 2026)

walk.js, peers.js en de bewegingsstudio kopieerden de quaternion van het paard op de ruiter: hij
kantelde star mee met elke wip van de galop, de kop als het eind van een stok. Nu is er één model,
`mount.js` `carry` / `stepRider`, dat alle drie gebruiken:

- de **heupen** blijven op het zadel (langs de grond binnen 3 mm);
- het **bekken** neemt `PELVIS_SHARE` (0,3) van de kanteling, het bovenlijf blijft in de wereld
  nagenoeg staan;
- een **veer** op de hoogte: een stijgend zadel duwt hem meteen op, een dalend laat hem even
  achter (zitten in draf, een tikje opgewipt per diagonaal), nooit in het leer;
- **halve zit** in de galop: 17 graden extra voorover, de heupen 1,2 cm los van het zadel, een
  zachtere veer omdat de knieën de deining nemen;
- de **handen** geven mee met het hoofd van het paard (`give`), zodat de teugels even lang blijven.

De rig krijgt die beweging als `pose.horseback` (een object; `true` blijft de vaste zit).
Alleen tekenen: niets gaat over de lijn. `tests/mount-rider.test.mjs`.

## Sneller dan de ruiter, en geen benen kwijt (7 oktober 2026)

- **Snelheid**: draf 1,9 en galop 3,4 (waren 0,72 en 1,18; de Avonturier rent 1,8 en sprint 2,7,
  dus de keeper liep zijn paard voorbij). Betaald met cadans (draf tot 2,5 Hz, galop tot 2,6 Hz) en
  een kortere steun (draf 0,36, galop 0,20), zodat een staande hoef binnen het bereik van het been
  blijft (~0,29 per steun) en nooit glijdt; de romp ligt in draf en galop iets lager. In de zwaai
  strekt een been soms tot het eind (de hoef 1 cm korter dan gepland, in de lucht, onzichtbaar).
  Galop vanaf 2,6 (`GAIT_EDGES`).
- **Verdwijnende benen** bij wisselen tussen vooruit en achteruit: door nul heen is het paard even
  'stand' op een paar duizendsten met cadans 0, en de raaklijn van de zwaai deelde door die 0. De
  overgang droeg de NaN daarna mee. `hoofPath` behandelt hz 0 als staan, de overgang gooit
  ongeldige getallen weg (`tests/horse-rig.test.mjs`).
- **Armen** deinen mee: een gedempte veer gedreven door de versnelling van het lichaam (draf: de
  ellebogen ±4-5 graden, stilstaand stil).
- **Knieën**: `stirrupLeg` in classic-avatar.js lost heup en knie op de echte botten op zodat de
  voeten in de beugels blijven als de heupen opkomen. Met de huidige beugels staat het been van de
  Avonturier al bijna gestrekt (hij haalt maar ~3 mm); kortere stijgbeugels zijn onderweg in de
  Blender-bron.

## Meer detail, een vacht en kortere beugels (7 oktober 2026)

`scripts/horse-model.py`: spierpartijen (schouder, achterhand, schoft, kruis, borst met groef,
opgetrokken flank), wangen, wenkbrauw, neusgaten, een volle manen (17 lokken en een kuif), een staart
met strengen, kastanjes en kootbehang - 3924 naar 6392 driehoeken (budget 6500,
`scripts/model-rules.mjs`). De vacht is vertex-kleur: donkerder over de rug en naar de benen,
lichter onder, vage appels, ambient occlusion met 32 vaste stralen per hoekpunt (geen Cycles, dus
deterministisch). De stijgbeugelriemen zijn 4,5 cm korter (ijzers op 0,3435), `saddleOf` leest ze
met `IRON_TOP` 0,38 en `IRON_BESIDE`, en de Avonturier zit met de knie op 68 graden.
Zelfs dan staat zijn been zo ver naar buiten dat een openende knie de voet maar ~6 mm laat zakken:
de halve zit komt 3 mm op en de vering mag 3 mm, en daarbinnen werken de knieën zichtbaar mee
(ruim 20 graden per 6 mm). Open: een vage naad waar hals en benen uit de romp komen (aparte gesloten
schillen, het oude paard had hem ook), en het zadel is nog de oude blokken.

## Grazen (7 oktober 2026)

De nek met kop reikt vanaf het nekgewricht (0,435 hoog) maar 0,42. Een eerste versie haalde het gras door
het paard voorover te kantelen (0,3 rad), te laten zakken en nek en hoofd ver te knikken: de nek wees
recht omlaag, het hoofd draaide mee voorbij loodrecht tot de snuit naar de voorbenen wees, en de voorknieën
vouwden alsof hij knielde. De test keek naar het laagste punt van de kop, en dat was de kuif. Nu
(`HORSE_GRAZE` in fauna.js) buigt de nek omlaag en draait het hoofd ertegenin terug, zodat het gezicht
loodrecht hangt; geen kanteling en geen zakken, dus de voorbenen blijven recht. De lippen stoppen ~0,07
boven het gras: deze nek is korter dan die van een paard. Wie het gras wil raken, maakt de nek in het model
langer. `tests/horse-graze.test.mjs` meet de snuitpunt en het achterhoofd (gezichtshoek 75-100 graden), de
voorknieën en de hoeven. Een bereden paard graast als het stilstaat en de ruiter het laat
(`mountPose({ graze })`); in de bewegingsstudio is het de derde stand van de knop Paard.

## Dansen in de rave (7 oktober 2026)

Het stalpaard danste met stijve benen (een zwaai om de heup, door horse-rig.js vertaald). Nu danst
het met zijn hoeven: `HORSE_DANCE` in fauna.js, een move per frase van zestien tellen, ingefaded over
de eerste tel - **pawen** (één voorhoef op tussen de kicks en erop neergestampt, met headbangen),
een **piaffe** (de draf op de plaats uit de dressuur: de diagonalen om de tel op, het lijf omhoog
tussen de kicks) **wiegen** (heen en weer over twee tellen, de nek mee, een voorteen die tikt) en **op de achterbenen** (een hele frase gesteigerd: de voorbenen pawen om de beurt in de lucht, een achterhoef stapt op tussen de kicks, het lijf veert en het hoofd knikt; horse-rig.js leest ).
Elke hoef staat op elke kick, alles komt uit de tel alleen (twee schermen dansen gelijk), en op de
drop steigert het zoals voorheen. In de bewegingsstudio is het de vierde stand van de knop Paard (op
132 BPM, de rave's tempo). `tests/rave-stable.test.mjs`.
