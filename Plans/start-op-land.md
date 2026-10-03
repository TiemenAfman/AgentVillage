# 🚧 Start op land

Plan van 3 oktober 2026. Wie geen eiland van zichzelf heeft (de app, en de webversie `/play` -
alles op het `STANDALONE`-pad, niet alleen `APP`) begon tot nu toe in een bootje midden op zee,
op een vrije ligplaats van open water. De keeper wil dat zo iemand **op land begint, met een
bootje klaar**.

## Waar je begint

Eén keer gekozen, bij het opstarten (`standaloneHome`, na `learnTheWorld`), uit de vloot zoals
die dan is. Daarna niet opnieuw: de vloot verandert (een starter wordt geclaimd, een eilandje valt
weg zodra iemands `reach` erover komt) en een speler die opeens ergens anders staat is erger dan
een bootje dat even verder moet varen.

1. **Een vrije starter.** Die heeft een plein, een put, een kroeg met waard en een stadhuis met
   burgemeester - daar vinden zwervers elkaar. Daarom krijgt iedereen **dezelfde**: de starter
   met het hoogste slot. Een nieuwkomer neemt de vrije starters van het laagste slot af
   (`fleet.publish`), dus de hoogste blijft het langst van niemand. Je staat op het plein, een
   paar passen van het midden (per speler-id verspreid, zodat twee spelers niet in elkaar staan).
   Een starter heeft geen haven (`harbours: []`, `landing: null`), dus `mooringsFor` geeft hem
   geen steiger en geen boot: het bootje is de **eigen skiff, afgemeerd voor zijn kust** - op het
   eerste water van minstens `SKIFF_DEPTH` diep, langs de kortste van zestien richtingen vanaf
   het plein.
2. **Anders een eilandje bij het eiland van een echte speler** (geen starter, geen vulkaan; een
   `live` eiland eerst, dan het laagste id): het dichtstbijzijnde eilandje (`isletsNear`) bij zijn
   middelpunt. Je staat op droge grond, vrij van de palmstammen; de skiff ligt in de ondiepte voor
   het strand, langs dezelfde richting naar buiten.
3. **Anders een eilandje bij de vulkaan.**
4. Lukt niets daarvan (een lege zee, een zee van vóór dit), dan de oude start: in de skiff op de
   eigen ligplaats.

De keuze is puur en gedeeld: `shared/start.mjs` (`startTarget` kiest de plek, `starterSpot` en
`isletSpot` zoeken waar je staat en waar de skiff ligt), getest zonder pagina. Een starter herkent
de pagina aan `starter: true` op de vlootrij - nieuw, en een oudere pagina negeert het - of, tegen
een zee van vóór dat veld, aan zijn id (`5ea5` + slot, `starterId` in lib/islandbundle.mjs; een
test houdt die twee gelijk).

## Wat "thuis" is

Niets daaraan verandert. `homeOrigin` blijft de vrije ligplaats van open water uit `nextOrigin`
op `makeTerrain(…, { open: true })`: de pagina tekent haar eigen eiland op de oorsprong, en een
starter of eilandje op diezelfde plek zou over dat thuis heen liggen (een gast die thuis overlapt
wordt geweigerd en als mist getekend). De startplek is gewoon een punt in de wereld; de pagina
rekent hem met `worldToScene` om, en loopt erheen zoals ze al over gasteilanden en eilandjes
loopt (`archipelago.height`, de `seabed`-haak). De eilandjes volgen `focusPoint()`, dus het
eilandje waar je op staat wordt getekend, ook ver van de ligplaats.

## Wat de zee weet

Bijna niets, en dat blijft zo. Een lichaam op een eilandje is gewoon een pose; op een starter is
het een wandelaar te voet op het eiland van de zee. De skiff wordt gelanceerd waar hij afgemeerd
ligt (`launch` neemt elke positie binnen de wereld), en de pagina laat het roer meteen los
(`dropBoat`), zoals `relaunchSkiff` al deed als je niet aan boord was. Zwervers op een starter
tellen nergens voor (niet tegen `MAX_ISLANDS`, alleen tegen `maxPlayers` zoals altijd), en een
starter is niet vijandig: geen wachters.

**Wordt de starter geclaimd** (`retireStarter`), dan stuurt de zee iedereen die erop loopt terug,
zoals nu: een zwerver naar zijn skiff. Twee dingen erbij:

- Een skiff die binnen het rooster van de **nieuwkomer** ligt, wordt eerst naar buiten gelegd, net
  voorbij de rand van dat rooster langs de lijn vanaf het midden - anders wordt de zwerver in een
  bootje op het land van de nieuwkomer gezet, of in zijn huizen. De nieuwkomer krijgt de ligplaats
  van de starter maar heeft zijn eigen grond.
- `evicted` krijgt `why: 'settled'` en `by` (de naam van de nieuwkomer). De pagina zegt dan
  vriendelijk "Nieuwland is zojuist gekoloniseerd door …; je bootje ligt klaar" en zet je in de
  skiff op de plek die de zee noemt (`m.x`/`m.z`, niet haar eigen oude kopie). Een pagina van
  vóór dit kent `settled` niet en zegt wat ze altijd zei.

## Respawn

Verdrinken of een verjaging: terug in de skiff, zoals altijd (`health.refuge`). Die ligt nu voor
de kust van de startplek, dus dat ís terug naar de startplek, aan de riemen. Niet naar het plein:
de zee kent de startplek niet, en hem die laten kennen is een nieuw veld in de join voor iets dat
de skiff al oplost.

## Patch of minor

Een **patch**. Geen `SEA_V`, geen laag, niets in `layout.json` of een bundel: de vlootrij krijgt
`starter: true` erbij, `evicted` `why: 'settled'` en `by`, allebei additief. De start op land werkt
tegen elke zee (de pagina herkent een starter ook aan zijn id); het vriendelijke bericht en de
verplaatste skiff bij het claimen vragen een zee met deze code, dus **de open zee (stack 28) moet
daarvoor met de hand worden geredeployd**.

## Bekende gaten

- Een zwerver die op het moment van claimen in zijn skiff boven het land van de nieuwkomer
  dobbert (aan het roer, dus niet te voet), wordt niet verplaatst; hij ligt aan de grond en roeit
  weg.
- De keuze kijkt niet naar hoe druk het op de hoogste starter is.
