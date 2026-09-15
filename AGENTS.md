# AgentVillage projectnotities

## Serverkant: het vangnet (sinds sept 2026)

`npm test` draait de suite met `node --test`. Vijfentwintig tests, ~1 s, geen dependencies.
Ze bewaken de belofte waar het hele eiland op rust en die tot nu toe alleen proza was in
`docs/branches.md`:

| bestand | bewaakt |
|---|---|
| `tests/layout-sticky.test.mjs` | een huis verhuist nooit; de aankomstvolgorde beslist niets; teruggegeven land gaat naar de volgende aankomst |
| `tests/layout-idempotent.test.mjs` | twee (en drie, en vier) scans laten `layout.json` byte-identiek |
| `tests/layout-town.test.mjs` | `town.centre` en het lattice-anker bewegen nooit; het plein groeit alleen op zijn drempels en bevat altijd het vorige |
| `tests/layout-land.test.mjs` | geen wijk verliest een super-cel; geen cel heeft twee eigenaren; de groengordel houdt |
| `tests/layout-gates.test.mjs` | de vier invalidatiepoorten: `v`/seed/size, `terrainHash`, `PARCEL_VERSION`, `ROAD_VERSION` |

Drie dingen die je moet weten voor je erin werkt:

- **`node --test tests/` werkt niet op Node 24** — dat leest het pad als een module. Het script
  gebruikt daarom een glob: `node --test "tests/**/*.test.mjs"`. Die sluit `tests/helpers/`
  meteen uit.
- **`requireIslandStopped()`** (in `tests/helpers/island-stopped.mjs`) weigert te draaien zolang
  er iets op 4747 antwoordt. Meten terwijl de server zijn eigen rescan doet heeft ooit een halve
  dag gekost. Let op: stoppen van `serve.mjs` is **niet genoeg** — de `SessionStart`-hook in
  `~/.claude/settings.json` draait óók een scan, bij elke Claude-sessie.
- **`SETTLERS_DATA`** overschrijft `DATA` in `lib/paths.mjs`, zodat een test zijn eigen datamap
  krijgt. Naast de al bestaande `SETTLERS_CLAUDE_HOME`.

### Het levende eiland staat niet in deze checkout

`data/` is hier leeg. De echte historie staat in `D:\git\Martijn\AgentVillage\data\` en de
hook wijst daar ook heen, dus werk in deze checkout raakt het levende eiland niet. Wil je tegen
echte data draaien, doe dat met kopieën en alle drie de overrides:

```
SETTLERS_DATA=$SCRATCH node scan.mjs --out $SCRATCH/village.json --layout-file $SCRATCH/layout.json --cache-file $SCRATCH/cache.json
```

Wijst `--layout-file` naar een pad dat niet bestaat, dan geeft `loadLayout` een lege layout terug
— dat is een volledige herfundering in kladbestanden, zonder één regel nieuwe code.

### Gevonden door het vangnet

- **Een eiland lag pas na twee scans stil.** Een eenzame hoeve zonder eigen perceel
  (`tier === 'farmstead'` met `lobes: []`) kreeg bij aanmaak geen `square`/`paved`; de
  greens-retirement-lus bovenaan `placeAll` stempelde ze er bij de vólgende scan alsnog op.
  Geen huis bewoog, maar "twee scans zijn byte-identiek" was onwaar. Nu zet de farmstead-tak
  beide velden onvoorwaardelijk.
- **De overlap van 131 van de 157 gebouwen is een client-probleem, niet een layout-probleem.**
  Gemeten: geen twee 3×3-huisplots overlappen, en de groengordel (`BELT = 1`) houdt overal. Een
  schuur zit wél binnen het 3×3-lot van zijn meester — dat is de "schuur in de tuin" uit de
  README, en precies daarom mag de client een huis niet over zijn hele plot tekenen.
- **Het eiland is vol.** Op de echte data staan 21 van de 39 huizen op de commons in plaats van
  op de grond van hun eigen wijk, en alle 13 wijken zijn `guest`. Dat is de aanleiding voor de
  serverherschrijving in één cijfer.

## Godot-spike
- Lokale Godot-installatie: `D:\Software\Godot_v4.7.2-stable_mono_win64`.
- Spike-project: `godot/`.
- Openen: `D:\Software\Godot_v4.7.2-stable_mono_win64\Godot_v4.7.2-stable_mono_win64.exe --path D:\git\Martijn\AgentVillage-godot-45\godot`.
- Headless sanity-check: `D:\Software\Godot_v4.7.2-stable_mono_win64\Godot_v4.7.2-stable_mono_win64_console.exe --headless --path D:\git\Martijn\AgentVillage-godot-45\godot --quit-after 1`.
- Headless script- modus vereist eerst een import-pass om `class_name`'s in de globale class-cache te zetten:
  `Godot_v4.7.2..._console.exe --headless --path ... --import` vooraleer `--script` werkt op nieuwe bestanden.

## Building kit architectuur (gesplit sinds juni-sept 2026)
`building_kit.gd` (1033 regels) is opgesplitst in 7 bestanden met composition:

| Bestand | class | Rol |
|---|---|---|
| `kit_primitives.gd` | `PmKitPrimitives` | Base: PALETTE/C/TIER_INDEX/BRIM, alle mesh-primitieven, `_inside/_window/_door/_bench/_table/_chair/_timber_frame` |
| `kit_houses.gd` | `PmKitHouses` | Houses per tier/style, `_windows_on/_foundation/_house_body`, ornaments |
| `kit_civics.gd` | `PmKitCivics` | Civic buildings (townhall, chapel, castle, …) |
| `kit_sheds.gd` | `PmKitSheds` | Shed types |
| `kit_towers.gd` | `PmKitTowers` | Hotel/tower |
| `kit_props.gd` | `PmKitProps` | Props (tree, rock, bridge, panel, …) + PROPS const |
| `building_kit.gd` | `PmKit` | Orchestrator: extends PmKitPrimitives, maakt modules, harbour-deck-logica |

Elke module krijgt een `kit: PmKitPrimitives` via `_init(p_kit)`. Publieke API is gelijk gebleven: `PmKit.new()`, `.build(spec, root)`, `.build_prop(p, root)`, `.prop_rad(kind)`, `.prop_wall_len(kind, p)`, `.panel_w(p)`, `.part_count()`.

## C# project (Promptholm V2, sinds fase 2)
- Godot.NET.Sdk **4.7.2**, target **net8.0**, root namespace `Promptholm`.
- `godot/Promptholm.csproj` — assembly_name = `"Promptholm"` (bijgewerkt in project.godot).
- Build: `dotnet build godot/Promptholm.csproj` (eerste keer vereist NuGet-restore).
- `dotnet build` log-compatibel met Godot editor: output naar `.godot/mono/temp/bin/`.
- Autoloads (project.godot): `EventBus` (`src/Core/EventBus.cs`) en `VillageClient` (`src/Data/VillageClient.cs`).

### Directorystructuur
```
godot/src/
├── Core/           # EventBus: singleton autoload, C# events + [Signal]s, Publish*. Events: VillageDataLoaded,
│   │               #   TerrainGenerated([Signal]), BuildingSelected([Signal], C#: BuildingSelected(string)),
│   │               #   InteractionPromptChanged(string?)
├── Data/
│   ├── VillageClient.cs    # [GlobalClass] Node: pollt /village.json elke 5s, CallDeferred
│   │                       #   naar de main-thread, fallback res://village.json
│   └── Models/             # DTOs + VillageJson-opties + FlexibleStringConverter:
│       ├── VillageData.cs      # topniveau: Island, Grid, Districts, Buildings, …Stats
│       ├── IslandData.cs       # + TownData (square/centre/lots/paved/sizeSteps), LatticeData
│       ├── BuildingData.cs     # + PlotData, SkillsData, CommissionData, BuildingStats
│       ├── DistrictData.cs     # + DistrictLobe (green/parcel)
│       ├── PathBridgeData.cs   # PathData, BridgeData
│       ├── PolderMilestoneData.cs
│       ├── VillageStats.cs     # + AssignmentData, NextMilestoneData
│       ├── PropData.cs         # knoop voor /api/props
│       └── VillageJson.cs      # camelCase policy + FlexibeleString-converter
├── World/          # bewerking ≠ pure .NET meer sinds water/props (nodes, maar wél headless testbaar)
│   ├── PmRng.cs              # hash32/mulberry32/js_round/fork
│   ├── PmSimplex.cs          # 2D simplex + fbm2 + smoothstep_js
│   ├── TerrainGenerator.cs   # bit-exacte port van terrain.gd + query-API (WorldHeight/Corner/Slope, SeaLevel=0, Land/BeachCells)
│   ├── DistrictDecorator.cs  # ParcelRaster (lobe-parcel RLE → fine-cell ownership map, gedeeld met FarmlandSpawner) +
│   │   │               #   [GlobalClass] Node3D: boundary hedges (BoxMesh 0.8×0.65×0.35 langs district grenzen, hue-tint),
│   │   │               #   gateposts (paar bij weg-kruisingen) + naam-archways (houten palen + plank + Label3D + hue-band)
│   │   │               #   per lobe; archway vindt gate via `road:{districtId}:{lobeIndex}` pad, valt terug op groen/centrum;
│   │   │               #   pub counts HedgeCount/ArchwayCount; alles MultiMesh + clamp op WorldHeight
│   ├── FarmlandSpawner.cs    # [GlobalClass] Node3D: ploughed fields + orchards op het platteland (owner==None, niet cleared,
│   │   │               #   isLand, niet beach, slope<0.35, hash-coverage 0.35); fields 3×4/4×5 loam-brown slabs + furrow-richels
│   │   │               #   langs de lange as, orchards 3×3 fruitbomen (trunk+crown ArrayMesh, MultiMesh, scale 0.46+hash%20);
│   │   │               #   cleared = polder.dike + village.Cleared + building plots ±1; retourneert IReadOnlySet<(int,int)>
│   │   │               #   fieldCells voor PropSpawner; pub counts FieldCount/OrchardCount
│   ├── CivicDecorator.cs     # [GlobalClass] Node3D (fase 2 stap 12): plaza-decor — ronde fontein op de
│   │   │               #   civic:fountain-plot (standaard gx:32,gz:32) + gestreepte marktkramen op
│   │   │               #   civic:market (standaard gx:36,gz:26); leest de plots uit village.json en valt
│   │   │               #   terug op de coördinaten hierboven; static Handles(b) → WorldManager skipt het
│   │   │               #   generieke civic-gebouw én het collider op die plots, registreert de cellen wél
│   │   │               #   (prop-trail/farmland-avoidance); pub counts FountainCount/StallCount/FountainPosition
│   ├── WorldManager.cs       # [GlobalClass] Node3D: ArrayMesh-ondergrond (hoogtegradiënt-normals + vertex-color
│   │   │               #   materiaal; storybook-band-kleuren: meer teal (0.20,0.32,0.35), goudstrand (0.90,0.82,0.58),
│   │   │               #   weilandgroen (0.40,0.64,0.26), heuvelgroen (0.38,0.61,0.25)) + gebouwen via
│   │   │               #   BuildingAssembler + BuildRoads/BuildBridges (cobble MultiMesh + houten brug met railings/steunpunten;
│   │   │               #   _roadRoot onder GroundRoot, _bridgeRoot onder ObjectsRoot; gedeelde _plankMat/_railingMat/_stoneMat/_cobbleMat)
│   │   │               #   + StaticBody3D per gebouw (CollisionLayer=4, meta building_id, box pw×2×pd) + BuildingMarker-record
│   │   │               #   + NearestDossier(pos, radius), IsBuildingCell(gx,gz), PlotCells, BuildMarker, BuildingDisplayName;
│   │   │               #   BuildWorld-volgorde: ground → water → DistrictDecorator → FarmlandSpawner → PropSpawner(fieldCells)
│   │   │               #   → roads → bridges → buildings → CivicDecorator.BuildCivics
│   ├── WaterPlane.cs         # [GlobalClass] MeshInstance3D: water via ShaderMaterial ↔ res://shaders/stylized_water.gdshader
│   │   │               #   op y=0 (2000×2000, HorizonSize 2000, shadow off, diepte-gradiënt + schuim via DEPTH_TEXTURE),
│   │   │               #   als child van GroundRoot. De uniforms worden hier expliciet gezet: de shader-defaults zijn
│   │   │               #   die van de tutorial (sea_height 1.1 / choppy 2.6 op roughness 0.10) en dat bedekte de hele
│   │   │               #   open zee met wit — gemeten géén schuim maar zonneglinstering op veel te steile normalen
│   └── PropSpawner.cs        # [GlobalClass] Node3D: deterministische trees/rocks via MultiMesh op land-cellen, plot-vermijding +
│       │               #   fieldCells-param (door FarmlandSpawner teruggegeven) óók geblockt, clamp op WorldHeight;
│       │               #   tree-densiteit +boost nabij hill (HillCentre, r<8 → ×1.0..1.5); bomen ~3.5 m (trunk 1.7 + foliage 1.9/1.2)
├── Main.cs          # [GlobalClass] Node3D, is de main.tscn-script: luistert naar EventBus.VillageDataLoaded; maakt
│   │               # WorldManager + FreeFlyCamera(Initialize((32,15,60), centrum)) + WalkModeManager(FlyCamera, World)
│   │               # + zon (DirectionalLight3D) + WorldEnvironment (ProceduralSky, Filmic tonemap, Glow/bloom) + een Atmosphere-container
│   │               #   (DayNightCycle + NightGlowManager + LighthouseController + CloudManager; NÁ EnsureLighting zodat de cycle
│   │               #   de bestaande Sun/WorldEnvironment adopteert i.p.v. eigen te maken); LoadFallbackVillage()
│   │               #   leest res://village.json via Godot.FileAccess (dummy-island enkel als laatste redmiddel)
├── Tools/
│   ├── VerifyTerrainRunner.cs # SceneTree-runner: headless hash-check
│   ├── VerifyWorldRunner.cs   # self-contained: 4 sample-gebouwen → mesh-contract (alle datahoekpunten, schort reikt
│   │                               #   ver genoeg, bodem diep genoeg, landhoogtes ongewijzigd), ≥7 pieces/gebouw
│   ├── VerifyLiveRunner.cs    # E2E tegen lokale server (poort 4747): aantallen zijn data-afhankelijk (snapshot village.json = 163 gebouwen, live kan anders zijn)
│   ├── VerifyWalkRunner.cs    # echte physics-frames: EnterWalkMode → 80 ticks op de grond (IsOnFloor), teleport in het water → 120 ticks (State=Swimming)
│   ├── VerifyDossierRunner.cs # building-colliders + NearestDossier + BuildingDossierUI round-trip (31 checks)
│   ├── VerifyAtmosphereRunner.cs # dag/nacht: 12:00 (dag, raam-glans blijft subtiel warm 0.35, lampen uit) / 23:00 (nacht,
│   │   │               #   windows+lampen emissie, vuurtoren beam aan + rotatie ~45°/s) / 19:30 (schemer, glow+lighthouse aan) — 28 checks
│   ├── VerifyModelSheetRunner.cs # 6 tiers × 3 styles assemblage + 9 prefab .tscn-scene-laden checks (factories + self-build)
│   ├── VerifyDistrictRunner.cs   # Phase 2 stap 9: laadt echte res://village.json, bouwt wereld, assert hedges>0,
│   │                               #   field/orchard>0 (falls toevallig 0 op een lege island — met fallback-village 164/16+21)
│   ├── VerifyVisualRunner.cs     # Fase 2 stap 12: storybook-verificatie — water shader/materiaal, palette-kleuren +
│   │                               #   half-timber slankheid, plaza-fontein+stalletjes, grondkleuren tegen de gedeelde
│   │                               #   WorldManager.GroundBandColour, wolken (aantal/hoogte/schaduw/drift/wrap)
│   ├── VerifyHudRunner.cs        # mount Main, wacht frames, leest de IslandCard-labels: de stats-pills mogen niet op
│   │                               #   "[ 0 settlers ]" blijven staan boven een gebouwde stad (EventBus-regressie)
│   ├── VerifyMetricsRunner.cs    # meet i.p.v. assert: distincte materialen/silhouetten, footprints, onderlinge
│   │                               #   afstanden, reliëf — het enige contract dat strikter wordt als het beter wordt
│   ├── ScreenshotRunner.cs       # rendert één standpunt op één uur naar PNG — NIET headless, zie de harness-sectie
│   └── ShotCatalog.cs            # de vaste standpunten (overlook/harbour/street/lighthouse) + de uren van de matrix
├── Buildings/
│   ├── Slots/
│   │   ├── SlotType.cs              # enum: Foundation/Wall/Roof/Door/Window/Ornament/Sign
│   │   ├── IBuildingPiece.cs        # interface: PieceId, TargetSlot, ClearanceSize
│   │   └── BuildingSlot3D.cs        # [GlobalClass] Marker3D: CanAttach/Attach/ClearAttached + editor gizmo
│   ├── Data/
│   │   ├── BuildingPieceResource.cs # [GlobalClass] Resource: PieceId, TargetSlot, TierReq, ModelStyle
│   │   │               #   + MeshOverride/MaterialOverride én runtime MeshNode (NIET PackedScene — zie valkuil);
│   │   │               #   AttachPiece dupliceert MeshNode, maakt anders een MeshInstance3D, valt terug op PieceScene
│   │   └── BuildingCatalog.cs       # statische mesh-fabrieken: Make*Foundation/Wall/Roof/Door/Window/Ornament
│   │                               #   → Node3D-boom met vaste Promptholm-materialen (pleister/balk/steen/tile/thatch/...)
│   ├── Prefabs/                     # [Tool]-prefabs: ToolPrefabBase + PmPrefab{FoundationStone,WallTimber,WallStone,
│   │   │                           #   RoofGableTiles,RoofThatch,DoorWood,WindowFrame,OrnamentForge,OrnamentWeathervane}
│   │   ├── ToolPrefabBase.cs        # RebuildMeshes() in _Ready — zónder editor-guard, dus ook runtime zelfbouwend;
│   │   │                           #   headless runners: instantieer .tscn en roep EnsureMeshes() aan
│   │   └── ModelSheetShowroom.cs    # [Tool] [GlobalClass]: galerij 6 tiers × 3 stijlen op sokkels + Label3D +
│   │                               #   key/fill/rim licht + orbital camera; rendert direct in editor (model_sheet.tscn)
│   └── BuildingAssembler.cs         # [GlobalClass] Node3D: slot-inventory, Assemble(style, tier, ornaments), ClearPieces
├── Atmosphere/       # Fase 2 stap 8: dag/nacht (namespace Promptholm.Atmosphere)
│   ├── DayNightCycle.cs       # [GlobalClass] Node3D: echte klok sync via DateTime.Now.TimeOfDay of ForceHour (0-24);
│   │   │               #   adoptie van Sun/Moon/WorldEnvironment elders in de tree (FindUpstream), anders eigen childs;
│   │   │               #   elevatie 0°@6u / 90°@12u / 0°@18u / −90°@0u; DayFactor=clamp(el/10); sun 0.03..1.25,
│   │   │               #   moon 0.35..0, ambient 0.12..0.6; GlowThresholdDeg=1° (IsDuskOrNight); pub API Hour,
│   │   │               #   SunElevationDeg, DayFactor, NightFactor, Sun/Moon, SunEnergy/MoonEnergy/AmbientEnergy,
│   │   │               #   ApplyHour(Hour), statics ElevationDegAt/IsNightTime/IsDuskOrNight
│   ├── NightGlowManager.cs  # [GlobalClass] Node3D: windows emissie = kleur GlowColour (1.0,0.75,0.35) op de
│   │   │               #   window slot-materialen (AttachedPiece Node3D-boom → eerst MeshInstance3D-kind mat);
│   │   │               #   overdag houden ramen een subtiele warme gloed (WindowDayGlow 0.35, SetGlow heeft nu
│   │   │               #   een dayEnergy-param); eigen straatlantaarns langs GroundRoot/Roads cobble MultiMesh
│   │   │               #   (elke 6e instancetransform, cap 96, steel-paal+glas emissief, gedeeld glas-materiaal
│   │   │               #   in _lampGlass); Cycle/World exports
│   ├── CloudManager.cs      # [GlobalClass] Node3D (fase 2 stap 12): laaghangende diorama-wolken — 5..7 bollen
│   │   │               #   (PmRng fork "clouds"), y-band 22..26, WorldHalf 60, drift 1.2 m/s met z-verhouding 0.22,
│   │   │               #   wrap rond de wereldrand, shadow casting aan; pub CloudCount/CloudAltitudeBand/Advance/Rebuild
│   └── LighthouseController.cs # [GlobalClass] Node3D: vindt ObjectRoot-building waarvan naam "lighthouse" bevat;
│       │               #   lantern op y≈2.7 (lanternglow OmniLight3D + BeamRotator met SpotLight3D SpotAngle 12/
│       │               #   SpotRange 42/energy 3.0 en additive emissie-cone CylinderMesh); 1 omwenteling/8 s via
│       │               #   Advance(seconds) + Mathf.Wrap, pitch −12°; alleen zichtbaar bij IsDuskOrNight; pub BeamYawDeg
├── UI/
│   └── BuildingDossierUI.cs    # [GlobalClass] CanvasLayer (Layer=10): dossier-overlay + interactie-prompt
│       │                   #   Open: BuildingSelected via EventBus → SetVillage+village.ByID → panel + AnimateOpen
│       │                   #   Sluiten: Esc, X-knop, buiten-klik; verbergt prompt-bar ook op InteractionPromptChanged(null)
│       │                   #   Paden: DossierOverlay/Center/DossierPanel/Body/{Header,Meta,InfoCard/CardBody,StatsGrid,Apprentices}
└── Walking/
    ├── FreeFlyCamera.cs    # [GlobalClass] Camera3D: RMB-look, WASD/QE/Space+Ctrl, Shift-boost, wheel-speed, damp
    │                       #   + linkermuis-raycast (mask 1u<<3 = laag 4) → PickBuilding → PublishBuildingSelected
    ├── SettlerMeshBuilder.cs # statisch: BuildSettler() → settler met strohoed + PoseWalk(root,time,speed01)
    ├── PlayerAvatar.cs     # [GlobalClass] CharacterBody3D: capsule r=0.35/h=1.5; Walk/Run/Swim/Jump, crouch (C),
    │                       #   Swimming-state (buoyancy naar y=WaterSurfaceY); CollisionLayer=2, CollisionMask=1|8
    │                       #   + [Export] WorldManager? World, InteractionRadius=2.5f, E/Joypad-X deur-interactie
    ├── ThirdPersonCamera.cs # [GlobalClass] Node3D: SpringArm3D (kerstbal r=0.25, CollisionMask=1|8) + Camera3D; RMB-look, wheel-zoom
    └── WalkModeManager.cs  # [GlobalClass] Node3D: Tab-switch tussen fly/walk; HeightMapShape3D-terreincollider,
#   FindGroundSpawn (dichtstbijzijnde landcel h≥0.35, skipt building-cellen), avatar+camera opbouwen;
                            #   rebuildt collider bij VillageDataLoaded; DisableWalk publiceert prompt-null
└── UI/                      # V1 Island HUD (fase 2 stap 10): volledig programmatisch opgebouwde Controls
    ├── IslandCard.cs        # top-links: "THE LIVING ISLAND", stats-pills, milestone-badge (kijkt naar Stats.NextMilestone)
    ├── ActivitySidebar.cs   # rechts: "WAITING FOR YOU" / "NOW BUILDING", klikbare sessiekaarten → SessionClicked
    │   │                    #   filters: Code=house, Cowork=shed, Apprentices=Skills.Jira||Issue (heuristiek, makkelijk te tunen)
    ├── TopNavBar.cs         # top-rechts: filtertoggles + Walk/Overview; events i.p.v. directe koppeling
    └── IslandHud.cs         # CanvasLayer(100): componeert bovenstaande, luistert EventBus.VillageDataLoaded;
                            #   WalkManager/FlyCamera vindt hij via GetParent().GetNodeOrNull — geen dependency op Main
```

### Visuele verificatie: de screenshot-harness (NIET headless)
De negen `Verify*Runner`s asserten getallen. Zo konden "20 visuele checks groen" en een
onbruikbaar beeld naast elkaar bestaan. `src/Tools/ScreenshotRunner.cs` + `ShotCatalog.cs`
renderen daarom echte PNG's; `scripts/shots.ps1` draait de matrix (4 standpunten × 6 uren)
naar `docs/shots/<sha>/` met een contactvel `index.html`.

```
# LET OP: geen --headless
Godot_v4.7.2-stable_mono_win64_console.exe --path <godot> --fixed-fps 60 --script res://src/Tools/ScreenshotRunner.cs -- `
  --hour 21.0 --shot harbour --size 1600x1000 --out D:\pad\harbour.png
```
Ook `--pos x,y,z --target x,y,z --fov N` om ad-hoc een framing te proberen zonder herbouw.

**`--fixed-fps 60` is niet optioneel.** De water-shader animeert op `TIME`, dus zonder vaste
framestap vangt elke run een ander golfmoment en verschillen twee shots van identieke code.
Mét de vlag zijn herhaalde runs bit-voor-bit gelijk (geverifieerd op md5) — en dát is wat een
voor/na-vergelijking betekenis geeft.

Vijf valkuilen, alle vijf gemeten:
- **`--headless` levert geen beeld.** Dat selecteert de dummy-renderdriver; de viewport-textuur
  komt leeg terug. De runner detecteert dat en faalt luid in plaats van een zwarte PNG te
  schrijven — een zwarte PNG vergiftigt stil een voor/na-vergelijking.
- **`--resolution` wordt overruled** door de project-aspect (1280×800): gevraagd 1920×1080 kwam
  er als 1728×1080 uit. Gebruik `--size`, dat zet `DisplayServer.WindowSetSize` zelf.
- **`LookAt` werkt niet in `_Initialize()`** — de node zit dan nog niet in de tree, dus de global
  transform is identiteit en de camera blijft langs −Z kijken (positie klopt wél, wat het
  verraderlijk maakt). Zet `Transform` met `Transform3D.LookingAt` in plaats daarvan.
- **Geen `2>&1` in `shots.ps1`.** Godot print de bekende `!is_inside_tree()`-ruis naar stderr, en
  Windows PowerShell verpakt bij redirectie elke stderr-regel als `NativeCommandError` — met
  `$ErrorActionPreference='Stop'` breekt de hele run af. Oordeel op het bestaan van de PNG.

Capture gebeurt op `RenderingServer.FramePostDraw` (niet in `_Process`, dat draait vóór de draw)
en pas na 120 frames, zodat SDFGI en volumetrische mist geconvergeerd zijn.

### Beta-build: `scripts/build.ps1`
`godot/export_presets.cfg` (preset "Windows Desktop", met de hand geschreven zodat een schone
checkout kan exporteren zonder de editor te openen) + `scripts/build.ps1` leveren
`dist/Promptholm-<versie>-win64.zip`: `dotnet build -c ExportRelease` → `--import` →
`--export-release` → zip, inclusief `LEESMIJ.txt` en `VERSION.txt`.

```
./scripts/build.ps1                      # versie = <datum>-<sha>[-dirty]
./scripts/build.ps1 -Version 0.3.0-beta
./scripts/build.ps1 -InstallTemplates    # eenmalig, downloadt ~1,1 GB
```

Vijf dingen die niet vanzelf goed gaan, alle vijf gemeten:
- **`godot/Promptholm.sln` moet bestaan.** Zonder solution slaat de .NET-exportplugin *elke*
  C#-assembly over, meldt dat als "completed with warnings" en eindigt met exit 0: je krijgt
  een `.exe` + `.pck` zonder een regel code, die start en niets doet. De eerste beta-zip was
  precies dat. Let op bij hergenereren: `dotnet new sln` maakt onder dotnet 10 een `.slnx`, en
  daar kijkt Godot niet naar - gebruik `--format sln` en vul `ExportDebug`/`ExportRelease` aan.
  `build.ps1` checkt de solution vooraf en de aanwezigheid van `Promptholm.dll` achteraf.
- **Een export-build sterft op exceptions die de editor slikt.** `LighthouseController` hield
  het `Building_lighthouse`-object vast dat `WorldManager.ClearBuildings()` bij een rebuild
  vrijgeeft - en die rebuild gebeurt al bij een gewone start, zodra de tweede `VillageData`
  binnenkomt. In de editor een rode regel, in de release-build meteen einde proces. Wie een
  wereld-node cachet, controleert hem met `GodotObject.IsInstanceValid` voor gebruik.
- **Export-templates zijn een aparte, eenmalige download** van exact deze Godot-versie
  (`%APPDATA%\Godot\export_templates\4.7.2.stable.mono\`). Zonder templates faalt de export;
  het script stopt vooraf met de URL in plaats van een half product af te leveren.
- **`include_filter="*.json"`.** `village.json` is geen Godot-resource maar een gewoon bestand,
  dus zonder die filter valt het uit de `.pck` en start de build zonder dorp zodra de
  localserver niet draait (`VillageClient.FallbackToResource`).
- **`--import` vóór de export.** Op een schone checkout bestaat `.godot/` niet en exporteert
  Godot anders een lege `.pck`.

De build is niet ondertekend: SmartScreen waarschuwt over een onbekende uitgever. Naast
`Promptholm.exe` komt `Promptholm.console.exe` mee, zodat een betatester logs kan plakken
(`debug/export_console_wrapper=2`; 1 betekent "debug only" en levert bij een release niets op).

Een exportbuild valt niet met de screenshot-harness te controleren - `--script` bestaat daar
niet. Verificatie is: starten, 45 s laten lopen, stderr moet leeg blijven, en het venster
vastleggen met `Graphics.CopyFromScreen` over de client-rect van `MainWindowHandle`.

### Geteste C# CLI-werkwijze (headless)
- `--script` pakt een **C# SceneTree-subclass direct** (geen GDScript-shim nodig). Na `dotnet build`:
  ```
  Godot_v4.7.2-stable_mono_win64_console.exe --headless --path D:\git\Martijn\AgentVillage-godot-45\godot --script res://src/Tools/VerifyTerrainRunner.cs
  ```
  De runner roept zelf `Quit(0|1)` — `$LASTEXITCODE` is daarmee de exit-status.
- De GDScript-variant blijft parallel bestaan: `--script res://tools/verify_terrain.gd`. Beide moeten seed 1337 → `f7ec71ac` geven; output is bewezen identiek (hill/lake, rivieren, land/beach/coast/river-banks).
- Fase-2-stap-3 runners (main-scene vervangt main.gd):
  - `VerifyWorldRunner.cs` — self-contained (seed 1337, 4 sample-gebouwen): hash `f7ec71ac`, grondmesh `(size+1)²` = 4225 verts, elk gebouw ≥ 7 pieces geassembleerd → PASS.
  - `VerifyLiveRunner.cs` — haalt écht `village.json` van `localhost:4747`, parst via `VillageJson`, bouwt wereld: aantallen data-afhankelijk (snapshot 163, live kan anders zijn), hash `f7ec71ac` → PASS.
  - `VerifyWalkRunner.cs` — draait échte physics-frames in de SceneTree (`--quit-after` werkt niet, zelf `Quit(0/1)`): EnterWalkMode → 80 ticks op de grond (IsOnFloor, collider, Y>0.5), teleport (40,-2,40) → 120 ticks (State=Swimming, Y in (-0.3,1.2)) → PASS.
  - `VerifyDossierRunner.cs` — physics-tick phase machine (_Ready garantie): building-collider meta/shape, NearestDossier bij deur vs. ver weg, PlotCells, dossier UI round-trip (SetVillage → open → labels → Esc-sluit), InteractionPrompt round-trip (toon/null) → 31 checks PASS.
  - `VerifyAtmosphereRunner.cs` — dag/nacht fase-machine (setup tick 1, checks tick 3): 12:00 zonhoog 90°·geen glow, 23:00 nacht + raam/lamp emissie + vuurtoren-beam 45°/s na Advance(1), 19:30 schemer → glow+lighthouse aan → 28 checks PASS.
  - `VerifyDistrictRunner.cs` — laadt echte res://village.json via VillageJson, bouwt wereld, assert DistrictDecorator-hedges>0 en FarmlandSpawner fields+orchards>0 (fallback-village 1337: 164 hedges, 12 gateposts, 5 archways, 16 fields, 21 orchards) → PASS.
  - `VerifyVisualRunner.cs` — stap 12: laadt echte village.json, assert water-shader + ShaderMaterial, palette-kleur getters (`BuildingCatalog.PlasterColour` etc.), fountain+3 stallletjes + terrain-clamp, per-vertex ground-kleurbanden, cloudveld 5..7 (altitude 22..26, schaduw, drift, wrap) → 20 checks PASS.

**De `!is_inside_tree()`-ruis was géén preëxistent gegeven.** De stacktrace wijst naar `WorldManager.BuildMarker` (`WorldManager.cs:236`, `root.GlobalTransform`), en de oorzaak is dat een runner `BuildWorld` aanriep vanuit `_Initialize()` — daar leeft de scene tree nog niet, dus élke global-transform-lezing faalt. Het waren er bovendien geen 161 maar ~25.000 stderr-regels per run. Opgelost door in `VerifyDistrict/Live/Visual/World` en `ScreenshotRunner` het werk op **frame 1** te doen (`_Process`, `if (++_ticks != 1) return false;`) in plaats van in `_Initialize`. Alle negen runners geven nu 0 van deze regels. **Regel: bouw nooit een wereld of lees een `GlobalTransform` vanuit `_Initialize()`.** Wat er ná `Quit()` nog aan leak-warnings verschijnt is cosmetisch (de runner freeed zijn nodes niet bij exit).
  - Wrap `Run()` in try/catch met `Quit(1)` erin: zonder `Quit` hangt een `--script`-runner eindeloos.

### Modulair building-piecesysteem (fase 2 stap 7)
`BuildingCatalog.cs` (statisch) bevat mesh-fabrieken voor elke piece-type met vaste Promptholm-materialen (pleister/balk/steen/tile/thatch/ijzer/koper). Elke fabriek retourneert een `Node3D`-boom met `MeshInstance3D`-children. `WorldManager.BuildCatalog()` roept deze fabrieken aan (niet meer inline `BoxMesh`). Gebruikte materialen: `_plaster` (warm beige), `_beam` (donkerbruin), `_stone` (grijs), `_roofTile` (terracotta), `_thatch` (strogeel), `_wood`/`_woodLight`, `_iron` (donker metaal), `_glass` (semi-transparant blauw), `_copper` (oranje-brons), `_smoke` (grijs, semi-transparant).
Prefab `.tscn`-scenes staan in `prefabs/` met `[Tool]` scripts die in de editor én runtime zelf bouwen via `ToolPrefabBase.EnsureMeshes()`. De [.tscn]-paden: `prefabs/foundations/foundation_stone.tscn`, `prefabs/walls/wall_timber.tscn`, `prefabs/walls/wall_stone.tscn`, `prefabs/roofs/roof_gable_tiles.tscn`, `prefabs/roofs/roof_thatch.tscn`, `prefabs/openings/door_wood.tscn`, `prefabs/openings/window_frame.tscn`, `prefabs/ornaments/ornament_forge.tscn`, `prefabs/ornaments/ornament_weathervane.tscn`.
Word-vrijwaring palette (fase 2 stap 12): plaster (0.94,0.90,0.82), balk (0.32,0.20,0.11, `TimberBeamWidth=0.05`), steen (0.60,0.58,0.55), dakpan (0.74,0.32,0.18), glas (0.98,0.88,0.52, alpha 0.92, emissie 0.35 warm). Openbare kleur-getters op `BuildingCatalog` (PlasterColour/BeamTimberColour/FieldstoneColour/RoofTileColour/WindowGlassColour) zodat runners de kleuren kunnen asserten.
Model Sheet showroom: `scenes/model_sheet.tscn` met `ModelSheetShowroom.cs` [Tool] galerij (6 tiers × 3 styles + ornaments + key/fill/rim licht + orbital camera).
Valkuil: `ToolPrefabBase._Ready()` mag niet door `Engine.IsEditorHint()` worden geblokkeerd als de scenes ook runtime-gebruikt moeten worden (bijv. als PieceScene); `ClearMeshChildren` ruimt eerst op, `AddMeshesFrom` verplaatst meshes en freed de temp-node.

### Schaalsemantiek v1 vs v2 (beoordeling stap 12 vervolg)
- **v1 (web/GDScript-kit)**: karakter ±0,45–0,6 m (`web/js/avatar.js` capsule r=0,092), gebouwen 0,8–1,9 m → huis ≈ 3× de persoon (realistische verhouding). Gebouw is een kleine prop op een groot perceel; dus veel lucht ertussen.
- **v2 (C#)**: avatar 1,5 m (capsule r=0,35/h=1,5); gebouw **vult het volle plot**: huizen 3×3 m met vaste wandhoogte 2 m (~3 m hoog) → huis ≈ 2× de persoon. Sheds 1×1, civics 1–3. Alle huis-tierniveaus (tent→manor) delen in village.json exact hetzelfde 3×3-plot.
- **Dichtheid — de "gap 0 van 163" hierboven was een verkeerde lezing.** Nagemeten op `godot/village.json`: de 45 plots van 3×3 staan onderling **min 3,00 / mediaan 4,00 / max 5,66 cellen** uit elkaar, en géén enkele dichter dan 3. Dat is `lattice.pitch 4` min footprint 3 = precies 1 cel lucht, dus ontwerp en geen fout. De gap 0 komt van de **schuren**: 25 cellen bevatten een `house` (3×3) én een `shed` (1×1) op dezelfde `gx,gz`. Dat is de layout die "een schuur in de tuin" bedoelt (README), maar de client tekent het huis over het hele plot en eet die tuin op.
- **Conclusie: het grid hoeft niet herbouwd te worden.** Een grid-wijziging 64→128 lost dichtheid noch wegbreedte op (pitch en footprint blijven gelijk) en kost 7 hash-plekken, een verhuizing van elk huis en een meterconstante-audit over de three.js-client. Het probleem is de **metersschaal** (1 cel = 1 m: huis 1,95 m breed naast een avatar van 1,5 m) en vooral de **uniformiteit** — zie hieronder. Issue #49 blijft geldig maar is geen voorwaarde voor visueel werk.
- **Uniformiteit is de echte boosdoener**: 124 van de 163 gebouwen (76%) hebben in de data een eigen vorm en renderen als hetzelfde doosje. `civicType` heeft **19** waarden maar `CivicDecorator.Handles()` pakt alleen `fountain` en `market` — vuurtoren, klokkentoren, kapel, molen en standbeeld worden generieke huizen. `agentType` heeft 12 waarden; alle 86 schuren zijn hetzelfde blokje. En `style` is alleen `opus`/`unknown`, dus `isThatch` (`WorldManager.cs:304`) is **nooit** waar → alle 163 daken zijn dezelfde terracotta gable.

### Scope sinds sept 2026: v1-compatibiliteit vervalt
De serverkant wordt volledig herschreven en de three.js-webclient (`web/`, ~16.400 regels) hoeft
niet meer ondersteund te worden. Twee gevolgen voor beslissingen die eerder in dit bestand
stonden:

- **De grid-herfundering is weer open.** Het advies om `grid.size` op 64 te laten steunde op de
  kosten: `terrainHash` op 7 plekken, elk huis verhuist, en een meterconstante-audit over de
  webclient. Die laatste vervalt en de eerste twee zijn nu gewoon migratiewerk. Issue #49
  (smallere wegen/rivieren) en de metersschaal horen daarmee bij de serverkant thuis, niet bij
  een client-side schaalfactor.
- **`f7ec71ac` is nog een nuttige regressiecheck, geen contract.** Zolang `shared/terrain.mjs`
  bestaat bewijst hij dat de C#-port bit-exact is. Zodra de generator verandert is het gewoon een
  nieuwe verwachte waarde, geen blokkade.

### Atmosfeer: één bron, keyframes, en een echte zonnebaan
`src/Atmosphere/` heeft nu drie lagen die strikt gescheiden zijn:
- **`AtmosphereState`** — alle sfeervelden voor één moment als pure data (geen nodes), zodat het
  headless te samplen en te asserten is. Eén `Lerp` over de hele struct, dus alle velden bewegen
  op dezelfde `t` en de lucht kan niet uit de pas lopen met de mist die hij verlicht.
- **`AtmospherePalette`** — acht geschreven momenten + `Sample(hour)`. Vervangt een dozijn losse
  lerps op `DayFactor`/`nightBlend`/`horizonGlow`.
- **`EnvironmentFactory`** — de enige plek die environment, sky en lichten schrijft (`Apply`),
  en de enige plek die ze bouwt. Verving drie uiteenlopende kopieën.

Drie fouten in de oude curve die de screenshots blootlegden:
- `ElevationDegAt` was `asin(sin(hourAngle))` → **zon in het zenit om 12:00**, het vlakste licht
  dat er is. Nu een boog met een top van 58°.
- `SunYawDeg` stond de hele dag op **50°**, dus schaduwen groeiden en krompen maar bewogen nooit.
  Nu een azimut die van 95° naar 265° veegt.
- `DayFactor = clamp(el/10)` op een curve die 90 haalde maakte de schemering ~40 minuten breed:
  18:20 was pikdonker. Nu `clamp(el/12)` op de vlakkere boog.

**Sleutelmomenten horen op de baan te liggen.** De eerste versie schreef "gouden uur" op 18.2,
maar daar staat de zon al 3° ónder de horizon: volle warme energie en nul schaduwen. Gouden uur
is 17.2 (zon op 12°). De uren van de shot-matrix volgen dezelfde baan.

`ClockSource` is standaard `Simulated` (24 minuten per dag), niet `RealClock`. Het beeld hing
anders af van wanneer je F5 drukte — 's nachts openen gaf een zwart scherm dat op kapot leek.
`ForceHour` wint altijd, dus alle runners blijven werken.

`DayNightCycle._Process` heeft twee lagen: rotaties elke frame (twee node-transforms), sky/env/
fog alleen als het uur merkbaar is verschoven (`HourEpsilonRad`, ~1,2 gesimuleerde minuten). Het
signaal `AtmosphereChanged` vervangt de per-frame `Sync()` van `NightGlowManager`.

### Kleurruimte-val: vertexkleuren zijn lineair
Godot leest `ArrayMesh`-vertexkleuren als **lineair** en converteert ze niet. De grondbanden
waren als sRGB geschreven, dus 0.40 kwam eruit als 0.40 lineair (≈ 0.66 sRGB) in plaats van
0.13. Het hele eiland was daardoor een uitgebeten mint. `BuildGroundMesh` doet nu
`.SrgbToLinear()` op de bandkleur; `GroundBandColour` blijft de sRGB-bron en `VerifyVisualRunner`
converteert mee. Dit was de grootste enkele verbetering van het beeld.

### Terrein-shader en de ruis-val
`shaders/stylized_terrain.gdshader` houdt de vertexkleur als biome en breekt hem op met ruis,
voegt hellings-gestuurd rots toe en kwantiseert de belichting (`light()` met wrapped diffuse).

**De ruis komt uit `NoiseTexture2D` (FastNoiseLite), niet uit een hash in de shader.** Een
hand-gerolde value-noise is geprobeerd en zijn interpolatie klapte op dit invoerbereik dicht tot
een constante — het gras bleef exact even vlak en het leek alsof de shader niet werd toegepast.
Dat kost veel tijd om te zien. Valkuil daarbij: schaal. Bij `macro_scale 0.03` beslaat het hele
eiland van 64 m nog geen halve ruiscel. Schalen worden expliciet vanuit `WorldManager` gezet, niet
als shader-default, juist omdat ze met de eilandgrootte mee moeten.

### Waterplaat moet tot de horizon reiken
`HorizonSize` stond op 2000 m, dus de plaat hield ongeveer een kilometer uit de kust op — ruim
vóór de echte horizon. In het gat zag je de donkere "grond"-helft van de sky-material als een
zwarte band boven de zee. Nu 12000 m; de kosten zijn nihil (40×40 subdivisies).

### Eén palet: `src/Visual/Palette.cs`
Zes losse kleursets waren gegroeid over `BuildingCatalog`, `WorldManager`, `PropSpawner`,
`FarmlandSpawner`, `DistrictDecorator` en `CivicDecorator`, en elk van die bestanden had een
eigen `SolidMat(Color)`-helper die **per aanroep** een nieuw `StandardMaterial3D` teruggaf. Elke
marktkraam-slat en elk veldslab droeg dus een privé-materiaal.

`Palette` heeft gecachete fabrieken (`Solid` / `Translucent` / `Emissive`) die op het volledige
recept cachen, plus de named colours en `Style(modelStyle)` — het per-model palet
(wall/trim/roof/accent/glow) geport uit `scripts/kit_primitives.gd:7-13`, dat bij de C#-herbouw
nooit was overgenomen. De vijf helpers delegeren nu; kleuren en ruwheid zijn ongewijzigd, alleen
de duplicaten zijn weg. **Gemeten: 101 → 65 distincte materialen.** `VerifyMetricsRunner` bewaakt
het plafond (75), dus een teruggeslopen `new StandardMaterial3D` valt meteen op.

Regel: geen `new StandardMaterial3D` meer buiten `Palette`.

### Meetbasis: `VerifyMetricsRunner`
Meet in plaats van te asserteren op literalen, en is daarmee het enige runner-contract dat
stríkter wordt naarmate de wereld beter wordt. Gemeten op seed 1337 (nulmeting, sept 2026):

| | |
|---|---|
| materialen | 65 distinct |
| gebouwen | 157 gerenderd (163 in de data, 6 neemt `CivicDecorator` over) |
| silhouetten | **4 distinct** — de kern van het visuele probleem |
| footprint | min 1,28 · mediaan **1,28** · max 2,43 m |
| onderlinge afstand | min −1,28 · mediaan **−0,85** m |
| overlappend | **131 van 157** gebouwen raken of snijden een buur |

Die −1,28 is exact de mediane footprint: volledige insluiting. Het zijn schuren die in het
middelpunt van hun ouderhuis staan (README belooft "een schuur in de tuin") plus het
plein-meubilair. Dat nuanceert de sectie hierboven: de lattice klopt, maar 83% van de gebouwen
overlapt alsnog iets.

### Zeebodem-schort: waarom het eiland geen vierkant meer is
`terrain.H` is een 65×65 grid en de zeebodem daarin is een bijna vlakke plaat op ±−2,5 m over
het **hele** vierkant, terwijl het echte land maar ~40% daarvan is. De water-shader tint alles
boven een zeebodem ondiep-teal, dus die datagrens tekende zich af als een kaarsrechte cyaan
rand om het eiland — de "halo". Van bovenaf was het onmiskenbaar een vierkant.

`WorldManager.BuildGroundMesh` lost dat puur in de **weergave** op:
- Het mesh loopt niet meer tot de datagrens maar tot `SeabedReachMetres` (1300 m), via ringen
  die buiten het grid geometrisch groeien (`SeabedRingGrowth`) — fijn bij het eiland, grof ver
  weg, dus voorbij de 2000 m waterplaat voor weinig vertices.
- `CoastDistance()` is een twee-pass chamfer-afstandsveld tot het dichtstbijzijnde landhoekpunt.
  De bodem zakt naar `SeabedFloorY` op basis van die afstand, dus de plaat volgt de kustlijn
  inclusief baaien, met een laagfrequente warp zodat hij — zoals in het echt — aan de ene flank
  breed is en aan de andere abrupt diep.
- **Land wordt niet aangeraakt**: `h >= SeaLevel` neemt `terrain.H` verbatim over. Daarom blijft
  `VerifyTerrainRunner` op `f7ec71ac` en veranderen collider, props en plaatsing niets.

`VerifyWorldRunner` pinde hiervóór `verts == (size+1)²` = 4225. Die assert bevroor een
implementatiedetail en blokkeerde dit; hij is vervangen door het werkelijke contract (alle
datahoekpunten aanwezig, mesh reikt ver genoeg, bodem zakt diep genoeg, landhoogtes ongewijzigd).
`VerifyVisualRunner` dupliceerde de bandkleuren; die leest nu `WorldManager.GroundBandColour`,
zodat test en implementatie niet uit elkaar kunnen lopen.

### Bewezen Mulberry32/uint-determinisme (C# port regels)
De C# terrein-port is bit-exact met zowel `shared/terrain.mjs` als `scripts/terrain.gd`. Regels die dat garanderen:
- **`double` overal** — GDScript `float` is 64-bit; `MathF` zou de bit-exactheid breken. Alleen `System.Math` (Floor/Sqrt/Clamp/Min/Ceil zijn IEEE-correct rond).
- **`uint`-wrap voor 32-bit ints** — JS-bitoperaties gedragen zich als int32; GDScript maskeert met `& 0xFFFFFFFF`. In C# is `unchecked(uint*uint)` mod 2³² hetzelfde, dus `imul = a*b`.
- **FNV-1a `hash32` over UTF-16-chars** — `char` (C#) == `unicode_at()` (GDScript) == `charCodeAt()` (JS). Seed-strings: `fork(label)` = `hash32("$seed:$label")`.
- **`js_round`** — `floor(x + 0.5)`, nooit de C# `Math.Round` (half-away-from-zero). Alleen voor tiny (niet exponentiële) getallen, zodat `(int)` truncatie hetzelfde is.
- **Valkuilen hierbij:** geen MathF, geen `Math.Round`, geen float-constanten uit `.0f`-types, geen lokalisatie (comma's) in string-interpolatie voor seed-fodder.`

### Bekende C# valkuilen
- `[GlobalClass]` op een script vereist dat de bestandsnaam exact overeenkomt met de class name.
- `partial class` is verplicht voor alle Godot C# scripts.
- Editor-gizmos (ImmediateMesh) renderen alleen als `Engine.IsEditorHint()` true is.
- Godot .NET SDK 4.7.2 is beschikbaar op NuGet; het lokale GodotSharp-pad wordt niet gebruikt door dotnet build (die haalt alles via NuGet).
- `--script` SceneTree-runners: `_Ready()` op custom nodes wordt **niet gegarandeerd** aangeroepen voor nodes die je in `_Initialize()` aan `Root` toevoegt → gebruik lazy `EnsureRoots()` of aanmaak vóór dat AddChild.
- SceneTree-loop-semantiek: `true` retourneren uit `_Process`/`_PhysicsProcess` **beeindigt de loop** (MainLoop-semantiek) → in runners altijd `false` returnen en stoppen via `Quit(0/1)`.
- `HeightMapShape3D` positioneer je op `(0.5, 0, 0.5)` (cel=corner bij gx/gz) en MapWidth/MapDepth = `N`; data is `double[N*N]` (`terrain.H`) → casten naar `float[]`.
- ArrayMesh-arrays: gebruik standaard C# arrays (`Vector3[]`, `Color[]`, `int[]`), géén `PackedVector3Array` (die type bestaat niet in C#-API). `SurfaceGetArrays(0)` geeft een `Godot.Collections.Array` met Variant-waarden → elementen casten met `.As<Color[]>()` / `.As<Vector3[]>()`. `SurfaceGetArrayLength` bestaat niet → pak de array via `SurfaceGetArrays(0)` en check de Vertex-array-lengte.
- `HttpClient` is ambig tussen `Godot.HttpClient` en `System.Net.Http.HttpClient` → voeg `using HttpClient = System.Net.Http.HttpClient;` toe (ook in Tools-runners).
- village.json is partieel untyped: `districtsRev` kan een number zijn, `outpost` een object → maak `DistrictsRev` `[JsonConverter(FlexibleStringConverter)]` en `Outpost` type `object?` (polymorf, zoals `District`).
- **C# heeft geen `ConeMesh`** (ook niet in 4.7) → kegel maken als `CylinderMesh` met `TopRadius = 0`.
- **`Basis * Basis` compileert niet in Godot C#** (er is geen operator; de compiler zoekt dan foutief de Quaternion-overload). Basis-multiply (bovendien basisen): zelf samenstellen, bijv. per kolom zoals `PropSpawner.RotScale` (`M = Ryaw·Rtilt·S` berekend per basis-vector, want Basis is column-major).
- **`Basis(Vector3, Quaternion)` bestaat niet** in Godot C# (er is géén scale+rotation constructor). Voor een pure schaal-basis de 3-kolommen-constructor gebruiken: `new Basis(new Vector3(sx,0,0), new Vector3(0,sy,0), new Vector3(0,0,sz))`.
- **`_UnhandledKeyInput(InputEventKey)` bestaat niet** in de Godot C#-bindings — gebruik `override _UnhandledInput(InputEvent @event)` met een pattern-match (`@event is InputEventKey { Pressed: true, Keycode: Key.Escape }`).
- **`BoxContainer.Separation` is géén property** in C# — gebruik `AddThemeConstantOverride("separation", <int>)`.
- **`SizeFlags` is génormeerd als `Control.SizeFlags`** (niet als platte `SizeFlags.ExpandFill`).
- **`AddThemeConstantOverride` verwacht `int`**, niet `float` (ook voor `h_separation`/`v_separation`).
- **`PackedScene.Pack()` op een off-tree node verliest z'n children** (C# 4.7): Pack+Instantiate rondt een Node3D met MeshInstance3D-child af tot een lege Node3D (`children=0`). Daarom bouwen de building-pieces hun mesh via `BuildingPieceResource.MeshOverride/MaterialOverride` (AttachPiece maakt zelf een `MeshInstance3D`), en niet via PackedScene — zie pitfall-regel voor windows: material pakken uit `MaterialOverride` (AttachPiece is nu direct een MeshInstance3D).
- **MultiMesh readonly-na-gebruik:** bij rebuild eerst oude childs `RemoveChild`+`QueueFree` (niet `Free()` direct — nodes met instanties geven anders "Leaked instance dependency"-ruis); transforms vul je via `mm.InstanceCount = n; mm.SetInstanceTransform(i, tf)`.
- **`Environment` is ambigu** tussen `System.Environment` en `Godot.Environment` → volledige `Godot.Environment`-kwalificatie (in Main.cs). De C#-naamgeving van `Environment` is anders dan GDScript: `BackgroundMode`-enum is `BGMode`, tonemap-property is `TonemapMode` (enum `ToneMapper`, waarden Linear/Reinhardt/Filmic/Aces/Agx), en "sky contribution" zit in `AmbientLightSkyContribution` (er is géén `SkyContribution`).
- **UI-enums zitten genest in `Control`** — `LayoutPreset`, `GrowDirection` en `MouseFilterEnum` bestaan NIET globaal in C# (anders dan GDScript): gebruik `Control.LayoutPreset.TopLeft`, `Control.GrowDirection.End`, `Control.MouseFilterEnum.Pass` (binnen een Control-subclass volstaat `MouseFilterEnum`).
- **Geen `SeparationOverride` op BoxContainer** (bestaat alleen in Godot 3) → `AddThemeConstantOverride("separation", N)`.
- **`Label` kent geen `AutoSize`** en geen `character_spacing`-theme-constante — Labels groeien automatisch mee met hun tekst; letter-spacing vereist een custom font.
- **Control positioneren:** `SetAnchorsPreset(Control.LayoutPreset.*)` + offsets; bij content-sized panelen `GrowHorizontal/GrowVertical` zetten zodat ze vanaf het anker groeien.
- **MouseFilter op een CanvasLayer-HUD:** root-panelen `Pass` zodat 3D-kliks doorkomen, alleen echte interactieve elementen (buttons/sessiekaarten) krijgen `Stop`.
- Headless-exit-warnings ("RID allocations leaked", "Pages in use exist at exit", ObjectDB leaks) zijn bekende teardown-ruis van de dummy-renderer en tellen niet als test-falen — let op `EXIT=0` en de `[OK]`-regels.

## Bekende Godot-4 valkuilen (nieuw)
- `SphereMesh` heeft **`radial_segments`** + `rings`, niet `segments` (Godot 3).
- `StandardMaterial3D`: gebruik `emission_enabled` / `emission` / `emission_energy`, **niet** `emissive_enabled` / `emissive` / `emissive_energy` — die geven remapping-warnings en zetten emission niet aan.
- Bij nieuwe `class_name`-scripts: eerst `--import` draaien, anders ziet `--script` de class niet.
- Water-shader (`res://shaders/water.gdshader`, stap 12): in een transparent/blend pass diepte uitlezen via `DEPTH_TEXTURE` + reconstructie `vec4 view = INV_PROJECTION_MATRIX * vec4(ndc, 1.0); depth = view.z / view.w` (wateroppervlak = `-VERTEX.z`); `render_mode blend_mix, depth_draw_never, cull_back, specular_disabled` zodat je door het water naar de wereldbodem kijkt. `ConeMesh` → `CylinderMesh` met `TopRadius=0`.
- `verify_objects.gd` bouwt zelf, niet via `root.add_child(kit.build(...))` — `build()` retourneert een Dictionary, geen Node.

## Wereldgenerator v2 (`lib/world/`, sinds sept 2026)

Vervangt `shared/terrain.mjs`. Het terrein wordt niet meer afgeleid maar **verstuurd**: de
generator draait één keer per eiland op de server en schrijft onveranderlijke chunks. Daarmee
vervalt de regel bovenaan `shared/rng.mjs` die `sin`, `cos` en `pow` verbood — die bestond
alleen omdat dezelfde code in Node, de browser en C# bit-identiek moest draaien.

```
node scripts/island.mjs                        bovenaanzicht als PNG
node scripts/island.mjs --sheet 9              contactvel van negen seeds
node scripts/island.mjs --stats --seeds 4      klassenverdeling en hellingen
node scripts/island.mjs --publish out/world    chunks + manifest, ~1,9 s
node scripts/island.mjs --sheet 9 --raw        hetzelfde vel zonder erosie, om te vergelijken
```

`--raw` zet de erosiepas uit (`erosion: 0`) en werkt op `--stats`, op de plaatjes en op
`--publish`. Zonder die schakelaar kun je niet zien wat de pas doet, en dan stel je hem een week
lang de verkeerde kant op af.

| module | doet |
|---|---|
| `noise.mjs` | fbm, ridged fbm, polynomiale smooth-min |
| `shape.mjs` | de omtrek: smooth-union van negen schijven door een vervormd domein |
| `relief.mjs` | hoogte: geridgede ruis, terrasseren naar treden van 7,5 m, strandprofiel |
| `classify.mjs` | één byte per monster: strand, duin, weide, bos, puin, rots |
| `erode.mjs` | hydraulische erosie: 55.000 druppels over het gebakken raster |
| `water.mjs` | rivieren en meren, in het gebakken raster gesneden |
| `features.mjs` | landmassa's, toppen en aanlandingsplekken benoemen |
| `bake.mjs` | één pas over de envelop: kust, hoogte, erosie, water, hellingcap, klassen |
| `chunks.mjs` | het schijfformaat, delta-gecodeerd en gegzipt |
| `publish.mjs` | chunks + `manifest.json` met `worldRev` |
| `render.mjs` | het diagnostische bovenaanzicht — tekent **de bake**, niet de continue functies |
| `png.mjs` (in `lib/`) | PNG-schrijver van zestig regels op `node:zlib`, geen dependency |

### Wat je moet weten voordat je eraan draait

- **Terrasseren is een kwantiseerder.** Wat je erin stopt komt eruit als treden van díé
  frequentie. De fijne korrel gaat er daarom pas ná overheen; mee-kwantiseren maakte het eiland
  verkreukeld folie in plaats van plateaus. `potential()` moet glad blijven — twee octaven, op
  schalen van 170–250 m.
- **`terraceMask` is niet optioneel.** Zonder masker is het hele eiland een bruidstaart.
- **De omvang is genormaliseerd, de vorm niet.** Het veld wordt om de oorsprong geschaald tot
  het landoppervlak zijn doel raakt (8,4 ha). Ongenormaliseerd scheelde het bijna een factor
  twee tussen seeds, en dan beslist de seed hoeveel settlers erop passen.
- **De hellingcap (45°) kan alleen in de bake.** Een continue functie heeft geen buurmonster om
  tegen te klemmen. `capGradient` schaaft de hógere van een te steil paar af, dus een klif wordt
  afgevlakt en een dal niet opgevuld — het eiland groeit er nooit van. Wat eraf gaat (~9.700
  monsters, gemiddeld 1,4 m) is precies het materiaal dat later rotsschillen wordt.
- **De zeebodem heeft een vloer op −32 m.** Niet alleen realisme: zonder vloer volgde de bodem
  het vervormde kustveld tot aan de rand van de envelop, was elk monster open oceaan anders, en
  woog een chunk pure zee 5 kB — even veel als een chunk eiland. Nu 95 bytes.
- **Chunks hebben een gedupliceerde randrij** (65×65 voor 64 m). Dat is wat buren naadloos laat
  aansluiten, en er staat een test op.
- **Een chunk heet naar de hash van zijn eigen bytes.** Ongewijzigd betekent dezelfde naam, dus
  `immutable` cachen kan en groeien is publiceren in plaats van herschrijven.

Meetlat voor een eiland van 208 m straal, **met erosie** (`node scripts/island.mjs --stats
--seeds 4`): 8,4 ha land, top 29–32 m, helling p50 0,28 / p90 0,80, en grofweg weide 43% ·
bos 14% · strand 15% · duin 10% · puin 8% · rots 7%. Loopt een van die ver weg, dan is er
iets kapot — de eerste afstelling leverde een kwart strand en een derde kale rots op, en dat zag
je meteen. Zonder erosie (`--raw`) is dezelfde meetlat top 30–35 m, p50 0,38 / p90 1,00 en
weide 34% · bos 12% · strand 15% · rots 14% · puin 12% · duin 12%; dat verschil is de
erosiepas en niet een defect.

### Erosie (`erode.mjs`, pas 3 van de bake)

Een druppelsimulatie: 7200 druppels per hectare (~55.000), elk maximaal 36 m lang, die de
gradiënt volgen met een beetje traagheid, materiaal oppakken waar ze versnellen en het laten
vallen waar ze vertragen. Erosie gaat met een kwast van 3 m, depositie bilineair.

- **Hij staat vóór het water en vóór de cap.** `carveWater` daalt af naar zee, dus na erosie vindt
  een rivier de geulen die de erosie al gesneden heeft in plaats van er dwars overheen te lopen.
  En de cap moet laatst, anders zijn er twee antwoorden op de vraag hoe steil een wand mag zijn.
- **Hij vecht niet met de hellingcap, hij helpt hem.** Dit is de valkuil die iedereen verwacht —
  erosie maakt alles steiler, de cap schaaft het er weer af, en je hebt twee keer gerekend voor
  niets. Gemeten gebeurt het omgekeerde: de cap doet **70.900 → 29.000** correcties, en het
  aandeel monsters dat precies op de cap zit gaat van 10% naar 6%. Druppels ondergraven een
  trapwand en leggen het puin aan de voet, dus de wand komt al binnen de limiet bij de cap aan.
- **Hij vecht ook niet met het terrasseren.** Het aandeel eiland dat op een trede ligt (hoogte
  binnen 1 m van een veelvoud van `BENCH`) gaat van 26,5% naar 25,9%, en het aandeel bijna-vlakke
  grond gaat juist iets omhóóg. De druppels ronden de *rand* van een trede af en vullen zijn top;
  ze snijden er niet doorheen. Er staat een test op.
- **`WEATHERING = 0.7` is een menging, geen snelheid.** De pas draait altijd voluit en het
  resultaat wordt daarna met het ongeërodeerde veld gemengd. Dat is niet uit luiheid: de *rates*
  omlaag draaien doet vrijwel niets — capaciteit en erosiesnelheid samen halveren verschuift de
  mediane helling van 0,26 naar 0,27 — omdat het landschap waar een druppelsimulatie naartoe
  convergeert een eigenschap van de simulatie is en niet van hoe hard je hem draait. Mengen is de
  enige knop die lineair is in het resultaat.
- **Erosie maakt het eiland groener.** Bij volle sterkte zakt de mediane helling van 0,38 naar
  0,25 en halveert kale rots + puin van 25% naar 14%, want een afwateringslandschap is nu eenmaal
  vlakker dan fractale ruis. Bij 0,7 is het 0,28 en 14%. Wil je de oude verhouding terug, dan is
  `WEATHERING = 0.4` de knop (0,32 en 19%) — of, waarschijnlijk beter, `SCREE_SLOPE` en
  `ROCK_SLOPE` in `classify.mjs` opnieuw afstellen, want die drempels zijn op de óngeërodeerde
  hellingverdeling gekozen.
- **Alleen het hoofdeiland, en niet tot aan de waterlijn.** De druppels lopen op een masker uit
  `shape.mainCoast`, 5 m binnen de kustlijn. Dat masker hangt alleen van seed en straal af — niet
  van de envelop, zoals `coast` (die is de vereniging met de eilandjes, en die liggen op een
  rooster over de envelop). Anders zou `islandStats` op 640 m een ander eiland afstellen dan
  `publishWorld` op 1024 m publiceert. De druppelwandeling rekent daarom ook in coördinaten
  t.o.v. de hoek van dat venster: absolute rasterindices lieten dezelfde wandeling op 10,3 en op
  42,3 beginnen, en float-optelling is niet translatie-invariant.
- **Kosten: +230 ms** op een bake van 1,42 s → 1,65 s (envelop 1024, 1,05 M monsters). Publiceren
  gaat van 1,65 s naar 1,9 s; de chunks worden 445 → 448 kB.
- **Wat eraf spoelt is weg.** Alleen slib dat de kustband bereikt gaat de zee in; een druppel die
  gewoon opdroogt legt zijn last neer met de erosiekwast. Zonder dat laatste nam elke druppel
  zijn hele lading mee en verloor het eiland 10% van zijn volume per bake, allemaal van de top.
  Nu is het netto verlies < 1%.

### Water, eilandjes en features

- **Zoet water is geen hoogte maar een klasse.** De oude generator kon wegkomen met "onder
  zeeniveau is water" omdat het eiland maar 5 m hoog was; op 46 m is een beek op 30 m hoogte nog
  steeds een beek. Het wateroppervlak ligt daarom een vaste diepte boven de bedding
  (`RIVER_DEPTH 1.1`, `LAKE_DEPTH 2.2`), en die twee getallen staan in het manifest.
- ⚠️ **De rivieren zijn kaarsrechte streepjes van ~65 m.** Zichtbaar geworden toen `render.mjs`
  de bake ging tekenen in plaats van de continue functies — daarvóór kwamen `CLASS.RIVER` en
  `CLASS.LAKE` nooit in beeld. Gemeten op seed 1337: `river:0` loopt van (17,105) naar (80,107),
  dus 63 m pal oost, en `river:1` idem naar het westen. Oorzaak zit in `descend`: het BFS-veld is
  4-verbonden, dus meestal is er maar één buur die écht dichter bij zee ligt, en dan is de
  "laagste buur"-keuze geen keuze. Daar komt bij dat een bron minimaal 55 BFS-stappen van zee moet
  liggen terwijl er nauwelijks kandidaten verder weg zijn, dus elke rivier begint net binnen dat
  minimum. Erosie verandert dit niet (het is even recht met `--raw`) en lost het ook niet op.
- **Een rivier volgt de afwatering, niet een afstandsveld.** Steilste afdaling alleen loopt vast
  in de eerste kuil — de oude generator schreef die les al op — en op getrapt terrein is het
  erger, want een vlakke trede hééft geen afdaling. `coast` volgen werkt ook niet: ná de domain
  warp is dat geen afstandsveld meer en heeft het lokale maxima. Daarom stond er eerst een
  BFS-afstand naar zee onder: monotoon, dus elke rivier kwám aan — maar langs de kórtste weg, en
  vier-verbonden daalt die afstand langs één of twee van de vier buren, dus er viel niets te
  kiezen. Resultaat: een balk langs een rasteras, niet langer dan de bron landinwaarts lag
  (seed 1337: 65 m op een eiland van 400 m). Nu doet `routeFlow()` het hydrologisch — kuilen
  vullen met een priority flood vanaf zee, elk landmonster acht-verbonden zijn steilste lagere
  buur geven, en het stroomgebied stroomafwaarts optellen — en wordt de rivier van zijn **monding**
  gevonden, stroomopwaarts langs de grootste zijtak tot de bron. 120–260 m kronkelende loop, en
  de bake kost er niets meer door (bucket-queue in plaats van een heap).
- **Het gevulde oppervlak is het waterpeil.** De carve volgt `filled`, niet `height`: dat daalt
  per stap per constructie, dus een loop die door een kuil gaat draagt dat peil niet mee en
  graaft geen geul door de rand erachter. En `lengthM` telt echte meters, geen monsters — de loop
  is acht-verbonden, dus een diagonale stap is 1,41 m.
- **Een test die alleen vraagt óf er een rivier is, slaagt ook op een balk.** `world-water.test.mjs`
  bewaakt daarom lengte (>110 m) én dat de loop ergens meer dan 40° draait; beide vallen om op de
  oude generator.
- **Een meer heeft een vlakke bodem.** Een constante diepte over een gebogen kom geeft geen vlak
  oppervlak, en dat is het enige wat elk meer ter wereld gemeen heeft.
- **Eilandjes worden met `max` verenigd, niet met smooth-min.** Twee landmassa's die samensmelten
  doen precies teniet waar ze voor zijn: een wijk op zijn eigen eiland. Hun plekken komen uit een
  vaste reeks, berekend op t=0, dus eilandje 4 landt waar eilandje 4 landt of 1 tot 3 nu bestaan
  of niet.
- **Een eilandje wordt gemeten vanaf de kustlijn, niet vanaf het middelpunt.** Ze lagen op vaste
  ringen (0,58 en 0,80 van de envelop), maar de kust zelf schommelt tussen ~150 en ~260 m, dus het
  water ertussen kwam op 74 tot 228 m uit — en een wijk achter 228 m open zee is geen wijk op een
  eilandje maar een wijk die niemand bereikt (seed 1337: zes van de twaalf projecten). `reachAlong()`
  in `shape.mjs` marcheert langs de peiling naar de búitenste kruising van `mainCoast` (niet
  bisectie: een gewarpte kust is niet monotoon langs een straal, dus je zou een eilandje midden in
  de volgende lob leggen) en zet het eilandje daar `GAP_MIN_M 26` tot `GAP_MAX_M 78` voorbij.
  Gemeten 27–72 m over drie seeds.
- **Elke landmassa krijgt zijn kust van zijn eigen veld, niet van de unie.** `shape.coast()` is
  `max(mainCoast, skerryCoast)` en betekent "is dit land" — goed voor `classify`, `features` en
  `water`, fout om een strand mee te vormen. Pass 2 van `bake.mjs` bakt daarom naast `coast` ook
  een `mainC`-raster en shape't het hoofdeiland daarop: lag een eilandje tegen de flank, dan las
  de unie tientallen meters landinwaarts op een monster dat een stap van de eigen waterlijn af
  lag, en dat werd massief in plaats van strand (seed 1401 op 640 m: 10,3 m hoog binnen 4 m van
  de kust).
- **De envelop verandert het hoofdeiland niet** — `islandStats` bakt op 640 m, `publishWorld` op
  1024 m, en sinds de eilandjes vanaf de kust liggen is de bake daar byte-identiek: gemeten over
  seeds 1337, 1401 en promptholm, **nul** afwijkende monsters, rivieren en meren inbegrepen. Dat
  laatste was de subtielste: `carveWater` routeert op de unie (terecht — een eilandje ís land),
  dus een verschoven eilandje veranderde `toSea`, daarmee de kandidatenlijst, en daarmee trok
  `rng.int()` een compleet andere bron. Bewaakt door `tests/world-skerries.test.mjs`, dat niets
  meer maskeert dan de eilandjes zelf.
- **`islandStats` meet het hoofdeiland via `mainCoast`.** De eilandjes meetellen liet het
  landoppervlak 1,13× variëren tussen seeds terwijl er in werkelijkheid alleen een andere zandplaat
  in beeld stond. En het meet op een echte bake: rivieren, meren en de hellingcap bestaan pas
  als er een raster is, dus de continue weg zou een eiland rapporteren dat niemand ooit ziet.
- ⚠️ **Een eilandje lekt in de hoogte van het hoofdeiland.** Pas 2 geeft `relief.height` de
  `coast` uit het raster mee, en dat is `max(mainCoast, skerryCoast)`. Ligt een eilandje dicht
  tegen een flank, dan leest een kustmonster van het hoofdeiland tientallen meters landinwaarts
  en wordt het als massief gebakken in plaats van als strand. Gemeten op seed 1337 met envelop
  640: **880 van de 78.545** hoofdeilandmonsters, tot 27 m mis. Omdat de eilandjes op een rooster
  over de envelop liggen, is `islandStats` (640 m) dus al niet helemaal hetzelfde eiland als
  `publishWorld` (1024 m) — in een band langs één flank. Dit is ouder dan de erosiepas; die
  gebruikt daarom een eigen masker uit `mainCoast`. Fix zou zijn: pas 2 `mainCoast` laten
  gebruiken voor `d` en `wBeach`, en `coast` alleen voor wat land í́s.
- **`render.mjs` tekent de bake, niet de continue functies.** Tot september tekende het
  bovenaanzicht `relief.height` rechtstreeks, dus je keek naar een eiland zónder rivieren, meren,
  hellingcap en erosie — vier van de zes passen — en precies dat is de fout waar dit script voor
  bestaat. Het kost nu wel een bake per cel: een contactvel van negen seeds duurt ~15 s in plaats
  van ~2 s. Dat is de prijs van naar het juiste plaatje kijken.
- **Het manifest benoemt wat het eiland ís** — landmassa's met zwaartepunt, grenzen en top, plus
  aanlandingsplekken, rivieren en meren. De client leidde `HillCentre`, `LakeCentre` en `Rivers`
  vroeger uit zijn eigen kopie van de generator af; met het terrein als bytes is er niets meer om
  dat uit af te leiden.

### `docs/island-preview.html`

`node scripts/preview.mjs` bundelt de generator tot één HTML-pagina die hem in de browser draait:
seed intypen, pijltjes om te stappen, en een knop om van eiland naar archipel te zoomen. Hij roept
dezelfde `bakeField` aan, dus wat je ziet is wat er gepubliceerd wordt. Voeg een nieuwe module toe
aan de generator, dan moet hij ook in `MODULES` in `scripts/preview.mjs` — anders faalt de pagina
met een `ReferenceError` en verder niets.

## Terrein als data in de client (sinds sept 2026)

`godot/src/World/TerrainField.cs` laadt het manifest en de chunks die de server publiceert;
`TerrainChunk.cs` is de decoder van het binaire formaat uit `lib/world/chunks.mjs`. Houd die twee
in de pas — magic en monsteraantal worden gecontroleerd, dus een mismatch faalt luid.

`TerrainMeshBuilder.cs` maakt er geometrie van: **één mesh per gepubliceerde chunk**. Land op volle
resolutie, chunks met alleen zee op stride 4. Eén mesh voor het hele eiland was prima op 64 m,
maar op een envelop van 1024 m valt daar niets aan te cullen en teken je vanaf het strand de
achterkant van de heuvel mee.

`WorldPreviewRunner.cs` rendert die wereld met de atmosfeer eroverheen en verder niets:

```
Godot..._console.exe --path godot --fixed-fps 60 --script res://src/Tools/WorldPreviewRunner.cs -- --hour 9.0 --out shot.png
```

Bewust niet de hele `Main`-scene: het dorp staat nog op het oude grid van 64 m, dus zijn huizen
zouden allemaal in één hoek belanden en het plaatje zou meer over dát zeggen dan over het terrein.

### Twee dingen die me hier zijn opgevallen

- **Windingvolgorde.** `a,b,c` en `b,d,c` — dezelfde als in `WorldManager.BuildGroundMesh`.
  Andersom wordt elke driehoek weggecruld en rendert het eiland als een handvol slivers. Dat leest
  als een kapotte mesh, niet als een omgedraaide, en daar ben ik een halfuur op blijven zoeken.
- **De mist was op 64 m afgesteld.** `EnvironmentFactory.DepthReachM` is nu instelbaar en schaalt
  begin, eind, dichtheid en volumetrische lengte mee. Op de oude waarde (600) verandert er niets.
  ⚠️ De dichtheidscorrectie is **kwadratisch en empirisch**, geen natuurkunde: het palet is
  geschreven voor een wereld waarin niets ooit honderd meter weg was, en lineair corrigeren liet
  het eiland bij gouden uur nog steeds in een muur van nevel staan. Dit hoort vervangen te worden
  door dichtheden die op de nieuwe schaal opnieuw zijn afgesteld, beoordeeld op de shot-matrix.
- **De watershader moet dezelfde behandeling krijgen.** Zijn dieptetint is afgesteld op een zee van
  2,5 m diep; die gaat nu tot 34 m, dus alles leest als "diep".


## De layout in lots van vier meter (herfundering, sept 2026)

`lib/layout.mjs` leidt geen terrein meer af. Het krijgt een **lot-veld** mee
(`lib/world/lotfield.mjs`) en telt in lots van 4 m. Elke constante hield zijn getal en
betekent vier keer zoveel meters: `PITCH 4` is een super-cel van 16 m, een 3×3-plot is
12 m, het plein groeit van 12 naar 20 naar 28 m. Vandaar *herfundering* en niet
herschrijving.

- `placeAll(layout, model, { lots, seed, worldRev })`. `size` komt uit `lots.size`.
- `village.json` draagt geen `terrainHash` meer maar `island.worldRev`,
  `island.metresPerLot` en `island.envelopeM`. De client mag die 4 **nooit** aannemen —
  `TerrainField.MetresPerLot` leest hem, en `CellWorld`/`CellCorner`/`Span` zijn de enige
  omrekeningen. Een client die gokt zet het dorp op de goede plek in de verkeerde schaal,
  en dat ziet eruit als een gezonken stad.
- Bebouwbaarheid is **grondverzet**, geen helling: `lots.earthwork(lx,lz,w,d)` is het
  hoogteverschil onder een blok, `EARTHWORK_MAX = 4 m`. Gemeten: een hellingdrempel liet
  25 bouwplekken over waar het grondverzetcriterium er 140 vindt. Het droge duin is
  bebouwbaar, alleen de natte vooroever niet — op dit eiland ís het strand het vlakke land.
- `Super.build` vraagt naar het **3×3-plot in de super-cel**, niet naar alle zestien lots.
  Alle zestien eisen kostte 278 van de 532 super-cellen omdat één hoek van de laan op het
  strand lag.
- **Polders zijn weg** (210 regels). Ze bestonden alleen omdat `gridSize` niet kon groeien;
  de wereld wordt nu één keer over de hele envelop gebakken en per chunk gepubliceerd.
  `POLDER_AT`/`POLDER_EVERY` blijven staan omdat `scan.mjs` de kroniek eruit dateert.

### Bakken één keer, daarna van schijf

`scan.mjs` → `ensureWorld()`: bakken kost 1,7 s, terugzetten 0,2 s. Herbakken gebeurt
alleen bij een andere seed, een andere `worldV` of een andere `radiusM`. `loadWorld()`
(`lib/world/load.mjs`) zet de chunks terug tot één veld — dezelfde bytes die de client
tekent, dus er is geen tweede afleiding die kan afdrijven.

`node scan.mjs --refound` plant het eiland opnieuw vanaf niets en legt `refoundedAt` +
`previous` vast. Gebruik dat als een dorp scheef gegroeid is; een gewijzigde `worldRev`
doet hetzelfde automatisch.

### Twee invarianten die stilletjes braken

Beide hadden geen zichtbaar symptoom en kostten elk een halve dag:

1. **`guest` was een eigenschap van de route.** Gezet in `ensureParcel`, die op de tweede
   scan niet meer draait omdat plots plakken — dus het vlaggetje klapte elke scan om en
   `layout.json` was nooit twee keer hetzelfde. Nu afgelezen van de afgemaakte layout
   (heeft dit district huizen op de commons?), aan het einde van `placeAll`.
2. **Een gast-gehucht kreeg `square`/`paved` een scan te laat.** De comment bij de
   `farmstead`-tak beschreef deze bug al; de fix was daar destijds alleen toegepast. Op het
   oude vlakke eiland kreeg elk gehucht land en werd de tak nooit gelopen.

Regel die hieruit volgt: **schrijf een veld dat uit de layout af te lezen is ook uit de
layout af**, niet op de plek waar het besloten wordt.

### Oversteken: het eiland is een archipel

Skerries worden geplaatst **vanaf de kustlijn**, niet vanaf het middelpunt
(`lib/world/shape.mjs`, `reachAlong()`). Op vaste ringen kwam het water tussen eilandje en
kust op 74 tot 228 m uit, omdat de kustlijn zelf tussen 150 en 260 m schommelt — zes van de
twaalf projecten stonden onbereikbaar. Nu: `GAP_MIN_M 26` tot `GAP_MAX_M 78`, gemeten
27–72 m over drie seeds.

`linkLandmasses()` in `layout.mjs` verbindt elke landmassa waar iemand woont met die van het
dorp, kortste oversteek eerst, en legt ze vast in `layout.links` (append-only, plakkend).
`CAUSEWAY_MAX_M 45` / `BRIDGE_MAX_M 110`. Een dek mag tot een derde van zijn lengte
scheef liggen — rechte oversteken eisen strandde een district op 116 m water terwijl het
kanaal ernaast 52 m was. `MAX_SPAN` in `crossingSpan` blijft 5: die is voor beekjes, en
verhogen zou wegen over elke baai laten springen.

### Mist hoort bij de wereld, niet bij de runner

`EnvironmentFactory.DepthReachM` werd alleen door `WorldPreviewRunner` gezet, dus het spel
zelf en elke screenshot kregen de mist van een eiland van 64 m over een van 408 m — bijna
wit. `WorldManager.BuildWorld` zet hem nu uit het manifest (`EnvelopeM * 1.2`). De
`fogScale`-correctie erin is nog steeds empirisch en kwadratisch; opnieuw tunen tegen de
screenshot-matrix staat open.

`ShotCatalog.Resolve()` schaalt de standpunten met `RadiusM / 32` rond het dorpsplein, zodat
de bestandsnamen over een herfundering heen vergelijkbaar blijven. Hoogte schaalt met de
wortel, anders kijk je loodrecht op een maquette.

### Kaart zonder Godot

`node scripts/village-map.mjs --data <dir>` tekent het dorp op het eiland als PNG: kleur per
wijk, wegen, oversteken, civics, dorpsplein. `--zoom <m>` voor een uitsnede rond het
centrum. Dit is waar je beoordeelt of het als dorp leest; `scripts/island.mjs` is voor de
grond alleen.
