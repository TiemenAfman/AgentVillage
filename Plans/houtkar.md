# De houtkar: de zagerij levert hout aan de werf, en er wordt op de werf gewerkt

**✅ Status: gebouwd op 28 september 2026.**

## Wat Tiemen vroeg

> De sawmill moet hout leveren aan de werf met paard en wagen. Er moeten ook werknemers bij de
> werf lopen.

Twee dingen dus: (1) een paard met een wagen dat hout van de zagerij over de weg naar de werf
brengt, en (2) mensen die op de werf aan het werk zijn en rondlopen.

## Wat er al is

- **De zagerij** (55 settlers, [zagerij.md](zagerij.md)): een zaagblad, een blok op de zaagbank en
  rollen, allemaal zonder mensen. Een eigen weg (`path:civic:sawmill`) naar het plein.
- **De werf** (95 settlers, [scheepswerf.md](scheepswerf.md)): een kavel van 5 bij 16 met een poort
  aan de landkant (`YARD_GATE`, `plotDoor`), een eigen weg, en een schip dat in vijf stappen
  (`yardStage` 0-4) op de helling groeit. Er staat een stapel stammen en planken bij de loods
  (`shipyard logs`, `shipyard planks`) en een teerketel. Werknemers staan onder "Later" in dat plan.
- **Een paard** (`fauna_horse`, `web/js/fauna.js`): een model met gewrichten en een pose die je van
  buitenaf kunt sturen (`stepPose` + `applyPose`). Zo danst het paard ook op de rave.
- **Een kar** (`prop_cart`): een handkar, zo groot dat een settler hem trekt. Te klein voor een paard,
  en met één disselboom in plaats van twee lamoenen.
- **Het patroon**: de goudvracht (`web/js/goldrun.js`, [goudmijn.md](goudmijn.md)): passieve figuren
  van de pagina, een lijst stappen per figuur, routes over de wegen (`roadBetween`).

## Besluiten

| Vraag | Besluit | Waarom |
|---|---|---|
| Wanneer rijdt de kar | Een vaste dienstregeling op de klok van de zee: een rit elke `TIMBER_EVERY` (6 minuten), met een fase uit het zaad van het eiland. Alleen overdag. Past de rit er niet in, dan wordt de periode langer; het paard loopt altijd stapvoets (zie hieronder). | Er hoort geen getal van de keeper bij zoals bij de goudkuil, dus er is niets privé en elke pagina (de keeper en elke bezoeker) mag hem zien. Met de klok van de zee rijdt hij op elk scherm op hetzelfde moment, zonder bericht op de lijn. |
| Waar het draait | Op de pagina, in `web/js/timberrun.js`, zoals de goudvracht. Niets op de lijn, niets op de zee. | De zee kent de figuren van de pagina niet. Een rit die op de zee liep zou een nieuwe versie van de zee vragen voor iets wat alleen te zien is. |
| Vanaf wanneer | Zodra er een zagerij en een werf staan, met een weg ertussen (`roadBetween`). Anders geen kar. | De werf komt bij 95, de zagerij al bij 55, dus in de praktijk: vanaf de werf. Een kar die vastloopt is erger dan geen kar. |
| De wagen | Een nieuw model, `prop_wagon` (`scripts/build-wagon.py`): een bak op twee grote wielen met twee lamoenen naar voren waar het paard tussen loopt. De wielen zijn eigen onderdelen met hun oorsprong op de as, zodat ze draaien. En `prop_timber`, de lading: vierkant bekapte balken, apart zodat hij zichtbaar is heen en niet terug. | Een geschaalde handkar leest als een handkar. Blender draait in de cloud, dus het model is echt gebakken en volgt de regels van de set. |
| Het paard | Een eigen trekpaard van de zagerij (`createAnimal('horse')`), niet het paard van de stal. De pose via `stepPose` (lopen als het rijdt, stil als het staat), de positie en richting zetten we zelf. | Het paard van de stal staat in zijn wei en gaat op zaterdagnacht naar de rave; een trekpaard dat daar tussen wegloopt zou een gat in de wei laten. |
| Hoe de wagen volgt | De wagen hangt aan het paard: zijn trekpunt blijft op vaste afstand achter het paard, en hij draait naar het paard toe (zoals een aanhanger). | Dan maakt de wagen in een bocht een eigen, ruimere bocht in plaats van als een stijf blok om het paard te draaien. |
| De voerman | Een figuur (de spelersrig als dorpeling, zoals de mijnwerker) die links bij het hoofd van het paard loopt. Laadt bij de zagerij, lost bij de werf. | Een paard dat alleen over de weg loopt, leest als een weggelopen paard. |
| De route | Van de stoep van de zagerij naar de poort van de werf (`plotDoor(...).step`, wat elke civic al als `door` op zijn record heeft) over de wegen, en terug. Een lang stuk wordt sneller gereden, nooit langer dan `LEG_MAX_S`. | Hetzelfde als de goudvracht. |
| Werknemers op de werf | Drie, in het assenstelsel van de werf (zoals de smid in de smidse): een scheepstimmerman met een hamer die langs de romp loopt en slaat, een drager die planken van de stapel naar de helling draagt, en een teerkoker bij de ketel die af en toe met de ketel naar de romp loopt. 's Nachts gaan ze de loods in. | "Lopen" was de vraag: dus niet drie beelden die staan te hameren, maar mensen die heen en weer gaan. Waar ze staan hangt af van de stap van het schip (`yardStage`): bij lege stapels opruimen, bij een romp langs de romp. |
| Als de kar er is | De drager loopt naar de poort en helpt lossen: hij draagt de balken van de wagen naar de stapel, en daarna gaat hij weer aan zijn werk. | Dan hoort de levering bij de werf, en is het niet iets wat er toevallig langskomt. |
| Hoe duur | Een paard, een wagen (~100 driehoeken) en vier figuren. De goudvracht had er twee plus een kar. | Binnen wat de goudvracht al kost. |

## Wat er bij het bouwen veranderde

- **Het paard draaft niet.** Het eerste eiland met een werf (112 settlers, 384-rooster) had 208
  cellen weg tussen de zagerij en de werf. Die rit in zes minuten persen gaf een paard op drie
  keer zijn stap - een op hol geslagen paard, geen levering. Nu loopt het paard altijd
  `HORSE_SPEED` en wordt de periode langer als de rit dat vraagt (daar: 17 minuten).
- **De drager rent niet.** Hij ging pas op weg als de wagen er al was, en had vijf seconden voor
  tien eenheden. Nu vertrekt hij `CARRIER_LEAD` (24 s) eerder naar de poort, wacht daar op de
  wagen, en loopt na het lossen in `CARRIER_BACK` (14 s) terug zijn ronde in. De test houdt vast
  dat geen van de drie ooit harder gaat dan een flinke pas.
- **De wagen is echt gebakken** (Blender 4.2 in de cloud, byte voor byte gelijk aan de bestaande
  bakes): `prop_wagon` 112/120 driehoeken, `prop_timber` 60/120. Een render vanuit Blender lukte
  hier niet (geen libEGL), dus bekeken op het eiland zelf.
- **Een fout in de houtkar mag het eiland niet kosten.** Een onbekende onderdeelnaam hield de
  pagina op zijn laadscherm; `main.js` vangt fouten van de houtkar nu af en laat hem dan weg.

## Versie

Geen `SEA_V`, geen layout-poort, niets in `layout.json` of de bundle: alleen een nieuw model en
nieuwe code op de pagina. Een patch mag dat.

## Later

- Het lossen laat de stapel op de werf niet groeien; de balken verdwijnen van de wagen en de
  drager legt er één op de stapel.

- Een zager aan de zaagbank ([zagerij.md](zagerij.md) "Later").
- De balken op de stapel van de werf die groeien en slinken met de leveringen.
