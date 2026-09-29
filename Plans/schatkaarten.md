# Schatkaarten: iets te vinden op de eilandjes

**🚧 Status: plan van 29 september 2026, nog niet gebouwd.**

## Aanleiding

De eilandjes zijn net begaanbaar gemaakt (ondiep water, solide palmen, een camera boven water,
[starter-eilanden.md](DONE/starter-eilanden.md)), en er is niets te doen op een eilandje behalve er
staan. Tegelijk heeft het inventory-scherm een tabel met slots en een kleurenrij, maar geen enkele
manier om er iets *bij te vinden*. Het idee: een schatkaart wijst je een eilandje aan, je vaart
erheen, je graaft op de plek, en in de kist zit iets voor je inventory.

## Wat er al is

- **De eilandjes zijn rekenwerk** (`shared/islets.mjs`): een rooster van `ISLET_PITCH` (96), één
  hash per vierkant, `ISLET_CHANCE` 25 %, zo'n 1764 vierkanten in de hele wereld. Geen bericht,
  geen veld, geen `SEA_V`: "an islet is where it is because of arithmetic". De grond die je ziet
  en waarop je staat is dezelfde `isletHeight`, en palmen en struiken (`islet.palms`,
  `islet.bushes`) komen uit de eigen rng van het eilandje.
- **Een eilandje kan verdwijnen**: `isletsNear` gooit er een weg als het niet meer `clearOf` de
  vloot is. Maar de *vorm* hangt alleen aan het roostervierkant (`candidate(i, j)`), dus met het
  id `islet:i:j` is het altijd opnieuw uit te rekenen.
- **De kaart en de radar**: de kaart (M) krijgt `islets: mapIslets()` (`main.js:2304`,
  `main.js:3219`), tekent er stippen van met een tooltip in `createWorldMap`, en heeft het
  raster A-P bij 1-16 (`KM` 252). De radar (`createMinimap`, straal 130) leest de hoogte van de
  hele archipel en laat de eilandjes dus vanzelf zien.
- **Het inventory** (`web/js/inventory.js`): slots met `options` (`PLAYER_HAT_SHAPES`,
  `HAND_ITEMS`) en kleuren uit `SWATCHES`. De look zit **in de browser** (`promptholm.avatar` in
  localStorage, `web/js/avatar.js`): "localStorage belongs to whoever is looking".
- **Interactie**: `interactables()` in `main.js:877`, elk met `kind`, plek, `r`, `label` en
  `prompt`; E kiest. Hurken is een poseer-bit op de lijn (`CROUCHING` 512), dus anderen zien het.
- **De klok van de zee** (`worldNow()`, `shared/worldclock.mjs`): dezelfde datum voor iedereen,
  en `tests/worldclock.test.mjs` verbiedt lokale `getDay()`/`getHours()` in `web/js/`.

## Wat het plan vastlegt, omdat de code het afdwingt

1. **Een schat is van de speler, niet van de zee.** Een gedeelde schat die op raakt heeft
   toestand nodig, en de zee bewaart niets ("writes nothing to disk", een herstart is een
   seconde leeg water). Dus elke kaart heeft een eigen zaad en de plek en de inhoud volgen
   daaruit; de zee en de lijn merken er niets van. Anderen zien jou graven (hurken), niet jouw X.
2. **De vondsten staan in localStorage** (`promptholm.finds`), naast de look. Het is de enige
   opslag die overal is: een desktoptab, het app-venster en de telefoon, die geen islander heeft
   (`mine()` weigert daar). `garden.json` valt af: dat is van het eiland van de keeper en heeft
   een beurs, geen speler. Prijs: leeg je sitegegevens, dan ben je je vondsten kwijt, net als nu
   je look. Elke lees en schrijf in try/catch; de pagina moet ook zonder kloppen.
3. **Nieuwe kleuren en hoeden mogen niet in `SWATCHES` of `HAT_SHAPES`.** De settlers trekken
   hun uiterlijk met `rng.pick` uit die lijsten (`shared/palette.mjs`, regels 131-135: hoed,
   huid en bies; alleen de tunica komt uit `dye(pal.wall, ...)`): één swatch of hoedvorm erbij
   en `rng.pick` geeft de hele bevolking een ander gezicht, en de belofte "the identical face"
   is weg. `PLAYER_HAT_SHAPES = [...HAT_SHAPES, helmet]` is het bestaande precedent; kleuren
   krijgen `PLAYER_SWATCHES` op dezelfde manier, voor alle vier de rijen.
4. **De look wordt niet gefilterd op wat je hebt.** `normalizeAvatar` en `lookOf` (de zee)
   blijven ruim: het is decor, en een vervalste look kost niemand iets. De keuze is alleen in de
   *kiezer* (de tegels) vergrendeld. Een oudere pagina die een onbekende hoed krijgt, valt in
   `normalizeAvatar` terug op de standaard: geen crash, geen redeploy van de zee.

## Besluiten

| Vraag | Besluit | Waarom |
|---|---|---|
| Waar komt een kaart vandaan? | **Een fles op het strand** van je eigen eiland, bij de aanlegplaats (`village.island.landing`, waar `lib/crowd.mjs:280` nieuwkomers vandaan laat lopen): een kustcel dicht bij de landing, gekozen op `hash(eiland-id, wereld-dag)`. E op de fles geeft een kaart. Hoogstens één per wereld-dag per speler. | Rekenwerk uit de klok van de zee, dus overal dezelfde fles op dezelfde dag, en niets om op te slaan behalve "vandaag heb ik hem gehad". |
| Alleen op dagen dat er gewerkt is | De fles spoelt alleen aan als er die wereld-dag een sessie op het eiland liep (een `lastAt` binnen die dag). | Het eiland is een afbeelding van echt werk; de zee brengt post op dagen dat het dorp bezig was. Kost een rij code. |
| De dag | `worldTime()` heeft geen dagnummer (alleen uur, maand, weekdag, seizoen, maan). Er komt een `day` bij, `floor((epoch + zone) / 86_400_000)`, met een regel in `tests/worldclock.test.mjs`. | Eén kopie van de klok, en niemand die zijn eigen tijdzone vraagt. |
| Welk eilandje | Een van de eilandjes in `isletsNear(vloot, [0, 0], { range: WORLD_HALF })` op 150 tot 900 eenheden van je berth, gekozen op de hash van het kaartzaad. De kaart onthoudt het **id**, niet de plek in de lijst. | Een reis van 15 tot 95 seconden met de boot (`BOAT_TOP` 9,5), niet zichtbaar vanaf het strand. Het id overleeft dat de vloot verandert. |
| Is het eilandje weg | De kaart slaapt: op de kaart een grijs kruis met "the water there is somebody's now". Komt het terug, dan werkt hij weer. Twee slapende kaarten of ouder dan zeven wereld-dagen vallen weg. | `candidate(i, j)` maakt het eilandje altijd opnieuw; alleen de aanwezigheid hangt aan de vloot. |
| De plek | `spotOf(islet, zaad)` in `shared/treasure.mjs`: rejection sampling in het eigen vlak van het eilandje op droge grond (`isletHeight` >= 0,15), minstens 1,6 cel van elke palm en 1,0 van elke struik, in 24 pogingen; daarna het hoogste punt buiten de palm. | Dezelfde functie die de grond tekent, dus niemand graaft in het water. Een zandbank (straal 3 tot 4, palm in het midden) houdt een ring over. |
| Hoe vind je hem | Twee trappen, met wat er al is. De kaart (M) tekent het eilandje van je kaart met een rood kruis en het rasterpunt ("K7"). Op de radar (straal 130) staat rond de plek een **ring van 10 eenheden**; binnen die ring wordt het een X. Binnen 1,2 eenheden staat er een `dig`-interactable: "E to dig". | Geen nieuw scherm. Een exacte stip vanaf 130 weg was een GPS; de ring laat wat te zoeken over. |
| Graven | `walk.dig(2.5)`: je hurkt (`crouching`, de bit die de lijn al heeft, dus anderen zien je graven) en staat stil; bewegen breekt af. Daarna komt de kist uit het zand (0,6 s), het deksel gaat open en er staat een toast. | Alles wat er te tekenen valt komt op het scherm van de graver; de lijn heeft er niets bij nodig. |
| De inhoud | Uit een tabel per zaad, alleen wat je nog niet hebt: 70 % een kleur (nieuwe rijen in `PLAYER_SWATCHES`: Captain red, Sea green, Kraken purple, Gold leaf), 25 % een hoed (fase 2), 5 % een handvoorwerp (fase 2). Heb je alles: "a handful of doubloons", zonder effect. | Begrensd en te verzamelen; nooit dezelfde vondst twee keer. |
| Nieuwe voorwerpen | Fase 2: `tricorn` en `bandana` als `PLAYER_HAT_SHAPES`, `spyglass` als `HAND_ITEMS`, gemodelleerd in `scripts/build-settler.py` volgens de `blender-pipeline`-skill. En de decor-props `prop_bottle`, `prop_chest` (deksel als los deel met zijn oorsprong op het scharnier) en `prop_treasure_x` (twee planken in het zand). | Nieuwe vormen horen in Blender en niet als dozen in `buildings.js`. Fase 1 werkt met de kleuren en met kist en fles als de eenvoudigste bake. |
| Vergrendelde tegels | In het inventory een silhouet met "found on an islet"; `tests/inventory.test.mjs` krijgt: elk beloningsid bestaat als tegel. | Zo kan een vondst niet stilletjes buiten het scherm vallen, dezelfde reden als de bestaande test. |

## Bestanden

- `shared/treasure.mjs` (nieuw) - de kaart, `spotOf`, `rewardOf`, de dag-en-fles-regel; alleen
  gehele getallen, `+ - * /`, `floor`, `abs`, `min`, `max`, `sqrt`, en `hash32`.
- `shared/islets.mjs` - een `isletById(id)` naast `candidate`, met `furnish` erop, zodat een kaart
  het eilandje kan terugvinden ook als het nu onder andermans water ligt.
- `shared/worldclock.mjs` - `day`.
- `shared/palette.mjs` - `PLAYER_SWATCHES` (niet `SWATCHES`).
- `web/js/treasure.js` (nieuw) - de vondsten (laden en bewaren), de fles, het kruis, de kist, de
  graafstappen; `main.js` bedraadt het in `interactables()`, `minimapData()` en de toasts.
- `web/js/minimap.js` - een rood kruis op de kaart, ring en X op de radar.
- `web/js/walk.js` - `dig(seconds)`.
- `web/js/inventory.js` en `studio.js` - vergrendelde tegels, de nieuwe swatches.
- `docs/manual.md` - een alinea over fles, kaart en kist.

## Tests

`tests/treasure.test.mjs`, zonder loader:

- `spotOf` is deterministisch, droog, en ligt buiten elke palm en struik, op elk van de drie
  soorten eilandjes en over een paar honderd zaden.
- Een kaart op een eilandje dat uit de vloot valt, slaapt in plaats van te breken, en wordt
  weer wakker.
- De beloning herhaalt niets wat je al hebt; met alles in bezit komt de doubloons-vondst.
- Een kapotte of te nieuwe `promptholm.finds` geeft een lege lijst, geen uitzondering.
- De fles: één per dag per speler, geen fles op een dag zonder werk.
- Bron-check: geen `Math.sin`, `cos` of `pow` in `shared/treasure.mjs`.

## Volgorde

1. `shared/treasure.mjs` en zijn tests, met `day` in de wereldklok.
2. Fles, kaart op de kaart, ring en X op de radar, graven, kist. Nog met alleen kleuren.
3. De nieuwe kleuren en de vergrendelde tegels in het inventory.
4. Fase 2: de drie bakes en de hoeden.

## Later, niet nu

- **Een gedeelde jacht** (wie het eerst graaft): dat is toestand op de zee, en dus een eigen plan
  met een eigen deur zoals `POST /island/:id/parcel`.
- **De telefoon.** Die heeft geen eiland en dus geen strand; een fles die bij de skiff dobbert
  zou het oplossen. Fase 1 is het bureaublad.
- **Kaarten bij de kroegbaas voor munten**, waar de beurs van de keeper (`mine()`) voor bestaat;
  en een kaart uit een visvangst.
- **Een wrak op de zeebodem** voor de duikstand (`state.diving` bestaat al).
- Een kaart aan een vriend geven (G geeft nu een biertje).
