# Lopen op een varende boot, met z'n vijven

**✅ Status: gebouwd op 29 september 2026**, op het piratenschip (`CRAFTS.galleon`, elk eiland heeft er
een). Open: alleen wat onder *Open vragen* en *Later* staat.

Opgeschreven op 25 september 2026; fase 0 en 1 gebouwd op dezelfde dag en met een tweede
speler op de open zee bekeken, fase 2 tot en met 6 op 28 en 29 september (zie Fases). Doel: een
boot waar tot vijf spelers tegelijk op staan en rondlopen terwijl hij vaart, zoals je in moderne
games in een rijdende vrachtwagen of op een lift staat, en dat iedereen op zee dat vloeiend ziet.

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
- Instappen: vanuit het water of van een kade tegen een van de touwladders aan lopen (zie
  *Instappen: touwladders*); er is geen toets voor. Uitstappen: over de reling springen, of
  uit het dek over de rand op de ladder stappen en naar beneden klimmen; ook daar geen toets.
  E is op het dek alleen het roer.
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

## Instappen: touwladders (29 september)

Eerst was aan boord komen een toets: E bij de boot zette je aan het roer, E op het roer liet je
los, en aan de rand van het dek bood E "step ashore" of "jump overboard" aan. Op een schip van
dertien lang voelde dat als een menu op een romp, en het klopte niet met de zee: volgens
`lib/boats.mjs` weigert die `take` op een boot met plek voor een crew tot je crew bent, dus wie
zo aan boord kwam, stuurde een schip dat naar het zich laat aanzien alleen op zijn eigen scherm
voer.

- **Een touwladder aan elke kant van het want** (`CRAFTS.galleon.ladders`, `x: ±2.42`,
  `z: 1.85`), geen toets. Niet halverwege de kanonnen: die steken met hun poorten uit tot 2.63
  op z -2, -1, 0 en 1, en het raam ertussen is 0.4 tot 0.5, te smal voor een ladder van 0.5.
  Voor de laatste poort is de zijkant schoon (gemeten met horizontale stralen over de hele
  hoogte van de romp). Eerst hing hij op z 0, dwars voor een kanon. Uit het water of van een kade tegen de
  voet lopen (`ladderUp`: naast de touwen, voeten laag, duwen in de richting van de romp) is
  klimmen; op het dek naar buiten duwen bij het hoofd van de ladder (`ladderDown`, en dan
  echt naar buiten: 0.8 van de stick, want langs de reling schuiven met een beetje duw hoort
  je niet over de rand te zetten) is naar beneden klimmen. Geen E, en E doet tijdens het
  klimmen niets.
- **Een klim is een pad, geen natuurkunde, maar waar je erop staat is aan jou.** `ladderPath`
  geeft punten in het stelsel van de romp: van het water langs de buitenkant tot de rand van de
  verschansing, erover en het dek op (`land`, vrij van de reling). Naar de romp toe duwen is
  een stuk omhoog (met 1.8), van de romp af duwen een stuk omlaag, en zonder duw blijf je
  hangen waar je hangt, met het gezicht naar de romp. Boven af is het dek, onder af het water,
  en springen is loslaten: je valt vanaf waar je hangt (`stepClimb`). Wat "naar de romp toe"
  is komt uit dezelfde lezing van de stick die je op de ladder zette (`pushOnHull`, vanuit waar
  de camera kijkt), anders begon achteruit aanlopen (S, camera weggedraaid) een klim die het
  volgende frame een afdaling heette. Het pad leeft in het rompstelsel, dus een romp die stampt
  neemt je mee. Het begint (of eindigt) waar je lichaam is, zodat de eerste stap een greep naar
  de sport is en geen sprong.
- **De ladder wordt getekend uit dezelfde getallen** (`ladderBoxes` in `web/js/boat.js`: twee
  touwen, sporten, de touwen over de rand vastgemaakt) en aan de geometrie van de romp
  gelast, dus nog steeds één draw call per schip. Niet gebakken: er valt aan een touw niets te
  modelleren, en zo kan wat je beklimt niet afwijken van wat je ziet.
- **Springen is de uitgang.** Een verschansing heeft een `top` (`BULWARK` 0.25 boven de planken
  ernaast; de bake loopt van 0.15 tot 0.4, en een sprong is 0.38, dus één getal met ruimte): wie
  met de voeten erboven zit, gaat er overheen (`railed` in `shared/deck.mjs`). Een mast heeft
  geen `top`. Tegen de reling staan en springen is genoeg, en `tests/deck.test.mjs` houdt vast
  dat elke reling te nemen is. Over de rand ben je niet meer op het dek: `walk.js` teleporteert
  niet meer naar het water maar laat je vanaf waar je bent door de lucht gaan (`state.drift`
  is de snelheid van de romp, door het water in een seconde gedempt en door iets droogs
  meteen), en landt op wat eronder ligt: water, of een kade.
- **De zee hoort het op de twee uiteinden.** Boven aan de ladder `boardBoat` (je bent crew,
  vanaf de plek waar de zee je laatst had - binnen `BOARD_REACH` omdat de ladder halverwege
  ligt), na de voet of een sprong `leaveBoat`. Het roer loslaten is `letGoBoat`, het roer
  pakken `takeBoat` vanaf het dek. `walkCallbacks` in main.js.
- **Wie meevaart, volgt.** Zolang iemand anders de romp beweegt (een andere piloot, of een die
  net losliet en de romp laat uitlopen op zijn laatste woord: `hullFollowed`) stapt jouw
  loopmodus de romp niet zelf en glijdt `glideBoats` hem langs het spoor. Een romp met niemand
  aan het roer en geen spoor is de jouwe om stil te laten liggen.
- **Het dek is een referentievlak, en je staat op dat vlak.** Wie op de romp staat (dek, ladder,
  roer) staat op een punt van haar eigen stelsel, en waar dat in de wereld is komt uit de
  transformatie waarmee de romp *dit frame* getekend wordt (`hullPointOf` in `web/js/boat.js`),
  niet uit `toWorld` en een hoogte. Gemeten in de browser op een staande settler: het punt lag
  tot 0.05 naast het dek (0.035 in x, 0.048 in z, en 0.044 te laag in y), want een romp die
  stampt en rolt om haar waterlijn schuift een dek dat 1.16 boven de draaipunt ligt ook opzij,
  en dat is een settler van een halve eenheid met voeten die over de planken glijden. Daarna 0
  in alle drie. Wat dat vraagt: de romp wordt eerst gepositioneerd (`poseHull` in main.js, plaats
  en deining op de klok van dit frame, en de vloot-lus tekent hem daarna met dezelfde getallen,
  dus tweemaal is eenmaal), en dan wordt het punt uit zijn matrix gelezen. De settler helt met
  het vlak mee (`hullTiltOf`: haar rotatie min haar koers, dus eerst om de verticaal gedraaid en
  dan gekanteld) en de camera staat in het vlak: zijn afstand tot jou meegedraaid met de tilt en
  zijn `up` de hare, zodat het dek stilstaat op het scherm en de zee schommelt. Een vlakke camera
  boven een dek dat eronder kantelt liet alles om je heen zwaaien terwijl je zelf stilstond, tot
  25 px in de opname. Zo ook de anderen op jouw scherm (`hullOf.point` en `tilt` voor het dek,
  `seatOf` voor het roer van een schip, dat niet in het midden van de romp ligt).
- **Het schip is de hitbox** (`shared/hullwalk.mjs`). Het dek was vijf platte rechthoeken met een
  lijst relingen, met de hand afgeleid uit de bake, en het klopte telkens ergens anders niet: op
  de trap naar het achterdek sprong je van 1.108 naar 1.738 en stond de settler tot 0.6 in de
  treden (gezien op een opname); ik gaf het dekstuk een `slope`, en het volgende was het ronde
  plateau bij het roer, 0.21 hoog en in geen enkele rechthoek. In plaats van dat te blijven
  bijstellen wordt het loopvlak uit het model zelf gehaald: `scripts/build-shipwalk.mjs` snijdt de
  bake met een verticale lijn door het midden van elk vierkantje van 5 cm en schrijft op waar de
  lijn een oppervlak raakt, op welke hoogte, en of dat er een is om op te staan (niet steiler dan
  70 graden, welke kant de winding ook op wijst: de bake heeft stukken die verkeerd om staan, de
  voet van de boeg-helling erbij) - `web/js/shipwalk-map.js`, 124 kB, en `npm run models` snijdt hem
  opnieuw zodra het schip gebakken wordt. Alles wat een lichaam kan volgt daaruit, zonder lijst:
  *vloer* is het hoogste oppervlak binnen een stap (0.25) van de voeten met een lichaam aan lucht
  erboven, dus treden, hellingen, het plateau en een lage kist; *obstakel* is wat dan ook, welke kant
  het op wijst, in de hoogte van een lichaam boven die vloer, dus een muur, een mast, een kanon,
  een ton die te hoog is, het schot onder de balustrade; en *steun* is dat de hele voetafdruk
  (straal 0.24, breder dan het lichaam) vloer heeft, niet meer dan een stap lager, zodat je niet
  over de bovenkant van een verschansing loopt en niet van een rand af. Wat dan overblijft is
  springen. `stepHull` loopt zo (per as, op de vloer die bij de stap hoort, in de lucht alleen
  gestopt door wat boven de voeten zit); een lichaam dat onder het dek valt zonder iets om op te
  landen is van het schip af. De zee loopt niemand over een schip en houdt een positie vast aan de
  grove rechthoeken van `shared/crafts.mjs`; die zijn voor de zee, de ladders en wat geen model
  heeft (de Benchy). Gemeten en getest (`tests/shipwalk.test.mjs`): vanaf het middendek is het
  hele schip bereikbaar - beide trappen, het achterdek, het plateau, het voordek en de boeg tot de
  punt - met masten, kanonnen, het rooster en het schot als obstakel; 150 startpunten in acht
  richtingen lopen vijf seconden zonder dat iemand van het schip valt, en springen kan wel
  (waar de verschansing lager is dan een sprong: de taille bij de ladder, het voordek; het
  achterdek heeft 0.4 en dat is te hoog, precies zoals het getekend staat). De kaart wordt
  vergeleken met een verse snede van de bake, dus een nieuw geboord schip dat niet opnieuw is
  gesneden laat de test falen. Het plateau is nu ook waar de piloot staat (`SHIP_HELM` vraagt het
  aan het model), en waar de ladder je op het dek zet en het punt een pas voor het roer zijn de
  dichtstbijzijnde vrije plekken (`nearestStand`).
- **Geen toets voor een schip.** `isShip` in main.js: geen `boat`-interactable, `takeBoatAt`
  slaat een schip over en de haven biedt er geen aan. Een boot (de Benchy) blijft E.

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
2. **De sloep.** *Gebouwd (28 september), als het piratenschip:* `CRAFTS.galleon` in
   `shared/crafts.mjs` (crew 5, roer, vijf dekvlakken en relingen, gemeten met de stralen van
   `scripts/build-pirateship.py`, en `sail`: sneller, trager in de bocht, botsen op boeg en
   schouders). `kindOf` maakt de eerste boot van elk eiland tot dit schip, voor de zee en elke
   pagina hetzelfde. Sinds 29 september ook twee touwladders (`ladders`) en relingen met een
   hoogte (`top`).
3. **Zelf lopen op een varend dek.** *Gebouwd (28 september):* `leaveHelm`, `takeHelm`,
   `stepOnDeck` in walk.js, `state.deck`, `stepDeck` en de overgangen in `shared/deck.mjs`
   (`tests/deck.test.mjs`). Sinds 29 september komt E daar niet meer aan te pas behalve voor
   het roer: aan boord via de touwladder, eraf door te springen of langs de ladder.
4. **Passagiers voor elkaar.** *Gebouwd:* net.js stuurt `on` en `d` = [x, y, z, yaw] zodra
   walk.js een `state.deck` heeft; de zee stuurt wie op welk dek staat als eigen lijst `d`
   naast de rijen, zodat een oudere pagina de rij leest zoals altijd; peers.js tekent zo
   iemand als romp (`hullOf` uit main.js) ⊕ plek op het dek, met die plek op dezelfde
   tijdlijn. `boardBoat` en `leaveBoat` worden sinds 29 september aangeroepen, bij de ladder.
   `tests/net-deck.test.mjs`. Geen `SEA_V`-stap.
5. **De zee rekent mee.** *Gebouwd:* `lib/boats.mjs` houdt een `crew` bij (de stuurder telt
   mee, `crewOf` uit de craft), `board` alleen binnen `BOARD_REACH` en tot vol, één dek per
   lichaam, en een bemande boot drijft niet naar huis. `lib/players.mjs` neemt een dekpositie
   alleen aan van wie aan boord is, klemt hem op de planken en rekent de wereldpositie zelf
   uit vanaf de romp zoals de zee die heeft. Aan boord is voor bewakers, lava en vechten
   hetzelfde als stuurder (`pilotsOf` telt de crew mee). `tests/crew.test.mjs`.
6. **Het roer overdragen.** *Gebouwd:* `letGo` maakt de stuurder crew; wie losliet mag de
   romp nog `COAST_MS` (8 s) verplaatsen terwijl hij uitloopt, tot een ander het roer pakt.
   Op de pagina is dat het roer loslaten (E, `letGoBoat`) waarna `stepOnDeck` de romp met
   gas dicht laat uitlopen, en het roer weer pakken (E, `takeBoat`); de rest van de crew volgt
   het spoor (`hullFollowed`).

## Open vragen

- Wie mag op wiens boot: alleen spelers van hetzelfde eiland, of iedereen op zee?
- Een zesde klimmer. De zee weigert `board` op een volle boot (`crew: 5`) zonder antwoord, en
  de pagina weet het niet: hij staat op zijn eigen scherm op het dek en is voor de anderen een
  zwemmer bij de ladder. Een `refused`-bericht en een klim die je terugzet is de oplossing;
  tot dat er is komt dit alleen voor bij vijf mensen op één schip.
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
