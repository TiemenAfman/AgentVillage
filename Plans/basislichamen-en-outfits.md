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
lichaam past.** De OUTFIT-slot kiest de outfit, HEAD verft het haar, er komt een huidkleur.

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

Nieuwe velden in de look (`normalizeAvatar`, en in `lookOf` in lib/players.mjs):

| veld | waarde | onbekend/ontbrekend |
|---|---|---|
| `character` | `traveller` / `adventurer` (bestaat) | Reiziger |
| `sex` | `male` / `female` | `male` |
| `outfit` | slug (`adventurer`, `peasant`, ...) | de standaard-outfit van het lichaam |
| `hair` | kleur (int) | de huidige haarkleur |

Waarom een los `sex`-veld en niet een derde `character`: `characterId` maakt van een onbekende id
de **Reiziger**. Een vrouw als `character: 'adventuress'` zou op een oude pagina dus een Reiziger
worden; met `character: 'adventurer', sex: 'female'` ziet een oude pagina gewoon de (mannelijke)
Avonturier. Een oude zee laat de onbekende velden in `lookOf` vallen (het is een whitelist), dus
ook daar: mannelijke Avonturier in de standaard-outfit, standaard-haar. Niets stuk, geen
`SEA_V`-bump, niets in layout/config/bundel - dus **een patch**. Maar: **de open zee moet opnieuw
uitgerold worden** voordat anderen haar, haar haarkleur of een andere outfit zien.

Opslag per browser: `promptholm.avatar` krijgt de nieuwe velden; een oude look opent zonder ze
(man, standaard-outfit, standaard-haar). `saveCharacter` bewaart ook `sex` meteen bij kiezen, net
als het lichaam nu.

### 6. Inventory

- **Bovenaan** blijven de lichaamstypen (Traveller | Adventurer), **rechts** komt de man/vrouw-
  keuze: twee portretjes (♂/♀, het blote hoofd zoals `characterIcon`) boven de rechter slots.
  Kiezen wisselt het lichaam in de alcove direct; *Wear it* bewaart, zoals de lichaamskeuze nu.
  Bij de Reiziger is er (fase 1) geen vrouw: de keuze staat grijs met een tooltip.
- **HEAD** - het verfknopje kleurt voortaan het **haar** (`dye: 'hair'`). De hoedkleur verhuist
  naar de hoed-kiezer zelf: onder de hoedtegels een rij kleuren (zie Vragen).
- **Huid** - de bestaande *Skin*-fles links onderaan de alcove blijft de huidkleur; hij is nu bij
  de Avonturier verborgen (`dyeApplies`) en verschijnt weer zodra de huid verfbaar is.
- **OUTFIT** - wordt een kiezer (`kind: 'pick'`, `field: 'outfit'`) met een tegel per outfit,
  het verfknopje blijft de stofkleur (`tunic`) van de gekozen outfit.
- `tests/inventory.test.mjs` houdt elke equip-sleutel bij één slot en elke swatch bij één
  verfknop: met `hair` als nieuwe swatch-rij en de hoedkleur in de hoedkiezer blijft dat waar
  (de test krijgt de hoed-kiezer als plek voor de `hat`-swatches).
- Renderers: de nieuwe portretten gebruiken de bestaande icoon-renderer (`iconGeometry`); geen
  extra WebGL-context (CLAUDE.md: "A temporary renderer gives its context back").

### 7. De Reiziger en de huidige Avonturier

Voorstel: in fase 1 **blijft de Reiziger** zoals hij is (eigen bake, procedurele beweging, krijgt
alleen haarverf). De **Avonturier** wordt het eerste lichaam in het nieuwe systeem: zijn kleding
(tuniek, hemd, broek, riemen, armbeschermers, handschoenen, laarzen) wordt de outfit
`adventurer`, getrokken op beide basislichamen; zijn Link-lijf en -gezicht verdwijnen (zie Vragen:
dat is een uiterlijk-keuze). Later kan de Reiziger zelf een outfit (`traveller`) op de
basislichamen worden, en dan is er nog één soort lichaam.

### 8. Grootte en prestaties

- Draw calls: gelijk (outfit en haar in dezelfde merge per ledemaatgroep).
- Downloadgrootte: twee lichamen van ~13k driehoeken en een outfit per lichaam. De Avonturier is nu
  33,5k driehoeken / 700 kB gzip. Verwacht ~1-1,5 MB gzip extra voor fase 1+2. Alles blijft
  synchroon geïmporteerd ("Nothing is fetched at boot"); wordt het te veel, dan kunnen outfits die
  niemand draagt later lui per outfit (zoals `LAZY`), maar niet in fase 1.
- Peers: elke peer bouwt zijn eigen rig (`createClassicAvatar`) zoals nu; geen verschil.

## Fasering

1. **Basislichamen + huidige outfit als laag (man).** `build-bodies.py` met het mannelijke
   basislichaam; zones; huid en haar als `tint`-delen; de Avonturier-outfit losgemaakt en op het
   lichaam getrokken (gewichten via Data Transfer); `outfit`/`hair` in look, `lookOf`,
   `normalizeAvatar`; HEAD = haar, hoedkleur in de hoedkiezer, Skin-fles terug. Controle: alle
   clips in `/avatar-motion.html` (lopen, rennen, sprinten, springen, zwemmen, watertrappen,
   graven, klimmen, paard, sterven) naast de huidige Avonturier.
2. **De vrouw.** Het vrouwelijke basislichaam, `sex` in look en inventory (keuze rechts), de
   Avonturier-outfit op haar getrokken; het paard (`horsebackOf`) en de ladder (`CLIMB_CLIP_LIFT`)
   per lichaam nagemeten. Screenshots naast Martijns referentie.
3. **Meer outfits.** Peasant en Ranger uit de gratis Quaternius-set (al per lichaam gefit), daarna
   een pak (`suit`): zelf in Blender op het referentielichaam, of de *Noble* uit de betaalde set.

Elke fase is een patch, met een redeploy van de open zee voor de anderen.

## Tests

- `tests/characters.test.mjs`: per lichaam × outfit: onderdelen, gewichten (som 1, alleen bestaande
  botten), voeten op de grond bij lopen en rennen, geen bedekte zone zichtbaar, wisselen in dezelfde
  ouder.
- `tests/inventory.test.mjs`: elke swatch-rij (ook `hair`) bij precies één knop, elke outfit-tegel
  rendert op elk lichaam.
- De zee: `lookOf` laat `sex`/`outfit`/`hair` door; een look zonder ze wordt de mannelijke
  Avonturier in de standaard-outfit (oude pagina/oude zee).
- `tests/models.test.mjs`-achtige check op de nieuwe bake (deterministisch: twee keer bakken =
  dezelfde bytes).

## Vragen aan Martijn (via de coördinator)

1. **Bron van de basislichamen**: Quaternius Universal Base Characters (aanbevolen) / MakeHuman /
   het Link-model bewerken.
2. **Wat er met de huidige Avonturier gebeurt**: zijn kleding wordt een outfit op de nieuwe lichamen
   en zijn Link-gezicht verdwijnt (aanbevolen) / hij blijft als vast lichaam naast de nieuwe.
3. **Hoedkleur** nu HEAD het haar verft: rij kleuren in de hoedkiezer (aanbevolen) / de hoed volgt
   het haar / hoeden een vaste kleur.
4. **De Reiziger**: blijft zoals hij is met alleen haarverf (aanbevolen) / wordt ook een outfit op de
   basislichamen in fase 3.

En een handeling: de Quaternius-zips zijn gratis ("name your own price", 0 kan) maar een download
vraagt een klik op itch.io; Martijn haalt ze binnen (of geeft toestemming), de bestanden komen in
`assets/bodies/source/` (CC0).

## Status

Plan, 7 oktober 2026. Nog niets gebouwd; wacht op de keuzes hierboven.
