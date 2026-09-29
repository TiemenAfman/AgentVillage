# Gebouwen in één batch per eiland

**🚧 Status: stap 1 en 2 gebouwd op 29 september 2026** (gebouwlichamen en de frames van de
naambordjes in één batch per eiland). Open: stap 3, de beletterde gezichten in een atlas, en een
controle op de telefoon (zie *Na*).

## Waar dit vandaan komt

Gemeten op 29 september 2026 op een kopie van Hoogezand (368 settlers, 40 wijken, vulkaan en
drie startereilanden in de zee): 32 fps, 34 ms CPU per frame. `__renderStats.breakdown()` zette
`(unnamed) [Mesh MeshStandardMaterial]` bovenaan met ~1.400 calls in elke pass, en een
CPU-profiel liet vooral three.js' eigen renderpad zien (`renderBufferDirect`, `setProgram`,
`projectObject`, `uniformMatrix4fv`): de prijs per draw call, niet de driehoeken. De vraag was
hoeveel van die 34 ms de prijs van de losse gebouwen is, en hoe die omlaag kan zonder de
interacties met een huis kwijt te raken.

## Metingen vóór

Kopie van `~/.promptholm` (zonder `*.lock`/`*.log`), zee op `single` met een eigen poort,
`network.public` uit, de worktree-`serve.mjs --no-rescan` met `PROMPTHOLM_HOME` op de kopie.
Chrome van de DevTools-MCP, venster vooraan, 1280x800, RTX 4090 laptop (ANGLE D3D11,
`WEBGL_multi_draw` aanwezig). `?nointro&stats&quality=0&hour=13`: de kwaliteitsregelaar vast
op *full* en het uur vast, zodat twee metingen hetzelfde tekenen. Elk getal is 5 s rAF-frames;
*work* is de mediaan van `?stats`' eigen *work*. Op het eiland: 806 records, waarvan 395 met
een naambord; op de vulkaan 61 records, op elke starter 4.

Het plafond is gemeten door het gebouwlichaam (`rec.mesh`) van elk record, thuis en op elk
gasteiland, onzichtbaar te zetten - wat een batch in het beste geval wegneemt. De naambordjes
bleken in de uitsplitsing even zwaar als de gebouwen (395 borden x drie calls: frame in beide
passes, het beletterde gezicht in de kleurpas), dus die zijn apart gemeten.

**Full**

| Standpunt | Situatie | fps | ms/frame | work | kleur calls | schaduw calls |
|---|---|---|---|---|---|---|
| Van boven (zoals het opent) | zoals het is | 31,4 | 31,8 | 34,7 | 1.945 | 1.458 |
| | zonder gebouwlichamen | 40,0 | 25,0 | 26,8 | 1.121 | 652 |
| | zonder naambordjes | 40,0 | 25,0 | 27,7 | 1.155 | 1.063 |
| | zonder beide | 62,0 | 16,1 | 18,4 | 329 | 255 |
| Ingezoomd op het dorp (35 van het stadhuis) | zoals het is | 48,2 | 20,8 | 23,2 | 413 | 769 |
| | zonder gebouwlichamen | 58,8 | 17,0 | 19,9 | 294 | 369 |
| | zonder naambordjes | 56,4 | 17,7 | 20,5 | 334 | 599 |
| | zonder beide | 69,0 | 14,5 | 17,0 | 217 | 201 |
| Te voet (op het plein) | zoals het is | 44,8 | 22,3 | 24,2 | 122 | 725 |
| | zonder gebouwlichamen | 49,9 | 20,0 | 22,2 | 99 | 363 |
| | zonder naambordjes | 50,5 | 19,8 | 22,2 | 120 | 565 |
| | zonder beide | 53,3 | 18,8 | 20,8 | 98 | 204 |

**`?modest`**

| Standpunt | Situatie | fps | ms/frame | work | kleur calls | schaduw calls |
|---|---|---|---|---|---|---|
| Van boven | zoals het is | 33,2 | 30,1 | 33,0 | 1.910 | 1.373 |
| | zonder gebouwlichamen | 45,7 | 21,9 | 24,8 | 1.096 | 597 |
| | zonder naambordjes | 43,9 | 22,8 | 25,6 | 1.119 | 990 |
| | zonder beide | 75,0 | 13,3 | 15,6 | 310 | 219 |
| Dorp | zoals het is | 51,4 | 19,5 | 22,6 | 397 | 767 |
| | zonder gebouwlichamen | 64,3 | 15,6 | 18,3 | 280 | 355 |
| | zonder beide | 75,1 | 13,3 | 15,8 | 198 | 182 |
| Te voet | zoals het is | 45,6 | 21,9 | 24,0 | 122 | 726 |
| | zonder gebouwlichamen | 52,7 | 19,0 | 21,1 | 99 | 360 |
| | zonder beide | 56,9 | 17,6 | 19,3 | 99 | 205 |

Wat het zegt:

- **Van boven kosten de ~870 losse gebouwen ~7 ms per frame** (31,8 → 25,0), bij 806 calls in
  elke pass. De GPU merkt ze nauwelijks: de kleurpas verliest er maar 0,6 miljoen van de 5,2
  miljoen driehoeken mee. Het is de CPU-prijs per call.
- **De naambordjes kosten nog eens ~7 ms**, en samen is het meer dan de helft van het frame
  (31,8 → 16,1 ms, 31 → 62 fps).
- **Ingezoomd en te voet is de winst kleiner** (3-4 ms): de frustum culling van three haalt de
  gebouwen buiten beeld al uit de kleurpas; wat overblijft is vooral de schaduwpas, waarvan de
  box veel meer huizen bestrijkt dan je ziet (te voet 725 schaduwcalls tegen 122 kleur).
- **Wat daarna nog 16-19 ms kost, zit niet in draw calls** (329 calls van boven). Dat is een
  volgende meting (de menigte, `pick()` elke frame in orbit, labels) - niet deze taak.

## Het ontwerp

### Eén BatchedMesh per eiland, en het record houdt een stand-in

three r170 heeft `BatchedMesh`: veel verschillende geometrieën in één buffer, één draw call
(`WEBGL_multi_draw`), per instance een eigen matrix en zichtbaarheid, per-instance frustum
culling in `onBeforeRender` en in `onBeforeShadow` (tegen de schaduwcamera), en een raycast die
`batchId` teruggeeft. Elk huis is een eigen geometrie (`buildBuilding` zaait zijn rng op het
id), dus instancing kan niet; een batch wel.

Nieuw: `web/js/record-batch.js`. Eén batch per eiland: thuis in `scene`, voor een gasteiland in
zijn eigen offset-groep (zijn matrices blijven dan in lokale coördinaten, dus klein en precies,
en `keepRegion` knipt de hele batch met de rest van dat eiland in één keer).

Het belangrijkste besluit: **het record behoudt zijn scènegraaf, en de batch spiegelt die.**
`rec.mesh` wordt een lege `Object3D` op de plek waar het mesh hing (zelfde `userData.id`), en de
batch kopieert in zijn eigen `onBeforeRender` - na `scene.updateMatrixWorld`, vóór de
schaduwpas, één keer per render - van elke stand-in:

- **zichtbaar** = elke ouder tot de ouder van de batch `visible`, én `layers.mask !== 0`;
- **matrix** = zijn `matrixWorld` ten opzichte van de batch, alleen geschreven als hij anders is.

Daardoor blijft alles wat nu een huis laat verschijnen, verdwijnen of bewegen werken zonder dat
het van de batch weet: `applyVisibility` (filters, de tijdlijn, `popping`), `popIn` en
`leaveAnimation` (schaal en positie van de groep), de Object Distance-cut (`keepRecord` zet
`layers.mask = 0` op alles in de groep, de stand-in ook), `keepRegion`, de deining van de
Batavia (die beweegt `rec.mesh` zelf, en hangt haar vlaggen eraan), de planner. `record-cull.js`
hoeft niet te veranderen. Het alternatief - elke schrijver van `group.visible` de batch laten
bijwerken - is precies de soort lijst die uit de pas raakt (zie `record-extras.js`).

De spiegel kost per render één lus over de stand-ins: een ouderketen van twee à drie stappen en
zestien getallen vergelijken. Een matrix die verandert (een huis dat opkomt, de Batavia) laat de
matrixtextuur opnieuw uploaden; bij ~1.000 instances is dat 64 kB.

### Aanklikken, hover, de planner

- De batch staat één keer in `state.pickables`. `pick()` en `pickBuilding` in `plan-mode.js`
  lezen het id via één helper (`pickedId(hit)`: `batchId` → stand-in → `userData.id`), zoals
  de settlers al `figureAt(mesh, instanceId)` doen. De raycast van een BatchedMesh slaat
  onzichtbare instances over, dus "alleen zichtbare huizen zijn raakbaar" blijft waar - met de
  zichtbaarheid van het laatst getekende frame, wat is wat je ziet.
- Een huis verandert bij hover of selectie niet van kleur (alleen label en cursor), dus
  `setColorAt` is niet nodig.
- De spookbeelden van de planner deelden `rec.mesh.geometry`. Die is er niet meer (zie
  geheugen), dus `plan-overlay.js` vraagt de batch om een kopie van alleen de posities van dat
  ene huis, bewaart die zolang de planner openstaat en geeft ze bij het sluiten terug.

### Geheugen en capaciteit

Hoogezand: 1,69 miljoen hoekpunten (niet-geïndexeerd), 44 bytes elk (positie, kleur, normaal,
`aEmissive`, `aSheet`): 74 MB. Blijft de losse geometrie na het kopiëren bestaan, dan staat dat
er twee keer in het JS-geheugen. Dus: kopiëren en de bron weggooien (`built.geometry = null`,
na `dispose()`); netto hetzelfde geheugen als nu, plus de ruimte die de batch vrijhoudt.

- Een batch heeft een vaste capaciteit. `reserve()` vóór de eerste lading (het aantal gebouwen
  in `village.json` maal een gemiddelde) zodat het opstarten niet vijf keer groeit; daarna groeit
  hij x1,5 (`setGeometrySize`, `setInstanceCount`) wanneer het vol raakt.
- `deleteGeometry` geeft in r170 het bereik niet terug, alleen het id. Een verbouwing is dus
  verwijderen en achteraan toevoegen. Het dode bereik wordt bijgehouden en eerst gecompacteerd
  (`optimize()`) voordat er gegroeid wordt.
- Elke geometrie moet dezelfde attributen hebben: 21 van de 806 gebouwen hebben geen `aSheet`
  (niets op een vel); die krijgen nullen, precies wat `merge()` al doet als één deel er wel een
  heeft.

### Het materiaal

`buildingMat` blijft het ene materiaal, gedeeld met de batch: de vellen per hoekpunt (`aSheet`,
driezijdig geprojecteerd vanuit `position`, dat in een batch nog steeds de lokale positie van
het huis is), de nachtgloed (`aEmissive`), `uNight`, de fade en `customProgramCacheKey`. three
compileert een batchvariant (`USE_BATCHING`) naast de gewone. Twee dingen van r170:

- De renderer vergelijkt `object.colorTexture` (bestaat niet; het veld heet `_colorsTexture`)
  en vraagt voor een batch zonder kleurtextuur **elke draw** een programma op. Eén keer
  `setColorAt(wit)` zet die textuur, waarna de vergelijking klopt. Wit vermenigvuldigt weg.
- De bol van de hele batch wordt één keer berekend en daarna nooit meer: `frustumCulled = false`
  op de batch zelf; de culling per instance doet het werk.

Dezelfde materialen met en zonder batching wisselen van programma bij elke overgang in de
render list. Die is gesorteerd op materiaal en diepte, dus dat zijn er per pass twee.

### WEBGL_multi_draw

Chrome op de desktop heeft het (gemeten). Zonder valt r170 terug op een lus van `drawArrays`
met een `_gl_DrawID`-uniform per huis: nog steeds één programma, één set uniforms en geen
`projectObject` per huis, dus niet trager dan nu, alleen minder winst. De telefoon moet op het
toestel gecontroleerd worden (Chrome op Android levert de extensie via ANGLE; niet te zien van
hier). De telefoon heeft geen eigen eiland, dus daar gaat het om de gasteilanden.

### Wat los blijft

- **Bewegende delen** (`attachExtras`: wieken, klok, fontein, zagerij, smidse, stal, bakkerij,
  slager, visser, groeve, goud, erts, oven, resetklok, brievenbusvlag, de vlaggen van de
  Batavia): ze bewegen per frame en hangen in de groep van het record, die ze meeneemt.
- **Lichten** (kampvuur, smidse, oven, vuurtoren): geen geometrie, en hun aantal zit in elke
  programmasleutel.
- **Steigers** (gedeelde geometrie, komen en gaan, schalen bij het afbreken).
- **`fog: false`-onderdelen** (de bundel van de vuurtoren, de vlam van het kampvuur): een ander
  materiaal, en een landmark die nooit geknipt wordt.
- **Het beletterde gezicht van een naambord**: een eigen canvas per bord (stap 3).
- **CSS3D-borden**, steigers, dokken, bruggen, props, gewassen, het bloembed en de borreltafels:
  eigen lagen, al samengevoegd of geïnstanced.

### De stappen

1. **Gebouwlichamen in de batch**, thuis en op elk gasteiland (ook de Codex-huizen op de vulkaan,
   die zonder rebuild komen en gaan via `applyBuildings`).
2. **Het frame van een naambord (paal en bord) in dezelfde batch.** Het is vertex-kleur,
   flat-shaded, ruwheid 0,85 - met `aSheet` en `aEmissive` op nul tekent `buildingMat` het
   precies zo. Er zijn maar twee vormen (gewoon en klein), dus twee geometrieën en 395 instances
   van dezelfde batch (`addInstance` op een gedeelde geometrie). Dat is 395 kleur- en 395
   schaduwcalls minder. Het gezicht blijft een eigen mesh.
3. *Later:* de gezichten in een atlas, als één transparante batch. Vraagt een verdeling van de
   textuur (395 gezichten van 512x202 passen niet in één 4096²-textuur; op 256 breed wel) en een
   afweging tussen scherpte van dichtbij en geheugen. Nu houden 395 canvas-texturen samen ~217 MB
   vast (met mipmaps). Het eenvoudiger alternatief - het gezicht niet tekenen waar het onleesbaar
   klein is, met een crème vlakje in de batch als wat je van veraf ziet - staat in
   [naambord-gezichten-op-afstand.md](naambord-gezichten-op-afstand.md).

   **Gemeten** (29 september, na stap 1 en 2, de 399 gezichten in dezelfde pagina om de beurt aan
   en uit, zeven keer per standpunt, gepaard verschil): van boven **~4,2 ms** per frame (full 20,9 → 15,8
   ms, `?modest` 17,3 → 14,5 ms; kleurpas 745 → 346 calls). Ingezoomd op het dorp staan er maar 38 in
   beeld en zit het verschil in de ruis; te voet 0. Dat is het plafond: een atlas-batch kost zelf nog
   wat (de lijst per pass, ~0,3 ms), dus realistisch ~3,5-4 ms van boven.

### Waarom niet samenvoegen per wijk (`mergeGeometries`)

Het haalt dezelfde draw calls weg, maar kost alles wat per huis werkt:

- een huis dat verbouwt, opkomt of vertrekt, bouwt de hele wijk opnieuw en uploadt die;
- zichtbaarheid per huis (filters, de tijdlijn, `popIn`, de Object Distance-cut) kan alleen door
  opnieuw samen te voegen - terugspoelen door de tijdlijn zou elk frame een wijk bouwen;
- aanklikken vraagt een tabel van driehoek naar huis;
- frustum culling wordt per wijk: alles of niets;
- de spookbeelden van de planner zijn per huis.

Een BatchedMesh geeft dezelfde ene call en houdt matrix en zichtbaarheid per huis. Eén batch per
wijk in plaats van per eiland zou alleen culling per wijk toevoegen, die de batch per instance al
doet, voor 40 calls in plaats van één.

### De regel in CLAUDE.md

"One material, one draw call per building" wordt: **één materiaal, één batch per eiland.** Elk
gebouwlichaam is een instance in de BatchedMesh van zijn eiland (`record-batch.js`); het record
houdt een stand-in (`rec.mesh`) en de batch neemt elke render diens zichtbaarheid en matrix over,
dus de toestand blijft in de scènegraaf. Een gebouw een materiaalarray of een eigen mesh geven
haalt het uit de batch: weer een call per pass.

## Na

### Metingen

Voor en na naast elkaar gemeten, dezelfde middag: de oude code (`cc960da`, een schone worktree)
en deze tak, elk op een verse kopie van Hoogezand, **om de beurt met maar één islander aan**, en
van elke laadbeurt de tweede doorloop. Dat bleek nodig: met twee lokale zeeën tegelijk (elk
loopt de hele menigte van Hoogezand, en het was lunchtijd, iedereen op weg naar het plein) schoot
dezelfde pagina tussen 40 en 67 fps heen en weer, en de eerste doorloop na het laden is nog aan
het compileren en opruimen. Dezelfde oude code mat 's ochtends 31,8 ms en 's middags 28,5 ms; de
tabel hieronder vergelijkt alleen middag met middag. Meerdere getallen zijn meerdere laadbeurten.

**Full**

| Standpunt | vóór: fps · ms/frame | na: fps · ms/frame | calls kleur / schaduw, vóór → na |
|---|---|---|---|
| Van boven | 35,4 · 28,2 en 34,8 · 28,7 | 68,1 · 14,7 en 66,7 · 15,0 | 1.945 / 1.460 → 727 / 258 |
| Dorp | 62,3 · 16,0 en 64,7 · 15,4 | 79,9 · 12,5, 82,0 · 12,2, 64,8 · 15,4 | 394 / 768 → 238 / 200 |
| Te voet | 54,8 · 18,2, 65,1 · 15,4, 54,3 · 18,4 | 62,9 · 15,9, 60,6 · 16,5, 58,6 · 17,1 | 119 / 727 → 98 / 204 |

**`?modest`**

| Standpunt | vóór: fps · ms/frame | na: fps · ms/frame | calls kleur / schaduw, vóór → na |
|---|---|---|---|
| Van boven | 42,6 · 23,5 | 63,7 · 15,7 en 55,8 · 17,9 | 1.907 / 1.371 → 707 / 217 |
| Dorp | 76,2 · 13,1 en 60,1 · 16,6 | 79,9 · 12,5 en 74,8 · 13,4 | 394 / 753 → 236 / 198 |
| Te voet | 62,3 · 16,1 en 58,8 · 17,0 | 69,6 · 14,4 en 61,4 · 16,3 | 119 / 708 → 98 / 202 |

**Zonder `WEBGL_multi_draw`** (de extensie verborgen voor de pagina laadde): van boven 63,2 · 15,8
en 60,1 · 16,6 ms. three tekent dan huis voor huis en telt weer 1.947 / 1.460 calls, maar de tijd
zat in wat three *per object* doet (`projectObject`, `setProgram`, de uniforms), en dat slaat een
batch ook dan over. Wat de telefoon doet is daarmee geen gok meer: in het ergste geval dit.

Wat het zegt:

- **Van boven is het frame bijna gehalveerd**: 28,5 → 15 ms, 35 → 67 fps. Dat is meer dan het
  plafond van alleen de lichamen (~7 ms): de frames van de naambordjes doen de rest.
- **Ingezoomd ~2 ms, te voet binnen de ruis.** Te voet valt de schaduwpas van 727 naar 204 calls
  en merkt het frame er weinig van; daar zit de tijd ergens anders (volgende meting).
- **Het beletterde gezicht is nu de grootste groep calls**: 395 in de kleurpas, allemaal met een
  eigen canvas-textuur. Dat is stap 3.
- **Wat de batch zelf kost**: in de frame ~1 ms voor de spiegel en de lijst van beide passes
  (drie schepen op hun deining laten de matrixtextuur elk frame opnieuw uploaden, 78 kB), en
  0,26 ms voor de raycast van `pick()`. Sorteren gebeurt alleen nog in de kleurpas.

### Controle

In de browser op de kopie van Hoogezand (Chrome van de DevTools-MCP, venster vooraan) en op een
klein eiland (de eigen worktree, vanochtend gesticht: 2 settlers, 11 gebouwen), en in tests.

- ✅ **Aanklikken opent het dossier**, voor een huis, een civic en een schuurtje (klik op het
  scherm op het midden van het gebouw, `pickedId` op de batch), ook op het kleine eiland.
- ✅ **Hover-label** boven het huis. Een huis verandert bij hover of selectie niet van kleur, dus
  `setColorAt` is niet nodig.
- ✅ **Alleen zichtbare huizen raakbaar**: met Apprentices uit gaan 343 schuurtjes uit de batch
  (1.201 → 858 getekend) en een klik op die plek raakt het huis erachter; weer aan, weer het
  schuurtje. Getest in `tests/record-batch.test.mjs`.
- ✅ **Focus** zet het doel precies op het huis; **Walk here** stuurt het lichaam op weg.
- ✅ **Een nieuw huis groeit op** (`popIn`, schaal 0,28 → 1), **steigers komen en gaan**, een hut
  wordt **cottage** (3.696 → 4.200 hoekpunten, opnieuw in de batch), een **tent vertrekt** en is
  na zijn animatie uit de batch: een echte rescan met een aangepaste `village.json`.
- ✅ **Show-filters**: Code 1.201 → 479, Cowork → 1.183, Apprentices → 858, en terug.
- ✅ **Tijdlijn**: terug naar 20 september 681 records, 13 augustus 78, eind juni 7, en Live weer 807.
- ✅ **Object Distance** op 100 te voet: 34 records geknipt, geen enkel verschil tussen wat de batch
  tekent en `group.visible && !rec.cull`; het ene landmark nooit geknipt; alle vier gasteilanden
  met hun batch weggemaskeerd (`keepRegion`). `record-cull.js` is ongewijzigd.
- ✅ **Frustum culling**: het hele eiland in beeld 1.203 draws, naar zee kijkend 0.
- ✅ **Schaduwen**, ook met `?quality=4` (de schaduwkaart om de drie frames), en **nachtgloed** en
  de **vellen** (pleister, dakpan, steen) zoals ze waren - de kleurpas telt exact dezelfde
  driehoeken als vóór (5.179.448 tegen 5.179.428).
- ✅ **De planner**: een wijk van twee huizen gesleept (twee spookbeelden, eigen kopie van alleen
  de posities, groen), Apply (beide 8 eenheden verschoven, batchmatrix = groep), Undo (terug).
- ✅ **Gasteilanden**: de 61 records op de vulkaan in hun eigen batch; een Codex-huis eruit en
  terug via `applyBuildings` (61 → 60 → 61), met vellen en schaduw.
- ✅ **Bewegende delen**: klok, fontein, zagerij, smidse, stal, bakkerij, slager, visser, groeve,
  goud, erts, oven, brievenbusvlag; de Batavia deint (haar instance volgt `rec.mesh.position.y`
  per frame) met haar vlaggen aan de stand-in.
- ✅ **`/demo` en `/editor`** laden zonder één melding in de console.
- ✅ **Geen lek**: `tests/guest-leak.test.mjs` groen (de batch van een gasteiland en zijn texturen
  worden bij het neerleggen vrijgegeven); in de browser acht keer alle gasteilanden neergelegd en
  opgehaald - geometrieën en texturen elke keer exact terug op 721 / 461 -, en twee minuten rond
  het dorp cirkelen: texturen vlak op 461, geometrieën 752 → 754, heap vlak rond 330-350 MB.
- ✅ **`node --test "tests/*.test.mjs"`**: 1.365 van de 1.366 groen, met 13 nieuwe in
  `tests/record-batch.test.mjs`. De ene die faalt, `codex-sources.test.mjs` ("a Codex island has
  its own stable layout"), faalt ook op een schone `cc960da`: zijn vaste datum (22 september) is
  sinds vandaag ouder dan `tentGraceMs`, dus de enige tent vertrekt. Los van deze wijziging.
- 🚧 **De telefoon** is niet op een toestel bekeken. Zonder eigen eiland heeft hij alleen
  gastbatches, en zonder `WEBGL_multi_draw` werkt het (zie hierboven).

## Versie

Alleen paginacode; niets op de lijn, niets in `layout.json`, `config.json` of de bundle. Past in
een patch.
