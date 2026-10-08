# 🚧 Harpoenen op het galjoen

Plan van 8 oktober 2026. De opdracht van de keeper, letterlijk: *"harpooon — zelfde als sea of thieves.
grab chests/loot/players. aut reel them in. grab a boat to "chase". zipline / balance on rope (afhankelijk
van de hoek ?)"*. Het model is `C:\Users\Martijn\Downloads\harpooon\martijn_harpoon.glb`.

Het referentiebeeld is Sea of Thieves: een harpoenkanon op een draaivoet aan de reling. Je bemant het,
richt, schiet een harpoen aan een touw en spoelt automatisch in. Raak je een kist of een speler, dan komt
die naar je toe. Raak je land of een ander schip, dan wordt je eigen schip ernaartoe getrokken, of draait
het eromheen als het vaart.

## Het model en de licentie

De GLB is een Sketchfab-download. In `asset.extras` staat:

- titel *Sea Of Thieves Harpoon*, maker *J.D.Productions*,
- licentie **CC-BY-4.0**,
- bron `sketchfab.com/3d-models/sea-of-thieves-harpoon-415e9492c4044f27ab8ec9d4367de5ec`.

De licentie zelf is vrij, maar **het ontwerp is van Rare/Microsoft**: het is fan-art van het harpoen uit
Sea of Thieves. Dat is hetzelfde geval als het vreugdevuur uit Dark Souls (CC-BY, maar het ontwerp van
FromSoftware), dat volgens CLAUDE.md buiten git blijft. Het is ook technisch geen bake-kandidaat:

- **48.518 driehoeken** in 16 meshes, waarvan 37k + 18k alleen in de touwwindingen ("defaultMaterial
  4", millimeterdun),
- vijf PBR-textuursets (`harpoon`, `metal`, `wood`, `leather`, `ROPE`, elk albedo/AO/metallic/normal/
  roughness), terwijl de bake hoekkleuren gebruikt,
- het hero-budget is 4000.

**Voorstel** (vraag 1 aan de keeper):

- **In git** komt een eigen harpoenkanon: `scripts/build-harpoon.py`, in de huisstijl en uit
  primitieven, als set `harpoon`. Het is een generieke vorm (een draaivoet, een juk, een loop met een
  spoel en twee handgrepen) en geen kopie van het SoT-ontwerp. Er komen twee parts: **`harpoon mount`**
  (de voet, origin op het dek) en **`harpoon gun`** (juk, loop en spoel, origin op de **draaias** voor
  de yaw). Daarnaast komt de **`harpoon bolt`** (de pijl zelf, origin op het oog waar het touw vastzit)
  en het anker `anchor.muzzle`. Het budget is hero, met als doel ±1500 voor alle drie samen.
- **Lokaal** kan de GLB als HD-stuk in het HD-pakket (`~/.promptholm/hd/`, via `hdOutside` zoals de
  Jolly Roger). Daarvoor is een `hd-manifest.json`-regel nodig en de CC-BY-naamsvermelding in de
  README van het pakket. Dat is dan alleen het uiterlijk, op een keeper-only route en nooit in een
  bundel of release. Dit is optioneel; zonder HD-pakket zie je de bake.

## Hoeveel en waar

**Twee harpoenen op het galjoen, één per boord op het voorkasteel** (`z` ≈ 3.3, `x` ≈ ±1.15, binnen
de rand op 1.2/1.55), met de loop naar buiten-voor (yaw ±60° in het schip). Daar zitten ze de kanonnen
(waist, z −0.5), de ladders (z 1.85) en de fokkemast (z 3.15, x 0) niet in de weg. De precieze plek wordt
gemeten met level-rays op de bake, zoals bij de ladders. Het getal staat één keer in `CRAFTS.galleon`.
De roeiboot krijgt er geen (crew 1, en dan zit je aan de riemen).

Vraag 2: voor of achter, en hoeveel.

## Eén bemand wapen, gedeeld met de kanonnen

De chip "🔷 Kanonnen op galjoen" (`claude/elastic-chandrasekhar-414110`, [kanonnen.md](kanonnen.md))
bouwt bemannen met E, draaien en richten binnen grenzen, traagheid, de camera achter de loop, loslaten
met E of Escape, het lassen in de romp en `aim()` op de CPU. Dat wordt **één mechanisme met twee
soorten**, en we bouwen het niet twee keer:

- `CRAFTS.galleon.mounts = [{ kind: 'cannon' | 'harpoon', x, z, y, yaw, yawLim, pitchLim }]` in plaats
  van een losse `cannons`-lijst. `state.gun = { boat, i, kind }` in walk.js.
- Wat per soort verschilt, zit in een tabel `MOUNT_KINDS` (shared): grenzen, draaisnelheid, camera-offset,
  de toetsen die gelden (`gunLoad`/`gunFire` voor het kanon, `gunFire`/`gunReel`/`gunRelease` voor het
  harpoen) en de prompt.
- **Volgorde**: de kanonnen-chip staat nog niet op main (alleen de bake en het plan). Zodra die op main
  staat, merge ik hem in deze branch en trek ik het bemannen eruit naar het gedeelde mechanisme (een
  kleine refactor op zijn code). Tot die tijd bouw ik alleen wat los staat: de ballistiek en het touw.
  Ik stuur de kanonnen-chip via de coördinator het voorstel voor `mounts`, zodat hij het meteen zo
  noemt.

## Schieten en het touw (`shared/harpoon.mjs`, puur, getest)

- **De vlucht**: dezelfde `stepBall` als de kanonskogel (zwaartekracht plus luchtweerstand, zonder trig),
  maar langzamer (`BOLT_SPEED` 26 u/s), en het touw remt: voorbij `ROPE_MAX` (40) is de pijl op en valt
  hij terug.
- **Het treffen**: dezelfde `ballHit`-soorten (water, land, een romp), plus **doelen**: een lijst
  `{ id, kind, x, y, z, r }` die de pagina meegeeft (het schatbeeld, een speler, een boot). Het eerste
  doel binnen `r` van het segment van deze frame wint. Water is geen houvast: de pijl zinkt en wordt
  vanzelf ingespoeld.
- **Het touw**: `ropeShape(a, b, length, out)` geeft `ROPE_SEGS` punten. Is het touw slap, dan hangt het
  in een parabool (een benadering van de kettinglijn zonder `cosh`, met een doorhang uit de lengte min de
  koorde). Is het strak, dan is het een rechte lijn. Getekend als één buis (een `TubeGeometry`-achtige
  ring per punt, CPU, één draw call voor alle touwen samen), nooit uit de GLB.
- **Het inspoelen** (`stepReel`): het touw krijgt een lengte `L`. Zolang je spoelt, wordt `L` met
  `REEL_SPEED` korter. Is de afstand groter dan `L`, dan houdt een veer-demper ze samen. De kracht gaat
  naar beide kanten in de verhouding van hun **massa** (`MASS`: kist 1, speler 2, roeiboot 6, galjoen
  60, land ∞). Alles is optellen en vermenigvuldigen, met één `sqrt` voor de afstand, deterministisch op
  ticks zoals settlerwalk. Draaien eromheen hoeft niet apart gebouwd te worden: een schip dat vaart met
  een strak touw naar een vast punt gaat vanzelf in een cirkel, omdat de beperking alleen de radiale
  snelheid wegneemt.

## Wat er gegrepen kan worden

| Doel | Wat er gebeurt | Wie rekent | Zee nodig? |
|---|---|---|---|
| **Het schatbeeld** (drijvend of op land) | komt naar je toe. Aan de romp wordt het lading (`putOnBoat`, zoals hijsen nu) | de pagina, zoals de hele schatjacht | nee, patch |
| **Land, rots, eilandje** | je eigen schip wordt ernaartoe getrokken, of draait eromheen | wie de romp stapt (zie hieronder) | nee |
| **Een ander schip** (achtervolgen) | jóúw schip hangt aan het hare en wordt meegetrokken | wie jouw romp stapt | alleen om het touw te laten zien |
| **Een speler** | wordt naar je toe getrokken | de pagina van díe speler | ja: een bericht, patch + redeploy |
| **Guards/residents** van de vulkaan | later; de zee loopt ze | de zee | ja |

**Wie stapt de romp?** Op de zee schrijft alleen de schipper waar een boot is (`moved` in
`lib/boats.mjs`), of degene die net losliet zolang ze uitloopt (`coast`). Je kunt niet tegelijk sturen en
harpoeneren. Dat is ook in SoT zo: één aan het roer, één aan het harpoen. Daarom:

- **Alleen aan boord**: je laat het roer los (E), loopt naar het harpoen en bemant het. De romp zit dan in
  `loose` en wordt door `walk.runOut` gestapt (CLAUDE.md, "Nothing steps a hull nobody is aboard"). De
  trekkracht van het touw komt daar als externe kracht bij in `stepBoat` (`pull: { fx, fz }`). Zolang er
  getrokken wordt, ververst de pagina de `coast` bij de zee, met een nieuw `letGo`-achtig bericht of een
  langere `runOut`. Dat moet ik nog meten: 60 s is lang genoeg voor bijna elke trek.
- **Met een schipper**: de harpoenier is crew, niet de schipper. De trek moet dan naar de pagina van de
  schipper, en daarvoor is een bericht nodig (`{t:'reel', b, at, L}` naar de bemanning van die boot, fase
  B). Tot dan trekt het harpoen alleen kisten en spelers, en voelt de schipper het touw niet.
- **Andermans boot** wordt nooit verplaatst door jouw pagina: alleen jouw schip beweegt naar het hare.
  Dat is precies "chase", en het houdt de regel "alleen de schipper stuurt" heel. Of je ook een boot
  zonder schipper naar je toe mag trekken (een losliggende roeiboot), is vraag 4.

## Spelers grijpen

Een speler is zijn eigen pagina, en zijn positie komt alleen van hem. Grijpen moet dus via de zee:

1. De schutter stuurt `{t:'harpoon', b, i, o, v}`. Dat is hetzelfde bericht dat iedereen het touw laat
   zien (fase B, zoals het kanonschot).
2. Raakt de pijl volgens de pagina van de schutter een speler, dan stuurt die `{t:'hook', who, b}`.
3. De zee checkt dat: `afoot` of zwemmend, binnen `ROPE_MAX + slack` van het schip, niet op zijn eigen
   eiland, en de pvp-regels uit [open-world-pvp.md](open-world-pvp.md) als de keeper grijpen als "harm"
   ziet. Klopt het, dan stuurt de zee `{t:'hooked', by, b, at}` naar de getroffene.
4. Zijn walk mode krijgt `state.hooked` en trekt het lichaam met `stepReel` naar het harpoen, op zijn
   eigen klok. Springen of slaan breekt los.

Er is geen `SEA_V` nodig: een oudere pagina laat een onbekende `t` vallen. Het is dus een patch, maar pas
na een redeploy van de open zee (stack 28, met de hand) werkt het voor anderen. Vraag 3: mag dat, en
alleen bij wie pvp aan heeft?

## Over het touw lopen en glijden

Een touw dat **strak** staat en aan **beide kanten vastzit** (aan het harpoen en aan land of een ander
schip) is een pad. Het is een nieuwe stand in walk.js, `state.rope = { a, b, t, mode }`, naast
`climbing`:

- **Balanceren**: helling onder `ZIP_SLOPE` (zo'n 20°). W/S lopen langs het touw, armen uit, langzaam
  (`ROPE_WALK` 0.9). Een **balans** `sway` schommelt mee met de deining en de draaiing van het schip, en
  A/D houdt hem recht. Loopt `sway` over zijn grens, of stuurt je niet, dan val je: airborne, en in water
  wordt dat de bestaande plunge (`plungeSpeed`). Vraag 5: moet je kunnen vallen, of is het alleen
  schoonheid?
- **Ziplinen**: helling boven `ZIP_SLOPE` en naar beneden. Je hangt aan je handen (of aan de harpoenstok)
  en glijdt met zwaartekracht langs de lijn, minus wrijving. Onderaan, of met Space, laat je los. Omhoog
  langs een steil touw gaat niet. Daar ben je een klimmer zonder ladder, dus je glijdt terug.
- **Op en af**: het touw nemen gaat met E bij een van zijn twee uiteinden (op het voorkasteel bij het
  harpoen, of waar de pijl zit). Een touw dat losschiet (inspoelen, het schip vaart weg, de harpoenier
  laat los) laat je vallen.
- **Vaste touwen** op het schip (de stagen van boegspriet naar mast) kunnen later met dezelfde code.
  Eerst alleen het harpoentouw.
- **Animaties**: in `D:\Mixamo\anims\y-bot` staat geen koorddans- of zipline-clip. Wel *Catwalk Idle To
  Walk Forward* (voet voor voet) en *Hanging Idle* (twee handen boven het hoofd). Het voorstel is
  balanceren als de catwalk-gang met de armen procedureel uit en zijwaartse schommel uit `sway`, en
  ziplinen als *Hanging Idle* met de benen iets opgetrokken. Voor de Reiziger wordt het procedureel,
  zoals `climbReach`. Met `/mixamo-fetch` zoek ik nog naar een echte *balance walk*. Alles is te zien en
  te beoordelen in `/avatar-motion.html` onder twee nieuwe knoppen, *Balanceren* en *Zipline*.
- **Anderen** zien je via de `y` en de positie die al over de lijn gaan. Hangt een peer aan een touw dat
  zij kennen, dan tekenen ze hem zo, zoals `ladderAt`. Anders lijkt het een val. Er komt geen pose-bit bij.

## Geluid

Een part **`harpoons`** ("Harpoons and ropes") op de ambience-bus in `sound-mix.js`, met drie families in
`LAZY` en `shared/sfx.mjs`:

- `harpoonFire`: een droge klap met een metalen naklank, plus het fluiten van het touw dat afrolt,
- `reel`: een ratel, één tik per `REEL_TICK` ingespoelde eenheid. Zo hoor je de snelheid,
- `ropeCreak`: een loop van houtgekraak die harder wordt met de spanning in het touw.

Het loopt via de cue-afspraak: `harpoon-fx.js` heeft een teller en een spanningswaarde,
`soundSnapshot()` geeft die door, en een tekenmodule roept nooit zelf geluid aan.

## Stappen

1. **Plan en vragen** (dit stuk). Daarna, los van de antwoorden, `shared/harpoon.mjs`: de vlucht,
   `ropeShape`, `stepReel` en `ropeMode` (balanceren of zipline op de helling), met tests.
2. De bake `harpoon` (eigen model), in /demo, of de HD-route als de keeper dat kiest.
3. Na de merge van de kanonnen: het gedeelde bemande wapen (`mounts`), de twee harpoenen gelast in de romp,
   richten en de camera. Test met de echte walk mode zonder browser.
4. Vuren, het touw tekenen en inspoelen voor het schatbeeld (alleen de pagina).
5. Je schip naar land of een ander schip trekken (`stepBoat` met `pull`, op een losgelaten romp).
6. Touw lopen en ziplinen: walk.js, de rig, `/avatar-motion.html`.
7. Geluid.
8. Fase B, de zee: het touw laten zien, spelers grijpen, de trek naar de schipper. Patch plus een
   redeploy van de open zee.

## Open vragen voor de keeper

1. **Licentie**: de GLB is CC-BY maar een SoT-ontwerp. Eigen bake in git en de GLB alleen lokaal als
   HD-stuk, of alleen de eigen bake?
2. **Waar**: twee op het voorkasteel, één per boord? Of voor en achter?
3. **Spelers grijpen**: ja voor iedereen, alleen bij pvp aan (beide spelers), of niet?
4. **Andermans boten**: alleen achtervolgen (je eigen schip hangt eraan), of ook een boot zonder
   schipper naar je toe trekken?
5. **Touw**: kun je van het touw vallen (balans), of loop/glij je er altijd veilig over?
