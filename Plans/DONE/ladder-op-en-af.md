# ✅ Een touwladder op- en afstappen

Martijns opname van 8 oktober 2026 (de Avonturier op de buitenladder van de Salty Kraken): van het
landingsplatform naar de ladder stond hij in één frame stil en hing hij het volgende frame met zijn
knieën omhoog op de sporten, en na de bovenste sport stond hij in één frame rechtop op de plank.

## Wat er sprong

- **De houding.** Op en af een ladder nam een andere clip het lichaam in één frame over (idle of
  lopen → Climbing Up A Ladder en terug), op volle sterkte.
- **De weg.** De sporten liepen door tot de voeten op de hoogte van de plank of reling stonden, en
  daarna liep het lichaam zijwaarts in de looppose over de rand.
- **Waar het lichaam getekend wordt.** Een watertrappende zwemmer hangt `TREAD_SINK` (0,28) onder
  zijn voeten: van de onderste sport van het galjoen het water in zakte hij 0,28 in één frame.
- **Kleiner:** bovenop het galjoen zocht walk.js de vrije plek (`nearestStand`) pas bij aankomst
  (0,14 verspringen), en de Reiziger liet zijn armen na 0,4 s in één frame van gedempt naar exact gaan.

## Wat het nu doet

- **Twee Mixamo-clips** (Martijns keuze): *Climbing Up A Ladder To Standing* (`climbTop`) over de top
  en het laatste stuk van *Start Climbing Ladder* (`climbOn`, frames 37-61: ervoor staat hij met zijn
  rug naar de ladder en draait zich om) van de vloer op de sporten. Elk ook achteruit, naar beneden.
  De bake (`STEPS` in `scripts/bake-mixamo-gait.py`) schrijft per rij `way`: hoe ver de voeten op dat
  moment vooruit en omhoog zijn.
- **De weg volgt de clip** (`web/js/ladder-way.js`, voor alle drie de ladders en de werkbank): de
  sporten eindigen een stap onder de top, en de weg erover is die van de clip, gelegd naar waar de
  ladder heen leidt; op dat stuk gaat het lichaam op de tijd van de clip (`topPace`, net zo snel
  tegenover de clip als de sporten eronder), zodat rig en voeten niet uit elkaar lopen. Waar de ladder
  minder ruimte heeft dan de clip vooruit stapt (de mastladders in de Kraken: 0,19 tegen 0,33), wordt
  de stap ingedrukt.
- **`state.climbing`** zegt nu ook `top` (0..1 over de rand) en `floor` (of de voet een vloer is om
  vanaf op te stappen: niet bij het galjoen, daar kom je uit het water).
- **Een vervaging bij elke overgang**: de rig houdt de houding van het vorige frame vast en laat de
  nieuwe er in `LADDER_FADE` (0,35 s) overheen komen, bij het begin en eind van de ladderweg, van de
  sporten, en van de ene klimclip naar de andere. walk.js doet hetzelfde met waar het lichaam getekend
  wordt (`STEP_OFF_S`, 0,5 s, ook het omdraaien naar de romp toe); de voeten, de camera en wat de zee
  hoort blijven waar walk mode ze zet.
- **De Reiziger** heeft geen clips: over de top laat hij de klimbeweging los naar staan en tilt zijn
  rechterknie op (`settleReach`).
- **Anderen** lezen de stap over de rand uit de positie alleen (walk.js `ladderAt` → `topNear`), en
  spelen dezelfde clip; geen nieuw bit op de lijn, dus geen redeploy van de zee nodig.

## Gemeten

`tests/ladder-step.test.mjs` loopt met de echte walk mode en zijn eigen rig op en af de Kraken-ladder,
de zijladder van het galjoen (uit en in het water) en haar mast, beide lichamen: geen gewricht mag in
één frame verder bewegen dan 0,06 (de klim zelf haalt 0,053), de romp niet sneller draaien dan 0,2 per
frame. Zonder de vervaging was het 0,2 per frame, en 0,47 bij het water in.

## Open

- Naar beneden van de plank loopt hij de laatste 0,13 achteruit naar de rand met de loopclip.
- *Start Climbing Ladder* draait in het gebruikte stuk nog zo'n 40 graden bij; beoordeel in
  `/avatar-motion.html` (Klimmen → Op- en afstappen) of een ander venster beter oogt.
