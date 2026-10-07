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
