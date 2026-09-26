# Starter-eilanden: een zee die nooit leeg is

Wens (Martijn, 2026-09-26): de zee legt zelf een paar **kleine starter-eilandjes** neer, zonder
agents, alleen met een stadscentrum. Een nieuwe speler claimt er een, en dan wordt dat eilandje
vervangen door zijn eigen eiland.

Waarom: een telefoonspeler heeft geen eiland (`Plans/eiland-op-android.md`) en kan dus alleen
iets doen op het eiland van een ander. Staan er geen desktops aan, dan is de zee alleen de
vulkaan, met vijandige bewakers. Daardoor voelt de app kaal en doelloos. Starters zorgen dat er
altijd iets is om naartoe te varen: een plein, een kroeg met een kroegbaas, een stadhuis met een
burgemeester. Het is ook de ondergrond voor de klusjes en het logboek die daarna komen.

Stap 1 tot en met 6 gebouwd op 26 september 2026: `starterBundle(slot)` in
`lib/islandbundle.mjs`, `fleet.raiseStarters()` en het claimen in `publish` (`lib/fleet.mjs`),
`retireStarter()` / `topUpStarters()` in `lib/sea.mjs`, `reach` in de vlootregel voor de
ligplaats van de telefoon, en `CLAUDE.md`; getest in `tests/starter.test.mjs`. De open vragen
onderaan en de decoratie-eilandjes staan nog.

## Hoe het nu zit (gemeten in de sessie van 26-09)

- **De zee bouwt al één eigen eiland.** `fleet.raiseVolcano()` (`lib/fleet.mjs`) maakt de vulkaan
  uit `volcanoBundle()` (`lib/islandbundle.mjs`): deterministisch, `token: null`, `sea: true`,
  `live: true`, op `[0,0]`. `lib/sea.mjs` roept hem bij het opstarten aan
  (`crowds.join(fleet.raiseVolcano())`). Een herstart bouwt hem bit voor bit opnieuw, dus er
  gaat niets naar schijf.
- **`sea: true` betekent "van niemand".** `publish`, `claim` en `patch` weigeren zo'n eiland
  (409, "that island is the sea's own"). `expired` slaat het over en `theirs()` telt het niet mee
  voor `MAX_ISLANDS` (16).
- **Bewaarders komen uit de gebouwen.** `createCrowd` (`lib/crowd.mjs`, rond regel 248) zet een
  bewaarder bij elk gebouw waarvoor `keeperOf(spec)` iets teruggeeft (`KEEPERS` in
  `shared/palette.mjs`: tavern, townhall, goldpit, school, chapel), mits het een `plot` heeft. Er
  zijn geen settlers of agents voor nodig.
- **Ligplaatsen.** `nextOrigin(placed, half, gap)` (`shared/regions.mjs`) geeft het eerste vrije
  roosterpunt, ring voor ring, met een onderlinge afstand die volgt uit het **grootste** eiland.
  `placed` rekent met `reach` (de maat waarin een eiland mag groeien, `bundle.island.room`), niet
  met de huidige maat. Een eiland houdt zijn ligplaats (`had.origin`) zolang het past.
- **Maten.** Een nieuw eiland begint op `gridSize` 64 en mag groeien tot `maxGridSize` (standaard
  384, keuzes 256–512 in `MAX_GRID_CHOICES`, maximaal `GRID_MAX` 512). Zijn `reach` is dus meestal
  384/2.
- **De telefoon krijgt de volgende vrije ligplaats.** `standaloneHome()` in `web/js/main.js`
  zoekt met `nextOrigin` een plek in open water, met `OPEN_HOME` 64 als eigen maat, en rekent
  de rest van de vloot daarbij met `gridSize / 2` in plaats van `reach`.
- **Van een eiland verjaagd worden** kent al een pad terug naar de skiff: `evicted` met de
  boot-id, en `onEvicted` op de pagina zet je er meteen in (`lib/hostility.mjs`).
- **Grace.** Sinds 26-09 (branch `feature/eilanden-blijven-liggen`) blijft een eiland 3 dagen
  liggen nadat de islander wegvalt (`GRACE_MS`). Dat staat hier los van: de grace zorgt dat
  Tiemens eiland er 's nachts nog ligt, starters zorgen dat de zee nooit leeg is.

## Besluiten

| Vraag | Besluit | Waarom |
|---|---|---|
| Van wie is een starter? | **Van de zee**, zoals de vulkaan: gemaakt bij het opstarten, zonder token. Een eigen vlag `starter: true` naast `sea: true`. | Hetzelfde recept als de vulkaan, dus niets naar schijf. De tweede vlag is nodig omdat `sea: true` nu elke `publish` weigert, en een starter moet juist overgenomen kunnen worden. |
| Wat staat erop? | Een klein terrein, een plein met waterput en tafels, een **kroeg** en een **stadhuis**. Geen huizen, geen settlers, geen haven met eigen boot. | Kroeg en stadhuis geven via `KEEPERS` meteen een kroegbaas en een burgemeester. Meer is voor nu niet nodig, en minder gebouwen is lichter voor de telefoon. |
| Hoe gebouwd? | **Met de hand geplaatst**, zoals het wachthuis in `volcanoBundle()`: vaste plots rond het midden van het terrein. Niet door `lib/layout.mjs`. | Layout plant een dorp uit settlers en mijlpalen. Een starter heeft die niet, en de zee zou er een hele planner voor moeten importeren. |
| Seed en id | Per slot een vaste seed en id, afgeleid van het slotnummer (hex, want `ISLAND_ID` is `/^[a-f0-9]{8,64}$/`), bijvoorbeeld `5747...0001`. Een geclaimde starter komt niet terug onder hetzelfde id; een nieuwe krijgt het volgende slotnummer. | Een herstart bouwt dezelfde eilanden. Een oud id hergebruiken zou op de pagina een eiland laten "terugkomen" dat net vervangen is. |
| Hoeveel? | Altijd **3 vrije** starters. Na een claim zet de zee er een nieuwe bij, op de volgende vrije ligplaats. | Genoeg om iets te kiezen en te bezoeken, weinig genoeg om de ringen niet vol te zetten. Het getal wordt een constante (`STARTERS`). |
| Telt het mee voor `MAX_ISLANDS`? | **Ja.** Het is een eiland dat getekend wordt, en de limiet gaat over het tekenbudget. Een claim hergebruikt de plek. Bijvullen gebeurt alleen als er plaats is. | Anders kunnen 16 spelers plus 3 starters samen boven het budget komen. Een volle zee heeft dus minder of geen starters, en dat is goed: dan is hij ook niet leeg. |
| Welke maat houdt een starter vrij? | Zijn `reach` is **`maxGridSize` 384 / 2**, de standaard waarin een nieuw eiland mag groeien. Het eilandje zelf is klein (64). | Een nieuw eiland vraagt meestal om `reach` 192. Houdt de starter die plek vrij, dan past de claimer altijd op dezelfde ligplaats. |
| Wat is claimen? | Een **nieuw** eiland (geen `had`) dat publiceert, krijgt de ligplaats van de **eerste vrije starter** (laagste slot). De starter gaat eruit (`drop`, `crowds.leave`, `{t:'island', a:'gone'}`), het eiland komt op zijn `origin`. Past de claimer niet (een `reach` groter dan de starter vrijhoudt), dan krijgt hij gewoon `nextOrigin` en blijft de starter liggen. | Geen keuze-UI nodig. De speler hoeft er niets voor te doen, het gebeurt bij de eerste publish. Een eiland dat al een ligplaats heeft, houdt die, zoals nu. |
| En wie er op dat moment staat? | Iedereen die op de starter loopt, gaat terug naar zijn skiff met het bestaande `evicted`-bericht (met boot-id). Een desktopspeler zonder skiff gaat naar zijn eigen dorpsplein, zoals bij een vijandig eiland. | Het terrein verandert onder zijn voeten; blijven staan kan in het water of in een huis uitkomen. Het pad bestaat al. |
| Berichten naar de pagina | Twee bestaande berichten na elkaar: `gone` voor de starter, dan het nieuwe eiland zoals elke publish. Geen nieuw berichttype, geen `SEA_V`-bump. | De pagina kent beide al (`state.fleet` in `web/js/main.js`, rond regel 2627). Een oudere pagina ziet gewoon een eiland verdwijnen en een ander verschijnen. |
| De telefoon en zijn ligplaats | `standaloneHome()` rekent starters mee zoals elk eiland in de vloot (ze staan erin), dus de telefoon komt vanzelf ná de starters. Wel gaat de telefoon met `reach` rekenen in plaats van `gridSize / 2`. | Anders legt de telefoon zijn skiff in de ruimte die een starter vrijhoudt voor zijn claimer. |
| Vijandig? | **Nee.** Geen `hostile`, geen bewakers. | Een starter is juist de veilige plek. |
| Een herstart van de zee | Maakt de starters opnieuw, en claimt de eilanden die weer publiceren in een nieuwe volgorde. | De vloot leeft alleen in het geheugen, dat blijft zo. Een eiland dat na een herstart een andere ligplaats krijgt, gebeurt nu ook al. |

## Stappen

1. **`starterBundle(slot)`** in `lib/islandbundle.mjs`, naast `volcanoBundle()`: terrein uit een
   vaste seed per slot, `gridSize` 64 en `room` 384, een plein met put en tafels, kroeg en stadhuis
   met een `plot`. Test: dezelfde slot geeft bit voor bit dezelfde bundel, `parseBundle` accepteert
   hem, en `createCrowd` zet er precies twee bewaarders op.
2. **`fleet.raiseStarters()`** in `lib/fleet.mjs`: vult aan tot `STARTERS` vrije starters met
   `nextOrigin`, zolang `MAX_ISLANDS` het toelaat. `theirs()` gaat starters meetellen voor de limiet;
   `expired` slaat ze over (ze zijn `live`); `claim` en `patch` weigeren ze nog steeds. Test: 3 bij
   een lege zee, minder als de zee bijna vol is, nooit op de vulkaan.
3. **Claimen in `publish`**: een nieuw eiland neemt de `origin` van de eerste vrije starter die
   past, en geeft terug welke starter het verving. Test: de claimer staat op de oude plek van de
   starter, de starter is weg, een tweede claimer neemt de volgende; een te grote claimer krijgt
   `nextOrigin` en de starter blijft.
4. **In `lib/sea.mjs`**: bij de claim `crowds.leave` voor de starter, iedereen die erop staat
   `evicted`, `gone` rondsturen vóór het nieuwe eiland, en daarna `raiseStarters()` met
   `crowds.join` voor de nieuwe. Bij het opstarten `raiseStarters()` na `raiseVolcano()`. Test: een
   speler op een starter krijgt `evicted` met zijn skiff; de volgorde op de lijn is `gone` en dan
   het nieuwe eiland.
5. **`standaloneHome()`** in `web/js/main.js` rekent met `reach` (die gaat daarvoor mee in de
   vlootregel, `fleet.row`). Test: een telefoon op een zee met starters krijgt een ligplaats die
   geen enkele starter raakt.
6. **`CLAUDE.md`** bijwerken: de zee heeft nu naast de vulkaan ook starters, wat `starter: true`
   betekent, en dat ze meetellen voor `MAX_ISLANDS`.

Live zetten vraagt alleen een redeploy van de zee. Een oudere islander of pagina hoeft niets te
weten: hij ziet eilanden komen en gaan.

## Erbij: onclaimbare eilandjes als decoratie

Wens (Martijn, 2026-09-26): hier en daar een klein eilandje dat van niemand is en dat niemand kan
claimen: een zandplaat met één palm, een rond eilandje met een groepje palmen, een iets groter
eiland met struiken erbij. Puur om de zee minder leeg te maken en iets te geven om naartoe te
varen.

| Vraag | Besluit | Waarom |
|---|---|---|
| Wie legt ze neer? | **De pagina**, niet de zee. Deterministisch uit een vast wereldrooster met kandidaat-plekken, met per plek een hash voor variant, grootte en draaiing. Een plek telt alleen als hij vrij is van elk eiland in de vloot, gemeten op `reach` plus een marge. | Geen zee-wijziging, geen bericht, geen `SEA_V`. Elke pagina ziet dezelfde vloot, dus iedereen ziet dezelfde eilandjes op dezelfde plek. |
| Mogen ze ligplaatsen blokkeren? | **Nee.** Ze gaan niet mee in `nextOrigin` en tellen niet voor `MAX_ISLANDS`. Komt er een eiland of starter op die plek, dan verdwijnt het eilandje. | `clearOf` houdt `SEA_GAP` (48) aan tot elk eiland. Telden ze mee, dan zou een zandplaat een hele ligplaats onbruikbaar maken. Verdwijnen gebeurt alleen als de vloot verandert, en dan wordt er toch al opnieuw getekend. |
| Hoe groot? | Klein: 6 tot 20 cellen doorsnede, in drie soorten (zandplaat met één palm, rond met een groepje palmen, groter met struiken). | Zichtbaar vanaf zee, geen dorp erop mogelijk, en goedkoop genoeg om er een handvol van te tekenen. |
| Wat staat erop? | **Palmbomen** (nieuw model, via de Blender-pipeline, zoals de andere gebakken props) en struiken. Geen gebouwen, geen bewaarders. | De bestaande `tree`-prop (`web/js/props.js`) is een loofboom en past niet bij een tropisch eilandje. |
| Tekenbudget | Mee in de ranking van `DETAILED`: dichtbij volledig, ver weg alleen het zand of niets. | Anders kosten tien zandplaten op de telefoon meer dan één echt eiland. |
| Kun je erop lopen? | **Tweede stap.** Eerst alleen zien. Daarna het zand meenemen in de grondhoogte van walk mode, zodat je er vanuit je skiff op kunt stappen. | Lopen is aan de kant van de pagina. Omdat iedereen dezelfde eilandjes ziet, zien anderen je dan ook op het zand staan en niet in het water. |

Hangt niet van de starters af en kan ervoor of erna gebouwd worden. Samen met het logboek
(eerder besproken: stempels voor bezochte eilanden) is een eilandje een goed doel voor een
telefoonspeler: "vind alle zandplaten".

## Open vragen

- **Naam.** Een starter heeft een naam nodig (de vulkaan heet `VOLCANO.name`). Een lijst vaste
  namen per slot, of "Nieuw land" met een nummer?
- **Hoe ziet een starter eruit?** Hetzelfde terrein voor alle drie is eenvoudig, maar saai. Een
  seed per slot geeft elk een eigen kustlijn. Voorstel: seed per slot.
- **Zichtbaar als "vrij"?** Een bordje op het plein ("Dit land is nog van niemand") zou een
  desktopspeler vertellen dat zijn eiland hier kan komen. Past bij de bestaande prikborden, maar
  hoeft niet in de eerste versie.
- **De grace terug naar uren?** Met starters is de zee nooit leeg, dus de 3 dagen grace zijn
  alleen nog nodig voor "Tiemens eiland ligt er 's ochtends nog". Korter maakt het `claimed`-
  probleem en de spookplekken kleiner. Eerst kijken hoe het met 3 dagen loopt.
