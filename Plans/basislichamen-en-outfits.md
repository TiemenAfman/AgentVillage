# 🚧 Basislichamen en outfits (man/vrouw, haar- en huidkleur)

## Aanleiding

Martijn vroeg om een vrouwelijke Avonturier, een man/vrouw-keuze rechts in de inventory en een
HEAD-kleurkiezer die de haarkleur bepaalt. Bij het plannen stuurde hij bij (7 oktober 2026):

> "ik denk dat we de karakters moeten maken in ondergoed, en dat de kleding een outfitkeuze wordt.
> dan kunnen we ook beginnen met een pak en andere outfits. zodat we niet elk karakter opnieuw
> moeten tekenen in een nieuw outfit"

> "oke we hebben wel een colorpicker nodig voor de huidskleur bedenk ik me net"

Dus niet "nog een lichaam met kleren eraan gebakken" maar een systeem: **een lichaam is een
basislichaam in ondergoed op het gedeelde skelet; kleding is een losse outfit-laag die op elk
lichaam past.** De OUTFIT-slot kiest de outfit, HEAD verft het haar, er komt een huidkleur. De
Reiziger en de Avonturier (Link) blijven daarnaast zoals ze zijn (Besluiten, onderaan).

## Wat er nu staat (en waarom het zo niet verder kan)

- Twee lichamen (`web/js/player-bodies.js`): de **Reiziger** (`scripts/build-settler.py`, eigen
  procedurele beweging) en de **Avonturier** (`scripts/build-adventurer.py` uit het CC-BY
  Link-model, Mixamo-clips). Hun kleding zit *in* het lichaam: bij de Avonturier is er onder de
  tuniek en de broek geen huid (`Upper_Skin` is alleen nek, onderarmen en een randje), dus van dat
  model kun je de kleren niet uittrekken. Een vrouw maken uit Link zou betekenen: een lijf
  onder de kleren boetseren én de kleren op een andere vorm trekken - precies het werk dat
  Martijn niet per personage opnieuw wil doen.
- Wat wél al lichaam-onafhankelijk is, en waar dit plan op bouwt:
  - **Het rig is een contract, geen mesh.** `bodyOf` in classic-avatar.js leest per lichaam de
    draaipunten (`rig`, `joints`, `fingers`) uit de bake; de Mixamo-clips (`gait-clips.js`) zijn
    rotaties per gewricht t.o.v. de ouder, dus ze spelen op elk lichaam dat die draaipunten levert.
    `plantFeet` zet de voeten na het poseren op de grond, de paslengte schaalt met het been.
  - **Een stuk uitrusting werkt al op twee lichamen**: de hoeden, rugzak, borstplaat en
    beenstukken van de Reiziger worden in `build-adventurer.py` op de Avonturier gefit (meten en
    schalen per lichaamsdeel) en houden naam, slot en variant.
  - **Draw calls**: een speler is per ledemaatgroep één mesh (`makePiece`: kern, hoofd, vier
    ledematen); alle onderdelen van een groep worden samengevoegd (`buildFigure`). Een outfit-laag
    gaat in diezelfde merge en kost dus **geen extra draw call**.
  - **Verven**: een onderdeel met een `slot` uit de spec (`skin`, `tunic`, `trim`, `hat`) krijgt die
    kleur; een onderdeel met `colors` (de Avonturier) wordt niet geverfd, daarom verbergt
    `dyeApplies` nu Skin en Outfit bij hem.

## Ontwerp

### 1. Basislichamen

Elk lichaam is: huid (gezicht, romp, armen, handen, benen, voeten), ondergoed, ogen,
wenkbrauwen, en een los **haar**-deel. Allemaal op hetzelfde skelet als nu: per ledemaat de
drie gewrichten (+15 vingerkootjes per hand), romp op bekken/onderrug/borst/nek, hoofd op de nek.
Elk lichaam levert zijn eigen draaipunten; de clips blijven dezelfde.

**Bron (keuze voor Martijn, zie Vragen).** Aanbevolen: **Quaternius *Universal Base Characters***
(CC0) - in ondergoed, man én vrouw op één humanoïde rig, ~13k driehoeken, met losse kapsels. De
gratis versie heeft 2 lichamen en 5 kapsels; de *Source* ($19,99) 6 lichamen (gewoon, superheld,
tiener) en 20 kapsels. Van dezelfde maker passen de **Modular Character Outfits - Fantasy** (CC0)
op die lichamen, al per lichaam gefit (`All_Male`/`All_Female`); gratis: *Peasant* en *Ranger*, de
rest ($20) o.a. *Noble* en *Wizard*. In de gratis previews staat al een blonde vrouw met kort haar,
wit hemd en bruin korset die dicht bij Martijns referentie zit. CC0 betekent: geen
naamsvermelding verplicht (we doen het wel, `CREDITS.md`), geen fanmodel van een bestaand personage,
en de bron mag gewoon in de repo.

Alternatieven die zijn afgewogen:
- **MakeHuman** (export CC0): man/vrouw met schuiven, eigen kledingproxy's die zichzelf op elk
  lichaam passen. Realistischer en minder in de eilandstijl; de fit-automaat zit in MakeHuman, niet
  in onze bake.
- **Het Link-model bewerken**: geen lijf onder de kleren, de vrouw moet geboetseerd worden en de
  kleren opnieuw getrokken. Veel handwerk en het blijft een fanmodel.
- **Mixamo-personages**: licentie staat gebruik in een spel toe, maar de mesh als JS-module in een
  openbare repo is herverdelen - om dezelfde reden staan de clips-FBX's al buiten git.
- De oude branch `origin/vrouwen` (Tiemen, 24 sep, `2d9f1c2`) gaat over de **dorpelingen**
  (`build-villagers.py`, `villager-mesh.js`, een vrouwvariant van de NPC's met rok of broek), niet
  over de speler. Niet bruikbaar als speler-lichaam; wel een plek waar de dorpsvrouwen later
  dezelfde kapsels en huidkleuren kunnen lenen.

Bake: `scripts/build-bodies.py` (naar het model van build-adventurer.py: bron gelezen, schaal naar
het eiland, A/T-pose naar hangende armen, botten gevouwen in onze ketens, textuur naar
hoekkleuren) → `assets/bodies/` → `web/js/body-<id>-mesh.js`, synchroon geïmporteerd zoals elke bake.
Elk lichaam krijgt een eigen `bodies`-rij in player-bodies.js (`id`, `sex`, `rig`, `joints`,
`fingers`, `eyeY`, `gait: 'athlete'`).

### 2. Huid onder kleding verbergen: zones

Het lichaam wordt in de bake in **zones** geknipt: `head`, `neck`, `chest`, `belly`, `upperArm`,
`forearm`, `hand`, `hips`, `thigh`, `shin`, `foot` (links/rechts apart). Elk outfit-onderdeel zegt
welke zones het **bedekt** (`covers: ['chest', 'belly', 'upperArm', ...]`). `buildFigure` laat
een zone weg die door een gedragen onderdeel bedekt is. Geen shader, geen alfamasker, gewoon
minder driehoeken - en geen huid die bij een buiging door de stof prikt. Een zone die half
bedekt is (een korte mouw over de bovenarm) blijft staan; daar zorgt de fit voor 2-4 mm ruimte.

### 3. Een outfit op twee lichaamsvormen: per lichaam gefit, één id

Gekozen: **per lichaam een eigen mesh onder één outfit-id**, gebakken als `(lichaam × outfit)`.
Niet één gedeelde mesh met shape keys: de lichamen hebben elk hun eigen topologie en draaipunten,
en een shape key zou bij elk nieuw lichaam toch opnieuw gemaakt moeten worden. Per lichaam bakken
is wat Quaternius zelf ook doet (`All_Male`/`All_Female`) en wat build-adventurer.py al met de
hoeden en de rugzak doet.

- Een outfit uit de Quaternius-set heeft per lichaam al een gefitte mesh: overnemen, botten vouwen.
- Een eigen outfit (zoals de huidige Avonturierskleding, of een pak dat we zelf maken) wordt op
  **één** referentielichaam gemodelleerd en in de bake op de andere lichamen getrokken:
  *Surface Deform* van referentielichaam naar doellichaam via een correspondentie (beide lichamen
  op dezelfde houding, het doellichaam als shape key van het referentielichaam via
  *Shrinkwrap + Data Transfer*), dan 2-4 mm naar buiten langs de normaal. Waar dat niet goed
  genoeg is, krijgt een outfit per lichaam een correctie in het script (zoals `fit_leg` nu).
- **Skin weights**: elk outfit-hoekpunt krijgt de gewichten van het **dichtstbijzijnde punt op
  het lichaam** eronder (Blender *Data Transfer*, nearest face interpolated) - dezelfde vier
  romp-, drie ledemaat- en vingerbotten als de huid. Dan beweegt de stof met de huid mee en
  spelen alle Mixamo-clips onveranderd. De naad mouw/romp houdt de romp-invloed zoals de
  Avonturier nu (CLAUDE.md: "renormalising away the torso influence opens the sleeve seam").
- Elke outfit levert onderdelen met `group` (welke `makePiece`), `skinGroup`, `slot` (verf),
  `covers`, en een variant `outfit:<id>`. Ze gaan in de bestaande merge: geen extra draw call.
- Outfit-ids in fase 1: `adventurer` (de huidige tuniek, riemen, armbeschermers, laarzen),
  later `peasant`, `ranger`, `suit`. De laarzen horen bij de outfit; de FEET-slot (sabatons)
  blijft uitrusting erover.

### 4. Haar en huid te verven

- **Haar** is een eigen deel met slot `hair` (nieuw spec-veld). **Huid** is slot `skin`.
  Gebakken als **grijswaarde × verf**: de bake schrijft van de textuur alleen de helderheid in de
  hoekkleuren en zet een vlag `tint: true`; `buildFigure` vermenigvuldigt die met de speckleur. Zo
  blijven het schilderwerk (lokken, wenkbrauwen, blos, schaduw onder de kin) staan en kiest de
  speler de tint. Ogen, wenkbrauwen, lippen blijven gewone hoekkleuren.
- Bij de **Reiziger** heeft het haar al slot `hair` (nu een vaste `PART_COLORS.hair`): met het
  nieuwe spec-veld wordt dat vanzelf verfbaar. Zijn huid is al `skin`. Beide lichamen lopen dus op
  hetzelfde mechanisme (`s[part.slot] ?? PART_COLORS[part.slot]`); de default `hair` is precies de
  huidige kleur, dus niemand verandert van uiterlijk tot hij zelf verft. NPC's hebben geen
  `hair` in hun spec en houden hun kleur.
- `dyeApplies` blijft het antwoord op "leest dit lichaam deze verf"; zodra huid en haar sloten zijn,
  zegt het vanzelf ja bij elk basislichaam.
- Paletten: `SWATCHES.hair` erbij (blond, aschblond, rood, koper, kastanje, donkerbruin, zwart,
  grijs, wit) in `shared/palette.mjs`. **Niet** in de lijsten die de dorpelingen gebruiken -
  `rng.pick(SWATCHES[part])` zou anders elk gezicht op elk eiland veranderen (zie de kop van
  `PLAYER_SWATCHES`).

### 5. De look en de zee

Link blijft (keuze van Martijn), dus de basislichamen zijn een **derde soort lichaam** naast de
Reiziger en de Avonturier. Werknaam in de inventory: **Wanderer** (naam nog vrij). Nieuwe velden in
de look (`normalizeAvatar`, en in `lookOf` in lib/players.mjs):

| veld | waarde | onbekend/ontbrekend |
|---|---|---|
| `character` | `traveller` / `adventurer` (bestaat) | Reiziger |
| `body` | `male` / `female`: een basislichaam (nieuw) | geen: het lichaam van `character` |
| `outfit` | slug (`peasant`, `ranger`, `adventurer`, ...) | de standaard-outfit |
| `hair` | kleur (int) | de huidige haarkleur van dat lichaam |

Een Wanderer gaat de deur uit als `character: 'adventurer', body: 'female', outfit, hair`. Waarom
zo en niet als `character: 'wanderer'`: `characterId` maakt van een onbekende id de **Reiziger**,
dus een oude pagina zou een vrouw als Reiziger tekenen. Met `character: 'adventurer'` als terugval
ziet een oude pagina (die `body` niet kent) de Avonturier, en een oude zee laat `body`/`outfit`/
`hair` in `lookOf` vallen (whitelist), dus ook daar de Avonturier. Niets stuk, geen `SEA_V`-bump,
niets in layout/config/bundel - **een patch**. Maar: **de open zee moet opnieuw uitgerold worden**
voordat anderen de Wanderer, de haarkleur of een outfit zien.

Opslag per browser: `promptholm.avatar` krijgt de nieuwe velden; een oude look opent zonder ze. Een
oude pagina die een nieuwe look leest, laat `body` vallen en opent op de Avonturier.
`saveCharacter` bewaart `body` meteen bij kiezen, net als het lichaam nu.

### 6. Inventory

- **Bovenaan** drie lichaamstypen: Traveller | Adventurer | Wanderer. **Rechts**, boven de
  rechter slots, de man/vrouw-keuze: twee portretjes (het blote hoofd zoals `characterIcon`). Alleen
  actief bij de Wanderer; bij Reiziger en Avonturier grijs met een tooltip (die hebben één lichaam).
  Kiezen wisselt het lichaam in de alcove direct; *Wear it* bewaart, zoals de lichaamskeuze nu.
- **HEAD** - het verfknopje kleurt voortaan het **haar** (`dye: 'hair'`), op elk lichaam: bij de
  Reiziger zijn bestaande `hair`-delen, bij de Avonturier zijn haar (de `Hairband`-mesh van het
  Link-model, opnieuw gebakken als grijswaarde × verf), bij de Wanderer haar kapsel.
- **Hoedkleur** (keuze van Martijn): in de hoedkiezer, een rij kleuren onder de hoedtegels.
- **Huid** - de bestaande *Skin*-fles links onderaan de alcove is de huidkleur voor elk lichaam.
  Bij de Avonturier nu verborgen (`dyeApplies`): zijn huid (`Head`, `Upper_Skin`) wordt net als zijn
  haar grijswaarde × verf gebakken, dan verschijnt de fles vanzelf.
- **OUTFIT** - bij de Wanderer een kiezer (`kind: 'pick'`, `field: 'outfit'`), een tegel per
  outfit; het verfknopje blijft de stofkleur (`tunic`). Bij Reiziger en Avonturier zoals nu.
- `tests/inventory.test.mjs` houdt elke equip-sleutel bij één slot en elke swatch bij één
  verfknop: `hair` krijgt HEAD, `hat` de hoedkiezer.
- Renderers: de nieuwe portretten gebruiken de bestaande icoon-renderer (`iconGeometry`); geen
  extra WebGL-context (CLAUDE.md: "A temporary renderer gives its context back").

### 7. De Reiziger en de Avonturier

Beide blijven zoals ze zijn (keuzes van Martijn), met eigen bake en eigen kleding. Ze krijgen alleen
haarverf (en de Avonturier huidverf). De Avonturierskleding kan later óók een outfit voor de
Wanderer worden (fase 3), zodat Martijns referentie - een vrouw in die tuniek - er kan komen; dat is
dan een kopie die op de basislichamen getrokken wordt, Link zelf blijft onaangeroerd.

### 8. Grootte en prestaties

- Draw calls: gelijk (outfit en haar in dezelfde merge per ledemaatgroep).
- Downloadgrootte: twee lichamen van ~13k driehoeken plus outfits per lichaam. De Avonturier is nu
  33,5k driehoeken / 700 kB gzip. Verwacht ~1-1,5 MB gzip extra. Alles blijft synchroon geïmporteerd
  ("Nothing is fetched at boot"); wordt het te veel, dan kunnen outfits later lui (zoals `LAZY`).
- Peers: elke peer bouwt zijn eigen rig (`createClassicAvatar`) zoals nu; geen verschil.

## Fasering

1. **Haar- en huidverf + basislichamen met een eerste outfit.** HEAD = haar en hoedkleur in de
   hoedkiezer (alle lichamen), Avonturier-haar en -huid verfbaar. `build-bodies.py`: het mannelijke
   en vrouwelijke basislichaam uit Quaternius (zones, huid en haar als `tint`-delen) met de gratis
   **Peasant**-outfit, die Quaternius al per lichaam gefit heeft. `body`/`outfit`/`hair` in look,
   `lookOf`, `normalizeAvatar`; Wanderer bovenaan en man/vrouw rechts in de inventory. Controle: alle
   clips in `/avatar-motion.html` (lopen, rennen, sprinten, springen, zwemmen, watertrappen, graven,
   klimmen, paard, sterven) per lichaam; screenshots naast Martijns referentie.
2. **Ranger** als tweede outfit; het paard (`horsebackOf`) en de ladder (`CLIMB_CLIP_LIFT`) per
   lichaam nagemeten.
3. **Eigen outfits**: de Avonturierskleding op de basislichamen (refit, gewichten via Data Transfer),
   daarna een pak (`suit`), zelf in Blender of de *Noble* uit de betaalde set.

Elke fase is een patch, met een redeploy van de open zee voor de anderen.

## Tests

- `tests/characters.test.mjs`: per lichaam × outfit: onderdelen, gewichten (som 1, alleen bestaande
  botten), voeten op de grond bij lopen en rennen, geen bedekte zone zichtbaar, wisselen in dezelfde
  ouder.
- `tests/inventory.test.mjs`: elke swatch-rij (ook `hair`) bij precies één knop, elke outfit-tegel
  rendert op elk lichaam.
- De zee: `lookOf` laat `body`/`outfit`/`hair` door; een look zonder ze wordt de Avonturier (oude
  pagina/oude zee).
- Deterministische bake: twee keer bakken = dezelfde bytes.

## Besluiten (7 oktober 2026, Martijn)

1. **Bron**: Quaternius Universal Base Characters + Modular Character Outfits - Fantasy (CC0).
2. **Link blijft** als vast lichaam met eigen kleding naast de nieuwe basislichamen (niet de
   aanbeveling).
3. **Hoedkleur** in de hoedkiezer.
4. **De Reiziger blijft** zoals hij is, met alleen haarverf.
5. De chip mag de gratis zips downloaden.

## Bronbestanden

- https://quaternius.itch.io/universal-base-characters - `Universal Base Characters[Standard].zip`
  (122 MB, gratis).
- https://quaternius.itch.io/modular-character-outfits-fantasy -
  `Modular Character Outfits - Fantasy[Standard].zip` (280 MB, gratis: Peasant en Ranger).
- De zips staan **buiten git** in `D:\Promptholm\sources\quaternius\`. In de repo komt alleen wat de
  bake leest (de twee lichamen, de gebruikte kapsels, de gebruikte outfit-onderdelen) in
  `assets/bodies/source/`, met `assets/bodies/CREDITS.md` (CC0, Quaternius, de links, en wat er
  veranderd is) - zoals `assets/adventurer/source-link.glb`.

## Bijsturing tijdens het bouwen (7 oktober 2026, Martijn in de chip)

- **Kleding los baken** ("broek shirt schoenen armstraps"), ook als basis voor Blender. Elk kledingstuk is
  een eigen stuk: `garment:<set>-<slot>` met de slots shirt, broek, schoenen en armstraps. In
  `assets/bodies/island-wanderer-<sex>.blend` staat elk kledingstuk als los, gerigd object op de
  rustpose met hangende armen.
- **Een outfit overschrijft de kleding**: "een set wat bij elkaar hoort wat je in 1 keer equipt"
  (een Iron Man-pak, een piratenkostuum). De kleding verdwijnt eronder. Een outfit is dus een laag
  *boven* de kleding, geen kledingstuk; er zijn er nog geen.
- **Kledingslots** (zijn keuze uit drie): CHEST = shirt, LEGS = broek, FEET = schoenen worden kiezers,
  met het harnasstuk als tegel in diezelfde kiezer. De armstraps krijgen een eigen slot ARMS, en OUTFIT
  blijft voor de overschrijvende set.
- **Kapsel is een keuze**: in de haar-popover onder HEAD staan de kapsels boven de kleuren (lang,
  knotjes, scheiding, kort, kaal).
- **Edit character** (zijn keuze): een knop in het inventory, en de karakterkeuze gaat uit het inventory.
  In hetzelfde venster: lichaam, man/vrouw, huid, haar, en schuiven voor heup, borst, hoofd, handen,
  voeten en slank↔dik. Lengte kwam er goedkoop bij. Heup, hoofd, handen, voeten en lengte zijn
  bot-schaal; borst en slank↔dik zijn vervorming van de vorm. Kleding en uitrusting gaan mee, en de
  clips blijven werken.
- **Het harnas is een kledingkeuze** ("net als de broek, niet overrulend"): in de kiezer van een slot
  staan Peasant, het harnasstuk en niets naast elkaar, en je draagt er één.
- **"Doorzichtig" en "beweegt raar"** bij broek en shirt: het waren naden. Alles onder de heuplijn hing
  aan het been, alles erboven aan de romp, en het kruis hoorde bij één dij. Nu:
  - de benen zijn ook aan de romp-botten gewogen (`LEG_TORSO`);
  - een shirt hangt helemaal aan de romp, de broek helemaal aan de benen;
  - het gewicht van de andere dij loopt via het bekken;
  - de kruisdriehoeken staan in beide benen.

## Status

**Fase 1 gebouwd** (7 oktober 2026, branch `claude/musing-leakey-c0431c`).

- **Bron.** Martijn had beide gratis zips al op 17 september binnengehaald; ze staan nu buiten git in
  `D:\Promptholm\sources\quaternius\`. Wat de bake leest staat in `assets/bodies/source/` (6,5 MB,
  texturen op 1024), met `CREDITS.md`. In de gratis versie zitten alleen de *Superhero*-lichamen; de
  outfits zijn voor de slankere *Regular*-lichamen gemaakt. Daarom zet de bake elk skelet op de botten
  van het lichaam (dat trekt ook de mannelijke Peasant op maat), en telt stof tot 4 cm *onder* de
  huid nog als bedekking (`COVER_IN`): anders staken de dijen door de broek.
- **Bake.** `scripts/build-bodies.py` schrijft `web/js/bodies-mesh.js` rechtstreeks (geen .blend). De
  armen gaan via de eigen gewichten van de kit 82° omlaag uit de T-pose. De huid onder de Peasant
  wordt per driehoek verborgen (`hide`). De vrouw krijgt haar eigen handen in plaats van de handen
  die de kit in haar mouwen heeft geschilderd. Het ondergoed is houtskoolgrijs. Hoeden, rugzak en
  harnas zijn die van de Avonturier, opnieuw gepast. Haar en huid zijn `tint`-delen.
- **De Avonturier** heeft nu ook verfbaar haar en verfbare huid (`tint`, gedeeld door de standaardkleur van de
  look, dus bij de standaard ongewijzigd: de geometrie is byte-gelijk).
- **Inventory.** Bovenaan Traveller | Adventurer | Wanderer, rechtsboven Man | Woman (alleen actief
  bij de Wanderer). HEAD verft het haar en kiest het kapsel; de hoedkleur staat onder de hoeden in de
  hoedkiezer. De Skin-fles kleurt elk lichaam. Bij de Wanderer zijn CHEST, ARMS, LEGS en FEET de
  kleding, en OUTFIT staat grijs (nog geen sets).
- **Gecontroleerd** in `/avatar-motion.html` (die toont nu alle vier, `?rider=wanderer-female` zet haar
  op het paard): lopen, rennen, klimmen en paard met de vrouw, en de inventory. Vergelijking met de
  referentie: `wanderer-vrouw-vergelijking.jpg` op Martijns bureaublad.

### Nog open

- Het paard is nog niet voor de Wanderers zelf nagemeten: ze gebruiken de getallen van de Avonturier.
  Dat geldt ook voor de ladderhandgrepen (`CLIMB_CLIP_LIFT`).
- De randen van het ondergoed zijn hoekig, want de bake knipt het per driehoek uit de textuur.
- In het kruis van de vrouwenbroek is bij een grote pas nog een haarlijn te zien.
- De beenplaten en sabatons zijn halve stukken (de Reiziger droeg ze over zijn broek): als enige
  kledingstuk laten ze de dijen bloot. Een volledig ijzeren tenue wordt een eigen kledingset.
- De schuiven zijn niet per lichaam afgesteld op het paard en de ladder (hipY schaalt wel mee).
- De Ranger-stukken (gratis) als tweede kledingset. Daarna outfits als overschrijvende sets (een pak,
  een piratenkostuum, eventueel de kleding van de Avonturier als set).
- De module is groot: ~2 MB gzip, de helft daarvan zijn de opnieuw gepaste hoeden per lichaam.
