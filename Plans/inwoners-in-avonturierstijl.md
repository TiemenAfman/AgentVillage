# 🚧 Inwoners in avonturierstijl (diversiteit, GPU-skinning per instance)

## Aanleiding

Tiemen (7 oktober 2026): de inwoners opnieuw opbouwen in de stijl van de Avonturier/Wanderer, met
een mooie diversiteit. Gekozen bij het plannen:

- **Aanpak 2: GPU-skinning per instance.** Eén instanced lichaam met een eigen vertex shader en
  gewrichtshoeken per inwoner, zodat knieën, ellebogen en schouders glad buigen in plaats van dat
  losse stukken (`RESIDENT_PIECES`) om een draaipunt kantelen.
- **Kleding los combineerbaar**: de Peasant-stukken uit het Quaternius-kit (shirt, broek, schoenen,
  bretels) plus eigen varianten in dezelfde stijl (schort, vest, rok/jurk, sjaal), met de bestaande
  hoeden, de vijf Quaternius-kapsels, huid- en haarkleuren.
- **Geen extra downloads**: alles komt uit `assets/bodies/source` (CC0) en wat we zelf modelleren.

## Wat er nu staat

- Een inwoner is `settler-figures.js` `createFigures`: elf InstancedMeshes in één `batch` (torso,
  trim, benen, armen, handen, nek, hoofd, gezichtsdetails) plus losse batches voor rok, haar, elke
  hoedvorm en gereedschap. Elk deel krijgt per frame een eigen matrix (`setPosed`): ~11 matrices
  per figuur, ~11 + hoeden/haar/rok/gereedschap draw calls per pass.
- Driehoeken per figuur (gemeten in `villager-mesh.js`): hoofd 576, details 376, torso 460,
  ledematen 672, handen 236 = **~2.300**, plus haar 400, rok 112, hoed ~136.
- Het uiterlijk komt uit `shared/palette.mjs settlerLook` (de `:look`-stream bepaalt o.a. lengte,
  dus de pas op de zee; `:appearance` is cosmetisch).
- De Wanderer (`bodies-mesh.js`, `scripts/build-bodies.py`) is per lichaam **~15.000** driehoeken
  kaal, plus kleding 6-10k, haar 0,8-3,3k: aangekleed **~25.000**, tien keer een inwoner.

## Performance (Tiemens vraag: "hoeveel impact geeft aanpak 2?")

De rekensom zit in de vertices, niet in de skinning:

| | nu | aanpak 2, gedecimeerd | Wanderer zoals hij is |
|---|---|---|---|
| driehoeken per figuur | ~2,3-2,9k | ≤ 3k (budget) | ~25k |
| 300 inwoners, beide passes | ~1,6M | ~1,6-1,8M | ~15M ❌ |
| matrices per figuur (CPU) | ~11 + gereedschap | 1 + ~16 hoeken | - |
| draw calls per pass | ~11 + varianten | ~1 per kledingvariant | - |

- **GPU**: per vertex komen er twee gewogen gewrichten bij (twee mat3-rotaties en een mix). Op een
  GPU is dat een paar dozijn ALU-instructies per vertex, verwaarloosbaar naast het fragmentwerk.
  Met hetzelfde aantal vertices is het **neutraal**.
- **CPU**: nu ~11 `setMatrixAt` + `instanceMatrix`-uploads per figuur; straks één matrix en één rij
  van ~16 hoeken in een gedeelde datatextuur. **Gelijk of iets goedkoper.**
- **Draw calls**: één InstancedMesh per lichaam/kledingstuk/kapsel/hoed die iemand draagt (net
  als nu bij hoeden en haar: wie het niet draagt heeft er geen instance in). Dat is het aantal
  *varianten*, niet het aantal inwoners: grofweg 30-50 per pass bij volle diversiteit, tegen ~25
  nu. Instanced calls zijn goedkoop; dit is de enige post die stijgt, en meetbaar.
- **De voorwaarde**: het lijf moet terug naar het budget van nu. Zonder decimeren is het tien
  keer zo duur en dat is niet te doen op Hoogezand (300+ inwoners, `CAPACITY` 1024). Dus:
  - huid die onder kleding valt eruit (de `hide`-lijsten die `build-bodies.py` al uitrekent),
  - decimeren in Blender naar een budget per stuk (richtgetal: lijf zichtbaar ~1.000, shirt 500,
    broek 350, schoenen 150, haar 250, hoed de bestaande ~136 van de inwoners),
  - geen schaduw van wat binnen het silhouet ligt (zoals nu `trim`, `details`).
- **Meten** met `?stats` op een kopie van Hoogezand, voor en na, beide passes (render-stats.js),
  zoals CLAUDE.md voorschrijft (één islander tegelijk, tweede pass na laden, afwisselen).

Conclusie: **neutraal tot iets beter**, mits het driehoekenbudget gehaald wordt. Het echte risico is
niet de snelheid maar de breedte van de verbouwing (hieronder).

## Ontwerp

### Het skelet van een inwoner

Een vaste, kleine hiërarchie (~16 gewrichten): heup, rug, borst, nek, hoofd; per kant schouder,
elleboog, pols; heup-been, knie, enkel. Dezelfde namen als de Wanderer (Adventurer-skelet), zodat de
bake de bestaande skinweights uit de bron kan overnemen en beperken tot **twee invloeden per vertex**
(de twee zwaarste, genormaliseerd). Twee is genoeg voor knie en elleboog en houdt de attributen klein
(`aJoint` 2× uint8, `aWeight` 1 float).

### Per instance

- Één `instanceMatrix` (plaats en kijkrichting, zoals nu de torso).
- Een **gedeelde DataTexture** (RGBA float, één rij per figuur): ~16 hoeken in 4 texels. Elke
  InstancedMesh (lijf, elk kledingstuk, haar, hoed) krijgt alleen een `aFigure`-index naar die rij,
  zodat de slots per batch mogen verschillen (de bestaande packing in `batch`/`trade` blijft) en de
  pose maar één keer per frame geüpload wordt, alleen tot het hoogste gebruikte figuurnummer.
- De vertex shader bouwt per vertex de twee gewrichtsrotaties op langs de vaste keten (diepte ≤ 4)
  uit de hoeken. Alternatief als dat in de metingen tegenvalt: CPU stelt per figuur de 16 matrices
  samen en de textuur draagt 3 texels per gewricht (three's eigen bone texture). Eerst de hoeken.

### De shader

Een patch op `crowdMat` via dezelfde weg als fade en see-through: `onBeforeCompile` en
`customProgramCacheKey` als `function`s (zie CLAUDE.md, see-through), met `-skin` in de sleutel. De
**diepte-tweeling** (`material.userData.fadeDepth`) krijgt dezelfde patch, anders werpt de schaduw
een stijve pop. `begin_vertex` en `beginnormal_vertex` worden vervangen; de rest van het materiaal
(nevel, fade, nacht) blijft.

### Houdingen

`workPose`, `sitPose`, dansen, drinken, `strike`, `barrow`/`carry`, flinch en de loopcyclus schrijven
nu hoeken per *stuk*. Die worden hoeken per *gewricht*, met knie en elleboog erbij (nu buigen benen en
armen alleen in de heup en schouder). Eén functie `poseOf(f, t) -> Float32Array(16)` vervangt de
`setPosed`-aanroepen; de huidige hoeken zijn de startwaarden, zodat er niets van betekenis
verandert behalve dat het buigt. Niets hiervan gaat over de draad: de zee stuurt nog steeds alleen
`anim`, `face`, `turn` (CLAUDE.md: de cosmetische sinussen voeden nooit een positie).

Gereedschap (hamer, zwaard, fakkel, hengel, gereedschap per werk) hangt star aan het
polsgewricht: zelfde shader, alle vertices gewicht 1 op de pols. Dan hoeft de CPU geen
handmatrix meer uit te rekenen en blijft het per frame geteld zoals nu.

### Diversiteit

Een nieuwe stream **`<id>:wardrobe`** in `shared/palette.mjs` (nooit een trekking in `:look`
erbij, die bepaalt de lengte en dus de pas op de zee). Per inwoner:

- lichaam: man/vrouw (de bestaande kans die nu een rok + haar geeft),
- bovenstuk: peasant-shirt, shirt + vest, jurk (vrouw), schort over shirt,
- onderstuk: broek, rok (vrouw) - een jurk vervangt beide,
- schoenen: peasant, klompen (de huidige, als stuk),
- extra: sjaal, bretels (peasant-straps),
- kapsel: een van de vijf (buzzed, buzzed female, buns, long, parted) of kaal, met de haarkleur
  uit het bestaande palet,
- hoed: de bestaande hoedvormen per `style`, zoals nu,
- huid: het bestaande huidpalet,
- kleuren per kledingstuk uit het bestaande dorpspalet (stof, niet fel).

De `tier`/`style`-regels die er nu zijn (tent, zeeman, tovenaar, ...) blijven bepalen *wat voor
soort* kleding; de wardrobe-stream kiest daarbinnen.

### De bake

`scripts/build-residents.py` (Blender, zoals `build-bodies.py`) → `assets/residents/residents.blend`
→ `web/js/residents-mesh.js`: per lichaam de zichtbare huid gedecimeerd, per kledingstuk een
gedecimeerde, op het skelet gewogen mesh, de vijf kapsels, de bestaande hoeden opnieuw op het hoofd
gepast, en de eigen kledingstukken gemodelleerd op het lichaam in ondergoed (zoals het Wanderer-plan
dat voorschrijft). Gezicht: ogen en wenkbrauwen als kleine geometrie (een gedecimeerd hoofd verliest
het vertex-colour-gezicht). Een regel in `scripts/model-rules.mjs` houdt het driehoekenbudget per
stuk vast, zodat `tests/models.test.mjs` een te zware bake weigert. **Vraagt Blender**: dit gebeurt
op Tiemens machine, niet in een cloudsessie.

## Fasen

1. **Bake** (`build-residents.py`, budget in model-rules, renders ter beoordeling). Blender.
2. **Skinning-shader + één lijf**: `createFigures` tekent het lijf met de nieuwe shader en de
   pose-textuur, eerst met alleen de loopcyclus; meten met `?stats` tegen de huidige.
3. **Alle houdingen** naar gewrichtshoeken (`poseOf`), de bestaande tests over houdingen
   (`sit-pose`, `settler-batches`, `butcher`, ...) bijgewerkt en een test die knie/elleboog binnen
   grenzen houdt.
4. **Kleding en wardrobe-stream**, gereedschap aan de pols, `figureGeometry` (walk mode, interieurs,
   modelvel) uit dezelfde stukken samengesteld.
5. **Opruimen**: `villager-mesh.js`/`RESIDENT_PIECES`/`RESIDENT_PIVOTS` weg zodra niets ze meer leest;
   CLAUDE.md bijwerken.

## Stand

### Fase 1 (8 oktober 2026): de bake

`scripts/build-residents.py` → `web/js/residents-mesh.js` + `assets/residents/residents.blend`, renders in
`assets/residents/renders/` (`scripts/preview-residents.py`, ook de loopende rij, geskind met de
geëxporteerde gewichten). Zeventien gewrichten, twee invloeden per hoek. Per lichaam: de altijd
zichtbare huid (hoofd, hals, handen, onderarmen, met de ogen erin) en losse stukken blote huid met een
`shows`-lijst (`<onderstuk>/<schoeisel>`); hemd, kniebroek, laarzen, bretels uit het kit, en zelf
gemodelleerd rok, jurk, vest, schort, sjaal en klompen; vier kapsels per lichaam plus kaal (alleen
wenkbrauwen, die in elk haarstuk zitten); de zes oude hoeden opnieuw gepast. Aangekleed 1.870-2.380
driehoeken; het budget (3.000 per figuur, per stuk een plafond) staat in `model-rules.mjs`
(`RESIDENT_FIGURE`, `RESIDENT_BUDGETS`, `checkResidents`), en `tests/models.test.mjs` weigert een te
zware bake.

### Fase 2 (8 oktober 2026): de shader en één lijf

- `web/js/resident-skin.js`: geometrie per stuk, `skinnedMaterial` (een kloon van het crowd-materiaal
  die diens hook draait en `-skin` aan de sleutel hangt, met een eigen diepte-tweeling; `buildings.js`
  laat zijn fade-schakelaar ook die klonen opnieuw compileren via `userData.followers`), de
  pose-textuur en `poseJoints`.
- **Matrices in de textuur, niet de hoeken.** Een gewricht draait om tot drie assen (een drinkarm
  zwaait en draait in, het lijf leunt, rolt en draait), dus de keten in de shader opbouwen is per
  vertex vijf niveaus van drie rotaties: zo'n zestig sin/cos, voor beide invloeden, in beide passes.
  Op de CPU zijn het zeventien kleine matrixproducten per figuur (de oude crowd deed er elf) en in de
  shader zes texel-fetches per vertex. Het plan noemde dit al als alternatief.
- Eén pose-rij per figuur, in een batch die net als de andere gepakt blijft (getekenden vooraan), dus
  de textuur groeit in machten van twee en gaat alleen omhoog als er iemand getekend wordt. Elke
  instance draagt `aFigure`; bij een ruil verhuist die mee met de matrix.
- `createFigures(..., { skinned })`, standaard uit; aan met `?skinned` of `promptholm.debug.skinned`
  in localStorage. Pas als fase 3 en 4 klaar zijn wordt het de standaard.
- Houdingen: de bestaande hoeken op heup- en schoudergewricht (dus zitten, werken, dansen, drinken,
  slaan doen wat ze deden), en lopend nu met knie en elleboog (`KNEE_*`, `ELBOW_*`). Gereedschap,
  zwaard, fakkel en bier hangen aan het polsgewricht. De kruiwagen-handvatten zijn nog op de oude hand
  gemeten.
- Kleding tot de wardrobe-stream er is: de oude look op de kit-kleding (hemd = tunic, broek of rok =
  trim, laarzen), vrouwen lang haar, mannen een scheiding.

**Gemeten** op een kopie van BierRum (Hoogezand staat niet op deze machine): 141 bewoners en 120
leerlingen, de noclip-camera vast boven het dorp, `__renderStats.breakdown()`, oud en nieuw om en om.

| | figuren | kleur: calls / driehoeken | schaduw: calls / driehoeken | per figuur, beide passes |
|---|---|---|---|---|
| oud | 204 | 36 / 554k | 17 / 358k | ~4.470 |
| skinned | 204 | 31 / 441k | 29 / 441k | ~4.330 |
| skinned (tweede keer) | 186 | 30 / 402k | 28 / 402k | ~4.320 |

Neutraal tot iets beter, zoals voorspeld. De schaduwpass is duurder dan voorheen (elk stuk werpt
schaduw, waar het oude lijf zijn trim en gezicht uitsloot), de kleurpass goedkoper. Draw calls: 30-31
in de kleurpass bij de gewone kleding van nu, tegen 36. CPU (`draw()` onder Node, 300 figuren, de helft
lopend): oud 0,34-0,40 ms, skinned 0,50 ms per frame; `poseJoints` is daarvan ~0,15 ms. De tijd per frame
in de browser was in het verborgen paneel niet eerlijk te meten.

## Besluiten

- GPU-skinning per instance, twee invloeden per vertex, hoeken in een gedeelde DataTexture.
- Driehoekenbudget ≤ 3k per aangeklede figuur; anders gaat het niet door.
- Cosmetiek alleen via een nieuwe `:wardrobe`-stream; `:look` blijft ongewijzigd.
- Niets op de draad, geen `SEA_V`, geen layoutgate: een patch qua compatibiliteit. Wel een flinke
  verandering in het beeld, dus liever in een minor.

## Open vragen

- Vindt Tiemen 30-50 draw calls per pass bij volle diversiteit acceptabel, of beperken we het aantal
  kledingvarianten per eiland?
- Blijven de Codex-bewoners en de bewakers op de vulkaan (imps) buiten dit plan? Voorstel: Codex-
  bewoners gaan mee (ze zijn instanced settlers), imps niet.
