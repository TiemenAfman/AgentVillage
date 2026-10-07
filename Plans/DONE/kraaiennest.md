# In het kraaiennest van het galjoen

**✅ Status: gebouwd op 7 oktober 2026.** Martijns vraag: *"kunnen we ook boven in de crowsnest in de mast
zitten? (touwladder op de grote stuurbare boot)"*.

## Wat er al was

Het galjoen (`kindOf` → `'galleon'`, `scripts/build-pirateship.py`, Greggory_Fisher's model) heeft aan
de grote mast al een kraaiennest. Het is een achthoekige mand, buitenstraal 0,72 en rand op 9,24 boven
`DECK_Y`. De vloer ligt op 8,62, ruim 7,5 boven het dek, met een getrapte verhoging rond de steng:
treden op 8,82, 8,96, 9,06 en 9,2. Een ladder of want was er niet, alleen vallen en brassen. Fokkemast
en bezaan hebben geen nest. Er hoefde dus geen nest bij en het model is niet aangeraakt.

## Keuzes

- **Eén touwladder, loodrecht, aan de stuurboord-achterkant van het nest (315°).** Gemeten met
  horizontale stralen rond de mast, van het dek tot de rand: vóór de mast hangt het grootzeil (z 0,45–1,0
  van 4,5 tot 7,7 hoog), opzij lopen de raas en recht achter drie vallen. Op 315° is de kolom vrij,
  op één dun brastouw op 7,5 na. De ladder hangt 0,8 uit de mast, net buiten de flens van de rand.
  `CRAFTS.galleon.aloft` in shared/crafts.mjs; de sporten volgen de klimclip (`RUNG_STEP` vanaf de voet
  op het dek, rung 0), zoals de ladders aan de romp.
- **Een klim die het dek nooit verlaat.** Beide einden liggen op het schip, dus wie klimt blijft crew.
  `walk.js` houdt `state.deck` op het punt van het touw waar je hangt, en net.js stuurt dat als gewone
  `on` + `d`. Er is geen nieuw bericht en geen nieuwe pose-bit. Loslaten (spatie) is een val in haar
  eigen frame (`stepHull`).
- **Het nest staat in de loopkaart als eigen laag** (`SHIPWALK.aloft`, `ALOFT` in
  scripts/build-shipwalk.mjs). Eén byte per hoogte haalt het nest niet: in stappen van 2 cm loopt het dek
  van 0,7 tot 2,6, het nest zit op 8,6. Alles daartussen is zeil en touw, en daar val je doorheen.
  `createSurface` leest alle lagen als één.
- **Vallen is echt vallen.** `stepHull` landde op de hoogste vloer onder je, hoe ver die ook lag. Uit het
  nest was dat 8 eenheden in één frame, en elke sprong op het dek werd op de top van de boog afgekapt.
  Nu land je alleen op een vloer die je in die frame passeert. Wie schrijlings op de rand of een
  verschansing neerkomt, wordt hooguit `NUDGE` (0,3) opgeschoven naar een plek waar hij kan staan, maar
  nooit naar een vloer meer dan een stap lager.
- **Eraf springen kan alleen met een aanloop** (Shift). Een sprong op loopsnelheid stuit tegen de rand en
  komt binnen weer neer; met een aanloop ga je erover en val je op het dek, of overboord het water in.
- **Zitten: E in het nest** (`craft.nest`, `walk.sitOnDeck`). Je zit op de bovenste trede met je rug
  tegen de steng en kijkt over de boeg. De zitplaats is een punt in het frame van het schip: ze vaart,
  deint en kantelt mee (`hullPoint`, `plane`). Opstaan doe je met E, een stap of een sprong, en je komt
  terug waar je stond.
- **De zee**: `DECK_HEIGHT` in lib/players.mjs ging van 4 naar 10. Op 4 hield de zee iedereen in het nest
  of op de ladder halverwege de mast vast. Peers.js tekent iemand op de mastladder klimmend
  (`aloftHolding`, uit de dekpositie), en iemand in het nest gewoon met de SITTING-bit.

## Patch of minor

Een patch: geen `SEA_V`, geen layout- of bundelveld. Wel moet de open zee opnieuw gedeployed worden. Een
oude zee kapt een dekpositie af op 4, en dan zien anderen je halverwege de mast hangen.
