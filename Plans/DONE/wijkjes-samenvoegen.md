# Wijkjes samenvoegen, en niet meer uit elkaar laten vallen

**✅ Status: gebouwd op 28 september 2026, en op main** (`tests/plan-merge.test.mjs`); op het live
eiland staat geen project meer in meer dan één stuk. Open blijft één ontwerpkeuze voor Tiemen: het
eerste project bij het plein wordt ingesloten (zie *Nog open*).

## Aanleiding

Tiemen ziet hier en daar huisjes die bij een project horen maar niet in hetzelfde wijkje
staan. Gemeten op het live eiland (28 september 2026):

| Project | Hoe het verspreid staat |
|---|---|
| Sybolt_PLC (22) | drie stukken land (4, 14 en 7 super-cellen: 3, 10 en 6 huizen) en 3 huizen op de gemeentegrond van het dorp - twee daarvan van vandaag |
| Settlers (46) | een annex van 2 cellen met 2 huizen, 4 super-cellen van het hoofdwijkje |
| TradingBot_2026_2 (13) | een losse cel met 1 huis, 2 super-cellen naast de rest |
| AgentVillage_web (10) | 1 huis in een annex 15 super-cellen verderop |
| AgentVillage (12) | 1 huis (van vandaag) op de gemeentegrond |

## Waarom het gebeurt

Drie oorzaken, alle drie in `lib/layout.mjs` of de planner:

1. **Een wijkje dat klem zit sticht een annex** (`ensureParcel`, `MAX_LOBES = 3`,
   `ANNEX_REACH = 8`). Zo'n annex is een tweede stuk land met een eigen weg, tot acht
   super-cellen verderop. Het was bedoeld om een ingesloten wijkje niet te laten uitdijen;
   het resultaat is een project in twee of drie stukken.
2. **Alleen het laatste stuk groeit** (`const last = rec.lobes[rec.lobes.length - 1]`). Na
   een annex krijgt het oorspronkelijke wijkje nooit meer land, dus alles wat erbij komt gaat
   naar de annex - Settlers: stuk 0 is 2 cellen gebleven, de annex werd 46.
3. **Wie geen plek vindt, gaat naar de gemeentegrond.** Een wijkje op `MAX_LOBES` groeit niet
   meer, dus Sybolt's nieuwe huizen van vandaag staan rond het plein. En een wijkje dat
   genoeg cellen *telt* maar waar een schuurtje, weg of rivieroever het blok bezet, vraagt
   geen land bij (`ensureParcel(pop + 1)` groeit alleen als het aantal cellen tekortschiet)
   - dat huis gaat ook naar de gemeentegrond.

Daarnaast verplaatste de planner stukken los van elkaar: klikken kiest één stuk (`lobe`),
niet het hele project, dus een sleep liet de annex achter (TradingBot en AgentVillage_web
tussen de snapshots van 26 september).

## Besluiten

| Vraag | Besluit | Waarom |
|---|---|---|
| Samenvoegen van wat er nu staat | Een nieuwe planner-op **`merge`**: `{ op: 'merge', district, lobe }` - `lobe` is het stuk dat blijft. Via `POST /api/plan` zoals alles: droogtest, snapshot, undo. | Een huis verhuist nooit vanzelf; de planner is de enige deur waardoor het bewust mag. Alle vangnetten gelden: `otherMoved` leeg, niemand zonder weg, de volgende scan byte-identiek. |
| Wat verhuist er? | Elk huis van het project (volgens het model) dat niet op het blijvende stuk staat - annex, gemeentegrond of andermans land - met zijn schuurtjes en voorpad. En elk huis dat op een stuk staat dat opgeheven wordt, ook als het van een ander project is; dat gaat naar zijn eigen wijkje. | Het land van de annex gaat terug naar het platteland, dus er mag niets op blijven staan. |
| Waar komen ze te staan? | De op tilt ze op, geeft het land van de andere stukken terug, laat het blijvende stuk groeien tot er plek is voor iedereen en laat `placeAll` ze neerzetten - precies zoals bij `rehome`. | Geen tweede plaatsingsregel. |
| Als het blijvende stuk klem zit? | De op weigert, in woorden: hoeveel plek er is en dat het wijkje eerst verplaatst moet worden (in hetzelfde plan) of land moet krijgen. En na het plaatsen controleert `runPlan` dat ieder opgetild huis van het project echt op het stuk staat (`diff.scattered`). | Een samenvoeging die half lukt is een nieuwe annex. |
| Lobe-nummers | Het blijvende stuk wordt `lobes[0]`; de weg van dat stuk heet daarna `road:<district>:0` (pad en bruggen hernoemd), de wegen van de opgeheven stukken gaan weg. Het kantoor staat bij de poort van stuk 0 en wordt opnieuw gezet als stuk 0 een ander stuk wordt. | `pruneUnreachable` en het kantoor lezen het stuk uit het nummer in de weg-id; een weg `road:x:1` bij een wijkje met één stuk zou nooit meer opnieuw gelegd worden. |
| De kade | Geweigerd: de kade volgt de kustlijn en mag daar in stukken liggen. | Een kade-annex is de volgende strook kade, geen verspreid project. |
| Voorkomen: annexen | Een project dat al land heeft sticht **geen annex meer**. Zit het stuk klem, dan groeit het ruimer: eerst zonder de straalgrens (`RCAP`), dan tot tegen de buren aan (gordel 0, nooit óp hun land). Pas als ook dat niet kan, is er echt geen plek (zie hieronder). | Een wijkje dat tegen de buren aan groeit of een L-vorm krijgt is minder erg dan een project in drie stukken. Alleen voor wat nodig is: de tuinen (`parcelTarget`) groeien alleen op de gewone manier. |
| Voorkomen: alleen het laatste stuk | Een ouder project met meerdere stukken probeert elk stuk, het laatste eerst. | Zodat een eiland dat nog niet samengevoegd is ook niet verder uit elkaar groeit. |
| Voorkomen: geteld maar bezet | Vindt een huis geen blok in zijn eigen land, dan vraagt het land voor één huis meer dan er cellen zijn, niet voor één meer dan de bevolking. Geeft dat een cel met een weg erdoor, dan vraagt het nog één super-cel waar een huis *op kan* (`roomy` in `growLobe`: een filter per trede, geen voorkeur). Lukt ook dat niet, dan telt het wijkje als krap (`rec.guest`) en wacht het huis op de ring als het aan zee ligt. | Anders gaat het naar de gemeentegrond terwijl er naast het wijkje nog ruimte is. Een voorkeur was niet genoeg: elke trede telt cellen, dus de eerste was al tevreden met een cel vol weg en de ruimere treden, waar de open grond lag, kwamen nooit aan de beurt. |
| Voorkomen: strand | De laatste trede van `growLobe` neemt ook strand-super-cellen (zand en gras, niet helemaal bebouwbaar). Het huis moet nog steeds op bebouwbare grond (`freeBlock(…, false)`). | Vaak is een meeroever het enige wat er naast een wijkje bij het plein over is (seed 7). |
| Wachten op een ring | Een huis zonder plek wacht één ring als het eiland kan groeien en het wijkje aan zee ligt (`landWouldHelp`); een ingesloten wijkje landinwaarts wacht niet. | Zonder annexen kan nieuwe kust alleen helpen als het wijkje er zelf naartoe kan groeien. |
| En als er echt geen plek is? | Dan blijft het de gemeentegrond, zoals nu - maar alleen voor een wijkje dat helemaal ingesloten is door water, steilte, zones en andermans land, op een eiland dat niet meer kan groeien. De planner laat dat project dan zien als verspreid met de knop Merge. | Een huis automatisch verhuizen, of een heel wijkje, breekt "een huis verhuist nooit vanzelf". |
| De planner | Klikken kiest het hele project (alle stukken), zodat een sleep het niet meer uit elkaar trekt. Staat een gekozen project verspreid, dan verschijnt **Merge**: één `merge`-op per verspreid project, met het stuk met de meeste huizen als het blijvende. Na een merge in het concept kan dat project in hetzelfde concept niet meer gesleept worden (eerst toepassen); ervóór wel, zodat "verplaats en voeg samen" één plan is. | De nummers van de stukken veranderen door een merge; een sleep erna zou het verkeerde stuk noemen. |
| Van project gewisseld | Niet automatisch. Een huis waarvan het project later anders werd gevouwen (drie Outlands-huizen staan op Sybolt's land) blijft staan; een `merge` van dat project haalt het wel op. | Weer: een huis verhuist nooit vanzelf. |
| Versiepoort? | Geen. Alleen nieuwe plots en de keeper's plan veranderen iets; een scan van een eiland waar niemand bijkomt blijft byte-identiek. | |

## Stand van zaken (28 september 2026)

Gebouwd: `merge`-op, geen annexen meer, ruimer groeien (`growLobe`, ook op strand), een
huis vraagt land waar het op kan staan (`roomy`, in plaats van de vier blinde pogingen van
`ROOM_TRIES`), het kantoor zoekt tot `OFFICE_REACH` wegvakken van de
poort, en in de planner kiest een klik het hele project, met een knop Merge / Merge all.

Gemeten op een kopie van het live eiland:
- Een gewone scan met de nieuwe code verandert niets (byte-identiek, niets erbij).
- De vijf samenvoegingen (TradingBot lobe 1, Settlers lobe 1, Sybolt_PLC lobe 1,
  AgentVillage_web lobe 0, AgentVillage lobe 0) slagen samen in één plan: `otherMoved` 0,
  `stranded` 0, 23 plots verplaatst (17 huizen, schuurtjes, 2 kantoren), de scan erna
  byte-identiek. Daarna staan alleen de drie Outlands-huizen (Sybolt-werk gestart vanuit
  `C:\Development\SYBOLT`) nog op Sybolt's land - bewust zo gelaten.

Gemeten op synthetische dorpen (oud = main, nieuw = deze branch):
- 128, vast, 12 projecten tot 240: oud 8-9 projecten in stukken en 26-30 huizen op het plein;
  nieuw 0 in stukken, 1-18 op het plein (een vol eiland dat niet mag groeien).
- Ongelijk (46, 22, 13, 12, 10, 5, 3, 1...), vijf seeds: oud 7-13 in stukken en 14-34 op het
  plein; nieuw 0 in stukken en 1-15 op het plein, met zo'n honderd huizen méér geplaatst.
- Let op: de "grows"-regels van het eerste meetscript deelden één `steps`-array tussen de oude
  en de nieuwe run, dus die cijfers tellen niet; de ongelijke meting had dat probleem niet.

Geprobeerd en weer verwijderd: een ingesloten wijkje een lege tuin van de buren laten
overnemen (`borrowGarden`). Geen verschil gemeten - de grenscellen van de buren zijn bijna
altijd zelf bebouwd - en het was de enige plek waar een scan land van iemand afpakt.

Gemeten, klein gesticht (32 op 256), stappen van 12 tot 240, huizen op de gemeentegrond:

| seed | vóór strand + `roomy` | nu |
|---|---|---|
| 7 | 13 | 0 |
| 4 | - | 0 |
| 11 | 17 | 17 |
| 2 | - | 24 |
| 3 | 31 | 31 |

Nergens een project in stukken, en overal geldt nu: geen huis gaat naar de gemeentegrond terwijl
er op of naast het land van zijn project een vrij 3x3-blok is (`tests/plan-merge.test.mjs`,
seed 3). Wat overblijft is telkens hetzelfde geval.

In de browser nagekeken (28 september 2026), op een synthetisch eiland van vijf projecten met één
Harbour-huis met de hand op de gemeentegrond gezet, via een echte `serve.mjs` en Playwright: zonder
selectie staat er **Merge all (1)**; een klik op een huis kiest het hele project ("1 hamlet:
Harbour", knop **Merge**); het grootboek zegt "Merge Harbour: every house onto one piece of land"
met de notitie van de droogtest en "The island agrees"; Delete haalt de merge-op weer weg; Apply
zet het huis terug op zijn eigen cel in stuk 0, verandert geen andere plot, schrijft de
`before-plan`-snapshot, en de scan erna is byte-identiek. Geen fouten in de console.

Nog open:
- **Het eerste project bij het plein wordt ingesloten.** Op een klein gesticht eiland liggen de
  eerste wijkjes tegen het dorp aan. Hun buren groeien met de gordel-0-trede van `growLobe` tot
  tegen hen aan, vaak voordat dat eerste wijkje het land zelf nodig heeft (seed 3: tussen 36 en 60
  settlers pakken proj:2, 7 en 9 de laatste vrije cellen naast proj:1, dat toen drie huizen had).
  Daarna staat elk nieuw huis van dat project op de gemeentegrond, 1 tot 9 super-cellen van huis.
  Zonder gordel-0 is het overal slechter (seed 1337: 26 in plaats van 1), dus die blijft. Een
  oplossing vraagt een keuze die Tiemen moet maken: wie krijgt een omstreden cel, het wijkje dat
  hem nu vraagt of het wijkje dat er later om zal vragen? Mogelijke richtingen: een gordel-0-cel
  niet geven als hij de laatste vrije buur van een ander wijkje is; of de planner zo'n project
  laten verhuizen en dan samenvoegen (dat kan nu al, met de hand, in één plan).
- Op het live eiland toepassen: branch in main, eiland herstarten, Merge all in de planner.

## Bestanden

- `lib/layout.mjs` - `growParcel` met straal, gordel en `roomy` als optie, `growLobe` (gewoon,
  dan ruimer, dan op strand), `ensureParcel` zonder annex voor projecten, `landWouldHelp` op zee-ligging, de
  huizenlus vraagt land voor één huis meer dan er cellen zijn.
- `lib/plan.mjs` - `parsePlan` + `opMerge`, `diff.scattered` in `runPlan`.
- `web/js/plan-mode.js`, `web/js/plan-panel.js` - klik kiest het hele project, knop Merge.
- `tests/plan-merge.test.mjs`, en een test dat een ingesloten wijkje geen annex sticht.
