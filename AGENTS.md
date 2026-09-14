# AgentVillage projectnotities

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
│   ├── WaterPlane.cs         # [GlobalClass] MeshInstance3D: water via ShaderMaterial ↔ res://shaders/water.gdshader
│   │   │               #   op y=0 (2000×2000, HorizonSize 2000, shadow off, diepte-gradiënt + schuimlijn via DEPTH_TEXTURE),
│   │   │               #   als child van GroundRoot
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
│   ├── VerifyWorldRunner.cs   # self-contained: 4 sample-gebouwen → mesh 4225 verts, ≥7 pieces/gebouw
│   ├── VerifyLiveRunner.cs    # E2E tegen lokale server (poort 4747): aantallen zijn data-afhankelijk (snapshot village.json = 163 gebouwen, live kan anders zijn)
│   ├── VerifyWalkRunner.cs    # echte physics-frames: EnterWalkMode → 80 ticks op de grond (IsOnFloor), teleport in het water → 120 ticks (State=Swimming)
│   ├── VerifyDossierRunner.cs # building-colliders + NearestDossier + BuildingDossierUI round-trip (31 checks)
│   ├── VerifyAtmosphereRunner.cs # dag/nacht: 12:00 (dag, raam-glans blijft subtiel warm 0.35, lampen uit) / 23:00 (nacht,
│   │   │               #   windows+lampen emissie, vuurtoren beam aan + rotatie ~45°/s) / 19:30 (schemer, glow+lighthouse aan) — 28 checks
│   ├── VerifyModelSheetRunner.cs # 6 tiers × 3 styles assemblage + 9 prefab .tscn-scene-laden checks (factories + self-build)
│   ├── VerifyDistrictRunner.cs   # Phase 2 stap 9: laadt echte res://village.json, bouwt wereld, assert hedges>0,
│   │                               #   field/orchard>0 (falls toevallig 0 op een lege island — met fallback-village 164/16+21)
│   └── VerifyVisualRunner.cs     # Fase 2 stap 12: storybook-verificatie (20 checks) — water shader/materiaal, palette-hele
│                               #   kleuren + half-timber slankheid, plaza-fontein+stalletjes, per-vertex grondkleuren,
│                               #   wolken (aantal/hoogte/schaduw/drift/wrap); zelfde 161 !is_inside_tree()-ruis als
│                               #   VerifyDistrictRunner (preëxistent, bij gebouwassembly) + EXIT=0
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
    │                       #   Swimming-state (buoyancy naar y=WaterSurfaceY); CollisionLayer=2, CollisionMask=1
    │                       #   + [Export] WorldManager? World, InteractionRadius=2.5f, E/Joypad-X deur-interactie
    ├── ThirdPersonCamera.cs # [GlobalClass] Node3D: SpringArm3D (kerstbal r=0.25, CollisionMask=1) + Camera3D; RMB-look, wheel-zoom
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
  - `VerifyVisualRunner.cs` — stap 12: laadt echte village.json, assert water-shader + ShaderMaterial, palette-kleur getters (`BuildingCatalog.PlasterColour` etc.), fountain+3 stallletjes + terrain-clamp, per-vertex ground-kleurbanden, cloudveld 5..7 (altitude 22..26, schaduw, drift, wrap) → 20 checks PASS. De 161 `Condition "!is_inside_tree()"`-regels die tijdens gebouwassembly verschijnen zijn preëxistent (DistrictRunner geeft identiek) → enkel op EXIT=0 + `[OK]` letten.
  - Wrap `Run()` in try/catch met `Quit(1)` erin: zonder `Quit` hangt een `--script`-runner eindeloos.

### Modulair building-piecesysteem (fase 2 stap 7)
`BuildingCatalog.cs` (statisch) bevat mesh-fabrieken voor elke piece-type met vaste Promptholm-materialen (pleister/balk/steen/tile/thatch/ijzer/koper). Elke fabriek retourneert een `Node3D`-boom met `MeshInstance3D`-children. `WorldManager.BuildCatalog()` roept deze fabrieken aan (niet meer inline `BoxMesh`). Gebruikte materialen: `_plaster` (warm beige), `_beam` (donkerbruin), `_stone` (grijs), `_roofTile` (terracotta), `_thatch` (strogeel), `_wood`/`_woodLight`, `_iron` (donker metaal), `_glass` (semi-transparant blauw), `_copper` (oranje-brons), `_smoke` (grijs, semi-transparant).
Prefab `.tscn`-scenes staan in `prefabs/` met `[Tool]` scripts die in de editor én runtime zelf bouwen via `ToolPrefabBase.EnsureMeshes()`. De [.tscn]-paden: `prefabs/foundations/foundation_stone.tscn`, `prefabs/walls/wall_timber.tscn`, `prefabs/walls/wall_stone.tscn`, `prefabs/roofs/roof_gable_tiles.tscn`, `prefabs/roofs/roof_thatch.tscn`, `prefabs/openings/door_wood.tscn`, `prefabs/openings/window_frame.tscn`, `prefabs/ornaments/ornament_forge.tscn`, `prefabs/ornaments/ornament_weathervane.tscn`.
Word-vrijwaring palette (fase 2 stap 12): plaster (0.94,0.90,0.82), balk (0.32,0.20,0.11, `TimberBeamWidth=0.05`), steen (0.60,0.58,0.55), dakpan (0.74,0.32,0.18), glas (0.98,0.88,0.52, alpha 0.92, emissie 0.35 warm). Openbare kleur-getters op `BuildingCatalog` (PlasterColour/BeamTimberColour/FieldstoneColour/RoofTileColour/WindowGlassColour) zodat runners de kleuren kunnen asserten.
Model Sheet showroom: `scenes/model_sheet.tscn` met `ModelSheetShowroom.cs` [Tool] galerij (6 tiers × 3 styles + ornaments + key/fill/rim licht + orbital camera).
Valkuil: `ToolPrefabBase._Ready()` mag niet door `Engine.IsEditorHint()` worden geblokkeerd als de scenes ook runtime-gebruikt moeten worden (bijv. als PieceScene); `ClearMeshChildren` ruimt eerst op, `AddMeshesFrom` verplaatst meshes en freed de temp-node.

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
