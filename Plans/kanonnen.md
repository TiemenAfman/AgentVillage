# 🚧 Kanonnen op het galjoen

Plan van 8 oktober 2026. De opdracht van de keeper, letterlijk: *"verwijder op de boten alle
kanonnen. plaats 2 van deze kannonen en maak ze functioneel. roteren, draaien richten schieten.
voeg geluidseffecten en exploties toe. Je moet ook jezelf kunnen afvuren."* Het model is zijn
eigen `MartijnCannon.fbx`. Het referentiebeeld is Sea of Thieves: je staat achter een scheepskanon,
hebt een laad-prompt en ziet het andere schip.

## Wat er nu staat

- **Alleen het galjoen heeft kanonnen.** Het zijn er acht, vier per boord in de waist (z −2, −1, 0
  en 1). Ze steken door de geschutspoorten tot 2.63 buiten het midden en komen uit de bron-download
  (`M_Cannon*`-materialen in `scripts/build-pirateship.py`, met de wangen van de affuiten dichtgenaaid).
  Ze zitten in de walk-map (`shipwalk-map.js`, de test "a cannon stops a body"). De rotsladders hangen
  op z 1.85, omdat de kanonnen daarvóór de zijkant bezet houden (`shared/crafts.mjs`).
- De **Batavia** heeft alleen geschilderde, dichte poortluiken (`on_side` in `build-batavia.py`). Daar
  is niets te verwijderen. De werf toont in haar laatste fase dezelfde bake.
- De **roeiboot** heeft geen kanonnen.
- De **Salty Kraken** is geen boot maar een kroeg. Het kanon in de hal (`krakenkit/cannon.py`) en de
  kanonsloop als schoorsteen op het dak blijven staan.

## Het model

`MartijnCannon.fbx` is één mesh met 9729 driehoeken, één grijs materiaal en geen textuur. Het is een
klassiek kanon op een affuit met vier wielen, 25 cm lang (Maya-centimeters), met de loop langs +x. Het
valt uiteen in 40 losse stukken: de loop (2031 tris), de twee wangen, vier wielen, de as/bodem,
de dekplaten over de tappen, een tapstang (28 tris, dwars op de as) en bouten.

- **Bron in git**: `assets/cannon/source/martijn-cannon.fbx`, het eigen model van de keeper.
- **`scripts/build-cannon.py`** importeert het, zet de loop met +x naar de island-voorkant (+Z),
  schaalt naar 0.62 lang (zo'n 2.5 m), decimeert naar het hero-budget (4000 voor de hele set,
  doel ±3500), en verft per stuk met hoekkleuren: gietijzer voor loop en bouten, eiken voor de
  affuit, donkerder hout voor de wielen. Er komen twee parts uit: **`cannon carriage`** (origin op
  de grond, midden van de affuit) en **`cannon barrel`** (de loop plus de tapstang, met de origin
  op de **tap-as**). Een ankerpunt `anchor.muzzle` ligt in het midden van de monding. Dezelfde
  conventie als de zaag van de zaagmolen: wat beweegt, draait om zijn eigen origin.
- Een set, `cannon` in `models.js`, als hero met budget 4000.

## Weg met de oude acht

In `build-pirateship.py` gaan de `M_Cannon*`-materialen (en de kogels) naar `DROP`. Het dichtnaaien
van de wangen vervalt daarmee, en ook de `cheeks`-lus van de bouten. De geschutspoorten zitten in de
romp en blijven open. Daarna:

1. `npm run models -- pirateship` en `node scripts/build-shipwalk.mjs`
2. `tests/shipwalk.test.mjs`: de vier kanonnen aan stuurboord uit de "wall is a wall"-test. Ze worden
   vervangen door de twee nieuwe (zie hieronder).
3. Het commentaar in `crafts.mjs` bij de ladders bijwerken. De ladders blijven waar ze zijn.

## Waar de twee nieuwe komen

**Eén per boord, in de waist, in de geschutspoort op z −0.5 tussen de oude.** Dat is het beeld uit
de referentie (een breedzijde), weg van de ladder (z 1.85), van de grote mast (z 0, binnen ±0.15)
en van de mastladder (op 0.57, −0.57). Het kanon richt zijn loop door de poort naar buiten
(yaw ±90° in het schip). Het getal staat één keer in `CRAFTS.galleon.mounts` (shared/crafts.mjs):
`{ x, z, yaw, y }` per kanon, met `y` uit de walk-map.

**Getekend als deel van de romp**, niet als losse meshes: de affuit en de loop worden in de geometrie
van het galjoen gelast, net als de ladders en de roeispanen. Draaien en richten verplaatst die
vertexrange op de CPU (`aim(i, yaw, pitch)` in `boat.js`), net als `row()` met de riemen. Dat kost geen
extra draw call per schip, en een kanon deint vanzelf mee met het schip. Dat herberekenen gebeurt
alleen als de hoek verandert, dus alleen terwijl iemand richt.

**Botsen**: de walk-map wordt uit de romp gesneden. `build-shipwalk.mjs` snijdt de kanonnen mee, in
rustpositie, op hun plek uit `crafts.mjs`. Draaien is beperkt (zie hieronder), dus een rustbox is
eerlijk genoeg. De zee kent ze via een `rail` zonder `top` in de grove rechthoeken.

## Bemannen, draaien, richten, vuren

- **E** bij een kanon (`reach` vanaf het dek, in het frame van de romp): je *bemant* het. Walk mode
  krijgt `state.gun = { boat, i }` (vergelijkbaar met `state.deck`/de helm). Het lichaam staat achter
  de affuit, de camera hangt laag achter de loop en kijkt erlangs, zoals het referentiebeeld.
- **Muis/stick links-rechts = draaien (yaw)** binnen ±35° van de poort, **op-neer = richten
  (elevatie)** van −8° tot +22°. Een draaisnelheid en een kleine traagheid zorgen dat het gewicht
  heeft. Dat zijn `GUN_YAW`, `GUN_PITCH` en `GUN_TURN` in `shared/cannon.mjs`.
- **Laden**: R (pad X) laadt een kogel (`LOAD_S` 1.6 s, met een balk). Een geladen kanon toont de
  prompt "Fire", een leeg kanon "Load cannonball".
- **Vuren**: linkermuis (pad RT). Het kanon terugslaat (de affuit schuift 0.15 terug en loopt weer
  in), er komt een mondingsvlam en rook, en een knal.
- **Ontladen** (de prompt in de referentie): R op een geladen kanon haalt de kogel er weer uit.
- **E / Escape**: loslaten. Je staat weer achter het kanon op het dek.
- **Jezelf afvuren**: C (de bukknop) bij een *leeg* kanon: "Climb in". Het lichaam verdwijnt in de
  loop (`state.gun.inside`) en je richt zoals een bemanner. Klikken vuurt jóú af (hieronder). Opnieuw
  C of E kruipt er weer uit.

Alle toetsen gaan via `keybinds.js`, zodat ze in Settings → Controls staan en te herbinden zijn. Er
komen drie nieuwe acties (`gunLoad`, `gunFire`, `gunClimb`). Ze gelden alleen terwijl je een kanon
bemant, dus ze botsen niet met lopen.

## Ballistiek (`shared/cannon.mjs`, puur, getest)

- `muzzleOf(gun, hull, yaw, pitch)`: waar de kogel uit de loop komt en met welke richting, in de
  wereld. Hier zitten sin/cos in; dit draait alleen op de pagina.
- `stepBall(b, dt)`: positie plus snelheid, zwaartekracht `BALL_G`, een kleine luchtweerstand.
  Rekenkunde zonder trig. Een kogel leeft maximaal `BALL_LIFE` 8 s.
- `ballHit(b, world)`: de eerste inslag langs het stuk van deze frame, uitgerekend voor:
  - **water**: onder `SEA_LEVEL` boven water → `splash`
  - **land**: onder `heightAt` → `blast`
  - **een schip**: binnen de grove romp van een ander galjoen (`CRAFTS.galleon`-rechthoeken plus de
    romphoogte, in haar frame, `hullOver` uit boat.js) → `blast` op de romp. Je eigen schip telt
    alleen zodra de kogel er een halve meter uit is, anders raak je je eigen poort.
- Snelheid uit de loop: `BALL_SPEED` 38 u/s. Bij +22° komt dat op zo'n 120 eenheden, ver genoeg om
  een ander schip of de kust te raken, en kort genoeg dat de kogel in de mist neerkomt.

## Jezelf afvuren

Hiervoor is geen nieuwe val- of landingscode nodig. Walk mode heeft al een lichaam in de lucht
(`state.grounded = false`, `state.vy`, `GRAVITY`) en een horizontale `drift` voor wie van een
varend schip springt. Afvuren doet:

- `state.pos` naar de monding, `state.vy` = de verticale component van `HUMAN_SPEED` (22 u/s, minder
  dan een kogel) maal de elevatie, en `drift` = de horizontale component. Voor de vlucht wordt
  `drift` niet gedempt: een nieuwe `launched`-vlag houdt hem vol tot de landing, zodat de baan een
  echte parabool is.
- `onLeftDeck` / `leaveBoat` zoals bij een sprong van het dek: je bent geen bemanning meer.
- Landen in diep water is de bestaande `plungeSpeed`: je duikt een paar meter onder en zwemt weer
  op. Landen op land is de bestaande landing. Een val doet nu nergens schade, dus een kanonsvlucht
  ook niet. Als de keeper wil dat een harde landing pijn doet, is dat een aparte beslissing (zie
  vragen).
- Zolang `launched` geldt, speelt de rig een opgerolde "kanonskogel"-pose: knieën op, armen om de
  benen (`pose.launched`, procedureel in `classic-avatar.js`, voor beide lichamen). Bij de top van
  de baan strekt hij zich uit. Te zien en te beoordelen in `/avatar-motion.html` onder een nieuwe
  knop *Afgevuurd*.
- Anderen zien de vlucht gratis: de pose (x, y, z) gaat al over de lijn, en `num(m.y, 60)` in
  `lib/players.mjs` laat 60 hoog toe. De opgerolde pose zien ze alleen als we er een bit voor maken,
  en dat is niet nodig: wie in de lucht is, wordt al als vallend getekend.

## Geluid

Een nieuw part **`cannons`** ("Cannons and blasts") op de ambience-bus in `sound-mix.js`. Drie nieuwe
families in `sound.js`'s `LAZY`, ook te vervangen in `shared/sfx.mjs`:

- `boom`: de knal, een lage sinusstoot met ruis en een lange staart
- `blast`: de inslag op land of een romp, ruis door een zakkend laagdoorlaatfilter, met gekraak
- `splash`: de plons, ruis met een hoge, snelle start en een zacht natrillen

Volgens de afspraak in `sound.js` roept geen tekenmodule geluid aan. `cannon-fx.js` heeft een teller
met gebeurtenissen (`events()`: `{ n, kind, x, y, z }`), `soundSnapshot()` geeft hem door, en sound.js
speelt per nieuw nummer een geplaatste one-shot. Op afstand wordt dat zachter en met de lowpass die
plaatsgeluiden al hebben.

## Explosie

`web/js/cannon-fx.js`, één `Points`-pool met twee materialen (additief vuur, gewone rook) en één
`InstancedMesh` voor de waterkolom. Dat zijn drie draw calls, en alleen zolang er iets brandt. Er
komen geen lichten bij (het aantal lichten zit in de sleutel van elk programma). Het is unlit en ziet
eruit zoals `room-glow.js`/`hearth-fire.js`:

- **mondingsvlam**: 0.15 s een felle oranje bol, plus een rookwolk die opbolt en met de wind meedrijft
- **inslag op land/romp**: een vuurbal (12 vonken), zwarte rook en een paar brokken die vallen
- **plons**: een witte kolom van 2 m die inzakt, plus een ring schuim op `SEA_LEVEL`

Alles volgt de wereldklok van de pagina en de pool is begrensd (`FX_CAP`). Een volle pool overschrijft
de oudste.

## Wat de zee moet weten

**Fase A, alleen deze pagina**: schieten, inslaan, de FX en het geluid zijn helemaal van de pagina. Dat
is een patch en vraagt geen redeploy.

**Fase B, anderen zien het** (voorstel): een nieuw bericht `{t:'cannon', b, i, o:[x,y,z], v:[x,y,z]}`.
De pagina stuurt het, `lib/players.mjs` checkt de vorm (getallen binnen `bound`, snelheid ≤ `BALL_SPEED`,
een `b` waarop de speler aan boord is) en zet het door naar iedereen behalve de schutter als
`{t:'cannon', id, b, i, o, v}`. Elke pagina laat dezelfde kogel vliegen met `stepBall` en tekent dezelfde
inslag. Een oudere pagina laat een onbekende `t` vallen en een oudere zee ook (die valt door naar het
einde van `onMessage`), dus er is **geen SEA_V nodig, het is een patch**. Pas na een redeploy van de open
zee (stack 28, met de hand) ziet iemand anders het. De loop van het kanon van een ander springt bij elk
schot naar de richting van dat schot (`aim` uit `v`). Hoe een ander richt tussen schoten door wordt níet
doorgegeven: dat zou een bericht per frame per kanon zijn.

**Fase C, schade** (alleen als de keeper het wil): de zee rekent de kogel zelf na (`stepBall` is puur en
trig-vrij, en de zee heeft de terreinen van de vloot). Een treffer binnen `BLAST_R` van een speler die
`afoot` is, gaat door `hurt(p, BALL_HIT, { kind: 'cannon' })`, met dezelfde regels als
[open-world-pvp.md](open-world-pvp.md): je eigen eiland is veilig, en alleen wie meedoet kan geraakt
worden. Guards en Codex-residents op de vulkaan gaan door `lib/combat.mjs`. Ook dit is een patch, want
`hurt` en `evicted` bestaan al. Schade aan schepen bestaat nog niet (een schip heeft geen gezondheid);
dat zou een eigen plan zijn.

## Stappen

1. Bake van `cannon`, de acht oude kanonnen eruit, de walk-map opnieuw snijden, tests. Laten zien in
   `/demo` (het kanon los, en het galjoen).
2. Twee kanonnen op het galjoen getekend en gelast. `aim()` op de CPU, met een test dat de loop om de
   tap-as draait.
3. Bemannen, draaien en richten, met de camera, in walk.js. `tests/cannon-man.test.mjs` met de echte
   walk mode zonder browser, zoals `diving-walk.test.mjs`.
4. `shared/cannon.mjs` (ballistiek, getest), vuren, inslag, `cannon-fx.js`, geluid.
5. Jezelf afvuren, de pose, `/avatar-motion.html`.
6. Fase B (en eventueel C) na het besluit van de keeper.

## Open vragen voor de keeper

1. Moeten anderen de schoten zien (fase B, redeploy van de open zee)?
2. Doet een treffer schade (fase C), en aan wie: spelers, de guards van de vulkaan, schepen?
3. Munitie: onbeperkt met laadtijd, of een voorraad?
4. Waar de twee staan: één per boord in de waist, of allebei voor of achter?

## Besluiten van de keeper (8 oktober 2026)

- **Zichtbaar**: ja, via de zee (fase B).
- **Schade**: ook spelers, behalve op hun eigen eiland (fase C). Hij twijfelt nog over schade aan
  andermans boten; zie het voorstel hieronder.
- **Munitie**: onbeperkt, met laadtijd.
- **Plaats**: één kanon per boord, midscheeps.
- **Vuren met de rechtermuisknop** (zijn eigen vraag, tijdens het testen): rechts vuurt altijd. Links
  vuurt alleen met een pointer lock; zonder lock sleep je met links om te richten.

## Stand

Gebouwd zoals hierboven, met deze afwijkingen:

- Alles wat bemand wordt, staat in één lijst, `CRAFTS.galleon.mounts` (`kind: 'cannon'`,
  `yawLim`, `pitchLim`). Dat is op verzoek van de harpoen-chip, zodat een harpoen er later bij kan.
- Aan het kanon is je eigen lijf verborgen en kijkt de camera vanachter de stuitkop langs de loop;
  anderen zien de schutter wel.
- Een afgevuurd lijf vliegt opgerold (de hurkpose van de rig) en draait kopje-over. Er is dus geen
  nieuwe pose en geen nieuw bit nodig.
- **Lont** (de keeper, naar Sea of Thieves): vuren steekt de lont aan, het kanon gaat `FUSE_S` (2 s)
  later af. Nog eens drukken dooft hem, opnieuw aansteken begint weer bij 2 s. Een geladen kanon
  toont een lontje in het zundgat, een brandend vonkt en rookt (`cannon-fx.js fuse`).
- De camera staat verder achter de stuitkop, zodat je die en de achterkant van de affuit ziet.
  **Climb in** kijkt van binnenuit door de loop naar buiten, met een rode HUD die zegt dat je jezelf
  afschiet. Een afgevuurd lijf landt op het dak van een gebouw en rolt eraf, in plaats van erdoorheen
  te vallen (`roofUnder`).
- De instructies staan in een grote HUD rechtsonder (`#gun-hud`), niet meer in de E-prompt.
- Schepen hebben nog geen gezondheid. Een kogel op een romp ontploft en raakt wie er in de buurt
  staat.

**Schade aan boten (de keeper: "zinken, terug naar ligplaats"; roeiboot "2 levens, dat is zielig").**
Een romp neemt `HULL_HITS` kogels: een galjoen 5, een roeiboot 2. Dat staat op de zee in het geheugen
(`lib/cannons.mjs hitHull`); een romp die `HULL_MEND_MS` (2 min) niet geraakt is, is weer heel. Elke
treffer gaat naar iedereen als `{t:'cannon', a:'hull', id, hits, of}`. Bij de laatste treffer zinkt
de boot (`boats.wreck`): `{t:'boat', ...ligplaats, sunk: [x, z]}`. Elke pagina laat op die plek een
zinkwolk zien, zet de boot terug op zijn ligplaats, en wie aan boord was ligt in het water. In de
eigen wateren (binnen de grid van zijn eiland, of nooit aangeraakt) is een boot veilig. De skiff van
een zwerver heeft geen ligplaats en wordt niet geraakt. Een oudere pagina negeert `sunk` en zet de
boot gewoon op zijn ligplaats. Het blijft een patch.
**Romp-HP-balk** (de keeper: "roeiboot krijgt ook een HP bar"): boven elke geraakte boot zweeft een
balk, `web/js/hull-bars.js`, gemaakt zoals agent-bars.js (twee InstancedMeshes, geen draw call per
boot). Een roeiboot krijgt twee vakjes, een galjoen één balk die leegloopt. De romp-HP van je eigen
boot in de HUD-rij voor wie aan boord is, komt later. Die rij maakt de chip "Galjoen houdt vaart";
hier blijft het bij de zwevende balk, om conflicten te vermijden.
