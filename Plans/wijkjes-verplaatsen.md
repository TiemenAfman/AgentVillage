# Wijkjes verplaatsen — een planner van bovenaf

> "Stel ik wil topview / Age of Empires-achtig een planner hebben om wat dorpjes te
> verplaatsen / groeperen. Een deel van de zee selecteren en het land uitbreiden. Highlight
> meerdere huisjes, drag-drop. Gebieden markeren voor wel of niet bebouwen. Ik wil misschien
> het centrum veranderen." — en daarna: "Nee, de huizen verhuizen nooit, daarom wil ik een
> editor om wijkjes te selecteren en wél te verhuizen."

**Status:** fase 1, 2 en 3 gebouwd op 22 september 2026. Fase 1: zones, wijkjes verplaatsen en de
planner-modus. Fase 2: handmatige polder met toegangsweg, `unpolder` om land terug te geven, `parcel`
(Land-tool, 5) om een wijkje grond bij te geven of af te nemen, en een bundel-test dat de zee een
handmatige polder accepteert. Fase 3: geen reload meer na Apply. De pagina bouwt een verplaatst
gebouw opnieuw, tekent wegen opnieuw als hun inhoud verandert en bouwt het terrein opnieuw bij een
ander poldersaldo. Wat live niet kan: bos terug laten groeien op vrijgekomen grond, want
`createLandscape` strooit het bos eenmalig per paginalading. Verplaatsen en polderen zijn op het
echte eiland door Martijn zelf nagekeken. De bijlage
"Verkenning" onderaan is de gemeten stand van de code op die dag — regelnummers, timingen en
wat er breekt — zodat dat niet opnieuw hoeft.

## Context

Promptholm plant zichzelf: `placeAll` in `lib/layout.mjs` zet elke nieuwe settler op de
eerste vrije super-cel (4×4 cellen) in het parcel van zijn district, en raakt daarna nooit
meer iets aan dat al staat. Dat is de invariant "een huis verhuist nooit", afgedwongen door
bestaanschecks vóór elke plaatser. Wat er wél al bestaat aan "herplannen": `/roads reroute`
(`clearRoads` + één `placeAll`), de vijf versiepoorten, en polders (zee → land, automatisch
bij 150 settlers).

Wat ontbreekt: een hand. Er is geen top-down camera, geen multi-select, geen manier om een
wijkje ergens anders neer te zetten, geen "hier niet bouwen", en geen handmatige polder.
Deze planner voegt precies die hand toe, met als kern: **de scanner verhuist nooit iets uit
zichzelf; de keeper verhuist bewust, via één deur, en de scan erna is weer een no-op.**

Het plein blijft staan (jouw keuze): "het centrum veranderen" = wijkjes eromheen
herschikken, grond vrijhouden met zones, land bijwinnen met polders. Het plein verplaatsen
is uit scope — zie "Wat echt moeilijk is" #12 voor waarom.

## Besluiten

| Vraag | Besluit | Waarom |
|---|---|---|
| Wat blijft er van "een huis verhuist nooit"? | **Nooit uit zichzelf.** Scanner blijft deterministisch en append-only; de keeper verhuist via `POST /api/plan`, en een tweede scan is byte-identiek. | Zelfde houding als `/roads reroute`. De vier checks uit `docs/branches.md` blijven gelden met "tenzij het plan het noemt". |
| Wat is de eenheid van verplaatsen? | **Hele wijkjes** (lobes), één of meer tegelijk, met één super-cel-delta. Losse huizen nooit. | Jouw uitgangspunt; en een huis staat op het land van zijn eigen project (`district` = projectmap, `lib/village.mjs:314-321`), dus over grenzen slepen kan niet kloppen. |
| Plein verplaatsen? | **Nee.** | ~40 civics staan op absolute cellen rond `town.centre`, alle 22 wegen richten erop, de lattice-anker hangt eraan. Herindexeren redt de gebouwen niet. |
| Waar worden ops toegepast? | In `scan.mjs`, in het slot waar `clearRoads` nu zit (`:116`), via `scan({ plan, dryRun })`; polders in `reclaim` vóór de hash-regel. | Een polder die vóór `placeAll` in `layout.polders` komt zonder nieuwe hash wist het hele eiland (`resetForNewTerrain`, `layout.mjs:1896-1905`). |
| Validatie | **Server-authoritatief**, met `Super.eligible` + een `replayGrid`. Dry run = `placeAll` op een deep copy. | `placeAll` weigert níets: gemeten werden twee huizen op een helling van 2.1 gewoon geaccepteerd. Validatie ís de feature. |
| Wegen van een verplaatst wijkje? | Weg + huispaden + office van de verplaatste lobes wissen, daarna **`pruneUnreachable`** (flood vanaf het plein via `shared/roads.mjs`), niet `clearRoads`. | Alleen eigen paden wissen liet gemeten in 2 van 4 experimenten een buurweg verweesd achter; `clearRoads` hertekent alle 114 paden op het eiland bij elke verhuizing. |
| `cleared` | Op apply leegmaken; `placeAll` bouwt het op als precies wat er staat. | Het bos groeit weer op het oude wijkje. Union groeit anders eeuwig (`docs/next/loose-ends.md`). |
| Zones | Alleen `no-build`, per super-cel, als `held` + `RESERVED` + in `fairwayHeld` — precies de dijk. Bestaande gebouwen erin blijven staan (bevroren, niet verjaagd). Zones blokkeren óók wegen. | Nul nieuwe grid-toestanden. Een zone dwars over de enige weg naar het plein strandt een wijkje: de dry run meldt dat via reachability. |
| Zones op de zee? | In `village.json` top-level `zones`, niet in de bundel-whitelist. | De keeper ziet ze; de bundel verandert niet, dus een zone-wijziging kost geen publish en geen rebuild bij buren. |
| Handmatige polder telt mee voor de ladder? | Ja, met `manual: true`, `at`, `unlockedAt`. | De ladder bestaat voor capaciteit; gewonnen land ís capaciteit. Zonder datering toont de chronicle hem vanaf dag één. |
| Atomair? | Ja: proef-`placeAll` op een kopie (tot fixed point, max 3), alles-of-niets, dan snapshot, dan echte apply. | Eén apply = één scan = één publish (206 kB, ~550 ms stall per kijker, iedereen loopt terug naar zijn deur). |
| Na apply in de eigen browser? | Fase 1: `broadcast('reload')`. | `applyVillage` vergelijkt `plot` niet (`main.js:3311-3321`); `reportPlacements` zou binnen 300 ms de óude posities naar de zee sturen. |
| Preview in de browser? | `GET /api/plan/survey` (server-gebakken bits per super) + dry run op drop; geen predicaten kopiëren naar `shared/`. Wel `shared/lattice.mjs` voor `blockOf`/`superOf`. | Eén waarheid; `hamlets.js:69-70` en `history.js` hebben nu al een tweede `blockOf`. |
| Ghosts of echte meshes tijdens slepen? | **Ghosts** (clones van de gebouwde geometrie, groen/rood). Echte groups bewegen nooit vóór apply. | `reportPlacements` leest `rec.group.position` bij elke `applyVillage`; een sleep die een 60 s-scan kruist zou verkeerde posities publiceren. |
| Ongedaan maken | `data/layout.before-plan-<ts>.json` vóór elke apply; `POST /api/plan/undo`; 10 bewaren. | Precedent: `data/layout.before-256-20260918-151140.json`. |
| Camera | Eigen `OrthographicCamera`, recht omlaag, noord = −z boven. `camera`/`controls` van orbit worden niet aangeraakt. | Een schermrechthoek is dan een wereldrechthoek; de orbit-pose herstelt gratis. |
| UI-taal | Engels in chips/panelen (Plan, Select, Move, Zone, Polder, Apply…). | De hele UI is Engels; commits en plannen Nederlands. |

## Ontwerp — server (`lib/plan.mjs`, `lib/layout.mjs`, `scan.mjs`, `serve.mjs`)

### Wire

```jsonc
POST /api/plan  { "dryRun": true|false, "ops": [
  { "op": "move",   "lobes": [{ "district": "p:d:\\git\\x", "lobe": 0 }], "di": 2, "dj": -1 },
  { "op": "zone",   "kind": "no-build", "add": [[i,j]], "remove": [[i,j]] },
  { "op": "parcel", "district": "…", "lobe": 0, "add": [[i,j]], "remove": [[i,j]] },   // fase 2
  { "op": "polder", "supers": [[i,j]] }                                                  // fase 2
] }
→ 200 { ok, dryRun, ms, placeMs, stableAfter, verdicts:[{i, op, ok, reason?, notes[]}],
        diff: { plots:{moved:[{id,from,to}], removed, added, otherMoved:[]},
                paths:{before, after, relaid, stranded:[districtIds]},
                cleared:{before, after}, polders:{before, after}, terrainHash:{before, after}, unplaced },
        snapshot? }
→ 409 { ok:false, verdicts, diff }   // iets geweigerd, niets geschreven
→ 423 { error:'scanning' }           // hook houdt data/scan.lock; opnieuw proberen
GET  /api/plan          → { zones, lattice, snapshots:[…nieuwste eerst], busy }
GET  /api/plan/survey   → { lat, R, usable, beach, held, water, owner, ownerIds, zones, generatedAt }
POST /api/plan/undo     { snapshot }  → kopieert terug, rescan, publish; antwoordt { replaced:[ids] }
```

Caps: ops ≤ 64, lobes per move ≤ 22, |di|,|dj| ≤ 64, zone-supers ≤ 512, polder-supers ≤ 24,
body 256 kB. District-ids alleen via membership in `layout.districts` (het zijn ruwe
Windows-paden: nooit regexen, nooit in een bestandsnaam). Snapshotnaam server-side.
`parsePlan` bouwt veld-voor-veld op zoals `lib/placements.mjs:33-80` (weigert `__proto__`).

### `lib/plan.mjs` (nieuw)

- `parsePlan(raw)`, `applyPlan(layout, model, plan, ctx, verdicts)`, `diffLayouts(before, after, touched)`,
  `snapshotName(now)`, `isSnapshotName(s)`, `pruneUnreachable(layout, grid)`.
- Per op: `opMove`, `opZone`, (fase 2) `opParcel`, `opPolder`. Importeert uit `layout.mjs`;
  `layout.mjs` importeert nooit `plan.mjs` (callback), dus geen cycle.

**`move` (kern, fase 1)** — starre translatie van één of meer lobes met (di, dj):
1. Verzamel per lobe: huizen (`plots` met `district`/`lobe`, geen `commons`), hun sheds
   (`shedOf` + elke `shed:` in het 3×3), en `civic:office:<district>` als `lobe === 0`.
2. `sup = new Super(terrain, lat, heldOf(layout))` met ownership herspeeld als
   `placeAll` (`:2131-2139`); **release** alle cellen van de bewegende lobes
   (nieuwe `Super.release(i,j)`); elke bestemmings-super moet `sup.eligible(i+di, j+dj, k, allowBeach)`
   halen — dat dekt bouwbaar (alle 16 cellen), niet van een ander, BELT, `held`, niet in de kern.
3. `grid = replayGrid(terrain, layoutZonderBewegendePlots)`; elk verplaatst 3×3 `freeBlock`,
   elke shed-cel `freeCell`, `outsideDoor` op land.
4. Mutatie: `gx,gz += 4di,4dj` voor huizen en sheds (`rot` blijft — invariant onder translatie),
   `cell += (di,dj)`, `lobe.cells`/`lobe.seed` getransleerd, `lobe.centre = centreOfCell(lat, seed)`
   (farmsteads herstellen dit niet zelf, `:2187/2195`), `rec.centre = lobes[0].centre`,
   `lobe.road = null`, `delete plots[office]`, `paths` zonder `road:<d>:<li>` en zonder
   `path:house:<id>` van de verhuisde huizen.
5. Na alle ops: `pruneUnreachable` (flood vanaf `town.paved` over PATH/SQUARE/BRIDGE met
   `reachableFromSquare` uit `shared/roads.mjs`; elk pad met een cel buiten het net weg, bijbehorende
   `lobe.road = null`), `layout.cleared = []`. `placeAll` legt daarna alleen het ontbrekende bij.
6. Geweigerd: onbekende lobe, lobe van een district dat niet meer in het model zit, delta 0.

**`zone`** — `layout.zones[kind].supers` = gesorteerde union; lege kind weg. Effect via
bestaande mechanismen: `heldOf(layout)` (dijk + causeway + zones) → `Super.build = 0`;
`RESERVED` op het grid naast `:1991`; `fairwayHeld` en `polderCandidate(keep)` krijgen de
zone-cellen. Een zone over een bestaand gebouw: note, geen weigering (PLOT wordt ná RESERVED
gestempeld, `:2022`, en wint). Dekt een zone een padcel → prune + relay.

**`polder` (fase 2)** — `planPolder` splitsen in `polderFromSupers(terrain, lat, supers, seed)`
(`:474-502`) en `digPolder(ground, layout, p)` (`:584-595`, pools + causeway); `reclaim(…, dig)`
graaft eerst de handmatige, dan de ladder, en de hash-regel (`:1960`) volgt ongewijzigd.
Weigeren: land-super, dieper dan `POLDER_DEPTH`, fairway-cel, zone-cel, dijk of cel in
`fairwayHeld` ∪ `fairway.cells` (pier, landing, paden), geen 4-connectiviteit, geen
`touchesShore`, `layout.polders.length >= 64`. `landing` in het werk → `null`.
`scan.mjs:422-425` dateert handmatige polders op `at`/`unlockedAt` uit het record.

**`parcel` (fase 2)** — land bijverven/afsnoepen voor één lobe: add via `sup.eligible`,
remove alleen zonder huis en zonder `seed`, resultaat 4-connected.

### Wijzigingen in `lib/layout.mjs`

- Exporteren: `Grid`, `Super`, `blockOf`, `centreOfCell`, `superOf`, `latticeOf`, `facing`,
  `doorCell`, `outsideDoor`, `polderCandidate`, `touchesShore`, `RESERVED/FREE/PATH/SQUARE/BRIDGE/PLOT`, `BELT`.
- `replayGrid(terrain, layout, { bridges })` uit `trialRoad` (`:1668-1686`) trekken; `trialRoad`
  en `placeAll` gebruiken hem; zones stempelen erin.
- `heldOf(layout)`, `zoneCells(layout)`; `held` op `:1987-1990` uit `heldOf`.
- `Super.release(i, j)`.
- `emptyLayout` krijgt `zones: []`; `loadLayout`: `l.zones = l.zones || []`; `migrateParcels`
  bewaart zones; `resetForNewTerrain` wist ze mee (terrein is weg, zones ook).
- `placeAll` retourneert ook `dug` (fase 2) en het scan-resultaat krijgt `placeMs`.
- `shared/lattice.mjs` (nieuw, puur): `PITCH`, `blockOf`, `superOf`, `centreOfCell`, `cellsOfSuper`;
  `layout.mjs`, `hamlets.js:69-70`, `history.js` en de planner-client importeren hem.

### `scan.mjs` — het slot

Tussen de deleties (`:118-146`) en `placeAll` (`:147`):

```
if (o.plan) {
  before = clone(layout); trial = clone(layout);
  vA = []; applyPlan(trial, model, o.plan, ctx, vA); rA = placeAllToFixedPoint(trial, …, 3);
  diff = diffLayouts(before, trial, touched(o.plan, vA));
  ok = vA.every(ok) && diff.plots.otherMoved.length === 0 && rA.stable;
  if (!ok || o.dryRun) return { ok, dryRun, verdicts: vA, diff, … };      // niets geschreven, ook cache niet
  fs.copyFileSync(files.layout, snapshotPath);                            // undo-punt
  vB = []; applyPlan(layout, model, o.plan, ctx, vB); placeAllToFixedPoint(layout, …, 3);
  if (verdicts differ) throw;                                             // determinisme-guard
} else placeAll(layout, model, …);
```

`otherMoved: []` is de invariant als runtime-guard: verplaatst er iets dat het plan niet
noemt, dan wordt niet geschreven. `assemble` krijgt `zones` (top-level).

### `serve.mjs`

- `rescan`'s `scanning/pending` (`:294-317`) vervangen door een exclusieve FIFO: gewone
  rescans blijven coalescen, een scan mét opts (`clearRoads`, `plan`) wordt nooit geabsorbeerd.
  Dit lost de caveat op `:296-300` meteen ook voor `/roads reroute` op.
- Routes in het schrijfpatroon van `:770-779`: `POST /api/plan` (na apply: `seaClient.publish()`
  éénmaal, `broadcast({…}, 'plan')`, `broadcast({}, 'reload')`), `GET /api/plan`,
  `GET /api/plan/survey` (gecachet per `village.generatedAt`), `POST /api/plan/undo`.
  Alles onder `/api/` is al keeper-only (`lib/access.mjs:145`).
- `scan()` geeft `{ skipped }` als de hook `data/scan.lock` houdt → 4× 400 ms retry, dan 423.
- `lib/placements.mjs`: `forgetPlacements(ids)` voor verplaatste ids (de pagina post na
  reload toch de nieuwe posities; tot dan valt de zee terug op het gemeten midden, `:98-104`).

## Ontwerp — client (`web/js/plan-mode.js`, `plan-overlay.js`, `plan-panel.js`)

### Modus

`state.mode = 'orbit' | 'walk' | 'plan'`. `enterPlan()`/`exitPlan()` naast `enterWalk`/`exitWalk`
(`main.js:1081`, `:1223`), keeper-only chip **Plan** in `#nav-chips` (verborgen voor bezoekers
via `setKeeper`, `ui.js:369`).

Enter: `exitWalk()` indien nodig; `setLiveMode()`; `state.intro = state.tween = null`;
`state.ghost.drop()`; dossier dicht; `controls.enabled = false`; `state.panels.setVisible(false)`;
`state.world.clouds.visible = false` (wolkschaduwen liggen anders over de kaart); `hamletGroup`
onzichtbaar; alle `rec.nameplate` onzichtbaar (41 nameplates = 123 draw calls); `scene.fog.near/far`
ver weg en `applyFogRange` een no-op (`main.js:1306`; de ortho-camera op y=300 zit anders in de nevel).
Exit: alles terug, `controls.enabled = true; controls.update()` één keer (damping-rest), `applyFogRange()`.
Draft blijft bewaard (toast), **Clear** is het expliciete weggooien.

Frame-loop (`main.js:3842-3879`): camera-tak en labels-guard worden `state.mode === 'orbit'`
(nu `!== 'walk'`); `else if ('plan') state.plan.update(dt)`; `renderer.render(scene, activeCamera)`;
`panels.render()` overslaan in plan. `pointermove/pointerup` (`:3573-3598`) returnen vroeg in
plan-modus zodat `select()`/`closeDossier()` nooit lopen. `orbitPad` idem.

### Camera en invoer

`OrthographicCamera` op `(cx, 300, cz)`, `up = (0,0,-1)`, `lookAt(cx,0,cz)` → boven = noord (−z),
rechts = oost (+x), de conventie van `minimap.js:16`. `frameIsland()` meet `terrain.landCells`
zoals `main.js:2905-2913`. Wiel zoomt om de cursor (`hh *= exp(±0.1)`, clamp `[6, half·1.25]`);
pan met rechts/midden-slepen (contextmenu is al onderdrukt, `:289`) en WASD/pijlen; centrum
geklemd op `state.bounds ± 8`. Listeners geïnstalleerd bij enter en verwijderd bij exit
(`ghost.js:310-316`/`:428-440`); toetsen in capture op `window` met `stopImmediatePropagation`
(`buildmenu.js:50-67`): Escape (band/drag annuleren → selectie leeg → modus uit), Ctrl+Z/Y,
Delete (laatste op op de selectie weg), 1–4 tools. Enter bewust niet gebonden.

### Tools

- **Select**: klik op een huis of op grond binnen een parcel → dat hele wijkje (lobe). Rubber-band
  (DOM-div over het canvas; op pointerup wordt de schermrechthoek via de ortho-view een
  wereldrechthoek) → alle lobes waarvan een parcel-super erin ligt. Shift voegt toe. Civic → toast
  "the town stays". Hamlet-signs zijn niet pickable (`main.js:2892`); het parcel-vlak is het doel.
- **Move**: slepen van de selectie; `[di,dj] = round(Δwereld / 4)`; ghosts (clone van
  `rec.built.geometry` met de OK/BAD-materialen uit `ghost.js:64-69`, één call per gebouw) op
  `plot + [4di,4dj]`, tethers oud→nieuw; kleur uit de survey (usable ∧ ¬held ∧ owner ∈ {none, eigen}
  ∧ BELT-regel op de 8 buren); loslaten met delta ≠ 0 → `move`-op. Server dry run (300 ms debounce)
  is de waarheid: verdict in het ledger, `diff.paths.relaid` als amberen celijnen,
  `diff.paths.stranded` en `unplaced` rood.
- **Zone**: LMB verft `add`, RMB/Alt verft `remove`, slepend; één `zone`-op per kind.
- **Polder** (fase 2): zee-supers verven; per-super kleur uit `survey.water`; set-verdict in de HUD.
- (Fase 2) **Land**: parcel bijverven voor het geselecteerde wijkje.

### Overlay (`plan-overlay.js`, elke laag één draw call)

Getters voor `terrain`/`village`/`byId` (de les van `road-debug.js:51-55`: `state.terrain` wordt
vervangen door `layLandscape`). Vertices op de hoekpunten van het grond-heightfield
(`terrain.corner(i,j)`, `world.js:1216-1217`) + y-offset 0.06–0.10 + `polygonOffset −1`: exact
coplanair met de grond, dus geen z-fighting op hellingen — níet de vlakke-vierkantjes-aanpak
van `road-debug.js:195-229`. Boven water op `SEA_LEVEL + 0.12`.

- `grid`: super-raster (lattice, pitch 4), ~68k line-vertices, gedimd.
- `fills`: één mesh, 5×5 vertices per super (~135k tris ≈ de grond zelf), `color` itemSize 4
  (three r170 `USE_COLOR_ALPHA`): parcel per district in zijn `hue` α .18, town grijs, zones
  roodbruin α .35, polder-preview zand, selectie-tint. `paint()` bij verandering, nooit per frame.
  Op `modest` alleen supers met een cel ≥ −1.2.
- `marks`: plot-rechthoeken van de selectie, lobe-omtrek, verplaatste rechthoeken, polderdijk-lijn.
- `tethers`, `roads` (dry-run diff), `unplaced`, `hover` (één vierkant), `ghosts` (pool).

### Panel (`plan-panel.js`, DOM-only)

Links `#plan-tools` (`.panel.left`, chips per tool, Overview, Done), rechts `#plan-ledger`
(ops als zinnen: "Move Sybolt_PLC, plclab by +2, −1", verdict ✓/✗ met reden, Undo/Redo/Clear,
`.btn.primary` **Apply** alleen actief als de laatste dry run actueel en groen is,
`.btn.danger` **Restore previous** achter een twee-keer-drukken-arm zoals `askToSendAway`,
`main.js:1138-1150`), onder `#plan-hud` naast `#build-hud` met `once()`-cache. Districtsnamen
escapen (`esc`, `ui.js:57`).

`localStorage`: `promptholm.plan.draft` `{v, seed, size, ops}` (hersteld als seed/size kloppen;
dry run verifieert opnieuw), `promptholm.plan.view` `{cx, cz, hh}`.

## Bestanden

| Bestand | Wat |
|---|---|
| `Plans/wijkjes-verplaatsen.md`, `Plans/README.md` | dit plan + verkenning (stap 0) |
| `shared/lattice.mjs` (nieuw) | `PITCH`, `blockOf`, `superOf`, `centreOfCell`, `cellsOfSuper` |
| `lib/plan.mjs` (nieuw) | parse, ops, prune, diff, snapshot |
| `lib/layout.mjs` | exports, `replayGrid`, `heldOf`/`zoneCells`, `Super.release`, `zones` in empty/load/migrate/reset, RESERVED-stempel; fase 2: `polderFromSupers`/`digPolder`/`reclaim(dig)` |
| `scan.mjs` | plan-slot, `placeAllToFixedPoint`, `placeMs`, `zones` in `assemble`; fase 2: polder-datering |
| `serve.mjs` | exclusieve scan-FIFO, `/api/plan`, `/api/plan/survey`, `/api/plan/undo` |
| `lib/placements.mjs` | `forgetPlacements(ids)` |
| `web/js/main.js` | `'plan'`-modus, `enterPlan`/`exitPlan`, ortho render, frame-loop-guards, pointer-guards, `applyFogRange`-guard, `onTogglePlan`, boot, resize |
| `web/js/plan-mode.js`, `plan-overlay.js`, `plan-panel.js` (nieuw) | camera/invoer/ops, lagen, DOM |
| `web/index.html`, `web/js/ui.js`, `web/css/ui.css` | chip `#plan-btn`, panelen, HUD, band-div, `setPlanning`, `.panel.left`, `.plan-band` |
| `web/js/hamlets.js`, `web/js/history.js` | `blockOf` uit `shared/lattice.mjs` |
| `tests/support/layout-props.mjs` (nieuw) | reach-flood + eigenschapschecks uit `layout-measure.test.mjs:163-351` gedeeld |
| `tests/plan-*.test.mjs` (nieuw) | zie Verificatie |
| `CLAUDE.md`, `docs/branches.md` | zie onder |

Docs: `CLAUDE.md` "**A house never moves.**" → "**A house never moves by itself.**" + de deur,
de snapshot, `layout.zones` als derde lijst grond die het register weigert (held + RESERVED,
géén hash), `lib/plan.mjs` in de brontabel. `docs/branches.md` assertion 1 → "no plot moved
*that the plan did not name* — `diff.plots.otherMoved` is dezelfde check at runtime"; nieuwe
assertion 5: "after a plan apply, a second scan changes nothing". Fase 2: `lib/islandbundle.mjs`
`polder()`-comment: `manual`/`at` zijn provenance en blijven thuis.

## Fasering — elke fase laat een eiland achter waar je diezelfde avond mee werkt

**Fase 0 — vastleggen.** `Plans/wijkjes-verplaatsen.md` + README-regel.

**Fase 1a — loodgieterswerk + zones.** `shared/lattice.mjs`; `lib/plan.mjs` (parse, zone, prune,
diff, snapshot); `layout.mjs` exports + `replayGrid` + `heldOf` + zones; `scan.mjs`-slot met dry run
en fixed point; `serve.mjs` FIFO + routes + survey; tests plan-parse/zone/scan/lattice; docs.
→ *Zichtbare winst:* een zone verven via `curl` en zien dat de volgende settler eromheen gaat,
zonder dat één huis beweegt.

**Fase 1b — de kaart.** `'plan'`-modus, ortho-camera, pan/zoom, fog/wolken/panels/nameplates,
overlay grid + parcels + zones, chip + panelen, Escape-eigenaarschap.
→ *Zichtbare winst:* het eiland van bovenaf, met wijkgrenzen, en terug naar orbit zonder sporen.

**Fase 1c — wijkjes verplaatsen.** `opMove` + `Super.release` + `forgetPlacements`; selectie
(klik/band/Shift), ghosts, tethers, drag met snap, ledger, dry run, Apply → reload, Restore previous;
tests plan-move (synthetisch + kopie van het echte eiland).
→ *Zichtbare winst:* een wijkje oppakken, neerzetten, en na Apply staat het er echt, wegen erbij,
bos over het oude erf.

**Fase 2 — land.** Handmatige polder (`polderFromSupers`/`digPolder`/`reclaim(dig)`, datering,
weigeringen bij fairway/pier), polder-tool met water-raster, `applyVillage` → `applyLandscape(true)`
bij polder/fairway-verschil (helpt ook de automatische polder); parcel bijverven; tests plan-polder
incl. `parseBundle(buildBundle(…))` round-trip.

**Fase 3 — verfijning.** `applyVillage` vergelijkt `plot` en doet `rebuild(rec, spec)` zodat een
reload niet meer nodig is; tweede publish onderdrukken; `/roads edit` (`lib/commands.mjs:145`, nu
zonder handler) → `enterPlan`.

## Verificatie

```bash
node --test "tests/*.test.mjs"
```

Server stoppen vóór het meten (`stop-island.cmd`), anders interleaved de 60 s-rescan.

| fase | draaien | waar naar kijken | tests erbij |
|---|---|---|---|
| 1a | `curl -X POST :4747/api/plan -d '{"dryRun":true,"ops":[{"op":"zone","kind":"no-build","add":[[5,5]]}]}'` en dan zonder dryRun; `npm run scan` ×2 | `diff.plots.otherMoved` leeg; `layout.json` na tweede scan byte-identiek; `layout.zones` gevuld; volgende settler mijdt de zone | `plan-parse` (caps, `__proto__`, dx), `plan-zone` (geen lobe-cel/plot/pad in de zone; bestaand huis blijft; tweede `placeAll` no-op), `plan-scan` (dry run schrijft niets, ook cache niet; falend plan → geen snapshot; apply → precies één snapshot gelijk aan het vorige bestand; scan erna byte-identiek), `lattice` (round trip op het echte anker; `hamlets.js` en `layout.mjs` geven dezelfde `owner`-map) |
| 1b | `npm run dev`, chip Plan, `?stats` vóór/na | draw calls ≤ Overview vandaag; orbit-pose ongewijzigd na Done; geen `select()` in plan | `plan-client` (source-scan: alleen `mine('/api/plan`, geen bare `fetch('/`, geen `location`; `plan-overlay` importeert alleen `three` + `shared/`) — `tests/api-base.test.mjs:78-91` dekt bare fetch al |
| 1c | wijkje slepen naar de kust, Apply, reload, `npm run scan` ×2 | alle huizen van de lobe exact +4di/+4dj, `rot` gelijk, sheds mee, `shedOf` deep-equal, office naast nieuwe wegkop, elke deur bereikt het plein, `cleared` bevat geen oude cel waar niets staat, `unplaced` leeg, buren zien één rev-bump | `plan-move` (a) hele lobe (2,−1) op synthetisch 12-project-dorp: bovenstaande + `otherMoved: []` + fixed point in 1; (b) twee lobes tegelijk; (c) weigeringen laten layout deep-equal: water, andermans land, BELT, kern, onbekende lobe, delta 0; (d) kopie van `data/layout.json` (layout-measure-idioom, retry op `skipped`): scan twee keer byte-identiek |
| 2 | zee-supers verven, Apply | kust hervormd na reload; `terrainHash === makeTerrain(seed,{size,polders,fairway}).hash`; ladder telt hem mee | `plan-polder` (`manual`, hash via `groundOf`, geen huis bewogen, causeway bereikt plein, pools ⊂ water, weigeringen: land/fairway/zone/los/geen kust; bundel-round-trip; datering) |

## Wat echt moeilijk is

0. **Gemeten op het echte eiland (22 september, avond):** een handmatige polder tegen een strand kreeg een
   causeway van één cel (geen bouwbaar land erachter); de dijk aan de waterkant en het strand aan de
   landkant (BLOCKED voor de router) sloten het binnenland af, en de drie huizen van machinedemo die
   erop gezet werden hadden geen weg. `placeAll` zegt daar niets over. Daarom weigert `runPlan` nu elk
   plan dat een huis nieuw zonder weg naar het plein achterlaat (`stranded`), en weigert een zone over
   eigen of bebouwd land (RESERVED sneed de lanen). De causeway zelf het strand laten oversteken is
   open werk.

1. **`placeAll` weigert niets, dus validatie is het product.** Gemeten: twee huizen op een helling
   van 2.1 (19 onbouwbare cellen) werden geaccepteerd met 0 `unplaced`, weg gelegd, office
   herplaatst. Alle 179 eigen supers op het echte eiland zijn volledig bouwbaar omdat normale
   plaatsing altijd via `Super.eligible` gaat; de planner passeert die poort. Elke bestemming
   door `sup.eligible` voor de eigen ordinal, elke grondcel FREE op een `replayGrid`.
2. **BELT weigert veel.** `eligible` eist geen andere eigenaar binnen 1 super (8 buren) rond élke
   bestemming; met 22 districten op 256 mislukt het meeste vrije land bij het dorp. Verwacht:
   verplaatsen lukt vooral naar de kust of op een verse polder. De survey maakt dat vóór het
   loslaten zichtbaar. Zeg dit in de UI zodat een 409 niet als bug wordt gelezen.
3. **De hash-wipe.** Een polder in `layout.polders` zonder nieuwe `terrainHash` wist stad én
   polder (`:1896-1905`); de dry run toont dat als "alles bewogen". Graven ín `reclaim`, vóór de
   hash-regel, pools inbegrepen (`islandbundle.mjs:445-452` vertelt waarom een ontbrekende `pools`
   het eiland onzeilbaar maakt).
4. **De eigen pagina maakt de apply ongedaan.** `applyVillage` negeert een gewijzigde `plot`;
   `reportPlacements` publiceert daarna de oude posities. Fase 1: reload na apply. Fase 3: `plot`
   in de refit-test.
5. **Eén pad wissen snijdt buren af.** Gemeten 2 van 4 verhuizingen verweesden een andere weg
   (`markPath` bewaart alleen zelf-geplaveide cellen, `:1348-1368`). `pruneUnreachable` na elke
   apply; nooit `clearRoads`-voor-alles (dat hertekent alle 114 paden).
6. **Coalescing en het slot.** `rescan()` laat opts vallen (`serve.mjs:296-300`); de hook houdt
   hetzelfde bestandsslot vanuit een ander proces. Een plan krijgt een eigen FIFO en een 423,
   nooit een stille skip of merge in een timer-scan.
7. **Eén pass is niet altijd een fixed point.** Padreplay (`:2024`) loopt vóór `sup.claim` de
   BLOCKED laancellen van een eigen super als FREE teruggeeft (`:855-868`, `:2138`); bereikbaar
   via ongeschikte bestemmingen (gemeten: 3 passes). Itereren tot stabiel (≤ 3, ~80 ms per pass),
   anders weigeren en `stableAfter` melden.
8. **Wat er met een huis meereist.** `cell`, elke shed in `shedOf` (laan-sheds in ring 2–4 kunnen
   op vreemde grond landen), `path:<id>`; de `seed` en `road` van de lobe; `lobe.centre`
   (farmsteads herstellen niet zelf); het office (weg, komt terug bij de nieuwe wegkop).
9. **Een zone is een dijk.** RESERVED blokkeert routing; een zone dwars over de enige weg naar
   het plein strandt een wijkje. De reachability-melding in de dry run maakt zones veilig.
10. **Elke apply is een vormverandering voor de hele zee.** Rev-bump, ~550 ms rebuild bij elke
    buur, crowd terug naar de deuren — twee keer, want de herladen pagina post placements.
    Bundelen, één publish; zones buiten de bundel.
11. **Polder-boekhouding.** `poldersWanted` telt de handmatige als trede; `scan.mjs` dateert op
    index; de chronicle toont een ongedateerde polder vanaf dag één; `poldermill` komt op
    `polders[0].dike`. `manual`/`at`/`unlockedAt` meegeven en honoreren; `fleet.row()` stuurt
    `polders` in elke manifest-rij, dus cap op 24 supers.
12. **Het plein (uit scope, voor de boeken).** ~40 civics op absolute cellen, `town.lots` sticky,
    kern rond lattice-origin, commons vanaf [0,0], alle 22 wegen via `facing(lobe.centre, townCentre)`,
    `landing` dichtstbij het centrum. Herindexeren is alleen veilig in veelvouden van 4 en redt
    de civics niet; `docs/branches.md` assertion 2 bestaat precies omdat niets dit overleeft.
13. **Frame-kosten van de overlay.** Fills ~135k tris + grid ~68k line-vertices + ~6 calls, plus
    één call per ghost (heel wijkje ≈ 50). Daartegenover verbergt plan-modus 41 nameplates
    (123 calls), 22 bogen (~66 calls), de CSS3D-laag en `pick()` per frame. Meten met `?stats`.

---

## Bijlage — Verkenning (gemeten, 22 september 2026)

Zodat dit niet opnieuw hoeft. Regelnummers zijn van de huidige `main`; live eiland: seed 1337,
size 256, 351 plots (132 house, 172 shed, 49 civic; het dashboard zei 348/130/169 een scan
eerder), 22 districten met elk 1 lobe en samen 179 supers, 114 paden (22 hamlet-wegen, 923
cellen), 1 brug (`civic:bridge`), 2211 `cleared`, 0 polders, fairway 112 cellen, anker [127,127],
commons 49 supers, `terrainHash 96977bde`.

### `data/layout.json` — vorm en poorten (`lib/layout.mjs`)

| key | vorm |
|---|---|
| `v/parcelV/squareV/roadV/quayV` | `1, 2, 3, 1, 2` — de vijf poorten |
| `lattice` | `{ anchor:[127,127], pitch:4 }`; `anchor = town.centre − 1` (`:343-348`) |
| `districts[id]` | `{ lobes:[{ seed:[i,j], cells:[[i,j]…], green, square, centre, paved, road }], pier, shore, tier, guest, square, centre, paved }`; id = `p:<repo root>` / `outlands` / `quay` |
| `plots[id]` | `{ gx, gz, w, d, rot, cell?, district?, lobe?, commons? }`; `gx,gz` = min-hoek; rot 0=−z,1=+x,2=+z,3=−x (`facing` `:1059`); `gx,gz === blockOf(lat, cell)` exact (`:349`) |
| `paths` | `[{ id, cells }]`: `path:house:<uuid>`, `path:civic:<x>`, `road:<district>:<lobe>`, `road:polder:<n>` |
| `bridges`, `cleared`, `landing`, `shedOf` | `[{id, axis, cells}]`, `[[gx,gz]…]` (union, groeit alleen), `[gx,gz]`, `{ shedId: houseId }` |
| `polders` | `[{ supers, cells, dike, pools, road, seed }]` |
| `fairway` | `{ line, cells }`; `null` = nooit gevraagd, `{cells:[]}` = gevraagd en niets |
| `town` | `{ square, centre, lots, size, paved, commons }` — `centre` eenmalig afgeleid (`:1917-1921`), daarna bevroren |
| `terrainHash` | `hashHeights(H)` (FNV-1a over de heightfield, `shared/terrain.mjs:165-173`) |

Poorten: `LAYOUT_VERSION`/seed/size → `emptyLayout` (`:128`); `PARCEL_VERSION` → alle house/shed-plots,
districten (behalve pier/shore), paden, cleared, commons weg (`migrateParcels` `:103-124`);
`ROAD_VERSION` → `clearRoads` (`:186-193`: `lobe.road=null`, `paths=[]`, `cleared=[]`);
`SQUARE_VERSION` → alleen dubbel-geclaimde plein-plots (`:1840-1863`); `QUAY_VERSION` → in `placeAll`
(`:1966`, `migrateQuay` `:219-272`). Zesde, stille reset: `resetForNewTerrain` (`:1884-1888`) bij
`layout.terrainHash !== terrain.hash` (`:1896-1905`) — wist álles in place; hash wordt geschreven op
`:1960` ná `planFairway`/`reclaim`.

"Een huis verhuist nooit" = bestaanschecks (`:2509` huizen, `:2564` sheds, `:2253` civics, `:2462`
meubilair, `:2110` borden, `:2090` stadhuis, `:2658` offices) + ownership herspeeld uit `lobe.cells`
(`:2136-2139`) + plots als PLOT gestempeld (`:2021-2023`) + nieuwe posities alleen uit `freeCellIn`
(`:2496-2506`) over `parcelOrder` met `cellTaken` afgeleid uit plots (`:2488-2493`); schrijven op
`:2538-2542`, `rot = facing([gx+1,gz+1], centreOfCell(lat, parentOf(lobe, cell)))` (`:2533-2536`).

Derived-en-weggegooid per scan: `lobe.green/square/paved`, `d.square/centre/paved`, `town.square/paved`,
`cleared`, `paths`. Sticky: `plots`, `lobe.cells/seed`, `town.centre/lots/commons`, `lattice`, `bridges`,
`polders`, `fairway`, `landing`, `pier/shore`. `lobe.centre` herstelt **niet** voor farmsteads (`:2187/2195`).

### Wijkjes, land, wegen

- District = projectmap (`lib/village.mjs:314-321, 369`), niet geometrie. `tierOf`: farmstead <3,
  hamlet ≥3, village ≥12. `MAX_LOBES=3`, `ANNEX_REACH=8`, `RCAP=5`, `BELT=1` (`Super.eligible` `:828`,
  `foreignWithin` `:819-827`; `usable` = alle 16 cellen bouwbaar `:813`). `TOWN_CORE_R=2` claimt 5×5
  supers rond lattice-origin (`:2131-2133`), districten overschrijven daarna (`:2138`).
- Sheds: `YARD_RING = RINGS[1]` rond `[gx+1,gz+1]` (`:296, 2571`), laan-sheds ring 2–4 (`:2584-2590`),
  `doorCell` overgeslagen; `shedOf` op `:2595`.
- Wegen: `routePath` (`:1276-1342`) = uniform-cost Dijkstra, states `cell*5+dir`; kosten `REUSE .04`,
  vers `1 + wander` (fbm, `WANDER 4.5`), `TURN .2`, `SLOPE 3×`, brugdek `SPAN 26`, `MAX_SPAN 5`.
  Hamlet-weg: start 2 cellen buiten `lobe.centre` richting plein, `isGoal: v===SQUARE`, budget 250000,
  `bridge:true` (`:2606-2639`); huispad: `outsideDoor`, goal PATH|SQUARE|BRIDGE, 60000 (`:2692-2725`);
  civic-pad `:2373-2377`. `markPath` bewaart alleen zelf-geplaveide cellen (`:1348-1368`) — dé reden
  dat één pad wissen buren afsnijdt. Relay alleen als het pad-record ontbreekt (`:2715-2717`).
  `trialRoad` (`:1663-1688`) is de bestaande non-mutating what-if en bevat de replay om te extraheren.
  `/roads {reroute,delete,…}` in `lib/commands.mjs:187-201`, `scan({clearRoads})` `scan.mjs:116`,
  `deleteRoads` `scan.mjs:55-78`. `/roads edit` → `roads_edit` heeft géén handler (`main.js:2593`).
- Office `civic:office:<d>` 1×1 naast `road.cells[0]` (`:2655-2673`) — wegen (`:2606`) lopen vóór offices,
  dus na verwijderen komt hij in dezelfde pass terug.

### Polders en fairway

`polderCandidate` (`:405-417`): hele super, 16 cellen in grid, `isWater`, niet in fairway, `heightAt ≥ POLDER_DEPTH (−1.2)`.
`planPolder` (`:435-503`): seed op bearing uit `rng.fork('polder').fork(n)` onder kust-rakende kandidaten,
groeit 4-connected tot `POLDER_SUPERS=12`, dijk 8-connected (`:491-500`), `causeway` (`:534-564`,
zonder kustcontact `q.slice(0,1)` = geen weg). `reclaim` (`:571-599`): `poldersWanted = settlers<150 ? 0 : 1+floor((settlers−150)/25)`
(`POLDER_AT/EVERY` `:380-381`), per polder terrein opnieuw, `pools` uit `enclosedWater` (`:745-767`).
Terrein: cells/pools → `POLDER_H 0.375`, dike → `DIKE_H 0.875`, vlakke `setCell` (`shared/terrain.mjs:249-288`).
Dijk + causeway = `held` (`:1987-1990` → `Super`-constructor `:790-792` zet build/beach 0) en `RESERVED`
(`:1991`); `town.lots` ook RESERVED (`:2058-2060`); `poldermill` mag op `polders[0].dike` (`:2280`).
`fairwayHeld` (`:636-651`) houdt pier/landing/paden/bruggen/plein; `planFairway` (`:659-738`) bij `FAIRWAY_AT=25`,
`dig` is min-only (`terrain.mjs:267-273`). Noch `polderCandidate` noch de dijk-lus raadpleegt `fairwayHeld`.
`scan.mjs:422-425` dateert polder k op `POLDER_AT + k·POLDER_EVERY`; `history.js:88-93` neemt null als "altijd".
Geen persistente "verboden cellen" buiten `town.lots`.

### Scan, server, toegang

- `scan()` → `withScanLock(runScan)` (`scan.mjs:44-47`); `runScan` `:80-160`: model, `loadLayout` `:113`,
  `clearRoads` `:116`, deleties `:118-146`, `placeAll` `:147`, `assemble` + writes `:149-152`.
  Hook `hooks/on-session.mjs:65-72` houdt hetzelfde slot vanuit een ander proces; `lib/lock.mjs`
  geeft `{skipped}` (ook bij eigen pid). `data/layout.before-256-20260918-151140.json` = snapshot-precedent.
- `serve.mjs`: `rescan` `:294-317` (coalescing, opts vallen weg `:296-300`), timer `:1453`,
  `watchData` `:1229-1245` (broadcast bij elke `village.json`-write), routes-tabel: `/api/hello` `:425`,
  `/api/model-save` `:508` (extra loopback-check, doelpad hardcoded, 256 kB), `/api/reload` `:646`,
  `/api/rescan` `:653`, `/api/command` `:674` (test `req.url`, buiten de `p===`-keten), `/api/placements`
  `:770` (→ `savePlacements` + `publish`), `/api/banish` `:926`, `/api/build` `:1063`, `/api/unbuild` `:1077`,
  `/api/garden` `:1105` (op-switch), `/api/props`+`/api/crops` publiek. `tellTheSea` `:1305-1317` alleen
  props/crops. `readBody(req, cap)`, `json(res, code, obj)`, `broadcast(obj, event)`.
- `lib/access.mjs:144-148`: `/api/*` deny-by-default (`PUBLIC_API` = hello/props/crops); `classify`
  `:195-199` eist Host + Origin + loopback. `lib/placements.mjs:33-80` = veld-voor-veld validator-idioom.
- Timings (in-process, deze machine): `makeTerrain(256)` 48 ms; deep copy layout 1 ms; `placeAll`-replay
  79 ms (byte-identiek); na `clearRoads` 155 ms (114 → 115 paden, fixed point in de tweede pass);
  volledige scan 561–2157 ms (`data/hook.log`).

### Multiplayer

- `buildBundle` (`lib/islandbundle.mjs:567`) weigert zonder `terrainHash`; bundel draagt island
  {seed, gridSize, terrainHash, landing, town, lattice}, districts (parcel-RLE, pier, shore), buildings
  (plot, door), paths, bridges, cleared, polders {cells,pools,dike,road,unlockedAt} (`:453-462`), fairway,
  props, crops, placements, decks. `layout.json` reist nooit (header `:26-31`). Caps: buildings 600,
  paths 400, polders 64, cleared 20000, cells 4096/lijst. `parseBundle` `:824` herrekent de hash (`:879-882`, fataal).
- `seaclient.publish` (`:67`) hasht de bundel en slaat over bij gelijk; `fleet.publish` (`:179`) `rev+1`
  bij elke publish, `patch` (`:119-129`) bewust niet; berth blijft tenzij `half` wijzigt (`:159-170`).
  `fleet.row()` stuurt `polders` in elke manifest-rij (`:88`).
- Kijkers: `islandsig.js:29-49` `drawnSignature` = alles behalve props/crops/placements/decks en
  active/lastAt → een verplaatst huis, polder, town, paths, cleared of lattice = `dropRegion` +
  `joinIsland` (~550 ms, `guest-island.js` heeft geen incrementeel pad); `createCrowd(known)` zet iedereen
  terug op zijn deur; `house:s<i>` is de index (`guestview.mjs:52-53`), dus geen "aankomsten".
- Parcel-RLE (`scan.mjs:340-351`, validator `islandbundle.mjs:258-274`, `hamlets.js:63-80`) overleeft
  niet-rechthoekige en niet-samenhangende lobes.

### Client

- Camera: één `PerspectiveCamera` (`main.js:280`), OrbitControls `:291-300` (`maxPolarAngle 1.34`,
  `zoomToCursor`), contextmenu onderdrukt `:289`, `applyCameraRange` `:1279`, `frameIsland` `:2905-2937`,
  frame-loop camera-tak `:3842-3862` (klemt `controls.target` op `bounds±3`, floor op waterhoogte),
  labels-guard `:3867`, render `:3869`, `panels.render` `:3879`. Enige `OrthographicCamera`: `studio.js:322`.
  `state.mode` `:323`; `enterWalk` `:1081-1112`, `exitWalk` `:1223`; `frame(dt)` `:3672-3884`; `tickers`/`enqueue`
  `:3205-3243`; intro zet `controls.enabled = true` bij afronden (`:3732`).
- Fog: `scene.fog = Fog(colour, half·1.1, half·3.4)` (`world.js:1509`), range alleen via `setFogRange`
  (`main.js:1346`) / `applyFogRange` (`:1306`), kleur elke frame (`world.js:1669`). Wolken: `world.clouds`
  InstancedMesh, `castShadow`, `frustumCulled=false` (`world.js:1745`). Grond: heightfield op cel-hoeken
  (`world.js:1216-1217`, `terrain.corner`). three r170 (`web/vendor/three.module.js:6`), `USE_COLOR_ALPHA`.
- Picking: één Raycaster `:3570`, `moved<5px` = klik `:3582-3598`, `pick()` `:3606-3623` over `state.pickables`
  (gastenmeshes ook, `:1469` — filter op `state.byId.has`), `select(id)` `:3562` = één string. `makeRecord`
  `:2311-2357` (`mesh.userData.id`, `state.byId`, `state.pickables`); `cellCentre` `:2229-2233`; `rebuild(rec, spec)`
  `:2464-2472`. Hamlet-signs `userData.id='district:<id>'` (`:2892`) maar niet pickable. `gateOf` `:2775-2794`.
- `applyVillage` `:3264-3357` incrementeel: fells `cleared`-diff (`:3270-3274`, `fellTrees` doet `treeCells.delete`,
  `world.js:1171` — nooit hergroei), paden alleen bij gewijzigde `paths.length` (`:3275`), `syncHamlets` bij
  `districtsRev`, per gebouw tier/style/kind/ornaments/sheds/active — **niet `plot`** (`:3311-3321`);
  `reportPlacements` `:3370-3393` na elke apply. `layLandscape`/`applyLandscape` `:3050-3099` alleen vanuit
  chronicle/live (`:4014`, `:4027`). SSE `connect()` `:4422-4472` (`update` debounce 250 ms, `reload` → `location.reload()`).
- Herbruikbaar: `editor.js` (`TransformControls` vendored `:14`, anchor-multi-drag `:196-201`/`:1062-1072`,
  `setTranslationSnap` `:1200`, `EdgesGeometry`-boxen `:187-189`/`:408-421`, `sel[]`+undo `:207`/`:422-485`,
  keyboard-guards `:1074-1088`, save-patroon `:1151-1184`, localStorage `:261-313`); `ghost.js` (`aim()` over
  land én zee `:100-126`, `whyNot` `:132-165`, OK/BAD-materialen `:64-69`/`:339`, pooled marks `:346-382`,
  capture-keys `:13-25`/`:292-316`, `dispose` `:428-440`, `put()` tekent niets lokaal `:232-259`);
  `road-debug.js` (`buildCellLines` ~`:157-240`, getters `:51-75`, `island-command`-switch `main.js:2524-2597`);
  `minimap.js` (`projectToRadar`, `terrainColor`, noord = −z); `hamlets.js:58-95` `decodeOwnership`/`stamp`;
  `shared/roads.mjs` `reachableFromSquare`/`houseGate`.
- UI: markup in `index.html` (chips `:109-129`, panelen `:143-156`, `#build-hud` `:188`, `#veil` `:190` ongebruikt),
  `ui.js` (`createUI` `:59`, `close/openLegend/syncSidebar` `:109-125`, document-Escape `:102-107`, `setKeeper`
  `:369`, `toast` `:508`, `once` `:609`, `setBuildHud` `:651`, return `:702-711`), `keeperOnly` `main.js:343-349`,
  `askToSendAway` `:1138-1150`, kleuren `.ok #6fce7a` / `.bad #e0574a` (`ui.css:47`, `:723`), localStorage `promptholm.*`.
  Toets-lagen: `ui.js` document, `walk.js:326-327` window, `ghost.js` capture, `buildmenu.js:50-67`
  `stopImmediatePropagation`, `popover.js` capture-Escape.

### Tests en docs

`docs/branches.md` = acceptatie: (1) geen plot bewogen, (2) town bit-identiek, (3) districten houden elke
super, (4) tweede scan byte-identiek; + bij terrein: geen landcel herschreven, aantal bouwbare 4×4-blokken
alleen omhoog; server stoppen vóór meten. `tests/layout-measure.test.mjs` (temp dir, kopie layout+cache,
`scan()` met retry op `skipped`, eigenschappen `:163-351` incl. reach-flood `:213-247`),
`tests/polder-hash.test.mjs` (`groundOf` uit `layout.polders`+`fairway`, `stands`/`movedBetween`, synthetisch
12-project-dorp `:47-61`, negatieve hash-test), `tests/island-signature.test.mjs` (mutatietabel),
`tests/settler-walk.test.mjs` (source-scan zonder loader/document), `tests/api-base.test.mjs:78-91` (bare fetch).
`docs/manual.md:565-732` (hamlets & git, polders), `docs/next/loose-ends.md` (`cleared` niet chronologisch,
poorten op de wegkop). `Plans/`: Nederlands, `## Aanleiding`/`## Besluiten` (Vraag/Besluit/Waarom)/`## Bestanden`/
`## Verificatie`/`## Wat echt moeilijk is`; README met "Gebouwd op …"/"Nog niet gebouwd: eerste stap is …".
`config.json` heeft `multiplayer.sea.{mode,url,key,port,name,known}` dat `config.example.json` mist.
