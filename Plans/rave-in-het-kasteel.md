# Een rave in het kasteel

Begonnen op 26 september 2026 (een zaterdag). Gevraagd: "als ik het kasteel inloop op zaterdag
tussen 21:00 en 03:00 dan wil ik terechtkomen in een rave, net zoals ik de tavern betreed. Grote
donkere zaal met lasers en ravende settlers."

## Wat er gebeurt

- Het kasteel krijgt een poort waar je voor kunt staan (`E`), zoals de tavern een deur heeft. De
  interactable staat **voor de poort**, niet op het midden van het 7x7-kavel: `DOOR_DIR[rot]` maal
  de halve breedte vanaf het midden, anders gaat de prompt ook aan de achterkant van de muur op.
- **Zaterdagavond 21:00 tot zondagnacht 03:00** (in de tijd van de zee, `worldNow()`) is de grote
  zaal een rave: je stapt naar binnen zoals in de tavern (`enterInterior('rave')`). Daarbuiten zit
  de poort dicht en zegt een toast wanneer hij opengaat - zo ontdekt iemand de rave ook op dinsdag.
- Om drie uur gaan de lichten aan: wie binnen is, staat weer buiten, met een toast.
- Binnen: een donkere stenen zaal (10 bij 8, twee keer zo hoog als de tavern), een podium met een
  DJ achter zijn tafel en een LED-wand achter hem, speakerstapels, een truss met lasers en moving
  heads, een discobal, een bar langs de westmuur met krukken en een uitsmijter bij de deur. Op de
  vloer zo'n zeventig dansende settlers.
- Met het geluid aan: een techno-loop van 16 maten op 132 BPM, zoals al het andere geluid hier
  berekend en niet opgehaald. Buiten, vlak bij het kasteel, hoor je de bas gedempt door de muren;
  loop je naar binnen, dan gaat het filter open - het is dezelfde bron, dus de beat loopt door.

## Besluiten

- **Het venster staat in `shared/daylight.mjs`** (`RAVE`, `raveAt`), naast `GATHERINGS`: dat bestand
  zegt wat een uur betekent voor de mensen, en de wikkel over middernacht (zaterdag 21-24 plus
  zondag 0-3) is precies het soort ding dat in woorden gevraagd wordt en in een decimaal verloopt.
  De zee leest het (nog) niet; niemand loopt op de zee naar het kasteel.
- **De ravers zijn onze eigen settlers**, gekleed zoals op het eiland (`settlerLook` op hun eigen
  huis-id), de actiefste eerst; is het eiland kleiner dan de dansvloer, dan vullen gasten "van de
  andere eilanden" de rest aan in de stijlen die er zijn. Ze zijn meubilair zoals de vaste gasten in
  de tavern: lokaal getekend, niet op de draad. Kinderen (schuurtjes) gaan om twee uur 's nachts niet
  naar een rave.
- **Dansen is een `f.anim` die alleen de tekenkant kent**: `'dance'`, met `f.beat` (tellen van de
  muziek) en `f.move`, in `settler-figures.js` (`dancePose`). Zo tekent `createFigures` de hele
  dansvloer in dezelfde instanced batches als de rest van de bevolking - geen draw call per raver.
  `ANIMS` in `shared/settlerwalk.mjs` (de draad) verandert niet.
- **De maat komt van de muziek.** `sound.raveClock()` geeft de positie in de loop (min de
  uitvoerlatentie); lichten, lasers en de dansers lopen daarop. Staat het geluid uit, dan lopen ze op
  een eigen klok in hetzelfde tempo. Het liedje (`RAVE_SONG`: tempo, maten, waar de break zit) staat
  één keer, in `sound.js`, en `rave.js` leest het.
- **De buffer wordt pas gemaakt als hij voor het eerst nodig is** - de eerste zaterdagavond binnen
  gehoorsafstand - niet bij het aanzetten van het geluid: 16 maten mono op 22 kHz is 2,6 MB Float32.
  Hij telt niet mee in de "zeven geplaatste stemmen"; het is een bed, geen plek.
- **Lasers, spots, discobalspikkels en de LED-wand zijn elk één InstancedMesh** met een eigen
  `MeshBasicMaterial` (additief voor licht door de nevel, `toneMapped: false` voor zuiver groen).
  Het gebouwmateriaal krijgt geen tweede variant; de zaal zelf is één samengevoegde mesh zoals de
  tavern.
- **De dansers wijken voor je uit** in plaats van blockers te zijn: zeventig blokjes op anderhalve
  meter van elkaar is een muur, en een menigte die je niet in kan is geen rave.
- `interior.js` blijft de machinerie; de rave is een tweede `ROOMS`-entry met een `show` (wat
  beweegt), zodat de tavern niets merkt: vuur, plafondhoogte, achtergrond en licht komen uit de def.
- **Niets wat het hele beeld doet flitst sneller dan de beat** (132 BPM = 2,2 per seconde, onder de
  drie per seconde van WCAG 2.3.1): de stroboscoop gaat op kwartnoten, niet op zestienden. Alleen
  de dunne laserstralen en de kleine LED-wand bewegen sneller.
- `?rave` zet de poort open op elk uur, om te testen; `/demo` heeft de deur ook, altijd open.
- Het beeld is op 26 september in het eiland goedgekeurd zoals het is ("the scene is perfect") -
  niet bijstellen zonder dat erom gevraagd wordt.

## Het paard (27 september)

Gevraagd: "Tijdens de rave moet de stable leeg zijn. Je mag raden waar het paard dan staat.."

- **De stal is leeg zolang de rave duurt**: `updateStable(stable, dt, { away })` in `stable.js`,
  met `away = raveOn()` uit `main.js` - dezelfde vraag als de poort, dus ook `?rave`. Paard én
  kippen gaan weg (de kippen horen bij de stal, `attachStable`), en tijdens hun afwezigheid wordt
  niemand gestapt, zodat ze 's ochtends staan waar ze stonden. Het is de zaterdagavond van de
  zee, dus de stal van een buur is op hetzelfde moment leeg.
- **Ze staan in de grote zaal**: het paard onder de discobal (`HORSE` in `rave.js`), het eerste wat
  je vanaf de poort ziet, driekwart naar het podium gedraaid, met de twee kippen aan zijn voeten
  aan de kant van de poort. Alleen als het eiland een stal heeft (`stableComes()` in `main.js`,
  `enter({ stable })`): zonder stal geen paard.
- **De vloer maakt ruimte zonder dansers te verliezen**: elke plek binnen `HORSE_ROOM` van de
  ruggengraat van het paard gaat naar de volgende in de rij verder naar achteren
  (`layout.roomy`), dus met paard dansen er evenveel settlers als zonder. Zonder paard is de vloer
  precies de goedgekeurde vloer van 26 september.
- **Een paard gaat niet opzij**: dansers wijken voor je uit, het paard en de kippen staan in de
  weg zoals een pilaar (drie rondjes langs de ruggengraat, één kleintje per kip; `show.blockers()`,
  die `interior.js` na `enter` vraagt, want alleen de show weet of het paard er vannacht is).
- **Het dansen is `stepDance` in `fauna.js`**, de pose-helft naast `stepPose`: op dezelfde tel als
  de settlers (`S.beats`), dus een hoef komt neer op de kick die je hoort. Headbangen op elke tel,
  om de tel een voorhoef die klauwt, een zwiepende staart; in de eerste tellen van de drop en de
  hele laatste maat van de build (als alle handen omhoog gaan) steigert het. Steigeren kantelt
  om het midden en tilt precies op wat dat de achterhoeven onder de vloer zou brengen, met de
  achterbenen recht naar beneden: het staat op zijn achterhoeven (`tests/rave-stable.test.mjs`
  meet het aan de bake). De kippen knikken met hun kop op de tel en slaan hun vleugels uit
  als het paard steigert.
- Op `/demo` heeft de rave het paard altijd (`enter({ stable: true })`); de stal op het veld houdt
  daar het zijne, want dat is een modellenblad.

## Nog niet

- Andere spelers in de rave zien elkaar wel (`peers.place`), maar niet dansen: een dans is geen pose.
- Geen dansknop voor jezelf.
