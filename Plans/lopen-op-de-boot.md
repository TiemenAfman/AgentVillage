# Lopen op een varende boot, met z'n vijven

Opgeschreven op 25 september 2026; fase 0 en 1 gebouwd op dezelfde dag (nog niet met twee
spelers tegelijk op zee bekeken). Doel: een boot waar tot vijf spelers
tegelijk op staan en rondlopen terwijl hij vaart, zoals je in moderne games in een rijdende
vrachtwagen of op een lift staat, en dat iedereen op zee dat vloeiend ziet.

## Hoe het zat (25 september, vóór fase 0 en 1)

- **Eén persoon per boot.** `lib/boats.mjs` zegt het zelf: *"One pilot per boat, and
  passengers are out of scope."* Geen stoelen, geen capaciteit, geen passagiers.
- **Je zit vast op het midden van de romp.** Elke frame zet `walk.js` je op
  `(vehicle.x, deckY, vehicle.z)` met de koers van de boot; WASD is gas en roer, geen benen.
  Deinen en rollen (`bob` in `web/js/boat.js`) is alleen beeld, op de klok van de pagina.
- **De stuurder is de baas over de romp.** Zijn client stuurt `{t:'boat', a:'moved', x, z,
  yaw}` op de pose-beat (100 ms, alleen als hij bewoog); de zee accepteert het alleen van
  `b.pilot` en geeft het door. Andere schermen zetten de romp op elk bericht neer, zonder
  interpolatie: hij verspringt tot zo'n 0.95 per stap op topsnelheid.
- **Spelers gaan in wereldcoördinaten over de lijn** en worden bij anderen 120 ms in het
  verleden getekend (`LAG_MS` in `web/js/peers.js`). Een passagier die zo verstuurd wordt,
  loopt 120 ms achter een romp die verspringt: ruim een eenheid naast een boot die zelf
  kleiner is dan dat.
- **Settlers doen het al goed.** `encodeRides` (`shared/settlerwire.mjs`) stuurt romp en
  opvarende samen in één rij, juist zodat de een niet achter de ander aan loopt. Dat is het
  patroon voor spelers.
- **De stuurder is voor anderen vermoedelijk onzichtbaar.** Aan boord zet main.js de kamer
  op `'boat'` (`setRoom('boat', …)`), `peers.js` heeft geen plek met die naam
  (`places`), `moveTo` doet dan niets en `p.room !== p.want` verbergt het lichaam. Uit de
  code gelezen, nog niet in een browser gezien.
- **Loopvlakken zijn vast.** `setLevels` / `groundAt` in walk.js en `createStandHeight` in
  `shared/settlerwalk.mjs` werken per wereldcel; niets daarvan beweegt mee.
- **De Benchy is te klein.** Ongeveer 1 tot 1.3 lang, gebouwd voor één rijder van 0.54, en
  een speler is 0.35 breed (straal). Vijf passen er niet op.

## Wat het moet doen

- Een grotere boot (werknaam *de sloep*) met een dek, een reling en een roer. Tot vijf
  spelers staan erop: één aan het roer, de rest loopt vrij rond, ook terwijl hij vaart.
- Aan het roer stuur je zoals nu. Loop je bij het roer weg, dan houdt de boot zijn koers en
  loopt zijn snelheid uit tot stilstand; een ander kan het roer overnemen zodra het vrij is.
- Instappen: vanaf de kade of het strand het dek op lopen als hij ligt, of vanuit het water
  bij de trap (E). Uitstappen: eraf lopen waar het dek op het land aansluit, of overboord
  springen en zwemmen.
- Springen op het dek landt op het dek, ook als de boot onder je doorvaart. Spring je over
  de reling, dan neem je de snelheid van de boot mee het water in.
- Iedereen op zee ziet de boot vloeiend varen en de mensen erop stil staan of lopen, zonder
  dat ze naast de romp zweven.

## Besluiten (voorstel)

- **Een lokaal assenstelsel voor wie aan boord is: `state.deck`, niet `state.vehicle`.**
  `vehicle` betekent overal in main.js en net.js *de boot die ik stuur* (hull-sync,
  afmeren, het uithoudingsvermogen van de boot), dezelfde reden als `state.bike` in
  [fiets.md](fiets.md). `state.deck = { boatId, x, y, z, yaw }` is je plek *ten opzichte van
  de romp*; elke frame is wereld = romp ⊕ lokaal, en je kijkrichting draait mee met de draai
  van de romp. De stuurder is gewoon iemand op het dek die op de roerplek staat, met
  `state.vehicle` erbij.
- **Lopen gebeurt in het lokale stelsel.** Invoer wordt naar rompcoördinaten gedraaid, er
  wordt gebotst tegen de reling en de opbouw zoals ze in het model staan (lokaal, dus
  stilstaand), en pas daarna wordt het terug naar de wereld gerekend. Het wordt een pure
  functie naast `stepBoat`, zonder THREE en zonder klok (`stepDeck` in `web/js/deck.js`),
  zodat een test onder Node op een varend dek kan lopen.
- **Het dek is plat voor de voeten.** Deinen en rollen blijven beeld: het model, de camera
  een klein beetje, niet de loopvlakken. Een dek dat echt helt laat iedereen glijden en maakt
  van elke golf een netwerkbericht.
- **Het dek komt uit het model.** Een nieuwe set in de Blender-pijplijn
  (`scripts/build-sloop.py` → `web/js/sloop-mesh.js`), met als ingebakken ankers: de
  loopvlakken met hun hoogte, de reling als muren, de roerplek, de instapplek(ken) en waar
  het dek op een kade aansluit. Geen loader, zoals altijd. Hero-budget (4000), maar lager
  mikken, want elke boot op zee tekent er één. De Benchy blijft wat hij is: de boot voor één
  persoon (en de skiff op de telefoon).
- **Wie op een dek staat, stuurt zijn positie ten opzichte van de romp.** De pose krijgt
  `on` (de boot) en lokale x, y, z en koers erbij. Andere schermen tekenen die persoon als
  romp ⊕ lokaal, met romp en lokaal op **dezelfde** tijdlijn geïnterpoleerd; dat is precies
  wat `encodeRides` voor settlers al doet. De wereldpositie blijft er ook in staan, zodat een
  zee of pagina van vóór dit werk iemand in elk geval nog ongeveer op de boot tekent.
  Daardoor is het een toevoeging aan het protocol en hoeft `SEA_V` niet omhoog; het wordt
  wel een minor release, want pas een bijgewerkte zee geeft de lokale velden door.
- **Boten van anderen worden geïnterpoleerd.** Nu verspringen ze per bericht. Ze komen in
  dezelfde buffer met dezelfde `LAG_MS` als de spelers, anders staat een passagier nog
  steeds naast een romp die een stap verder is. Ook zonder passagiers een verbetering.
- **Je eigen stappen op het dek voorspel je zelf, in het lokale stelsel.** Dan voelt lopen
  direct, ook al komt de romp van de stuurder met vertraging binnen: je staat altijd goed
  op *jouw* beeld van de boot.
- **De zee blijft simpel en controleert.** De stuurder blijft baas over de romp; iedere
  passagier over zijn eigen lokale plek. De zee houdt bij wie op welke boot staat
  (`lib/boats.mjs`, `crew` per boot, hoogstens `CREW` = 5 voor de sloep en 1 voor de
  Benchy), weigert instappen buiten bereik van de romp of op een volle boot, en klemt een
  lokale positie binnen het dek.
- **Wat pijn doet, rekent met de echte plek.** De bewakers (`lib/hostility.mjs`), de lava
  (`lib/lava.mjs`) en `hurt()` werken met wereldposities, dus de zee rekent voor iedereen
  aan boord romp ⊕ lokaal uit. Wie op een dek staat, zwemt niet en staat niet in de lava.
- **Overgangen rekenen één keer om.** Instappen: wereld → lokaal op dat moment. Uitstappen
  of over de reling springen: lokaal → wereld, met de snelheid van de romp erbij. Tijdens
  een sprong boven het dek blijf je in het stelsel van de boot.

## Fases

0. **De stuurder zichtbaar maken.** *Gebouwd.* Hij verdween inderdaad: `'boat'` is geen
   plek in peers.js. Nu is `BOAT_ROOM` daar een romp en geen kamer (de zee blijft de kamer
   gebruiken voor `afoot`), en `seatOf` uit main.js zet de stuurder op zijn romp zoals die
   dit frame getekend wordt, op het dek (`deckY`), in plaats van op zijn eigen pose.
1. **Boten van anderen vloeiend.** *Gebouwd.* `web/js/timeline.js` is de ene tijdlijn
   (`LAG_MS`, `MAX_EXTRAPOLATE_MS`) voor spelers én rompen. Een romp krijgt een kort spoor van
   samples (`pushSample` / `trackAt`, de laatste vier) in plaats van twee: met twee viel het
   beeld bij elk nieuw bericht terug en stond de boot even stil (gemeten 0.19 bij topsnelheid).
   Losgelaten glijdt hij het laatste stuk naar waar hij achterbleef en stopt daar (`final`).
   `glideBoats()` draait vóór de peers, zodat de stuurder op de romp van dít frame staat.
   `tests/timeline.test.mjs` vaart een romp op topsnelheid, ook over een haperende lijn.
2. **De sloep.** Het model met zijn ankers door de pijplijn, varend en aangemeerd, nog met
   één persoon aan het roer zoals nu.
3. **Zelf lopen op een varend dek.** `state.deck`, `stepDeck`, de overgangen, springen.
   Alleen op je eigen scherm; de pose gaat nog in wereldcoördinaten.
4. **Passagiers voor elkaar.** De lokale velden in de pose, de zee die `crew` bijhoudt en
   doorgeeft, andere schermen die romp ⊕ lokaal tekenen. Hierna moet de open zee mee.
5. **De zee rekent mee.** Capaciteit, bereik en klemmen, en de wereldpositie voor bewakers,
   lava en schade.
6. **Het roer overdragen.** Weglopen bij het roer, uitlopen, een ander die het roer pakt.

## Open vragen

- Wie mag op wiens boot: alleen spelers van hetzelfde eiland, of iedereen op zee?
- Wat gebeurt er met de bemanning als de stuurder wegvalt? De zee brengt een onbemande boot
  na vijf minuten terug naar zijn ligplaats (`lib/boats.mjs`); met mensen erop moet hij
  eerst stilliggen tot ze eraf zijn, of ze varen mee.
- Moet een boot met mensen erop langzamer, zodat lopen bij 9.5 per seconde niet
  onspeelbaar wordt?
- Vallen de bewakers van de vulkaan (die tot `GUARD_SWIM` cellen uit de kust zwemmen)
  passagiers op het dek aan?

## Later, niet nu

- Settlers vrij over het dek laten lopen (nu zitten ze op het midden van de romp, net als de
  speler nu).
- Liften, vlotten, een pont: hetzelfde mechanisme (`state.deck` op iets anders dan een
  boot). Pas als de boot bevalt.
