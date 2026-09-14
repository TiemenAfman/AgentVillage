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
├── Core/           # EventBus: singleton autoload, C# events + [Signal]s, Publish*
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
│   ├── TerrainGenerator.cs   # bit-exacte port van terrain.gd + query-API (WorldHeight/Corner, SeaLevel=0, Land/BeachCells)
│   ├── WorldManager.cs       # [GlobalClass] Node3D: ArrayMesh-ondergrond (hoogtegradiënt-normals + vertex-color materiaal) + gebouwen via
│   │   │               #   BuildingAssembler + BuildRoads/BuildBridges (cobble MultiMesh + houten brug met railings/steunpunten;
│   │   │               #   _roadRoot onder GroundRoot, _bridgeRoot onder ObjectsRoot; gedeelde _plankMat/_railingMat/_stoneMat/_cobbleMat)
│   ├── WaterPlane.cs         # [GlobalClass] MeshInstance3D: oneindig-ogend semi-transparant vlak op y=0 (2000×2000, HorizonSize 2000,
│   │   │               #   diep oceaanblauw (0.02,0.14,0.32) + Roughness 0.18, shadow off), als child van GroundRoot
│   └── PropSpawner.cs        # [GlobalClass] Node3D: deterministische trees/rocks via MultiMesh op land-cellen, plot-vermijding,
│       │               #   clamp op WorldHeight; bomen ~3.5 m (trunk 1.7 + foliage 1.9/1.2), scale 0.75+forestN*0.2+rng*0.3
├── Main.cs          # [GlobalClass] Node3D, is de main.tscn-script: luistert naar EventBus.VillageDataLoaded; maakt
│   │               # WorldManager + FreeFlyCamera(Initialize((32,15,60), centrum)) + WalkModeManager(FlyCamera, World)
│   │               # + zon (DirectionalLight3D) + WorldEnvironment (ProceduralSky); LoadFallbackVillage() leest
│   │               #   res://village.json via Godot.FileAccess (dummy-island enkel als laatste redmiddel)
├── Tools/
│   ├── VerifyTerrainRunner.cs # SceneTree-runner: headless hash-check
│   ├── VerifyWorldRunner.cs   # self-contained: 4 sample-gebouwen → mesh 4225 verts, ≥7 pieces/gebouw
│   ├── VerifyLiveRunner.cs    # E2E tegen lokale server (poort 4747): aantallen zijn data-afhankelijk (snapshot village.json = 163 gebouwen, live kan anders zijn)
│   └── VerifyWalkRunner.cs    # echte physics-frames: EnterWalkMode → 80 ticks op de grond (IsOnFloor), teleport in het water → 120 ticks (State=Swimming)
├── Buildings/
│   ├── Slots/
│   │   ├── SlotType.cs              # enum: Foundation/Wall/Roof/Door/Window/Ornament/Sign
│   │   ├── IBuildingPiece.cs        # interface: PieceId, TargetSlot, ClearanceSize
│   │   └── BuildingSlot3D.cs        # [GlobalClass] Marker3D: CanAttach/Attach/ClearAttached + editor gizmo
│   ├── Data/
│   │   └── BuildingPieceResource.cs # [GlobalClass] Resource: PieceId, PieceScene, TargetSlot, TierReq, ModelStyle
│   └── BuildingAssembler.cs         # [GlobalClass] Node3D: slot-inventory, Assemble(style, tier, ornaments), ClearPieces
└── Walking/
    ├── FreeFlyCamera.cs    # [GlobalClass] Camera3D: RMB-look, WASD/QE/Space+Ctrl, Shift-boost, wheel-speed, damp
    ├── SettlerMeshBuilder.cs # statisch: BuildSettler() → settler met strohoed + PoseWalk(root,time,speed01)
    ├── PlayerAvatar.cs     # [GlobalClass] CharacterBody3D: capsule r=0.35/h=1.5; Walk/Run/Swim/Jump, crouch (C),
    │   │                   #   Swimming-state (buoyancy naar y=WaterSurfaceY); CollisionLayer=2, CollisionMask=1
    ├── ThirdPersonCamera.cs # [GlobalClass] Node3D: SpringArm3D (kerstbal r=0.25, CollisionMask=1) + Camera3D; RMB-look, wheel-zoom
    └── WalkModeManager.cs  # [GlobalClass] Node3D: Tab-switch tussen fly/walk; HeightMapShape3D-terreincollider,
                            #   FindGroundSpawn (dichtstbijzijnde landcel h≥0.35), avatar+camera opbouwen; rebuildt collider bij VillageDataLoaded
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
  - Wrap `Run()` in try/catch met `Quit(1)` erin: zonder `Quit` hangt een `--script`-runner eindeloos.

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
- ArrayMesh-arrays: gebruik standaard C# arrays (`Vector3[]`, `Color[]`, `int[]`), géén `PackedVector3Array` (die type bestaat niet in C#-API). `SurfaceGetArrayLength` bestaat niet → pak de array via `SurfaceGetArrays(0)` en check de Vertex-array-lengte.
- `HttpClient` is ambig tussen `Godot.HttpClient` en `System.Net.Http.HttpClient` → voeg `using HttpClient = System.Net.Http.HttpClient;` toe (ook in Tools-runners).
- village.json is partieel untyped: `districtsRev` kan een number zijn, `outpost` een object → maak `DistrictsRev` `[JsonConverter(FlexibleStringConverter)]` en `Outpost` type `object?` (polymorf, zoals `District`).
- **C# heeft geen `ConeMesh`** (ook niet in 4.7) → kegel maken als `CylinderMesh` met `TopRadius = 0`.
- **`Basis * Basis` compileert niet in Godot C#** (er is geen operator; de compiler zoekt dan foutief de Quaternion-overload). Basis-multiply (bovendien basisen): zelf samenstellen, bijv. per kolom zoals `PropSpawner.RotScale` (`M = Ryaw·Rtilt·S` berekend per basis-vector, want Basis is column-major).
- **MultiMesh readonly-na-gebruik:** bij rebuild eerst oude childs `RemoveChild`+`QueueFree` (niet `Free()` direct — nodes met instanties geven anders "Leaked instance dependency"-ruis); transforms vul je via `mm.InstanceCount = n; mm.SetInstanceTransform(i, tf)`.
- **`Environment` is ambigu** tussen `System.Environment` en `Godot.Environment` → volledige `Godot.Environment`-kwalificatie (in Main.cs). De C#-naamgeving van `Environment` is anders dan GDScript: `BackgroundMode`-enum is `BGMode`, tonemap-property is `TonemapMode` (enum `ToneMapper`, waarden Linear/Reinhardt/Filmic/Aces/Agx), en "sky contribution" zit in `AmbientLightSkyContribution` (er is géén `SkyContribution`).
- Headless-exit-warnings ("RID allocations leaked", "Pages in use exist at exit", ObjectDB leaks) zijn bekende teardown-ruis van de dummy-renderer en tellen niet als test-falen — let op `EXIT=0` en de `[OK]`-regels.

## Bekende Godot-4 valkuilen (nieuw)
- `SphereMesh` heeft **`radial_segments`** + `rings`, niet `segments` (Godot 3).
- `StandardMaterial3D`: gebruik `emission_enabled` / `emission` / `emission_energy`, **niet** `emissive_enabled` / `emissive` / `emissive_energy` — die geven remapping-warnings en zetten emission niet aan.
- Bij nieuwe `class_name`-scripts: eerst `--import` draaien, anders ziet `--script` de class niet.
- `verify_objects.gd` bouwt zelf, niet via `root.add_child(kit.build(...))` — `build()` retourneert een Dictionary, geen Node.
