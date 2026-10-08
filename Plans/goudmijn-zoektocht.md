# Zoektocht in de goudmijn

**🚧 Status: plan van 8 oktober 2026; keuzes gemaakt, eerste versie gebouwd.** Een quest-lijn naast het
piratenverhaal: met E de goudmijn van je eigen eiland in, op elke verdieping een veld van 25 x 25
graafplekken, ergens daaronder een trap naar de volgende verdieping, en op de onderste een
artefact. Graven kost graaf-stamina, die je bijvult met een drankje uit de taverne; dat drankje
betaal je met de opbrengst van de zaadkraam of van de edelstenen die je onderweg opgraaft en bij de
goudsmid verkoopt.

## Wat de keeper vroeg (letterlijk)

> Vul de quest lijst aan. Zoektocht in de goudmijn. Je kan in de goudmijn op je eiland. Betreden
> met E. Wanneer je binnen bent ligt daar een raster van graafpunten van bij 25x25 cellen. Op elke
> cel kan je graven. Sommige plekken zijn bedekt met een steen, hier kan je niet graven. Op één van
> de cellen zit een trap verstopt. Als je de trap gebruikt dan ga je een verdieping lager. Dit moet
> een x aantal verdiepingen gebeuren, maar er moet een dig stamina komen die leegloopt tijdens
> graven. Deze kun je vullen met een potion, maar die moet gekocht worden bij de tavern. Het geld
> voor de potion kun je verdienen met de seed stall of met de edelstenen die je tegenkomt tijdens
> graven in de goudmijn. Deze kun je dan weer verkopen bij de goudsmit. Op de onderste verdieping
> ligt een artifact. Wat je met de artifact kan doen weet ik nog niet. Verzin wat.

En daarna: *"de goudmijn quest kan parallel aan de andere quest gedaan worden"* - geen hoofdstuk
achter de Kraken, maar een tweede lijn die vanaf het begin open staat.

## Wat er al is

- **Quests** (`shared/quests.mjs`): één verhaal (`ONCE`, in volgorde) plus herhaalbare quests die
  altijd meetellen (`REPEATS`). De staat is `{ v, done, step, repeats }` in `promptholm.quests`;
  `parseQuestState` knipt `done` af tot een ononderbroken rij van het verhaal. Eén `step`, dus één
  actieve quest. Gevers: de piraat en de crew (`businessWith`, `giverOf`, `pirate.js
  giverSpeech`).
- **Kamers** (`web/js/interior.js`, `ROOMS`): een eigen scène met eigen walk mode; `def` levert
  `parts`, `blockers`, `seats`, `talkers`, `exits`, `surfaces`, `areas`, `lights` (een vast aantal:
  het lichtaantal zit in de programmasleutel), `spawn`, `doorway`. Deur via `roomDoors` in main.js
  (`kind: 'tavern'` → `enterInterior`). `onOrder(room, 'beer')` bij de eerste bestelling aan een
  kruk; dat is de `drank`-stap van de Kraken.
- **De mijn en de goudsmid** zijn al civics (`civic:goldmine`, `civic:goldsmith`). E bij de mijn
  geeft nu een toast (`mineWords`), E bij de goudsmid ook (`smithWords`).
- **Graven** bestaat: `walk.dig(seconds)` / `cancelDig`, de rig speelt `dig(on, side)` met de schep
  (`SHOVEL`, de eerste unlock van de piraat), `onDigDone(x, z, …)`.
- **Geld** is de portemonnee in `data/garden.json` (`lib/garden.mjs`, `/api/garden`, keeper-only):
  `purse` (start 15), zaad 2–35, oogst verkoopt voor 2–90 per stuk.
- **Stamina** (`web/js/stamina.js`): twee pools (lijf, boot), puur, met `stepPool`. **Balken**
  (`web/js/vitals.js`): gezondheid, stamina, lucht, bier.

## Ontwerp

### 1. Een tweede lijn in de quests (`line`)

Een quest krijgt `line` (default `'story'`). Per lijn één actieve quest; de mijnlijn is `'mine'`.
De staat krijgt naast `step` (die van het verhaal blijft) `lines: { mine: <step> }`; `done` houdt
de afgeronde ids van élke lijn. `parseQuestState` repareert per lijn (de ononderbroken rij geldt
binnen een lijn). `advance` laat een event elke lijn proberen - het verhaal, elke andere lijn, en de
herhaalbare - zodat "parallel" letterlijk is. `QUEST_STATE_V` blijft 1: een oudere pagina kent de
mijn-ids niet, slaat ze over en schrijft `lines` niet terug (dan is je mijnvoortgang in die browser
weg - per browser, en alleen bij een downgrade; geen ramp). `activeStep`/`businessWith` blijven het
verhaal beantwoorden; er komen `activeSteps(state)` (één per lijn) en `businessWith(state, who)`
-achtige vragen per gever. Het quest-log toont beide actieve quests.

Nieuwe events: `entered { where: 'goldmine' }`, `descended { floor }` (met `least`), `found
{ kind: 'artifact' }`, `sold { what: 'gems' }`, `bought { what: 'potion' }`. `dug { kind: 'gem' }`
voor een edelsteen.

**De gever is de goudsmid** - hij koopt de stenen, de mijn is zijn erts, hij heeft er dus belang
bij. E bij de goudsmid opent hetzelfde venster als de piraat (`createQuestGiver`) met daaronder
"Sell gems". Voorstel voor de lijn (`line: 'mine'`):

1. **Into the Mine** - praat met de goudsmid (krijgt de schep als je die nog niet hebt: `grant:
   unlock [SHOVEL]`), ga de mijn in (`entered`), graaf een edelsteen op (`dug gem`), verkoop hem
   bij de goudsmid (`sold`). Beloning: een kleur (`miner's ochre`).
2. **Deeper Still** - daal af tot verdieping 3 (`descended least 3`), koop een drankje in de
   taverne (`bought potion`), terug bij de goudsmid. Beloning: een hoed/kleur.
3. **The Heart of the Mountain** - bereik de onderste verdieping en neem het artefact (`found
   artifact`), breng het bij de goudsmid. Beloning: het artefact (zie 6).
4. Daarna een herhaalbare **Gems of the Day**? Niet nodig: de mijn zelf is herhaalbaar (nieuwe
   mijn per dag), en de stenen betalen.

### 2. De mijn als kamer, gegenereerd

`ROOMS.goldmine` in interior.js, `buildGoldMine({ FLOOR, rect, floor, seed })` in een eigen
`web/js/mine-room.js`, uit primitieven en instanced meshes, **geen bake per verdieping**: een grot
(rotswanden, stutbalken, lantaarns - vier lichten, vast), en in het midden het veld.

- **Raster**: 25 x 25 cellen van 0,5 eenheid (12,5 x 12,5; de taverne is 6 x 5), rond het veld een
  rand van 1,5 om te lopen en voor de camera. Elke cel is een hoopje grond (onaangeroerd), een kuil
  (gegraven) of een **steen** (een blocker, ongeveer 20 %). Drie InstancedMeshes (hoopjes, kuilen,
  stenen) plus edelstenen en de trap: zo'n zes draw calls voor 625 cellen.
- **De trap** zit onder één niet-steen cel, nooit aan de rand van de spawn. Opgegraven wordt het een
  luik met een ladder; E erop = een verdieping lager (fade, nieuwe verdieping opgebouwd - de kamer
  wordt opnieuw gezaaid, niet opnieuw gemaakt: de meshes blijven, alleen de instance-matrices
  veranderen).
- **Hints**, anders is 625 plekken blind graven: elke gegraven kuil kleurt van koude grijze tot
  warme rode aarde naar de afstand tot de trap (warm/koud). Alternatief: minesweeper-cijfers. Zie
  vraag 2.
- **Verdiepingen**: vijf (aanbevolen). Dieper = meer stenen, betere edelstenen, iets donkerder.
- **Zaaien**: deterministisch uit `hash32('mine:<islandSeed>:<worldDay>:<floor>')` (shared/rng) -
  een nieuwe mijn per wereld-dag (`worldTime`, niet de klok van deze machine). Bewaard in
  localStorage `promptholm.mine`: `{ day, floor, deepest, dug: { <floor>: [cellnummers] }, gems }`.
  Weggaan en terugkomen op dezelfde dag: je komt terug op de verdieping waar je was, met wat je
  gegraven had; een nieuwe dag is een nieuwe mijn vanaf verdieping 1. Een ladder bij de spawn van
  elke verdieping > 1 brengt je in één keer naar buiten (E), verdieping 1 heeft de deur.
- **Deur**: E bij `civic:goldmine` → `enterInterior('goldmine', …)` (`roomDoors`, alleen op ons
  eigen eiland - niet bij een buur, niet op de telefoon/het web: er is geen portemonnee). De toast
  over de week blijft als prompt-tekst.
- **Graven**: dezelfde `walk.dig` en schep, korter (1,2 s). E op een cel vóór je: hoopje → kuil
  (soms een edelsteen, soms de trap); E op een steen: "rock - too hard to dig". Geen schep → "You
  need a shovel; the goldsmith lends one."

### 3. Graaf-stamina

Een **eigen pool** `DIG` naast lijf en boot (stamina.js), een vijfde balk (⛏️, oranje) die alleen
in de mijn zichtbaar is. Elke graafbeurt kost `1/30` (30 graafbeurten per volle balk). Leeg: graven
weigert ("too tired to dig - a potion would help"), lopen en de trap niet. Hij vult **niet** vanzelf
binnen; hij staat weer vol bij een nieuwe wereld-dag (aanbevolen, vraag 3). Een drankje vult hem
helemaal. Bewaard in `promptholm.mine` (`dig`, `day`), zodat herladen geen gratis balk is.

### 4. Economie - één portemonnee

De portemonnee van `garden.json` (keeper-only, loopback - valsspelen is je eigen eiland). Erbij in
`lib/garden.mjs`: `gems: { quartz, amethyst, ruby, diamond }` en `potions`, en drie ops op
`/api/garden`:

- `find { gem }` - een edelsteen erbij (de pagina zaait wat er ligt; de server telt alleen, met een
  plafond per dag tegen een kapotte lus);
- `sellGems` - bij de goudsmid, vaste prijzen (voorstel: kwarts 3, amethist 8, robijn 20, diamant
  50; diamant alleen op de onderste twee verdiepingen);
- `buyPotion` - bij de **dorpstaverne** (aanbevolen: die staat altijd op je eiland, de Kraken pas
  bij 52 inwoners), 12 munten. Bij de bar: zit, en de derde E-keuze aan de kruk wordt "buy a stamina
  potion (12)" - of een eigen interactable "the barman" bij de toog. `onOrder(room, 'potion')`.

Ter vergelijking: een volle balk (30 graafbeurten) levert gemiddeld ~1,5 steen ≈ 10–20 munten op
de diepere verdiepingen; zaaien loont ongeveer evenveel per uur. Een drankje is dus een afweging,
geen formaliteit. Getallen staan op één plek (`shared/mine.mjs`) en zijn daar bij te stellen.

### 5. Wat erbij komt, en wat het kost

- `shared/mine.mjs` (puur, getest): zaaien van een verdieping, hints, prijzen, `DIG` - draait in Node.
- `web/js/mine-room.js` (de kamer), `web/js/mine.js` (de regels, DOM-vrij, de pool, de opslag -
  treasure.js' patroon: alles komt binnen als functies, testbaar met een nep-walker).
- Geen Blender in fase 1: primitieven en de bestaande `flora_rock`-varianten. Edelstenen, luik en
  drankje als kleine primitieven. Later eventueel een `minekit`-bake.
- **Niets over de lijn, niets in een bundle, niets in layout.json** → **patch**. `garden.json`
  krijgt velden die een oudere `readGarden` negeert (en bij een schrijfactie weggooit: je stenen
  zijn dan weg - acceptabel, één file per keeper; of we laten `save` onbekende velden doorgeven).
- Prestatie: alleen binnen (eigen scène), ~6 draw calls voor het veld, 4 lichten, geen schaduw.

### 6. Het artefact - voorstellen

1. **De mijnwerkerslamp** (aanbevolen): een helm met lamp, een nieuwe live `head`-piece. In de mijn
   ziet je kuil-hint verder (de hints van de buurcellen kleuren al mee), en 's nachts op het eiland
   draag je licht. Geeft de quest een tastbare beloning die je ziet en gebruikt.
2. **Het Hart van de Berg** in de goudsmidse: een gloeiende steen op een sokkel buiten de winkel
   (een één-cel civic zoals het schatbeeld, eiland-breed via een eigen bestandje). Een trofee die
   bezoekers zien; elke volgende vondst laat hem feller branden.
3. **Een sleutel naar dieper**: het artefact opent een zesde verdieping met een ondergrondse rivier
   - de volgende quest, nog niet gebouwd.
4. **Gouden schep**: graven kost de helft van de stamina. Puur een spelvoordeel.

## Besluiten van de keeper (8 oktober 2026)

| Vraag | Besluit |
|---|---|
| Artefact | **Een sleutel**, "nader te bepalen waarvoor": `mine-key` (shared/treasure.mjs `MINE_KEY`, een *planned* stuk in shared/equipment.mjs). De derde mijnquest geeft hem; een volgende quest vraagt unlocks.js ernaar. Geen zesde verdieping. |
| Hints | **Geen.** Blind graven, een kleiner veld: **7 x 7** (CELL 0,6). Stamina op en geen drankje = pech. De mijn uit = opnieuw bovenaan beginnen; een verdieping is de hele wereld-dag hetzelfde, dus je onthoudt waar de trap zat. |
| Stamina | **Langzaam + drankje**: buiten de mijn vol in `REFILL_S` (600 s), binnen alleen met een drankje. 30 graafbeurten per balk. |
| Verdiepingen | **7.** |

De mijnlijn loopt **parallel** aan het verhaal (de keeper): vanaf het begin open, naast de piraat.

## Wat er gebouwd is

- `shared/quests.mjs`: `line` per quest, `state.lines` per lijn, `activeSteps`, `hasBusiness`, `GIVERS`;
  drie mijnquests van de goudsmid (`into-the-mine`, `deeper-still`, `heart-of-the-mountain`) en de events
  `entered`, `descended`, `found`, `sold`, `bought`.
- `shared/mine.mjs`: het zaaien (`floorOf`), de getallen (stenen, prijzen, balk, drankje).
- `lib/garden.mjs`: `gems`, `potions` en `findGem` / `sellGems` / `buyPotion` / `drinkPotion` op `/api/garden`.
- `web/js/mine.js` (de regels), `web/js/mine-room.js` (de kamer, `ROOMS.goldmine`), de toog van de
  dorpstaverne (`def.counter`), de goudsmid als gever en koper, een vijfde balk (⛏️) in `vitals.js`.
- Op de zee heet de kamer `<eiland>:goldmine`: elke mijn is van zijn eigen eiland.

## Nog open

- Een deur voor de sleutel.
- De grot is primitieven; een `minekit`-bake zou mooier zijn.
- Een tweede blik op de getallen na echt spelen (balk, stenen, prijs van het drankje). Gespeeld op 8
  oktober 2026, zie [speeltest-quests.md](speeltest-quests.md): ruim 100 graafbeurten voor vier verdiepingen,
  ≈ 0,35 munt per beurt tegen 0,4 aan drankje. Daar ook de besluiten van de keeper, gebouwd: de graafplekken zijn
  onzichtbaar (één effen bed losse aarde over het veld) en de camera kijkt van boven (`camera.pitch`); 7 x 7 en
  de ruimte blijven.
