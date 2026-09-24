# Bier in de hand, drinken met de muis, en wat het met je doet

## Aanleiding

Naast de wapens wil Martijn dat een speler ook een biertje kan vasthouden (inventory,
linker- of rechterhand). De muisknop van die hand wordt een drinkanimatie; drinken vult een
paars balkje (intoxicatie); het beeld wordt wazig en het poppetje gaat zwalkend lopen. Later
erbij: de drie balkjes krijgen een emoji ervoor — ❤️ gezondheid, ⚡ stamina, 🍺 bier.

## Besluiten

| Vraag | Besluit | Waarom |
|---|---|---|
| Wat is het bier? | Een zesde `HAND_ITEMS`-item, `beer`: een procedurele pint (amber glas, schuimkraag, oor) zoals de parasol en de hamer, met het oor in de vuist en het glas naar binnen. Kleuren gelijk aan de pint die de barman in de taveerne tapt. | Geen Blender-bake nodig voor ~60 driehoeken, en het is hetzelfde bier als binnen. |
| Welke muisknop? | De knop van die hand: sinds d5b13b8 heeft elke hand zijn eigen knop (links = linkerhand, rechts = rechterhand; een schild blokt, de rest valt aan). Bier in een hand maakt van die knop drinken (`act` in walk.js, `drink(side)`). Eerst gebouwd op de oude verdeling (links slaat, rechts blokt, via `attackSide`/`blockSide`) en bij de merge omgezet. | Letterlijk "de bijbehorende muisknop". |
| Blokkeert drinken? | **Nee.** Een glas is geen schild: de knop van een bierhand komt nooit bij `guardUp`/`state.blocking`. | Anders zou de zee een drinker als blokkerend zien en minder schade laten doen. |
| Wanneer mag je drinken? | Als je mag vechten, én zittend. | Aan de bar zitten met een biertje is precies de bedoeling. Zwemmen, liggen en aan het roer niet. |
| De animatie | 1,6 s: glas naar de mond (arm naar voren-boven, iets naar binnen), kantelen, slokken (0,8 s, daar vult het balkje), terug. Zwemmen of liggen breekt af. | Direct aangestuurd zoals de zwaai, niet via `damp()`. |
| Het balkje | `web/js/tipsy.js`: één DOM-vrije pool als `stamina.js`. Een volle slok is `DOSE` (0,15, dus ±7 glazen tot vol); na `DELAY` (8 s) zak je in `SOBER` (60 s) van vol naar nuchter. Leeg = onzichtbaar, zoals een vol rood/geel balkje. | Testbaar onder kale Node, en alleen van de pagina — net als stamina is het niet iets om te valsspelen. |
| Van wie is de pool? | `main.js` maakt er één en geeft hem aan beide walk-modes (eiland en taveerne) en stapt hem elke frame, ook vanuit de lucht. | Anders loop je nuchter de taveerne uit. Een walk-mode zonder pool (de werkbank) maakt en stapt zijn eigen. |
| Wazig beeld | CSS `filter: blur()` op `#stage` én `#panels`, alleen te voet, zachtjes pulserend. Alleen geschreven als de afgeronde waarde verandert. | Geen post-processing-pijplijn erbij voor één effect; en alleen het canvas vervagen laat een scherp bord door het gat kijken. |
| Zwalkend lopen | De looprichting slingert (twee sinussen, tot ±0,6 rad bij vol), het lijf rolt en knikt mee; stilstaand of zittend een trage deining. | Via dezelfde botsingscode als gewoon lopen, dus je zwalkt niet door muren. |
| De toetsenstrip | Zegt per knop wat zijn hand nu doet: `attack`, `hold to block` (schild) of `drink` (`ui.setMouse`, elke frame gevoed uit `walk.handAction(side)`, alleen hertekend bij een wijziging); binnen staat alleen een drinkende knop erbij. `B build` staat er alleen als bouwen met de hand aan staat (Settings → Debug). De strip zit op 66 px i.p.v. 92 (net boven de fullscreen-knop; de chronicle is te voet weg), ≤760 px blijft 92. | Een knop die iets anders doet dan er staat, of een toets die alleen "staat uit" antwoordt, is ruis. |
| Zien anderen het? | Het zwalkende pad wel (dat is gewoon je positie), het glas en de rol niet. | Anderen zien je als één mesh zonder armen of items (`peers.js`); een extra pose-bit is een wijziging aan de zee. |

## Een biertje voor een settler

Later erbij: sta je met een bier in een hand vlak bij een settler, dan komt er een popup
"geef bier aan settler"; die drinkt hem op, en na 3 à 4 gaat hij ook schommelen.

| Vraag | Besluit | Waarom |
|---|---|---|
| Wanneer de popup? | Te voet op ons eigen eiland, een bier in een van beide handen, en een settler (het lichaam, niet zijn huis) binnen `GIVE_R` (1,6). Een eigen kaartje `#walk-give` onder de gewone prompt: **G** give *naam* a beer. | De prompt gaat over het dichtstbijzijnde bruikbare ding - meestal het huis - en de settler vóór je is dat zelden. G is vrij en betekent "give". |
| Wat doet G? | De settler draait zich naar je toe en drinkt (2,2 s, een pint via één instanced mesh voor de hele crowd, `count` 0 als niemand drinkt). Jouw arm steekt het glas uit, het is weg uit je hand tot hij het op heeft, en dan staat er een vol glas in. Eén tegelijk, niet opnieuw zolang hij nog drinkt. | De pint in je hand is iets wat je draagt, niet iets wat opraakt. |
| Staat hij stil? | Ja, via hetzelfde `attend` als een gesprek, dus iedereen op de zee ziet hem stoppen en omdraaien. Met de naam die de zee kent (`seaIdOf`, het omgekeerde van `/api/crowd-ids`): de zee kent onze settlers als `house:s3`, niet als `house:<uuid>`. | Met de pagina-id vond de zee hem niet. |
| Schommelen | Per settler een eigen pool (`SETTLER_TIPSY`: een kwart per glas, 45 s vertraging, 180 s tot nuchter), per huis-id in `crowd-view.js`, zodat een nieuwe aankleding hem niet nuchter maakt. `settlerSway`: niets tot twee glazen, half bij drie, helemaal bij vier. Rol, knik en een paar cm heen en weer; lopend een zigzag tot ±20 cm om zijn route, zijn neus draait mee, en om de paar seconden een struikelaar (ruk naar voren en opzij), in- en uitgefaded bij vertrek en stilstaan - alleen in de getekende matrix, nooit in `f.pos`. | De zee bepaalt waar hij is; dit is alleen hoe hij daar staat. De eerste versie liet hem "nog steeds netjes zijn route volgen". |
| Zien anderen het? | Het stoppen wel, het glas en het schommelen niet. | Dat is zee-protocol (een bericht en een broadcast); later, als het gewenst is. |
| De pint van een settler | De pint van de speler, 4,5 cm vóór de vuist (`PINT_OUT`) en zachter gekanteld. | Gemeten in de browser: met de greep van de speler zat het midden van het glas 5 cm ín het gezicht. |

## Bestanden

- `web/js/tipsy.js` (nieuw) — pool, `drinkIn`, `stepTipsy`, `hazePx`.
- `web/js/avatar.js`, `web/js/inventory.js` — het item en zijn icoonstand.
- `web/js/classic-avatar.js` — `beerGeometry()`, `drink(side)`, `swallowed()`.
- `web/js/walk.js` — knoppen (`act`, `canDrink`, `handAction`), zwalken.
- `web/js/ui.js` — de toetsenstrip per knop (`setMouse`), `B` alleen als bouwen aan staat.
- `web/js/vitals.js`, `web/index.html`, `web/css/ui.css`, `web/css/harbour.css` — derde balkje, emoji's, blur.
- `web/js/main.js`, `web/js/interior.js` — één gedeelde pool doorgeven en stappen.

## Verificatie

Tests (`tests/tipsy.test.mjs`, `tests/avatar.test.mjs`); dan te voet met bier rechts: klik →
glas naar de mond, paars balkje loopt op; een paar glazen → wazig en zwalkend; wachten →
alles zakt weg en het balkje verdwijnt. Bier links met een zwaard rechts: links slaat, rechts
drinkt. In de taveerne zittend drinken, naar buiten lopen: nog even dronken.
