# De goudmijn en de goudsmid: het weeklimiet, en elke vijf uur een vracht goud

**✅ Status: gebouwd op 28 september 2026, op branch `main-bh81q4`.** Nog niet op main en niet op
het eiland: samenvoegen en het eiland herstarten is voor als Tiemen terug is.

## Stand van zaken (28 september)

Gebouwd: het weekgetal (`weekResetOf`, `currentUsage`, `mineOf`, `mine` op `/api/gold`), de
plaatsing (`goldsmithSites`, `mineSites`, `standAt` in `lib/layout.mjs`, de records in
`scan.mjs`, beide in `MOVABLE_CIVICS`), `roadBetween` in `shared/roads.mjs`, beide modellen,
`web/js/goldmine.js` / `goldsmith.js` / `goldrun.js` en de bedrading in `main.js`, `?goldrun`,
beide op `/demo`, en `tests/goldmine.test.mjs`. De hele suite is groen.

Wat er in de cloud nog bij kwam:

- **Een kavel pas nemen als zijn weg het plein haalt.** Op seed 7 (128) stond de mijn aan de
  overkant van de rivier: de eerste scan legde geen weg (een civic-weg bouwt geen brug), de
  tweede wel, over de brug die een gehucht intussen had gelegd - en dan is de tweede scan geen
  no-op. `standAt` zet nu elke kandidaat op het rooster, probeert zijn weg in alle vier de
  deurrichtingen en geeft hem terug als die het plein niet haalt, of als de kavel een stuk land
  afsnijdt (`reachCount`): op het stichtingseiland (32 op 64) sloot de goudsmid anders de strook
  af waar een havenhelling doorheen moest. Staat er op het rooster niets meer vrij, dan een losse
  drie bij drie, het dichtst bij het plein.
- **De planner en grond van het dorp die los ligt.** De mijn claimt zijn grond voor het dorp, en
  die ligt buiten de commons; de `commons`-op weigerde daarna elke uitbreiding ("the town's
  ground would come apart"). Nu weigert hij alleen grond die er een los stuk bij maakt (`pieces`
  in `lib/plan.mjs`) - de werf en een kasteel konden dat al eerder veroorzaken.
- **De vracht kreeg het getal niet.** `/api/gold` antwoordt meestal voordat het terrein er is;
  dan was er nog geen vracht om het te vertellen, en het eerste woord voor de vracht was pas het
  volgende `event: gold` - een omgeslagen venster werd zo voor een eerste meting aangezien en
  meteen getoond, en `?goldrun` deed niets. `goldRunOf` geeft het getal nu mee zodra hij gemaakt
  wordt.
- **In de browser bekeken**, overdag en om 21 uur, op het eiland zelf: de mijnwerker duwt de
  volle kar over de weg, de goudsmid wacht bij de werkbank, rijdt de kruiwagen naar de kuil en
  de kuil telt op (20 → 78 → 100), daarna gaan ze allebei terug. Beide gebouwen van vier kanten.
  De achterkant van de mijn is nog steeds een steile rotswand met een rechte voet; dat is het
  model, en dat vraagt Blender (hier niet beschikbaar).

## Wat Tiemen vroeg

> We moeten ook een goudmijn hebben die elke 5 uur weer nieuw goud via de goudsmit naar de
> goudstapel brengt. De goudmijn moet de weekly usage weergeven.

En daarna: "check ook vanaf meerdere kanten dat het er goed uitziet".

Drie dingen dus, naast de goudkuil van [goudkuil.md](goudkuil.md): (1) het weekgetal, (2) een
mijn die het laat zien en een goudsmid, (3) de vracht: als het vijfuursvenster omslaat en de
kuil weer vol mag, komt dat goud uit de mijn, via de goudsmid, in de kuil terecht in plaats van
dat de stapel in één frame terug is.

## 1. Het weekgetal

| Vraag | Besluit | Waarom |
|---|---|---|
| Bron: de statusLine | `rate_limits.seven_day` staat al in `data/usage.json` als `sevenDay: { used, resetsAt }` (`readingOf` schreef het vanaf het begin mee). Exact, met de echte reset. | Het was "de voor de hand liggende volgende vraag" in goudkuil.md, en die vraag is nu gesteld. |
| Bron: de desktop-app | `sd` uit het laatste sample van `plan-usage-history.json`, dezelfde `org` als het vijfuursgetal. | Op deze machine is dat de enige bron: er is geen `usage.json`, alles is `claude-desktop`. |
| De weekreset van de app | Er staat geen reset in het bestand, dus **geschat**: de laatste keer dat `sd` zakte (naar de helft of minder, of naar 5 of minder), plus zeven dagen, gerekend vanaf het sample ná de daling. | Gemeten op een maand historie van Tiemen: de week reset op een vast moment, elke donderdag tussen 08:57 en 09:12 UTC (10, 17 en 24 september). Het sample na de daling ligt dus hooguit een kwartier na de echte reset, en zeven dagen later is een bovengrens, net als bij het vijfuursvenster: een mijn die een kwartier te laat vol is, is beter dan een die vol is terwijl de week nog op is. Een losse daling van een procent is geen reset (een oud, rollend venster zakte zo, begin september), vandaar de drempel. Geen daling in de historie: geen reset bekend, en de mijn zegt alleen het getal. |
| Twee bronnen | `currentUsage` houdt het vijfuursvenster van de jongste bron, zoals nu, en neemt het weekvenster van de jongste bron **die er een heeft**. | Een statusLine van een API-gebruiker heeft geen `seven_day`; dan hoeft de mijn niet leeg te staan omdat de app een kwartier eerder sampelde. |
| Wat het getal wordt | `shared/gold.mjs mineOf`: `ore = 100 − round(used)`, honderd klompen erts, één per procent van de week. Geen meting, of de reset voorbij: een volle mijn. | Hetzelfde contract als `goldOf`: een eiland zonder getal is geen kapot eiland. |
| Hoe het de pagina bereikt | Door dezelfde deur als de kuil: `/api/gold` en `event: gold` krijgen een veld `mine`. Keeper-only, nooit in `village.json` of de bundle. | Hoeveel iemand van zijn week heeft opgemaakt is net zo privé als zijn vijf uur. Eén poll, één event, één plek die beslist wie het ziet. |

## 2. De gebouwen

| Vraag | Besluit | Waarom |
|---|---|---|
| Welke | Twee nieuwe civics, `civic:goldmine` (`civicType: 'goldmine'`) en `civic:goldsmith` (`'goldsmith'`), elk op een 3×3-kavel met een deur, een weg (`path:<id>`) en grond van het dorp (`claimForTown`), zoals de ambachten. | Een 3×3 met een deur krijgt zijn weg, en dus een route voor wie het goud rijdt, gratis. |
| Vanaf wanneer | Vanaf de eerste scan, net als de kuil. Geen mijlpaal. | De limieten horen bij elke sessie. Een kuil die volloopt uit een mijn die er nog niet is, zou niet kloppen. |
| Waar de goudsmid staat | Zo dicht mogelijk bij de kuil: het vrije blok van het rooster van het dorp dat het dichtst bij de kuil ligt, niet op een kavel van het dorpsplan (`planCells`), op grond van het dorp of van niemand. | Het laatste stuk van de vracht, de kruiwagen met staven, is kort en loopt door het dorp. De straatkavels blijven voor de winkels, zoals de kuil ze ook liet liggen. |
| Waar de mijn staat | `mineSites`: net als de steengroeve (`quarrySite`) op de hoogste grond die vlak genoeg is voor een kavel, buiten het dorp (`TOWN_REACH`), maar binnen `MINE_REACH` van het plein. | Een mijn hoort in de heuvels, en wie van het plein kijkt ziet hem liggen. Zonder de afstand zou hij op een groot eiland een halve minuut lopen verderop staan, en dan ziet niemand de vracht aankomen. Op een vlak eiland staat hij op het hoogste stukje met zijn eigen rots. |
| Plakt het | Ja, zoals elke `civic:`-kavel: één keer geschreven, nooit meer verplaatst, de scan erna byte-identiek. Beide in `MOVABLE_CIVICS`, zodat de keeper ze met de planner kan verzetten. | Geen versiepoort: er verhuist niets, er komen twee kavels bij. |
| De mijn als model | `civic_goldmine` (Blender, `scripts/build-goldmine.py`): een rotsheuvel achter op de kavel met een gestutte stollengang naar voren (+Z), rails die eruit komen, een ertsbak van planken aan de voorkant, een lantaarn bij de ingang en een bordje met een houweel. De rots loopt onder de grond door, zodat hij op een helling nergens zweeft. Geen porch: een stoep om een rots is een sokkel onder een heuvel. | |
| Wat de mijn laat zien | Honderd klompen goudhoudend erts (`prop_goldore`, één `InstancedMesh`) op een hoop in de ertsbak, van boven af weggenomen: `count = ore`. | Precies de kuil, een week groot: één draw call, niets om opnieuw te bouwen. |
| De mijnkar | `prop_minecart`, een eigen asset: hij staat op de rails zolang er niets te rijden is en gaat met de mijnwerker mee. | Een kar die meerijdt kan geen deel van het samengevoegde gebouw zijn. |
| De goudsmid als model | `civic_goldsmith` (`scripts/build-goldsmith.py`): een smal werkhuis met een puntgevel naar voren, een etalage met een gouden uithangbord, en aan de zijkant een smeltoven met schoorsteen en een gietbank ervoor. De gloed in de ovenmond is een eigen onderdeel dat `buildings.js` uit de merge laat en `goldsmith.js` laat opvlammen als er gesmolten wordt, zoals het vuur van de smidse. | Het patroon van de smidse (Plans/smidse.md), geen nieuw mechanisme. |

## 3. De vracht

```
het venster slaat om  →  mijnwerker duwt de kar naar de goudsmid  →  storten
                      →  de goudsmid smelt en giet (de oven vlamt op)
                      →  kruiwagen met staven naar de kuil  →  de kuil telt op tot het nieuwe getal
                      →  allebei terug naar hun eigen plek
```

| Vraag | Besluit | Waarom |
|---|---|---|
| Wanneer | Als het aantal staven in de kuil **stijgt** met minstens 5, op ons eigen eiland. Stijgen kan alleen doordat een venster omslaat (een statusLine-reset, een verlopen schatting of een nieuw app-sample na de reset); dalen blijft direct, zoals nu. | Dat is "elke vijf uur", zonder een eigen klok die kan afwijken van wat de kuil zegt. Een kleine stijging is afronding, geen vracht. |
| Waar het draait | **Op de pagina**, in `web/js/goldrun.js`. De mijnwerker en de goudsmid zijn passieve figuren zoals de smid (de spelersrig), van niemand, niet op de lijn. | Het moment van de reset zegt iets over iemands gebruik, dus het gaat niet naar de zee; en de zee kent het getal ook niet (goudkuil.md). Een bezoeker ziet dus een volle mijn en een goudsmid aan zijn werkbank, en nooit een vracht. |
| De kuil tijdens de vracht | Blijft op het oude getal staan tot de kruiwagen er is, en telt dan in een paar seconden op tot het nieuwe. | Het goud wordt gebracht; als het er al lag voor de kruiwagen kwam, klopt het verhaal niet. |
| De route | Over de wegen: de wegcel het dichtst bij de voordeur, breedte-eerst over `roadCells` (zoals `roadRoute` op de zee), dan het laatste stukje naar de deur. | Een route over het gras door iemands tuin leest als een fout. |
| Hoe lang | Lopen op het tempo van de smid, maar elk stuk hooguit `LEG_MAX_S` (40 s); een langere route wordt sneller gelopen. Smelten 10 s. | Een vracht die langer duurt dan twee minuten ziet niemand afmaken. |
| Wat er niet is | Geen mijn, geen goudsmid, geen kuil of geen weg ertussen: de kuil vult meteen, zoals nu. | Een vracht die vastloopt is erger dan geen vracht. |
| Proberen | `?goldrun` speelt er een een paar seconden na het laden (de kuil van 20 naar zijn echte getal). | Wachten op een reset om te kijken of het werkt kan tot vijf uur duren. |
| 's Nachts | De vracht rijdt ook 's nachts (een reset om drie uur is er ook een). Zonder vracht staan ze overdag bij hun werk en zijn ze 's nachts binnen, zoals de smid. | |

## 4. Versie

Geen `SEA_V`, geen layout-poort, niets op de lijn. Wel twee nieuwe plots in `layout.json` die
een oudere pagina als een grijs blokje tekent: een minor, geen patch.

## 5. Van meerdere kanten bekeken

`npm run models:preview -- --around <asset>` rendert een model van vier kanten (voor, achter,
links, rechts) naast het gewone schuine beeld; zo zijn beide gebouwen nagekeken, daarna op
`/demo` en op een kopie van het eiland.

## Wat er nog openstaat

- **Een lege week.** Als de mijn leeg is (het weeklimiet op), kan het vijfuursvenster ook niet
  meer gebruikt worden, maar de kuil vult nog steeds tot honderd. Eerlijker zou zijn: de vracht
  brengt nooit meer dan er in de mijn zit. Niet gedaan, omdat het de betekenis van de kuil
  verandert (goudkuil.md: honderd staven is het vijfuursvenster, niets anders).
- **De weekreset zelf** heeft geen animatie; de ertsbak is gewoon weer vol.
- **Bezoekers** zien nooit een vracht, om dezelfde reden als de volle kuil.
