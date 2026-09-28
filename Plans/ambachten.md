# De ambachten: de brouwerij, het oefenveld en de steengroeve

**🚧 NOG NIET KLAAR** — de modellen zijn af, de treden en de plek op het eiland nog niet.

Begonnen op 28 september 2026, als stap 4 van `Plans/mijlpalen-tot-tweehonderd.md`: de drie
gebouwen uit de tabel "De nieuwe ladder, 90-200" die geen haven nodig hebben. De brouwerij (106)
omdat de kroeg sinds `Plans/bier-en-dronken.md` bier tapt, het oefenveld (134) naar
`Ideas/Images to Render/trainingarea.png` en `Ideas/Ideas.MD` §16, de steengroeve (142) naar §15:
de steen voor de eerste dijk op 150.

## Stand van zaken

Model en animatie op `/demo` (rij "Civic", na het kasteel) en in `/editor`. **Nog niet op het
eiland**: de treden in `MILESTONES` en de plek in `TRADES` zijn van het plan van de ladder, en een
trede gaat pas in `MILESTONES` als zijn model er is. Dat is nu zo.

- **De brouwerij.** Een brouwhuis van baksteen onder leien, 1,5 breed en 1,15 diep, nok op 1,5, met
  een vierkante schoorsteen tot 2,5 (het hoogste van de drie ambachten, anderhalf keer de zagerij).
  De grote deur (0,5 bij 0,66, een vat op een steekkar gaat erdoor) staat wijd open op de maischkuip
  in het donker; boven de deur de moutzolder met een hijsbalk en een zak die omhoog gaat, op de nok
  een luchtkoker. Rechts een afdak op twee palen met de koperen ketel op een stookplaats, het vuur
  zichtbaar in de mond, een dampbuis door het dak, brandhout in de hoek, hop te drogen aan de balk
  en een lantaarn. Op het erf zes vaten op een stelling en twee rechtop, een bierkar met drie
  vaten en zakken hop, één open met de bellen erop. Het uithangbord is een vaatje aan een ijzeren
  arm. De ramen gloeien 's nachts, de schoorsteen rookt en de ketel dampt.
- **Het oefenveld.** Een omheind veld van 3 bij 3, het hek op de kavelgrens zoals de wei van de
  stal, met een poort die naar binnen openstaat. Achterin links een open schuilhut (0,72 hoog aan de
  voorkant) met schilden, helmen, een kist en een ton, een blauw vaandel aan de hoekpaal en een
  vlaggenstok waar `main.js` de vlag van het eiland aan hangt (`anchor.flag`, zoals bij het
  stadhuis). Drie strooien poppen op een paal, op mensenmaat (0,47 met helm): één kaal, één met helm
  en rode tuniek, één met helm, leren borstkuras en schild. Twee pells met pinnen. Achterin rechts
  drie schietschijven, de middelste onder een dakje, met pijlen erin en één ernaast, een
  schietlijn met een bank en een ton vol pijlen. Een wapenrek met speren en een hellebaard langs
  het linkerhek, een rek met houten oefenzwaarden, strobalen, graspollen langs de randen.
- **De steengroeve.** Een baai in een heuvel: drie gezaagde treden (0,32, 0,64 à 0,70 en 0,98),
  elk net anders gehakt, met voegen in de wanden waar de volgende blokken uit komen, een blok dat
  al los ligt en een blok dat is afgetekend. Ruwe rots erboven en langs beide flanken, met gras op
  de heuvel die naar de kavelgrens afloopt. Op de vloer een tredmolenkraan (het rad is 0,72 rond, er
  kan een settler in lopen), een lorrie op een kort spoor, een stapel gezaagde blokken bij de
  straat, de werkbank van de steenhouwer met een blok, hamer en beitel, een ladder tegen de
  onderste trede en een houweel.

### Wat er beweegt

- De schoorsteen van de brouwerij rookt de hele dag, zoals die van de smidse (`civicFire` in
  `main.js`), en de ketel dampt twee keer zo vaak uit zijn eigen `anchor.smoke`.
- De vlag op het oefenveld is de gewone vlag van `main.js`, in de kleur van de wijk.
- In de steengroeve (`web/js/quarry.js`, een ronde van 16 s op de eigen klok): een blok groeit op
  de onderste trede onder de haak, wordt opgehesen, de giek zwenkt 59,5° naar de lorrie, laat het
  blok erop zakken; de lege haak gaat omhoog, terug en omlaag. De lorrie rijdt het blok 1,24 over
  het spoor naar de stapel, het blok krimpt erop weg, de lorrie rijdt leeg terug. Het tredrad draait
  precies zo ver als er touw op de trommel komt: vooruit bij het hijsen, achteruit bij het vieren.

## Besluiten

- **Eén Blender-set voor drie gebouwen**: `scripts/build-workshops.py` →
  `assets/workshops/workshops.blend` → `web/js/workshops-mesh.js`, zeven gemeente-assets onder het
  budget van 1500: `civic_brewery` 1270, `civic_brewery_copper` 196, `civic_brewery_yard` 1368,
  `civic_trainingfield` 1390, `civic_trainingfield_yard` 1279, `civic_quarry` 711,
  `civic_quarry_yard` 1320. Twee keer bakken geeft dezelfde bytes; elke ruwe vorm komt uit een
  `random.Random` met een vaste seed.
- **De ketel is een eigen asset** omdat hij zijn eigen `anchor.smoke` heeft (de stoom) naast die van
  de schoorsteen, en een asset heeft één anker van elke naam. Blender houdt objectnamen uniek over
  het hele bestand, dus het tweede anker heet `anchor.smoke.001`; `scripts/export-models.py` haalt
  dat achtervoegsel eraf. Geen andere set had er een.
- **Een hoogte per asset**: `heightOf` is de `building_height` van de set, één getal voor alle
  drie, en dat is de schoorsteen. `topOf` in `web/js/models.js` leest de hoogte van één asset uit
  zijn eigen punten.
- **Leien op de brouwerij, niet de terracotta van de herberg**: baksteen en dakpan zijn dezelfde
  roodbruin, en van ver was het brouwhuis één klomp. Leien zoals de smidse en de slagerij.
- **Het hek staat op de kavelgrens**, zoals de wei van de stal: de palen (0,036) staan midden op de
  lijn, het veld reikt 1,518 van zijn midden. De brouwerij reikt 1,446, de groeve 1,478.
  `tests/workshops.test.mjs` houdt dat vast op dezelfde manier als `tests/trades.test.mjs`. Alle drie
  staan op de gewone opstap (0,23 rondom), net als de stal: die steekt zo'n kwart cel de steeg in,
  alleen als beeld.
- **Het oefenveld is voor lopers één blok**, zoals de wei van de stal: de vloer ligt onder de
  loophoogte, dus de voetafdruk is het hele veld. Het veld begaanbaar maken vraagt een vloer die
  niet meetelt, en dat is een eigen stap (zie Later).
- **De groeve is een baai in een heuvel, geen trap op een grasveld.** Drie gelijke treden over de
  hele breedte lazen als een amfitheater; nu is elke trede anders gehakt, lopen de flanken schuin
  terug als rots (`splay`) en valt de heuvel met gras naar de kavelgrens af, zodat hij van achteren
  een helling is en geen muur. De treden stoppen onder de heuvel (1,3) in plaats van op de lijn.
- **De kraan is een giek die zwenkt**, geen katrol die op en neer gaat: een blok dat alleen omhoog en
  weer omlaag gaat is een jojo. De mast staat waar de trede en de lorrie even ver weg zijn, dus de
  tip hangt precies boven allebei (nagemeten in de test). Haak en blok houden hun eigen richting
  terwijl de giek eroverheen draait, zoals een last aan een touw.
- **Bewegende delen zitten in de werf-asset**, met hun oorsprong op hun eigen as, zoals bij de
  zagerij (`isQuarryMoving` in `buildings.js`). `quarry.js` leest elke afstand uit de bake en
  voegt samen met `mergeParts`, niet `mergeGeometries`: het tredrad is planken en kopshout, en
  alleen de planken hebben een sheet.
- **Geen letters**: het bord van de brouwerij is een vaatje aan een arm.

## Later

- **De treden en de plek**: `brewery` op 106 en `trainingfield` op 134 in `MILESTONES` en in
  `TRADES` (`lib/layout.mjs`); `quarry` op 142, volgens het plan op hoge, rotsige grond met een
  eigen plekregel zoals de windmolen, of anders ook in `TRADES` - de bake past op een 3x3. Daarna
  `tests/trades.test.mjs` uitbreiden, en `MOVABLE_CIVICS`/`CIVIC_NAMES` in `lib/plan.mjs`.
- Passieve settlers zoals de smid en de bakker: een brouwer bij de ketel, iemand in het tredrad,
  een steenhouwer aan de werkbank, rekruten bij de poppen.
- Het oefenveld begaanbaar maken en de poppen laten terugwiebelen als je ze slaat.
- Stoom op `/demo`: die pagina heeft geen deeltjes.
