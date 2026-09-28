# Je karakter blijft staan, en loopt waar je klikt

**🚧 NOG NIET KLAAR**

Issue [#73](https://github.com/TiemenAfman/AgentVillage/issues/73), 28 september 2026. Gevraagd:
ga je terug naar de lucht, dan blijft je karakter staan waar je was (met ZZZ boven zijn hoofd)
in plaats van weg te teleporteren. Van bovenaf wil je het ook kunnen sturen: klik op een plek
en hij loopt erheen, een soort RTS-modus, en bij een gefocust gebouw een knop *Walk here*. En
bij het opstarten van de islander sta je op het plein, zodat er altijd een karakter is.

## Hoe het nu zit

- `exitWalk` (main.js) stuurt `{t:'w', on:false}`; de zee (`lib/players.mjs`) neemt wie niet
  loopt niet meer op in `{t:'s'}`, en peers.js laat hem uitfaden. `walk.exit()` zet het
  avatar onzichtbaar. Voor jezelf en voor iedereen ben je dus weg.
- `walk.update()` doet niets zonder `state.active`, en dat zet alleen `enter()` aan: het
  lijf kan in de lucht niet bewegen.
- `enterWalk` begint bij de boot in de lucht, dan `recalledSpot()`, dan het bord op het plein.
- In orbit raakt `pick()` gebouwen en figuren, geen grond: een klik op gras sluit alleen het
  dossier.
- `findPath` (shared/settlerwalk.mjs, A* over cellen) is ook in de browser te gebruiken.

## Besluiten

| Vraag | Besluit | Waarom |
|---|---|---|
| Blijft het lijf op de zee? | **Ja.** In de lucht blijft de pagina `walking` en poses sturen; het lijf staat stil. | Anders fade je voor anderen weg, en dat is precies wat het issue niet wil. |
| Hoe weten anderen dat niemand aan de knoppen zit? | Een pose-bit `ASLEEP` (4096, `POSE_MASK` 8191). peers.js zet er ZZZ boven. | Een bit, zoals dansen: het duurt, en de pagina tekent het zelf. Een zee op 0.6.x maskeert het weg: dan sta je er wel, zonder ZZZ. |
| Idle-kick | Niets aan veranderd. | De sweep kijkt naar het laatste bericht, en de pagina stuurt ook stilstaand elke seconde een pose (`KEEPALIVE_MS`). |
| Bewakers | Wie slaapt, is geen doelwit (`afoot` sluit `ASLEEP` uit). | Een lijf dat je niet bestuurt, mag niet sterven terwijl je naar een dossier kijkt. |
| Aan het roer of op een dek | Blijft wat het was: je vliegt op en de boot blijft liggen (`skyBoat`). | Het lijf staat dan op een romp die niemand meer stuurt; dat is een eigen vraag. |
| Verborgen tabblad | Blijft wat het is: `walking` uit. | Anders blijft van elke dichtgeklikte tab een slapend lijf achter. |
| Klikken op de grond | In orbit, een klik zonder sleep op ons eigen eiland: raycast op de grond, pad met `findPath` van het lijf naar die cel, en het lijf loopt. | RTS-achtig. De camera blijft van jou; het lijf loopt eronder. |
| Hoe loopt het lijf zonder walk mode? | `walk.js` krijgt een autowalk: `goTo(path)` + een `tick(dt)` die in orbit draait, met dezelfde stap- en botsregels maar zonder camera en toetsen. | Eén bewegingsregel. Een tweede kopie zou het lijf anders door muren laten gaan dan je voeten. |
| *Walk here* bij een gebouw | Een knop in het dossier; het doel is de cel voor de deur (`outsideDoor`). | De deur is waar een gebouw te bereiken is. |
| Terug naar walk mode | Je begint waar het lijf nu staat. De boot in de lucht gaat nog voor. | Het lijf is de waarheid over waar je bent. |
| Opstarten | De islander start met het lijf op het plein (de plek voor het bord, zoals `enterWalk` al kent), slapend. | Er is altijd een karakter om te besturen. Een eerdere plek (`recalledSpot`) wint niet meer bij het opstarten. |
| Telefoon | Niets verandert: die kent geen orbit. | |

## Stappen

Stap 1 tot en met 5 gebouwd op 28 september 2026, nog niet met twee spelers op zee bekeken:
`park` / `goTo` / `blockedAt` in `walk.js`, `FLAG_ASLEEP` in `net.js` en `peers.js`, de Zzz in
`web/js/zzz.js`, `ASLEEP` in `lib/players.mjs` en `afoot`, en in `main.js` `parkOnSquare`,
`walkBodyTo`, `walkToPointer` en `walkToBuilding`. De open zee moet geredeployd worden voor de Zzz
bij anderen en voor bewakers die een slaper laten staan.


1. Het lijf blijft staan: `exitWalk` houdt `walking` aan, zet `ASLEEP`, laat het avatar zien;
   `enterWalk` begint bij het lijf. ZZZ boven jezelf en bij peers.
2. De zee: `ASLEEP` in `POSE`, `POSE_MASK`, idle-sweep en `afoot` (redeploy van de open zee).
3. Autowalk in `walk.js` en klikken op de grond in orbit.
4. *Walk here* in het dossier.
5. Opstarten op het plein.
