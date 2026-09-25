# De goudkuil: het 5-uurslimiet als een berg goud naast het plein

**Status: gebouwd op 24 september 2026.** Onderaan staat wat er nog openstaat.

## Wat Tiemen vroeg

> In de buurt van de square een sleufsilo of "kuil" met daarin goudstaven, een berg goud.
> 100 stuks, ongeveer één per procent, die symbool staan voor het usage limit van de huidige
> 5-uurssessie. Elke keer als een inwoner aan het bouwen is haalt hij goud (tokens) van de
> goudstapel en neemt die mee naar huis als hij gaat bouwen. De voorraad goud moet slinken
> naarmate er meer van het usage limit gebruikt wordt.

Drie dingen dus: (1) waar het getal vandaan komt, (2) een kuil met honderd staven die
meeslinkt, (3) settlers die goud halen voordat ze gaan hameren.

## 1. Waar het getal vandaan komt

(Sinds 25 september is er een tweede bron, het eigen bestand van de desktop-app; zie
"Wat er nog openstaat" onderaan.)

Nagezocht in de documentatie van Claude Code (statusline-pagina, september 2026): het
5-uurspercentage staat **alleen** in de JSON die Claude Code aan een `statusLine`-commando
geeft:

```json
"rate_limits": { "five_hour": { "used_percentage": 23.5, "resets_at": 1738425600 }, ... }
```

`used_percentage` loopt van 0 tot 100, `resets_at` is in Unix-seconden. Het is er alleen voor
Pro/Max (of achter een gateway met een spend limit), pas na het eerste antwoord in een sessie,
en Claude Code laat een venster weg zodra `resets_at` voorbij is. Hooks krijgen het niet, en
de transcripts (`~/.claude/projects/**.jsonl`) ook niet (nagekeken op een transcript van deze
sessie).

| Vraag | Besluit | Waarom |
|---|---|---|
| Bron | **`hooks/statusline.mjs` als statusLine-commando.** Het leest stdin, schrijft `data/usage.json` en print een korte regel (`⛏ 73/100 goud · vol om 16:40`). | De enige gedocumenteerde bron. Het draait bij elk nieuw assistent-bericht (300 ms gedebounced), dus het getal loopt mee terwijl er gewerkt wordt, en stilstaat als er niets gebruikt wordt, wat precies is wanneer het ook niet verandert. |
| Niet gekozen: de OAuth-usage-API | Niet gebouwd. | Dat is `api.anthropic.com/api/oauth/usage` met het token uit `~/.claude/.credentials.json`: ongedocumenteerd, en het eiland zou de inloggegevens van de keeper moeten lezen. Voor een server die "gevaarlijk met opzet" is en alles op loopback houdt, is dat een grens die Tiemen zelf moet willen overgaan. Staat hieronder als open punt. |
| Niet gekozen: schatten uit transcripts | Niet gebouwd. | Tokens optellen over het venster kan, maar het limiet zelf staat nergens; elke schatting (zoals ccusage's "grootste blok ooit") is een gok die een berg goud laat slinken naar een getal dat niet klopt. |
| Een statusLine die er al is | **Doorgelust**, niet vervangen: `node ".../statusline.mjs" --pass \| <het bestaande commando>`. Met `--pass` schrijft het script `usage.json` en geeft het stdin ongewijzigd door, dus de eigen regel van de gebruiker blijft staan. `node scripts/setup.mjs --uninstall` haalt het voorvoegsel er weer af. | Een statusLine van iemand anders overschrijven is onbeleefd; ernaast iets zetten kan niet (er is er één). Een pipe werkt in Git Bash (waar Claude Code op Windows commando's in draait) en in cmd. De logica staat in `lib/statusline.mjs`, zodat ze getest kan worden zonder aan `~/.claude` te komen. |
| Wie installeert hem | **De islander zelf**, bij het opstarten (`ensureStatusLine` vanuit `serve.mjs`): niets om met de hand te draaien. Eén keer per eiland; `data/statusline.json` onthoudt dat het gevraagd is, en wie de regel daarna weer weghaalt, krijgt hem niet terug. Eerst een back-up van `settings.json` ernaast; een `settings.json` die geen JSON is wordt nooit overschreven. `scripts/setup.mjs` zet hem ook, voor wie setup toch draait. | Tiemen: "niks npm run". Een release heeft geen npm, en een eiland dat pas werkt na een commando in een terminal werkt voor de meeste mensen nooit. Eén keer vragen en het antwoord laten staan is hetzelfde als bij het vaarwater (`null` tegen `{ cells: [] }`). |
| Regels voor het script | Dezelfde als de session-hook: **altijd exit 0**, nooit iets kapot maken. Schrijft alleen als het getal veranderd is, via tmp + rename, en slikt een mislukte rename (EPERM op Windows als de islander het bestand net leest). | Een statusLine die faalt laat een lege regel achter in iemands terminal; een die hangt vertraagt hem. |
| Wat staat er in `usage.json` | `{ v: 1, fiveHour: { used, resetsAt }, sevenDay: {…} \| null, at }`, `resetsAt` in milliseconden. | Het zevendaagse venster kost niets om mee te schrijven en is de voor de hand liggende volgende vraag. |
| Hoe het getal goud wordt | `lib/usage.mjs goldOf`: `bars = 100 − round(used)`, begrensd op 0..100. **Geen meting, of `resetsAt` voorbij: 100.** | Een vol venster na een reset is precies wat een reset betekent. Een eiland zonder meting tekent een volle kuil, net zoals een wereld zonder weer zonnig is: het ontbreken van een getal is geen kapot eiland. Het dossier zegt wel dat er nog geen meting is en hoe je hem krijgt. |

## 2. De kuil

| Vraag | Besluit | Waarom |
|---|---|---|
| Wat is het | Een civic-gebouw, `civic:goldpit` / `civicType: 'goldpit'`, op een **3×3-kavel**: een betonnen sleufsilo (vloer, twee zijwanden en een achterwand, open naar het plein) met de staven achterin. | 3×3 is de maat van elk civic-gebouw met een deur: `outsideDoor`, de weg ernaartoe (het "civic roads, relaid"-blok legt hem vanzelf), de bestrating ervoor (frontage) en een plek waar een settler naartoe kan lopen komen dan allemaal gratis. Een 1×1 op het plein (zoals de brievenbus) is te klein voor honderd staven en zit midden in de looproute. |
| Waar | `findBlockAround(grid, townCentre, { skipRing0: true })`, direct **na** de mijlpalen en **vóór** het relaid/frontage-blok. **Niet** `takeCivicLot`. | De acht kavels rond het plein zijn precies op voor het stadhuis en de zeven 3×3-mijlpalen (markt, taverne, klokkentoren, school, watertoren, kapel, kasteel); de kuil er één afpakken laat later de school een eind buiten het dorp belanden. `findBlockAround` neemt het dichtstbijzijnde vrije blok op het rooster van het dorp, dus zo dicht bij het plein als er ruimte is. |
| Vanaf wanneer | Vanaf de eerste scan, voor iedereen. Geen mijlpaal. | Het limiet hoort bij elke sessie, niet bij een verdiende rang. Een scan moet een pure functie van het model zijn, dus aan het getal zelf (dat niet in het model zit) kan de kuil niet hangen. |
| Plakt het | Ja. Eén keer geschreven in `layout.plots`, nooit meer verplaatst; `scan.mjs` gooit nooit een `civic:*`-kavel weg. Een bestaand eiland krijgt hem bij de eerste scan met deze code op het dichtstbijzijnde vrije blok, en de scan daarna is weer byte-identiek. | "Een huis verhuist nooit vanzelf" geldt ook hiervoor. Geen versiepoort nodig: er verhuist niets, er komt één kavel bij. |
| De staven | Eén `InstancedMesh` van precies 100 staven met een eigen metalen materiaal (`web/js/goldpit.js`), naast het ene samengevoegde silo-mesh. Gestapeld als een piramide van vijf lagen, 5×8 + 4×7 + 3×6 + 2×5 + 1×4 = 100, van onder naar boven genummerd; `setBars(n)` zet `count = n`. | Twee draw calls voor de hele kuil, hoe vol hij ook is. Van onder naar boven genummerd betekent dat de berg van bovenaf slinkt, zoals een echte stapel waar je van afpakt. Honderd staven maakt "één staaf is één procent" letterlijk. |
| Wie ziet welk getal | **Alleen de keeper ziet zijn eigen getal.** `GET /api/gold` en het SSE-event `gold` zijn keeper-only (`who.role === 'islander'`, `localOnly`). Het getal staat níet in `village.json` en níet in de bundle. Een bezoeker, en elk ander eiland op de zee, ziet een volle kuil. | Hoeveel iemand van zijn abonnement heeft opgemaakt is van hem, net zoals zijn Jira-token en zijn mail; het principe van deze code is dat zoiets de machine niet af gaat. En in de bundle zou het ook duur zijn: elke verandering is dan een republish (206 kB, elke kijker bouwt de regio opnieuw, en de zee zet elke settler terug voor zijn deur). |
| Hoe het getal de pagina bereikt | `serve.mjs` kijkt elke 5 s of `usage.json` veranderd is (of een `resetsAt` verstreken) en stuurt dan `event: gold`. Bij het opstarten haalt de pagina `/api/gold` één keer op. | Een `stat` per 5 s kost niets. `fs.watch` op de data-map is er al voor `village.json`, maar een tweede luisteraar op dezelfde map met eigen debounce is meer code voor dezelfde uitkomst. |
| Een oude pagina | Tekent een onbekend `civicType` als het grijze stenen blokje van `default:` in `buildings.js`. Crasht niet. | |

## 3. Goud halen voordat je gaat bouwen

Een settler wiens sessie loopt, hamert voor zijn deur (`mode: 'hammer'`, gezet door
`lib/crowd.mjs` bij het spawnen). Dat blijft zo, met één ronde ervoor en daarna af en toe
opnieuw:

```
hammer ──(goldIn op)──> lege kruiwagen naar de kuil ──> laden (1,6–3 s) ──> volle kruiwagen naar huis ──> hammer
```

| Vraag | Besluit | Waarom |
|---|---|---|
| Waar | In `shared/settlerwalk.mjs`, dus op de zee. | Daar lopen de settlers, van elk eiland, ook als niemand kijkt. De regels van `shared/` gelden: geen `Math.random`, geen transcendente functies. |
| Hoe vaak | Eerste ronde 2–20 s nadat iemand begint te bouwen, daarna elke 150–330 s hameren. Nooit meer dan `MAX_GOLD` (12) tegelijk op pad per eiland, niet tijdens de borrel. | "Elke keer als hij gaat bouwen" — en een sessie bouwt uren, dus om de paar minuten nog een staaf houdt het dorp levend zonder dat het een mierenhoop wordt. |
| Welke rng | Een eigen stroom per settler, `<id>:gold`. | De stroom `<id>:walk` is geordend en dragend (zie CLAUDE.md): een trekking erbij verschuift ieders voeten. |
| De route | Over de weg naar de wegcel het dichtst bij de voordeur van de kuil (`routeTo`: weg + het laatste stukje over land), dan de kuil in tot vóór de stapel. Terug dezelfde route omgekeerd plus de eigen stoep. | Precies hoe een wandeling al werkt; geen nieuwe beweging, alleen een nieuwe reden. Errand-haken blijven records (`gold-out`, `gold-home`), geen closures. |
| Wat de pagina ziet | **Het goud wordt met een kruiwagen gehaald** (Tiemen, 25 september). Drie woorden achteraan in `ANIMS`: `'barrow'` (de lege kruiwagen heen), `'load'` (gebukt bij de stapel, de kruiwagen geparkeerd op zijn pootjes ervoor) en `'carry'` (de volle kruiwagen naar huis). De twee loopwoorden staan in `MOVING`, precies zoals een houthakker met een bos takken `'haul'` loopt (Plans/inwoners-aan-het-werk.md); `'load'` is een klusje zoals `'gather'`, en gebruikt diens bukhouding. `settler-figures.js` tekent de kruiwagen op de grond onder de settler (zonder de deining van de pas, hij rijdt op zijn wiel), het wiel draait mee met de loopsnelheid, en in de bak ligt bij het laden één staaf en op de terugweg drie. Drie batches voor de hele crowd, nul draw calls als niemand goud haalt. **Tussen de rondes staat de kruiwagen bij het huis** (Tiemen, 25 september): naast de hamerende settler, langs de gevel, leeg. Dat leidt de pagina zelf af (`barrowAtHome` in `crowd-view.js`: `'hammer'` op een eiland met een kuil), dus er gaat niets extra over de draad en elk scherm, ook na een herlaad, zet hem op dezelfde plek. | Op `Develop_Tiemn` is dit al het patroon voor lopen-met-iets-in-de-hand, dus geen tweede mechanisme ernaast. Eerst droeg een settler één staaf dwars over beide vuisten; een kruiwagen leest van veraf beter als 'goud halen' en is wat Tiemen vroeg. Een oude pagina leest het onbekende getal als `'still'`, wat bij `'haul'` al zo was. (Op `main` bestaat `'haul'` niet en ging het als een eigen `fc`-bericht naast `fh`; die versie staat op `claude/charming-clarke-mf9egn`.) |
| Een republish middenin een ronde | **De ronde overleeft het.** `createCrowd(island, { known, before })` geeft elke settler die in de vorige crowd ook actief was zijn goudtoestand terug (`walk.adopt`): de aftelling tot de volgende ronde, en een ronde die bezig is compleet met positie, pad en staaf. Alleen als zijn huis op dezelfde plek staat. | Zolang er iemand werkt verandert `lastAt` elke scan, dus publiceert de islander elke minuut en bouwt de zee de crowd opnieuw. Zonder dit zou een settler die ver weg woont nooit bij de kuil aankomen: hij zou elke minuut terugspringen naar zijn deur. Het is bewust alleen het goud; de rest van de crowd gaat terug naar huis zoals altijd. |
| De vulkaan | Geen kuil, dus de Codex-bewoners hameren zoals voorheen. | |
| Versie | **`SEA_V` blijft staan**, geen layout-poort. Een oude zee laat niemand goud halen; een nieuwe zee met een oude pagina laat ze wel lopen, alleen zonder staaf (het woord leest als `'still'`). | Alleen ophogen als een oude peer iets verkeerd zou lezen. Wel een nieuwe functie, dus een minor en geen patch - en een zee op afstand moet opnieuw uitgerold worden voordat het goud daar gehaald wordt. |

## Wat er nog openstaat

- ~~**Claude desktop / Cowork.**~~ **Opgelost op 25 september.** De desktop-app draait
  inderdaad geen statusLine: alle sessies sinds de installatie waren
  `entrypoint: claude-desktop` en `data/usage.json` bestond niet, dus Tiemen zat op 11% met
  een volle kuil. Maar de app houdt het venster zelf bij, in
  `%APPDATA%\Claude\plan-usage-history.json`: elk kwartier een sample
  `{ t, org, u: { fh, sd } }`, met `fh` het vijfuurspercentage. Dat is nu de tweede bron
  (`readDesktopUsage` in `lib/usage.mjs`), zonder inloggegevens en zonder netwerk, dus de
  OAuth-API blijft ongebouwd.

  | Vraag | Besluit | Waarom |
  |---|---|---|
  | De reset | Er staat geen `resets_at` in het bestand, dus **geschat**: vijf uur na het eerste sample van het huidige venster (terug vanaf het laatste sample, zolang `fh` niet daalt, niet 0 is en niet verder dan vijf uur terug). | Dat sample had al gebruik, dus het venster was toen open: het is een bovengrens. Een kuil die een kwartier te laat volloopt is beter dan een die volloopt terwijl het venster nog op is. Teruggespeeld over een maand historie (26 resets met de app open): nooit te vroeg, hooguit een kwartier te laat, en later alleen als het venster opende terwijl de app dicht was. |
  | Welke bron wint | **De jongste** (`currentUsage`); bij gelijk de statusLine. | De statusLine is exact maar schrijft alleen als het getal beweegt en zwijgt zonder terminal; de app loopt tot een kwartier achter maar blijft samplen. |
  | Welk account | Alleen de `org` van het laatste sample. | Het bestand houdt elk account bij waarmee de app ooit ingelogd was. |
  | Wat het dossier zegt | "As the desktop app saw it at 09:49", en "full again by 14:11 at the latest". | Het getal is tot een kwartier oud en de reset een schatting; dat hoort erbij te staan. |
  | Het risico | Het bestandsformaat is niet gedocumenteerd en kan veranderen. | Dan geeft `readDesktopUsage` null (alles wordt veld voor veld gecontroleerd) en is de kuil weer vol, zoals voorheen - er gaat niets stuk. |

  De kuil slinkt zo in stapjes van een kwartier, niet bij elk bericht.
- **Bezoekers zien een volle kuil.** Als het getal ooit toch gedeeld moet worden, dan door een
  eigen deur zoals `/island/:id/codex`, nooit in de bundle.
- **Een lege kuil.** Op 100% hameren settlers door en halen ze nog steeds een staaf; de zee
  weet het getal niet (zie privacy). Bij een bereikt limiet staat een sessie meestal toch stil.
