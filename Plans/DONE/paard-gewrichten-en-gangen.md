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
