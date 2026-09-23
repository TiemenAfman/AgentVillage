# De klok en de hemel horen bij de zee

Doel: iedereen in één zee ziet hetzelfde uur, dezelfde zon en maan, dezelfde maand/seizoen,
hetzelfde weer, dezelfde wolken — en de borrel begint voor iedereen tegelijk. De zee is de
enige klok; de pagina leidt alles daaruit af en leest zelf nooit meer `Date` voor "hoe laat
is het in de wereld".

## Wat er al staat

Veel is al gecentraliseerd, en dat blijft het fundament:

- **Het moment.** De welcome draagt `now` en `tz` (`lib/sea.mjs` `welcome()`); de pagina
  bewaart `state.seaSkewMs` en `state.seaTz` (`onFleetNews` in `web/js/main.js`) en
  `currentHour()` rekent UTC + `tz`. Het uur — en daarmee `sunDirection(hour)`, de zon- en
  maanschijf, sterren, licht, de klok op de toren en de HUD — komt dus al van de zee.
- **Het weer.** `lib/weather.mjs` draait op de beat, gaat mee op de welcome en als één
  `{t:'weather'}`-broadcast; `web/js/weather.js` vermenigvuldigt wat `world.js` voor het uur
  heeft gezet. Regen komt binnen met `since`, dus een joiner staat meteen in de bui.

## Wat er lekt

Gemeten in de code op 23 september 2026:

1. **`tz` is de tijdzone van de host-machine, en die is in Docker UTC.** `tz:
   -new Date().getTimezoneOffset()` op de zee. `Dockerfile.sea` zet geen `TZ`, dus de open zee
   op de NUC draait 's zomers twee uur achter op Nederland — de borrel om 16:30 wereldtijd is
   18:30 op de muur. En `tz` is één getal op het moment van de welcome: een zee die over de
   zomertijdwissel heen draait, houdt voor een pagina die al verbonden was de oude offset.
2. **Maand, seizoen en weekdag komen uit de browser, niet uit de zee.**
   `new Date(timeNow()).getMonth()` en `d.getDay()` (borrel) in de frame-loop gebruiken de
   *lokale* tijdzone van de browser; `createWorld`/`createGuestIsland` krijgen zelfs
   `new Date().getMonth()` zonder skew (`main.js:2357`, `main.js:2746`, `guest-island.js:47`,
   `world.js:1327`). Rond middernacht op de 1e van een maand, of met een speler in een andere
   zone, staan twee eilanden in een ander seizoen en is het bij de één vrijdag en de ander niet.
3. **De borrel is stil sinds de zee de bewoners laat lopen.** `setGather` in
   `shared/settlerwalk.mjs` wordt nergens meer aangeroepen — de aanroep verdween met
   `5bfd696 Laat de zee ook onze eigen bewoners lopen`. De pagina zet nog wel de tafels neer
   (`state.borrel.show`), maar niemand loopt naar het plein. De beslissing "het is borrel" hoort
   op de zee, want die loopt de crowd; de comment in `main.js` zegt dat al, de code niet.
4. **De wolken zijn per pagina.** Negen wolken, geplaatst uit een rng en verschoven met
   `c.x += c.speed * dt` sinds het laden van de tab (`world.js` `update`). Twee spelers op
   hetzelfde eiland zien andere wolken, en de wolkschaduw valt bij de één op het stadhuis en
   bij de ander op zee.
5. **Golven en deining lopen op de klok van de tab.** `waterMat.uniforms.uTime = time` (sinds
   laden) en de bob-klok in `shared/boating.mjs`. Puur cosmetisch — niemand vergelijkt golven
   tussen twee schermen — maar het staat in het rijtje "etc".
6. **De maan heeft geen fase.** `moonDisc` is een bol op de nachttak van `sunDirection`; hij is
   al gedeeld omdat het uur gedeeld is, maar er is niets aan af te lezen.
7. **De lenzen zijn lokaal en dat is niet te zien.** `?hour=`, de klok-chip (wisselt tussen
   7/12/18.5/22) en het scrubben door de kroniek veranderen alleen dit scherm, terwijl de
   HUD en de torenklok dan een uur tonen dat geen wereldtijd is.

## Beslissingen

**Eén module rekent, iedereen leest.** Nieuw: `shared/worldclock.mjs`, puur (geen three.js,
geen document, geen lokale `Date`-methodes — alleen `getUTC*`, die in beide runtimes exact
gespecificeerd zijn). Eén functie:

```js
worldTime(epochMs, tzMinutes) -> { hour, month, weekday, season, moon }
```

`hour` zoals `currentHour()` nu doet, `month`/`weekday` uit UTC + `tz` (dus níet
`getMonth()`/`getDay()`), `season` via de bestaande `seasonOf` (die verhuist naar `shared/`,
`world.js` re-exporteert hem), `moon` als fase 0..1 uit het epoch (synodische maand
29,530589 d vanaf een bekende nieuwe maan). Zowel de zee (borrel) als de pagina importeren
dit; er bestaat geen tweede kopie van "hoe laat is het".

**De zee kent een tijdzone bij naam, niet een getal.** `SEA_TZ` (IANA, bv.
`Europe/Amsterdam`); zonder die variabele de zone van de host
(`Intl.DateTimeFormat().resolvedOptions().timeZone`). De offset wordt *per moment* uitgerekend
via `Intl`, dus zomertijd klopt vanzelf. Op de wire blijft `tz` een getal in minuten — dat
begrijpt elke pagina al — en de zee stuurt `{t:'clock', now, tz}` zodra die offset verandert
(twee keer per jaar), op dezelfde beat als het weer: één vergelijking per tick. Een oude
pagina negeert het onbekende type (de `switch` in `net.js` heeft geen default die klaagt), dus
geen `SEA_V`-bump. `Dockerfile.sea` krijgt `ENV SEA_TZ=Europe/Amsterdam` als default; de
`node`-image heeft volledige ICU, dus `Intl` met een tijdzone werkt daar. Voor de loopback-zee
van `serve.mjs` verandert niets: dat is de zone van deze machine, zoals nu.

*Waarom niet de naam over de wire sturen en de pagina `Intl` laten doen:* dan hangt de
wereldtijd van de tzdata van elke browser af, en een telefoon met oude tzdata staat een uur
verkeerd. Het getal van de zee is de enige waarheid.

**De borrel wordt weer echt, en de zee beslist.** In de beat (`lib/sea.mjs`, naast
`weather.tick()`) rekent de zee `worldTime(now(), tz)`, bepaalt borrel ja/nee met de drie
constanten die nu in `main.js` staan (die verhuizen naar `shared/worldclock.mjs`, één kopie),
en roept bij een *overgang* `setGather(on)` aan op elke crowd — en op een crowd die tijdens een
borrel wordt aangemaakt. De pagina leest dezelfde functie voor de tafels, dus tafels en mensen
kunnen niet uit de pas lopen. `tests/settler-walk.test.mjs` blijft groen: settlerwalk krijgt
een vlag, geen klok.

**Wolken zijn een functie van wereldtijd, geen toestand.** `x = wrap(x0 + speed * t)`, met
`t` = seconden wereldtijd modulo de lus (180 eenheden / speed), in plaats van `+= speed * dt`.
Dezelfde rng-volgorde, dus de wolken zien er hetzelfde uit; ze staan alleen voor iedereen op
dezelfde plek. Kost niets op de wire. Grens die blijft: de wolkenlaag hangt aan `world.js` van
*deze* pagina (rond ons eigen eiland), niet per regio — een joiner die naar de host vaart ziet
boven de host zijn eigen wolkenlaag. Per-regio wolken is een apart plan als het ooit opvalt.

**Golven: optioneel, en alleen omdat het gratis is.** De drie golffrequenties in de shader
(1,1 / 0,9 / 1,3) hebben een gemeenschappelijke periode van precies 20π s (22π, 18π, 26π), dus
`uTime = wereldseconden mod 20π` is naadloos én blijft klein genoeg voor een float32. De
deining van boten (`shared/boating.mjs`) houdt zijn eigen tick-klok: die draait deels op de zee
en moet deterministisch blijven, dus daar geen wandklok in.

**De lenzen blijven lokaal, maar zeggen dat ze het zijn.** `?hour`, de klok-chip en de kroniek
zijn een manier van *kijken*, zoals `?sky`; ze worden geen zee-actie. Wel: zolang er een lens
op staat toont de chip dat (bv. `12:00 · lokaal`), zodat niemand een screenshot van "de wereld
om 12:00" maakt terwijl het daar avond is. De borrel volgt nooit een lens — die volgt de zee.

**Geen `Date` meer in de pagina voor wereldtijd.** Alle zes plekken uit punt 2 gaan via
`worldTime(timeNow(), state.seaTz)`. Een bron-scantest (zoals de kale-`fetch`-scan in
`tests/api-base.test.mjs`) faalt op `getMonth()`/`getDay()`/`getHours()` in `web/js/`, met
alleen de workbench (`demo.js`, die de muurklok bedoelt) en `ui.js`-datumlabels uitgezonderd.

## Fasering

1. **`shared/worldclock.mjs` + `SEA_TZ`.** *Gebouwd op 23 september 2026* — `lib/seaclock.mjs`
   is de zone-kant, `worldNow()` in `main.js` de pagina-kant, `tests/worldclock.test.mjs` de
   tests incl. de bron-scan (`mail.js` staat er ook in als uitzondering: echte datums). De
   borrel-constanten staan nog in `main.js`; die verhuizen in fase 2.
   Wat erin zit: module, tests (uur/maand/weekdag rond een maandgrens en rond de zomertijdwissel, maanfase van een bekende volle maan), de zee rekent
   de offset per moment en broadcast `clock` bij een wissel, `Dockerfile.sea` krijgt de
   default, de pagina gebruikt `worldTime` op alle plekken, plus de bron-scantest.
   `tests/sea-image.test.mjs` bewaakt dat `shared/worldclock.mjs` in de image zit (`shared/`
   wordt al gekopieerd).
2. **De borrel terug.** Zee zet `setGather` op overgangen; test met een geïnjecteerde `now` op
   vrijdag 16:29 → 16:31 → 17:01 dat de vlag precies twee keer omgaat.
3. **Wolken (en eventueel golven) op wereldtijd.**
4. **Maanfase tekenen** — de schijf wordt een sikkel/halve/volle maan via een simpele
   terminator-shader of een tweede, donkere bol ervoor. Puur cosmetisch, als laatste.
5. **Lens zichtbaar maken** in de klok-chip.

## Open vragen

- **Moet een zee een eigen tempo kunnen hebben** (`SEA_DAY_MINUTES`: een dag van twee uur, zodat
  wie 's avonds speelt ook eens daglicht ziet)? Met `worldclock` als enige lezer is het één
  regel (`epoch0 + (now - epoch0) * scale`), maar het raakt het weer (spell-lengtes zijn in
  echte minuten gekozen) en de borrel. Voorstel: nu niet, maar de module zo bouwen dat het kan.
- **Seizoensafhankelijke daglengte.** `sunDirection` gaat altijd van 6 tot 18 uur op. Met
  `month` gedeeld zou december korte dagen kunnen krijgen; buiten dit plan, want het verandert
  het uiterlijk, niet de synchronisatie.
- **Tot de welcome er is** tekent de pagina de eigen wandklok en springt dan. Meestal binnen
  een seconde, dus accepteren; alleen iets doen als het in de praktijk opvalt.
