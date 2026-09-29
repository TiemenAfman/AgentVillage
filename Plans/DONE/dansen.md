# Zelf dansen

**✅ DONE**

Begonnen op 27 september 2026, na het paard op de rave. Gevraagd: "Hebben we ook een dans-knop?"
en daarna "Bouw voor iedereen zichtbaar". In `Plans/DONE/rave-in-het-kasteel.md` stonden allebei onder
"Nog niet": geen dansknop voor jezelf, en andere spelers in de rave zien elkaar niet dansen.

## Wat er gebeurt

- **R** (op de controller het kruisje omhoog) en je settler danst, waar je ook staat: op de
  dansvloer, op het plein, in de tavern. Nog een keer R, of weglopen, springen, hurken, zwaaien
  of een schild opheffen, en je staat weer gewoon. Niet op de fiets, niet in de boot, niet
  zwemmend, niet zittend of liggend. Een biertje drinken mag wel: dansend, met je glas.
- Je danst dezelfde dans als de settlers op de rave (`dancePose`): twee eigen bewegingen die om
  de vier maten wisselen, en in de laatste maat van de build de handen omhoog. Welke twee is
  van jou (uit je eigen id), dus iedereen die naar je kijkt ziet dezelfde stijl.
- Je danst **op de beat die je hoort**: in de rave op de muziek (of de klok van de zaal als het
  geluid uit staat), daarbuiten op dezelfde 132 BPM op een eigen klok.
- Andere spelers zien je dansen - op het eiland en binnen - en zij zien je op *hun* beat. Dat is
  geen gebrek: iedereen hoort de muziek op zijn eigen scherm, en een dans die over de lijn in de
  maat van de afzender zou lopen, loopt op het scherm van de kijker naast de muziek.

## Besluiten

- **Dansen is een pose-bit, geen event.** Zwaaien en drinken zijn events omdat ze voorbij zijn
  voordat twee pose-tikken langs zijn; dansen duurt, net als zitten en liggen, en een bit wordt
  herhaald: wie later binnenkomt of even wegvalt, ziet je nog steeds dansen. `DANCING` is het
  volgende vrije bit, en het masker in `lib/players.mjs` gaat mee omhoog.
- **Alleen het bit gaat over de lijn, niet de beweging en niet de tel.** Welke beweging komt
  uit de id van de danser en de maat, en de maat is die van de kijker - zo is er niets te
  synchroniseren en past het in de pose die toch al verstuurd wordt.
- **Eén kopie van de dans.** `dancePose` verhuist uit `settler-figures.js` naar een eigen klein
  bestand (`web/js/dance.js`) zodat het rig van de speler (`classic-avatar.js`) en de instanced
  settlers dezelfde bewegingen lezen; `settler-figures.js` exporteert hem door voor wie hem daar
  al importeerde.
- **Waar de beat vandaan komt is één functie in `main.js`** (`danceBeat`): de zaal zelf als je in
  de rave bent (die loopt al op de muziek als die er is), anders de muziek als je die hoort,
  anders de wandklok op `RAVE_SONG.bpm`. Walk mode en `peers.js` krijgen die functie mee in
  plaats van hem ieder zelf uit te rekenen.
- **Een zee van vóór dit bit maskeert het weg**, zoals bij de fiets (`FLAG_RIDING`): op een eigen
  zee (de islander start hem uit deze checkout) werkt het meteen, op de open zee pas als die
  opnieuw is uitgerold. Geen `SEA_V`-ophoging: een oudere pagina die het bit krijgt negeert het.
- **De dans zit in het rig zelf** (`classic-avatar.js`, `update({ dancing })`): armen en benen
  uit `dancePose`, en de bob, de lean, de twist en de roll op de wortel van het rig, bij de
  voeten - de ledematen hangen niet aan de romp, dus daar kan het niet. Zo hoeven walk.js en
  peers.js alleen door te geven *dat* er gedanst wordt. Niet in first person: dat is een
  viewmodel dat niemand anders ziet. Op het podium van de rave stond een andere speler tot zijn
  knieën in de planken (de vloer binnen is plat, het podium is alleen walk levels); een danser
  wordt daarom net als een zitter op de hoogte getekend die hij zelf stuurde.
- **Getest**: `tests/dance.test.mjs` (de keuze van de beweging, het rig, wanneer het niet danst,
  de knop op de controller, en `peers.js` zelf - dat laadt onder Node met een canvas-stub - die
  een ander op de beat laat dansen en op het podium zet), `tests/player-look.test.mjs` (het bit
  gaat de lijn op en door de zee, en de beweging en de tel niet). In de browser op `/demo`
  bekeken: op het veld en tussen de ravers, en R, lopen, springen, hurken en de fiets gedragen
  zich zoals hierboven. Twee pagina's op één zee zagen elkaar wel, maar het bos op het verse
  eiland stond telkens tussen ze in; dat stuk is dus met de test van `peers.js` gedekt en niet
  op beeld.

## Nog niet

- Op de telefoon: de touch-knoppen zijn net naar de indeling van Xbox Cloud Gaming gelegd en
  krijgen er geen knop bij zonder dat daarom gevraagd wordt.
- Zelf een beweging kiezen.
