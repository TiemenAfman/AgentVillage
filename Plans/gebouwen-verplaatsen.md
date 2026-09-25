# Gebouwen rond het plein verplaatsen en draaien

Begonnen op 25 september 2026, op verzoek van Tiemen: in plan mode het stadhuis of de herberg
kunnen verplaatsen en draaien, en de grond van de stad kunnen uitbreiden om ruimte te maken.
Bouwt voort op `Plans/wijkjes-verplaatsen.md` (dezelfde deur, dezelfde regels) en
`Plans/wegen-tekenen.md` (een nieuwe op naast de oude).

## Wat de keeper kan

1. **Een gebouw van de stad selecteren** (Select, `1`): klikken op het stadhuis, de herberg, de
   markt, de school, de kapel, de klokkentoren, de watertoren, de zagerij, de smidse of de
   goudkuil. Nu geeft dat de toast "The town stays where it is"; straks een gouden kader om het
   kavel en een streepje voor de deur.
2. **Slepen** (Move, `2`): het gebouw schuift **per cel**, niet per supercel, want de kavels rond
   het plein liggen bewust naast het rooster van de huizen (`CIVIC_LOTS`). Een spook van het
   echte gebouw volgt de muis, groen of rood.
3. **Draaien**: `R` tijdens het slepen of met het gebouw geselecteerd draait het een kwartslag
   (`rot + 1`, de deur gaat mee). Ook een knop in het paneel, omdat een toets niet te vinden is.
4. **De grond van de stad uitbreiden** (Land, `5`): met de stad geselecteerd (klik op het plein
   of op grond van de stad terwijl Land aan staat) voeg je supercellen toe aan
   `layout.town.commons`, zoals je een gehucht land geeft.

Alles gaat als plan: een dry run na elke wijziging, het echte werk op Apply, een snapshot ervoor
en Restore previous erna. Niets echts beweegt voor Apply.

## Besluiten

- **Welke gebouwen**: de 3x3-gebouwen van de stad, `MOVABLE_CIVICS` in `lib/plan.mjs`. Niet het
  kasteel (7x7, `claimForTown`, `growCastle`), de vuurtoren, de kraan, de poldermolen, de molen,
  de brug en de kantoren van de gehuchten: die horen bij hun plek en worden daar door de scan
  gezet. Niet de losse dingen op het plein (put, fontein, standbeeld, tafels, borden): voor die
  heeft het plein geen bezettingscontrole die een verplaatsing overleeft (`squareClaimRank` draait
  maar één keer).
- **Op elkaar slepen wordt geweigerd**, niet geruild. Rood, "the tavern stands there". Eerst het
  ene gebouw weg, dan het andere erop: twee stappen in hetzelfde plan mag, want de ops lopen op
  volgorde.
- **Waar naartoe**: alleen op grond van de stad (de kern `TOWN_CORE_R` en de commons). Een cel
  op een laan tussen twee supercellen telt als van de stad als een supercel ernaast van de stad
  is: de kavels rond het plein staan zelf over zulke lanen heen. Die grond is uit te breiden
  (hieronder).
- **Wat onder het kavel mag liggen**: vrije grond, en wat van het gebouw zelf was (het oude
  kavel, zijn eigen pad, zijn eigen stoep). Een gewone weg eronder wordt opgebroken en opnieuw
  gelegd, zoals bij het verplaatsen van een gehucht. Geweigerd: het plein zelf (het houdt zijn
  maat), de stoep of het kavel van een ander gebouw, een weg van de keeper (`layout.roads`), een
  zone, een polderdijk, water, te steile grond (`freeBlock`).
- **De kavels rond het plein** blijven waar ze zijn (`layout.town.lots` is plakkerig). Een gebouw
  mag precies op een vrij kavel, of er helemaal naast, **nooit half erop**: `takeCivicLot` kijkt
  alleen naar de hoek van een kavel en zou de volgende trede dwars door het gebouw bouwen. Een
  gebouw dat van zijn kavel af gaat, maakt dat kavel vrij voor de volgende trede. **Behalve bij
  een duwtje**: een gebouw dat precies op een kavel stond en zo verschoven wordt dat het zijn
  eigen kavel nog raakt, neemt dat kavel mee (het kavel verhuist naar waar het gebouw nu staat).
  Anders kon je niets rond het plein een cel opschuiven.
- **Wat een gebouw al had, telt niet tegen hem.** Op het echte eiland ging de deur van de school
  open in het kavel van de herberg (`nearestWalkable` vindt voor de school een andere uitweg);
  de eerste versie weigerde daardoor zelfs het draaien van de herberg op zijn plek. Cellen waar
  het gebouw al staat, tellen niet als andermans stoep; een verplaatsing mag het alleen niet
  ergens nieuw veroorzaken.
- **De deur moet het plein bereiken.** `stranded` in `lib/plan.mjs` kijkt nu alleen naar huizen;
  het verplaatste gebouw komt erbij, zodat een deur tegen de rand van het eiland geweigerd wordt
  in plaats van stil zonder weg te staan.
- **Wat meeverhuist**: het pad naar de deur (`path:civic:<type>`) wordt weggegooid en door de
  lus "civic roads, relaid" in `placeAll` opnieuw gelegd vanaf de nieuwe deur; wegen die erop
  aansloten ruimt `pruneUnreachable` op en worden opnieuw gelegd. De stoep rond het gebouw en
  het plein worden elke scan opnieuw afgeleid, dus die volgen vanzelf. De brievenbus staat naast
  de deur van het stadhuis en wordt één keer gezet: bij een verplaatst stadhuis wordt
  `civic:mailbox` weggehaald en door `placeAll` opnieuw gezet, zoals het kantoor bij een gehucht.
- **De op**: `{ op: 'civic', id: 'civic:tavern', gx, gz, rot }`, een **absolute** plek en geen
  delta, zodat twee keer slepen in één plan één op blijft (`pushOp` vervangt de vorige voor
  hetzelfde gebouw) en een draai zonder verplaatsing gewoon dezelfde `gx, gz` is.
- **De grond uitbreiden**: `{ op: 'commons', add: [[i, j], ...] }`. Alleen toevoegen: de commons
  groeit elke scan terug naar wat er nodig is (`growParcel` in `placeAll`), dus weghalen zou
  terugkomen waar de keeper het niet koos. Elke supercel moet op het eiland liggen, van niemand
  zijn, geen zone, `Super.eligible` voor de stad, en aan de grond van de stad vastzitten.
- **De kleur van het spook** komt van de server, zoals bij de gehuchten: `civicSites` in
  `lib/plan.mjs` geeft per verplaatsbaar gebouw een kaart met per hoekpunt één hexcijfer, één bit
  per richting van de deur (`0` = kan hier niet staan, `f` = elke kant op goed). De deur zit
  erin omdat een spook dat groen werd met zijn deur tegen een muur, en een tel later door de dry
  run geweigerd werd, las alsof de planner loog. De survey bakt die kaart voor het eiland zoals
  het is, en **elke dry run met een `civic`- of `commons`-stap bakt hem voor het eiland zoals het
  concept het achterlaat**. Zo is de tweede stap van een ruil (de herberg op het kavel dat het
  stadhuis net verliet) groen tijdens het slepen. Na een geweigerde stap tekent de planner dat
  spook rood, zodat je ziet welk gebouw de weigering betreft.
- **Geen versiepoort en geen nieuw veld in `layout.json`**: een verplaatst gebouw is een gewoon
  kavel met andere getallen en de commons is dezelfde lijst. Een oudere 0.4.x leest het precies
  zo. Dus een patch mag dit dragen.
- **Het spook kan draaien**: `setGhosts` in `web/js/plan-overlay.js` verschuift nu alleen;
  het krijgt een draai erbij, met dezelfde `housePlacement` als het echte gebouw zodat het spook
  staat waar het gebouw komt te staan (inclusief het kleine scheve van de gebouwen rond het plein).

## Stand van zaken

Gebouwd op 25 september 2026: de ops in `lib/plan.mjs` (`opCivic`, `opCommons`, `civicSite`,
`civicSites`), de kaart in de survey en de dry run, en de planner in de browser (selecteren,
slepen, `R`/Turn, Land voor de stad, rode spoken voor geweigerde stappen). Uitgeprobeerd op een
kopie van het echte eiland: de herberg draaien en naar de westkant van het plein zetten, en de
stad een supercel grond geven, allebei toegepast en daarna stabiel.

## Wat getest wordt (`tests/plan-civic.test.mjs`)

- De herberg naar vrije grond van de stad: alleen de herberg staat anders (`otherMoved` leeg),
  zijn pad komt vanaf de nieuwe deur, en de scan erna schrijft hetzelfde bestand.
- Draaien op zijn plek: dezelfde `gx, gz`, een andere `rot`, een pad naar de nieuwe deur.
- Het stadhuis verplaatsen neemt de brievenbus mee.
- Geweigerd: op een ander gebouw, half op een vrij kavel, buiten de grond van de stad, op het
  plein, een gebouw dat niet mag (de put) of er niet is (het kasteel bij veertig settlers).
  Een deur die het plein niet haalt wordt ook geweigerd (`stranded` met het gebouw erbij), maar
  daar is nog geen test voor: op de testeilanden vond ik geen plek waar dat gebeurt.
- Een kavel dat al over de stoep van een buur valt, mag nog steeds op zijn plek draaien.
- Grond toevoegen aan de stad, en daarna een gebouw erop zetten.

## Later

- De losse dingen op het plein (put, standbeeld, tafels, borden).
- Ruilen in één handeling, als twee stappen in de praktijk te omslachtig blijkt.
- Grond van de stad weer teruggeven.
