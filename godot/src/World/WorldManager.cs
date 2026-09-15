using System;
using System.Collections.Generic;
using Godot;
using Promptholm.Buildings;
using Promptholm.Buildings.Data;
using Promptholm.Buildings.Slots;
using Promptholm.Data.Models;
using Promptholm.Visual;

namespace Promptholm.World;

[GlobalClass]
public partial class WorldManager : Node3D
{
	private Node3D? _groundRoot;
	private Node3D? _objectsRoot;
	private TerrainField? _terrain;
	private WaterPlane? _waterPlane;
	private Terrain3DBridge? _bridge;
	private DistrictDecorator? _districtDecorator;
	private FarmlandSpawner? _farmlandSpawner;
	private PropSpawner? _propSpawner;
	private CivicDecorator? _civicDecorator;
	private MeshInstance3D? _islandMesh;
	private Node3D? _roadRoot;
	private Node3D? _bridgeRoot;

	private readonly List<BuildingMarker> _buildingMarkers = new();
	private readonly HashSet<(int, int)> _buildingCells = new();

	/// <summary>Buildings are drawn at 65% of their plot, centred on the lot, so adjacent
	/// plots (gap 0 in the data) get a green margin instead of touching walls. Density
	/// relief without touching data; see AGENTS.md "Schaalsemantiek v1 vs v2".</summary>
	public const float FootprintScale = 0.65f;

	/// <summary>
	/// How far the tidal flats run out from the coastline before the bottom starts dropping.
	/// The island sits on a shelf like a Wadden island: a long stretch of barely-deepening sand
	/// first, then the fall to open water. A short falloff made it read as a plug of rock
	/// dropped into the sea.
	/// </summary>
	public const float SeabedFlatMetres = 150.0f;

	/// <summary>Depth the flats settle at; shallow enough to stay lit and coloured.</summary>
	public const float SeabedFlatY = -1.9f;

	/// <summary>Distance over which the bottom falls away once the flats end.</summary>
	public const float SeabedFalloffMetres = 110.0f;

	/// <summary>
	/// Outer radius of the rendered seabed. Past the falloff the rings grow geometrically, so
	/// reaching beyond the water plane costs very few vertices.
	/// </summary>
	public const float SeabedReachMetres = 1300.0f;

	/// <summary>Growth factor per ring outside the data grid; 1.0 would mean uniform 1 m spacing.</summary>
	public const float SeabedRingGrowth = 1.13f;

	/// <summary>Depth the apron levels off at.</summary>
	public const float SeabedFloorY = -30.0f;

	/// <summary>Depth below which ground colour starts darkening toward open-ocean floor.</summary>
	public const float SeabedShelfY = -3.0f;

	/// <summary>
	/// How far, in metres, noise pushes the shelf edge in and out. Large on purpose: real flats
	/// are broad on one flank and pinched on another, never a constant width.
	/// </summary>
	public const float SeabedShelfWarp = 55.0f;

	/// <summary>
	/// Height of the sandbanks on the flats. Tall enough that the crests actually break the
	/// waterline — below that they are just a ripple in the tint and you never see sand. The
	/// height band above zero already paints them with the beach colour.
	/// </summary>
	public const float SeabedBankHeight = 3.6f;

	/// <summary>Amplitude of the noise that breaks up the deep floor.</summary>
	public const float SeabedRelief = 2.5f;

	/// <summary>Logical handle for click/proximity selection of a placed building.</summary>
	public sealed record BuildingMarker(string Id, string Name, Vector2 Door, string Kind);

	public override void _Ready()
	{
		EnsureRoots();
	}

	private void EnsureRoots()
	{
		_groundRoot ??= new Node3D { Name = "GroundRoot" };
		_objectsRoot ??= new Node3D { Name = "ObjectsRoot" };
		if (_groundRoot.GetParent() is null)
			AddChild(_groundRoot);
		if (_objectsRoot.GetParent() is null)
			AddChild(_objectsRoot);

		if (_waterPlane is null)
		{
			_waterPlane = new WaterPlane { Name = "WaterPlane" };
			_groundRoot!.AddChild(_waterPlane);
		}
		if (_districtDecorator is null)
		{
			_districtDecorator = new DistrictDecorator { Name = "DistrictDecorator" };
			_objectsRoot!.AddChild(_districtDecorator);
		}
		if (_farmlandSpawner is null)
		{
			_farmlandSpawner = new FarmlandSpawner { Name = "FarmlandSpawner" };
			_objectsRoot!.AddChild(_farmlandSpawner);
		}
		if (_propSpawner is null)
		{
			_propSpawner = new PropSpawner { Name = "PropSpawner" };
			_objectsRoot.AddChild(_propSpawner);
		}
		if (_civicDecorator is null)
		{
			_civicDecorator = new CivicDecorator { Name = "CivicDecorator" };
			_objectsRoot!.AddChild(_civicDecorator);
		}

		if (_roadRoot is null)
		{
			_roadRoot = new Node3D { Name = "Roads" };
			_groundRoot!.AddChild(_roadRoot);
		}
		if (_bridgeRoot is null)
		{
			_bridgeRoot = new Node3D { Name = "Bridges" };
			_objectsRoot.AddChild(_bridgeRoot);
		}
	}

	public TerrainField? Terrain => _terrain;

	/// <summary>The Terrain3D bridge, or null when the extension is not loaded and the fallback
	/// chunk meshes are being drawn instead.</summary>
	public Terrain3DBridge? Bridge => _bridge;

	public void BuildWorld(VillageData village)
	{
		EnsureRoots();

		uint seed = village.Island.Seed;
		int size = village.Grid.Size;

		GD.Print($"[WorldManager] Building world for seed {seed}, size {size}, "
			+ $"{village.Buildings.Count} buildings");

		// The island comes from the server now. `res://world/` is the copy baked into the build;
		// when the client fetches a world over HTTP this is where that arrives instead.
		_terrain = TerrainField.LoadFromResources();
		_terrain.Size = size;                 // the layout grid the village is still expressed in
		if (_terrain.IslandSeed != seed)
		{
			GD.PushWarning(
				$"the published world is seed {_terrain.IslandSeed} but the village says {seed}; " +
				"the houses were laid out on a different island");
		}

		var terrainMeshRoot = _groundRoot!.GetNodeOrNull<Node3D>("Terrain");
		if (terrainMeshRoot is null)
		{
			terrainMeshRoot = new Node3D { Name = "Terrain" };
			_groundRoot.AddChild(terrainMeshRoot);
		}

		// Terrain3D when it is there, our own chunk meshes when it is not. The fallback is not
		// ceremony: the extension is a platform-specific binary, and a build without one for the
		// platform in hand should still show an island rather than an empty sea.
		var clock = Time.GetTicksMsec();
		_bridge = Terrain3DBridge.Build(terrainMeshRoot, _terrain);
		if (_bridge is not null)
		{
			GD.Print($"[WorldManager] terrain {_terrain.WorldRev}: Terrain3D, "
				+ $"{_bridge.RegionCount} regions in {Time.GetTicksMsec() - clock} ms");
		}
		else
		{
			var meshStats = TerrainMeshBuilder.BuildInto(terrainMeshRoot, _terrain, GroundMaterial());
			GD.Print($"[WorldManager] terrain {_terrain.WorldRev}: {meshStats.Chunks} chunk meshes, "
				+ $"{meshStats.Triangles:N0} tris in {meshStats.Milliseconds} ms");
		}

		_waterPlane?.Build();
		_districtDecorator?.DecorateDistricts(_terrain, village);
		var fieldCells = _farmlandSpawner?.SpawnFields(_terrain, village);
		_propSpawner?.SpawnProps(_terrain, village, fieldCells);
		BuildRoads(_terrain, village);
		BuildBridges(_terrain, village);

		ClearBuildings();
		_buildingMarkers.Clear();
		_buildingCells.Clear();

		foreach (var b in village.Buildings)
		{
			if (b.Plot is null)
				continue;

			// Fountain & market plots are owned by the CivicDecorator (visual only): their
			// cells still count as occupied, but no generic civic house is drawn on top.
			if (_civicDecorator is not null && CivicDecorator.Handles(b))
			{
				_buildingCells.UnionWith(PlotCells(b));
				continue;
			}

			float gx = b.Plot.Gx;
			float gz = b.Plot.Gz;
			// Footprint scaled down, but the plot anchors the centre: the building is centred
			// on the full lot and leaves a margin on all four sides.
			float pw = Math.Max(0.8f, b.Plot.W * FootprintScale);
			float pd = Math.Max(0.8f, b.Plot.D * FootprintScale);
			int rot = (int)b.Plot.Rot;

			float x = gx + b.Plot.W * 0.5f - (float)_terrain.Half;
			float z = gz + b.Plot.D * 0.5f - (float)_terrain.Half;
			float ground = (float)_terrain.WorldHeight(x, z);

			var buildingRoot = new Node3D
			{
				Name = $"Building_{b.Id}",
				Position = new Vector3(x, ground, z),
				Rotation = new Vector3(0, rot * MathF.PI / 2.0f, 0),
			};
			_objectsRoot!.AddChild(buildingRoot);

			AddBuildingCollider(buildingRoot, b, pw, pd);
			_buildingCells.UnionWith(PlotCells(b));
			_buildingMarkers.Add(BuildMarker(buildingRoot, b, pw, pd));

			var assembler = new BuildingAssembler { Name = "BuildingAssembler" };
			buildingRoot.AddChild(assembler);

			var tier = string.IsNullOrWhiteSpace(b.Tier) ? b.Kind : b.Tier;
			var style = string.IsNullOrWhiteSpace(b.Style) ? tier : b.Style;

			BuildSlots(assembler, b, pw, pd);
			var catalog = BuildCatalog(b, pw, pd);
			assembler.Catalog = catalog;
			assembler.Assemble(style, tier, OrnamentIds(b));
		}

		_civicDecorator?.BuildCivics(_terrain, village);

		GD.Print("[WorldManager] World build complete.");
	}

	/// <summary>Static body + plot-sized box on the building layer so clicks and the settler find it.</summary>
	private static void AddBuildingCollider(Node3D root, BuildingData b, float w, float d)
	{
		var body = new StaticBody3D
		{
			Name = "BuildingCollider",
			CollisionLayer = 4,
			CollisionMask = 0,
		};
		body.SetMeta("building_id", b.Id);
		body.SetMeta("building_kind", string.IsNullOrWhiteSpace(b.Kind) ? "house" : b.Kind);
		body.AddChild(new CollisionShape3D
		{
			Name = "Collision",
			Shape = new BoxShape3D { Size = new Vector3(w, 2.0f, d) },
			Position = new Vector3(0.0f, 1.0f, 0.0f),
		});
		root.AddChild(body);
	}

	private static IEnumerable<(int, int)> PlotCells(BuildingData b)
	{
		int w = Math.Max(1, b.Plot.W);
		int d = Math.Max(1, b.Plot.D);
		for (int cx = 0; cx < w; cx++)
			for (int cz = 0; cz < d; cz++)
				yield return (b.Plot.Gx + cx, b.Plot.Gz + cz);
	}

	/// <summary>
	/// World-space interaction point: the door on the front wall (relative to the building's
	/// yaw), so the settler stands in front of the entrance rather than at the plot centre.
	/// </summary>
	private static BuildingMarker BuildMarker(Node3D root, BuildingData b, float w, float d)
	{
		var doorLocal = new Vector3(0.0f, 0.0f, -d * 0.5f + 0.12f);
		var doorWorld = root.GlobalTransform * doorLocal;
		return new BuildingMarker(b.Id, BuildingDisplayName(b), new Vector2(doorWorld.X, doorWorld.Z), b.Kind);
	}

	private static string BuildingDisplayName(BuildingData b)
	{
		if (!string.IsNullOrWhiteSpace(b.Name)) return b.Name!;
		if (!string.IsNullOrWhiteSpace(b.Label)) return b.Label!;
		return string.IsNullOrWhiteSpace(b.Id) ? "Unknown" : b.Id;
	}

	private static string[] OrnamentIds(BuildingData b)
	{
		if (b.Ornaments is null || b.Ornaments.Count == 0)
			return [];
		var ids = new List<string>();
		foreach (var o in b.Ornaments)
		{
			var s = o?.ToString();
			if (!string.IsNullOrWhiteSpace(s) && !ids.Contains(s))
				ids.Add(s);
		}
		return ids.ToArray();
	}

	/// <summary>Frees previously placed buildings while keeping non-building children (PropSpawner).</summary>
	private void ClearBuildings()
	{
		foreach (var child in _objectsRoot!.GetChildren())
		{
			if (child.Name.ToString().StartsWith("Building_", StringComparison.Ordinal))
				child.QueueFree();
		}
	}

	/// <summary>True when the grid cell falls inside a building's plot (used for spawn avoidance).</summary>
	public bool IsBuildingCell(int gx, int gz)
		=> _buildingCells.Contains((gx, gz));

	/// <summary>
	/// The building whose door (or origin) is closest to <paramref name="worldPos"/>, provided it
	/// is within <paramref name="maxDistance"/>. Returns null when nobody is within reach.
	/// </summary>
	public BuildingMarker? NearestDossier(Vector3 worldPos, float maxDistance)
	{
		BuildingMarker? best = null;
		float bestDist = maxDistance;
		foreach (var m in _buildingMarkers)
		{
			float dx = worldPos.X - m.Door.X;
			float dz = worldPos.Z - m.Door.Y;
			float dist = Mathf.Sqrt(dx * dx + dz * dz);
			if (dist <= bestDist)
			{
				bestDist = dist;
				best = m;
			}
		}
		return best;
	}

	// ---- modular assembly -------------------------------------------------------

	private static void BuildSlots(BuildingAssembler assembler, BuildingData b, float w, float d)
	{
		float h = 2.0f;
		float t = 0.12f;

		assembler.AddChild(MkSlot("Foundation", SlotType.Foundation, new Vector3(0, 0.12f, 0), Math.Max(w, d)));
		assembler.AddChild(MkSlot("WallFront", SlotType.Wall, new Vector3(0, h * 0.5f, -d * 0.5f), w, 0f));
		assembler.AddChild(MkSlot("WallBack", SlotType.Wall, new Vector3(0, h * 0.5f, d * 0.5f), w, MathF.PI));
		assembler.AddChild(MkSlot("WallLeft", SlotType.Wall, new Vector3(-w * 0.5f, h * 0.5f, 0), d, MathF.PI * 0.5f));
		assembler.AddChild(MkSlot("WallRight", SlotType.Wall, new Vector3(w * 0.5f, h * 0.5f, 0), d, -MathF.PI * 0.5f));
		assembler.AddChild(MkSlot("Roof", SlotType.Roof, new Vector3(0, h, 0), Math.Max(w, d)));
		assembler.AddChild(MkSlot("Door", SlotType.Door, new Vector3(0, 0.7f, -d * 0.5f + t), 0.9f));
		assembler.AddChild(MkSlot("WindowLeft", SlotType.Window, new Vector3(-w * 0.25f, 1.3f, -d * 0.5f + t), 0.7f));
		assembler.AddChild(MkSlot("WindowRight", SlotType.Window, new Vector3(w * 0.25f, 1.3f, -d * 0.5f + t), 0.7f));

		if (b.Kind == "civic")
			assembler.AddChild(MkSlot("Sign", SlotType.Sign, new Vector3(0, 1.75f, -d * 0.5f + t), 0.9f));

		assembler.AddChild(MkSlot("Ornament", SlotType.Ornament, new Vector3(0, h + 0.35f, 0), 0.5f));
	}

	private static BuildingSlot3D MkSlot(string name, SlotType type, Vector3 pos, float size, float rotY = 0f)
	{
		return new BuildingSlot3D
		{
			Name = name,
			Type = type,
			ClearanceRadius = Math.Max(size, 0.5f),
			Position = pos,
			Rotation = new Vector3(0, rotY, 0),
		};
	}

	private static BuildingPieceResource[] BuildCatalog(BuildingData b, float w, float d)
	{
		var style = string.IsNullOrWhiteSpace(b.Style) ? b.Tier : b.Style;
		bool isStone = string.Equals(style, "opus", StringComparison.OrdinalIgnoreCase);
		bool isThatch = string.Equals(style, "haiku", StringComparison.OrdinalIgnoreCase);
		const float wallH = 2.0f;

		var list = new List<BuildingPieceResource>
		{
			Piece(SlotType.Foundation, "foundation", BuildingCatalog.MakeFoundationStone(w, d)),
			Piece(SlotType.Wall, "wall_front_back",
				isStone ? BuildingCatalog.MakeWallStone(w, wallH, 0.12f)
				        : BuildingCatalog.MakeWallTimber(w, wallH, 0.12f)),
			Piece(SlotType.Wall, "wall_sides",
				isStone ? BuildingCatalog.MakeWallStone(d, wallH, 0.12f)
				        : BuildingCatalog.MakeWallTimber(d, wallH, 0.12f)),
			Piece(SlotType.Roof, "roof",
				isThatch ? BuildingCatalog.MakeRoofThatch(w, d)
				         : BuildingCatalog.MakeRoofGableTiles(w, d)),
			Piece(SlotType.Door, "door", BuildingCatalog.MakeDoorWood()),
			Piece(SlotType.Window, "window", BuildingCatalog.MakeWindowFrame()),
			Piece(SlotType.Sign, "sign", MkGoldSign()),
		};

		if (b.Ornaments != null)
		{
			foreach (var o in b.Ornaments)
			{
				var s = o?.ToString();
				if (string.IsNullOrWhiteSpace(s))
					continue;
				var node = string.Equals(s, "forge", StringComparison.OrdinalIgnoreCase)
					? BuildingCatalog.MakeOrnamentForge()
					: BuildingCatalog.MakeOrnamentWeathervane();
				list.Add(Piece(SlotType.Ornament, s, node));
			}
		}

		return list.ToArray();
	}

	private static Node3D MkGoldSign()
	{
		var sign = new BoxMesh { Size = new Vector3(0.9f, 0.35f, 0.06f) };
		sign.Material = new StandardMaterial3D
		{
			AlbedoColor = new Color(0.85f, 0.72f, 0.35f),
			Roughness = 0.6f,
			Metallic = 0.3f,
		};
		var root = new Node3D();
		root.AddChild(new MeshInstance3D { Mesh = sign });
		return root;
	}

	private static BuildingPieceResource Piece(SlotType slot, string id, Node3D node)
	{
		return new BuildingPieceResource
		{
			PieceId = id,
			MeshNode = node,
			TargetSlot = slot,
			TierRequirement = 0,
			ModelStyle = string.Empty,
		};
	}

	/// <summary>
	/// Detaches and frees every child of <paramref name="parent"/>. Both callers used to call
	/// RemoveChild on the WorldManager itself while iterating a root's children, which Godot
	/// rejects once per child on the second BuildWorld (the first build finds the roots empty,
	/// so it went unnoticed). CivicDecorator.ClearDecos already did this correctly.
	/// </summary>
	private static void ClearChildren(Node parent)
	{
		foreach (var child in parent.GetChildren())
		{
			parent.RemoveChild(child);
			child.QueueFree();
		}
	}

	// ---- terrain ----------------------------------------------------------------
	//
	// The ground is no longer built here. The server bakes the island once and publishes it as
	// chunks; TerrainMeshBuilder turns those into one mesh each. What used to live in this space
	// - a chamfer distance field, a geometrically growing axis out to 1300 m, a seabed apron
	// invented on the client - was all machinery for hiding the fact that the island was a 64 m
	// square with nothing around it. There is a real seabed now, so none of it is needed.

	/// <summary>
	/// Painterly ground shader. The vertex colours stay as the biome the generator chose, and
	/// the shader breaks them up with noise, adds slope-driven rock and quantises the shading.
	/// A plain vertex-colour material left the island as one flat green over most of the frame.
	/// </summary>
	private static ShaderMaterial GroundMaterial()
	{
		_groundMaterial ??= new ShaderMaterial
		{
			Shader = GD.Load<Shader>("res://shaders/stylized_terrain.gdshader"),
		};

		// Set explicitly rather than leaning on the shader's defaults: the scales are the one
		// thing that has to track the island's size, so they belong next to the world that is
		// being built. At 64 m across, 0.11 gives patches of roughly 9 m.
		_groundMaterial.SetShaderParameter("macro_noise", TerrainNoise(0.9f, 1337));
		_groundMaterial.SetShaderParameter("detail_noise", TerrainNoise(2.4f, 91));

		// World metres per noise-texture tile. 0.035 makes one tile span about 28 m, so the
		// patchiness reads as terrain character; the detail layer tiles every ~3 m for grain.
		_groundMaterial.SetShaderParameter("macro_scale", 0.035f);
		_groundMaterial.SetShaderParameter("detail_scale", 0.33f);
		_groundMaterial.SetShaderParameter("macro_amount", 0.80f);
		_groundMaterial.SetShaderParameter("detail_amount", 0.16f);

		// Two greens far enough apart to read as different ground, not as one colour with a
		// gradient on it: a cool meadow and a dry, sun-bleached olive.
		_groundMaterial.SetShaderParameter("lush_colour", new Color(0.19f, 0.46f, 0.20f));
		_groundMaterial.SetShaderParameter("dry_colour", new Color(0.62f, 0.60f, 0.28f));
		_groundMaterial.SetShaderParameter("rock_colour", new Color(0.38f, 0.36f, 0.33f));

		return _groundMaterial;
	}

	private static ShaderMaterial? _groundMaterial;

	/// <summary>Seamless fBm tile for the ground shader's colour variation.</summary>
	private static NoiseTexture2D TerrainNoise(float frequency, int seed) => new()
	{
		Noise = new FastNoiseLite
		{
			NoiseType = FastNoiseLite.NoiseTypeEnum.SimplexSmooth,
			Frequency = frequency / 64.0f,
			FractalOctaves = 4,
			Seed = seed,
		},
		Width = 256,
		Height = 256,
		Seamless = true,
		GenerateMipmaps = true,
	};

	// ---- roads & paved square ------------------------------------------------

	/// <summary>
	/// Cobblestone tiles for every path cell and every paved plaza cell, clumped one
	/// cell above the terrain (WorldHeight + 0.03) so the ribbon never z-fights with the
	/// ground. Drawn as a single MultiMesh over the cell-slab primitive.
	/// </summary>
	private void BuildRoads(TerrainField terrain, VillageData village)
	{
		ClearChildren(_roadRoot!);

		var tiles = new List<Transform3D>();

		void AddCell(int gx, int gz, float lift)
		{
			var (wx, wz) = terrain.CellWorld(gx, gz);
			float y = (float)terrain.WorldHeight(wx, wz) + lift;
			tiles.Add(new Transform3D(Basis.Identity, new Vector3((float)wx, y, (float)wz)));
		}

		foreach (var path in village.Paths)
		{
			foreach (var cell in path.Cells)
			{
				if (cell.Count >= 2)
					AddCell(cell[0], cell[1], 0.03f);
			}
		}

		if (village.Island.Town?.Paved is not null)
		{
			foreach (var cell in village.Island.Town.Paved)
			{
				if (cell.Count >= 2)
					AddCell(cell[0], cell[1], 0.03f);
			}
		}

		var slab = new BoxMesh { Size = new Vector3(1.0f, 0.06f, 1.0f) };
		slab.Material = CobbleMat();
		var mmi = NewMulti(slab);
		_roadRoot.AddChild(mmi);
		FillMulti(mmi, tiles);

		GD.Print($"[WorldManager] {tiles.Count} cobblestone tiles");
	}

	// ---- bridges -------------------------------------------------------------

	private void BuildBridges(TerrainField terrain, VillageData village)
	{
		ClearChildren(_bridgeRoot!);

		int n = 0;
		foreach (var bridge in village.Bridges)
		{
			var deck = TryBuildBridge(terrain, bridge);
			if (deck is null)
				continue;
			deck.Name = $"Bridge_{bridge.Id}";
			_bridgeRoot.AddChild(deck);
			n++;
		}

		GD.Print($"[WorldManager] built {n} bridges");
	}

	/// <summary>
	/// Wooden deck over a straight run of river cells, floated at DeckY well above the
	/// waterline. Railings run along both long edges; short footings prop the deck ends
	/// on the banks. The span under the deck stays empty, so swimmers pass clean through.
	/// </summary>
	private Node3D? TryBuildBridge(TerrainField terrain, BridgeData bridge)
	{
		if (bridge.Cells.Count < 2)
			return null;

		int gxMin = int.MaxValue, gxMax = int.MinValue;
		int gzMin = int.MaxValue, gzMax = int.MinValue;
		foreach (var c in bridge.Cells)
		{
			if (c.Count < 2)
				return null;
			gxMin = Math.Min(gxMin, c[0]);
			gxMax = Math.Max(gxMax, c[0]);
			gzMin = Math.Min(gzMin, c[1]);
			gzMax = Math.Max(gzMax, c[1]);
		}

		// Axis is stored as "x"/"z"; fall back to whichever axis the cells actually run along.
		bool alongX = bridge.Axis switch
		{
			"z" => false,
			"x" => true,
			_ => gxMax - gxMin >= gzMax - gzMin,
		};

		float half = (float)terrain.Half;
		float start, end, constW;
		if (alongX)
		{
			start = gxMin + 0.5f - half;
			end = gxMax + 0.5f - half;
			constW = (gzMin + gzMax) * 0.5f + 0.5f - half;
		}
		else
		{
			start = gzMin + 0.5f - half;
			end = gzMax + 0.5f - half;
			constW = (gxMin + gxMax) * 0.5f + 0.5f - half;
		}

		float length = Math.Max(1.0f, Math.Abs(end - start) + 1.0f);
		float mid = (start + end) * 0.5f;

		const float DeckY = 0.7f;
		const float DeckH = 0.14f;
		const float DeckW = 2.4f;
		const float RailingH = 0.4f;

		var deckBox = new BoxMesh
		{
			Size = alongX ? new Vector3(length, DeckH, DeckW) : new Vector3(DeckW, DeckH, length),
		};
		deckBox.Material = PlankMat();

		var root = new Node3D();
		root.AddChild(new MeshInstance3D
		{
			Name = "Deck",
			Mesh = deckBox,
			Position = alongX ? new Vector3(mid, DeckY, constW) : new Vector3(constW, DeckY, mid),
		});

		// Low wooden railings along both sides, enclosing the ends. AddRailing builds its own
		// box from the size, so the two BoxMesh objects that used to be created and handed in
		// here were pure waste — one of them did not even carry the size it was passed with.
		float railY = DeckY + DeckH * 0.5f + RailingH * 0.5f;
		float side = DeckW * 0.5f;

		var sideSize = alongX ? new Vector3(length, RailingH, 0.04f) : new Vector3(0.04f, RailingH, length);
		AddRailing(root, sideSize, alongX ? new Vector3(0, railY, side) : new Vector3(side, railY, 0));
		AddRailing(root, sideSize, alongX ? new Vector3(0, railY, -side) : new Vector3(-side, railY, 0));

		var endSize = alongX ? new Vector3(0.04f, RailingH, DeckW) : new Vector3(DeckW, RailingH, 0.04f);
		AddRailing(root, endSize, alongX ? new Vector3(-length * 0.5f, railY, 0) : new Vector3(0, railY, -length * 0.5f));
		AddRailing(root, endSize, alongX ? new Vector3(length * 0.5f, railY, 0) : new Vector3(0, railY, length * 0.5f));

		// Stone footings on the banks under the deck corners; skipped when the bank is
		// already higher than the deck bottom.
		// A unit box scaled per instance. Sharing one BoxMesh and reassigning its Size inside
		// the loop meant every footing already added pointed at the same resource, so they all
		// ended up with the height of whichever one was computed last.
		var footingMesh = new BoxMesh { Size = Vector3.One };
		footingMesh.Material = StoneMat();
		float deckBottom = DeckY - DeckH * 0.5f;
		foreach (var edge in new[] { start, end })
		{
			foreach (var off in new[] { -side, side })
			{
				float cx = alongX ? edge : constW + off;
				float cz = alongX ? constW + off : edge;
				float bankY = (float)terrain.WorldHeight((double)cx, (double)cz);
				float h = deckBottom - bankY;
				if (h <= 0.02f)
					continue;
				root.AddChild(new MeshInstance3D
				{
					Name = "Footing",
					Mesh = footingMesh,
					Transform = new Transform3D(
						Basis.FromScale(new Vector3(0.6f, h, 0.6f)),
						new Vector3(cx, bankY + h * 0.5f, cz)),
				});
			}
		}

		return root;
	}

	private static void AddRailing(Node3D root, Vector3 size, Vector3 pos)
	{
		var mesh = new BoxMesh { Size = size };
		mesh.Material = RailingMat();
		root.AddChild(new MeshInstance3D { Name = "Railing", Mesh = mesh, Position = pos });
	}

	// ---- shared materials ----------------------------------------------------

	private static readonly StandardMaterial3D _plankMat =
		SolidMat(new Color(0.45f, 0.30f, 0.18f));

	private static readonly StandardMaterial3D _railingMat =
		SolidMat(new Color(0.38f, 0.25f, 0.15f));

	private static readonly StandardMaterial3D _stoneMat =
		SolidMat(new Color(0.52f, 0.52f, 0.54f));

	private static StandardMaterial3D? _cobbleMat;

	private static StandardMaterial3D PlankMat() => _plankMat;
	private static StandardMaterial3D RailingMat() => _railingMat;
	private static StandardMaterial3D StoneMat() => _stoneMat;

	private static StandardMaterial3D CobbleMat()
		=> _cobbleMat ??= new StandardMaterial3D
		{
			AlbedoColor = new Color(0.44f, 0.46f, 0.50f),
			Roughness = 0.85f,
			SpecularMode = BaseMaterial3D.SpecularModeEnum.Disabled,
		};

	private static StandardMaterial3D SolidMat(Color colour, float roughness = 0.82f)
		=> Palette.Solid(colour, roughness);

	// ---- MultiMesh helpers ---------------------------------------------------

	private static MultiMeshInstance3D NewMulti(Mesh mesh)
	{
		var mm = new MultiMesh
		{
			Mesh = mesh,
			TransformFormat = MultiMesh.TransformFormatEnum.Transform3D,
		};
		return new MultiMeshInstance3D { Multimesh = mm };
	}

	private static void FillMulti(MultiMeshInstance3D mmi, List<Transform3D> transforms)
	{
		var mm = mmi.Multimesh!;
		mm.InstanceCount = transforms.Count;
		for (int i = 0; i < transforms.Count; i++)
			mm.SetInstanceTransform(i, transforms[i]);
	}
}