using System;
using System.Collections.Generic;
using Godot;
using Promptholm.Buildings;
using Promptholm.Buildings.Data;
using Promptholm.Buildings.Slots;
using Promptholm.Data.Models;

namespace Promptholm.World;

[GlobalClass]
public partial class WorldManager : Node3D
{
	private Node3D? _groundRoot;
	private Node3D? _objectsRoot;
	private TerrainGenerator? _terrain;
	private WaterPlane? _waterPlane;
	private DistrictDecorator? _districtDecorator;
	private FarmlandSpawner? _farmlandSpawner;
	private PropSpawner? _propSpawner;
	private MeshInstance3D? _islandMesh;
	private Node3D? _roadRoot;
	private Node3D? _bridgeRoot;

	private readonly List<BuildingMarker> _buildingMarkers = new();
	private readonly HashSet<(int, int)> _buildingCells = new();

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

	public TerrainGenerator? Terrain => _terrain;

	public void BuildWorld(VillageData village)
	{
		EnsureRoots();

		uint seed = village.Island.Seed;
		int size = village.Grid.Size;

		GD.Print($"[WorldManager] Building world for seed {seed}, size {size}, "
			+ $"{village.Buildings.Count} buildings");

		_terrain = new TerrainGenerator(seed, size);
		BuildGroundMesh(_terrain);
		_waterPlane?.Build(_terrain);
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

			float gx = b.Plot.Gx;
			float gz = b.Plot.Gz;
			float pw = Math.Max(0.8f, b.Plot.W);
			float pd = Math.Max(0.8f, b.Plot.D);
			int rot = (int)b.Plot.Rot;

			float x = gx + pw * 0.5f - (float)_terrain.Half;
			float z = gz + pd * 0.5f - (float)_terrain.Half;
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

	// ---- terrain mesh -----------------------------------------------------------

	private void BuildGroundMesh(TerrainGenerator terrain)
	{
		if (_islandMesh is not null)
		{
			_groundRoot!.RemoveChild(_islandMesh);
			_islandMesh.QueueFree();
			_islandMesh = null;
		}

		int cols = terrain.N;
		int count = cols * cols;

		var verts = new Vector3[count];
		var normals = new Vector3[count];
		var colors = new Color[count];

		for (int j = 0; j < cols; j++)
		{
			for (int i = 0; i < cols; i++)
			{
				int idx = i + j * cols;
				float x = (float)(i - terrain.Half);
				float z = (float)(j - terrain.Half);
				float h = (float)terrain.H[idx];

				verts[idx] = new Vector3(x, h, z);

				// Surface normal from the heightfield gradient (central differences on the
				// 1.0 grid, one-sided at the rim) so hills catch directional light.
				float hL = (float)terrain.H[Math.Max(0, i - 1) + j * cols];
				float hR = (float)terrain.H[Math.Min(cols - 1, i + 1) + j * cols];
				float hU = (float)terrain.H[i + Math.Max(0, j - 1) * cols];
				float hD = (float)terrain.H[i + Math.Min(cols - 1, j + 1) * cols];
				float dhdx = (hR - hL) * 0.5f;
				float dhdz = (hD - hU) * 0.5f;
				normals[idx] = new Vector3(-dhdx, 1.0f, -dhdz).Normalized();

				Color col;
				if (h < 0.0f)
					col = new Color(0.25f, 0.41f, 0.48f);
				else if (h < 0.35f)
					col = new Color(0.88f, 0.82f, 0.65f);
				else if (h < 3.4f)
					col = new Color(0.57f, 0.75f, 0.38f);
				else
					col = new Color(0.5f, 0.5f, 0.5f);

				colors[idx] = col;
			}
		}

		int quads = cols - 1;
		var indices = new int[quads * quads * 6];
		int at = 0;
		for (int j = 0; j < quads; j++)
		{
			for (int i = 0; i < quads; i++)
			{
				int a = i + j * cols;
				int b = a + 1;
				int c = a + cols;
				int d = c + 1;

				indices[at++] = a;
				indices[at++] = b;
				indices[at++] = c;

				indices[at++] = b;
				indices[at++] = d;
				indices[at++] = c;
			}
		}

		var arrays = new Godot.Collections.Array();
		arrays.Resize((int)Mesh.ArrayType.Max);
		arrays[(int)Mesh.ArrayType.Vertex] = verts;
		arrays[(int)Mesh.ArrayType.Normal] = normals;
		arrays[(int)Mesh.ArrayType.Color] = colors;
		arrays[(int)Mesh.ArrayType.Index] = indices;

		var mesh = new ArrayMesh();
		mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);

		_islandMesh = new MeshInstance3D
		{
			Name = "IslandMesh",
			Mesh = mesh,
			MaterialOverride = GroundMaterial(),
		};
		_groundRoot!.AddChild(_islandMesh);
	}

	/// <summary>Vertex-colored grass/sand/rock material for the island surface.</summary>
	private static StandardMaterial3D GroundMaterial()
		=> new()
		{
			VertexColorUseAsAlbedo = true,
			Roughness = 0.85f,
			SpecularMode = BaseMaterial3D.SpecularModeEnum.Disabled,
		};

	// ---- roads & paved square ------------------------------------------------

	/// <summary>
	/// Cobblestone tiles for every path cell and every paved plaza cell, clumped one
	/// cell above the terrain (WorldHeight + 0.03) so the ribbon never z-fights with the
	/// ground. Drawn as a single MultiMesh over the cell-slab primitive.
	/// </summary>
	private void BuildRoads(TerrainGenerator terrain, VillageData village)
	{
		foreach (var child in _roadRoot!.GetChildren())
		{
			RemoveChild(child);
			child.QueueFree();
		}

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

	private void BuildBridges(TerrainGenerator terrain, VillageData village)
	{
		foreach (var child in _bridgeRoot!.GetChildren())
		{
			RemoveChild(child);
			child.QueueFree();
		}

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
	private Node3D? TryBuildBridge(TerrainGenerator terrain, BridgeData bridge)
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

		// Low wooden railings along both sides, enclosing the ends.
		var railMesh = new BoxMesh { Size = new Vector3(0.05f, RailingH, 0.05f) };
		railMesh.Material = RailingMat();
		float railY = DeckY + DeckH * 0.5f + RailingH * 0.5f;
		float side = DeckW * 0.5f;
		AddRailing(root, railMesh, alongX ? new Vector3(length, RailingH, 0.04f) : new Vector3(0.04f, RailingH, length),
			alongX ? new Vector3(0, railY, side) : new Vector3(side, railY, 0));
		AddRailing(root, railMesh, alongX ? new Vector3(length, RailingH, 0.04f) : new Vector3(0.04f, RailingH, length),
			alongX ? new Vector3(0, railY, -side) : new Vector3(-side, railY, 0));

		var railBox = new BoxMesh
		{
			Size = alongX ? new Vector3(0.04f, RailingH, DeckW) : new Vector3(DeckW, RailingH, 0.04f),
		};
		railBox.Material = RailingMat();
		AddRailing(root, railBox, railBox.Size, alongX ? new Vector3(-length * 0.5f, railY, 0) : new Vector3(0, railY, -length * 0.5f));
		AddRailing(root, railBox, railBox.Size, alongX ? new Vector3(length * 0.5f, railY, 0) : new Vector3(0, railY, length * 0.5f));

		// Stone footings on the banks under the deck corners; skipped when the bank is
		// already higher than the deck bottom.
		var footingMesh = new BoxMesh { Size = new Vector3(0.6f, 0.5f, 0.6f) };
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
				footingMesh.Size = new Vector3(0.6f, h, 0.6f);
				root.AddChild(new MeshInstance3D
				{
					Name = "Footing",
					Mesh = footingMesh,
					Position = new Vector3(cx, bankY + h * 0.5f, cz),
				});
			}
		}

		return root;
	}

	private static void AddRailing(Node3D root, BoxMesh mesh, Vector3 size, Vector3 pos)
	{
		var m = new BoxMesh
		{
			Size = size,
		};
		m.Material = RailingMat();
		root.AddChild(new MeshInstance3D { Name = "Railing", Mesh = m, Position = pos });
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
		=> new() { AlbedoColor = colour, Roughness = roughness };

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