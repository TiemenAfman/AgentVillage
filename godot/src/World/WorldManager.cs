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
	private FoliageSpawner? _foliage;

	private readonly List<BuildingMarker> _buildingMarkers = new();
	private readonly HashSet<(int, int)> _buildingCells = new();
	private readonly List<IReadOnlyList<(int Gx, int Gz)>> _pathRuns = new();
	private readonly HashSet<(int, int)> _bridgeCells = new();

	/// <summary>
	/// Buildings are drawn at this fraction of their plot, centred on it, so adjacent plots
	/// get a garden instead of touching walls.
	///
	/// It was 0.65, chosen when a 3x3 plot was three metres across and 65% of it was a shed.
	/// On lots of four metres the same fraction makes a house nearly eight metres wide - a barn
	/// standing over a path a metre and a half wide, which is what the village looked like. At
	/// 0.42 a house is five metres on a twelve-metre plot: a cottage with a garden round it,
	/// which is the shape the layout has always been describing.
	/// </summary>
	public const float FootprintScale = 0.42f;

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

	/// <summary>
	/// The village paths split into continuous runs of lots, as handed to the paving painter.
	/// Published because the paths are no longer geometry anyone can read back: they are a
	/// texture in the Terrain3D control map, so whatever wants to follow a road - the street
	/// lamps, next whatever else - has to follow this list instead of the scene tree.
	/// </summary>
	public IReadOnlyList<IReadOnlyList<(int Gx, int Gz)>> PathRuns => _pathRuns;

	/// <summary>True when the grid cell is spanned by a bridge deck, so nothing should be
	/// planted on it: it is a plank over water, not ground.</summary>
	public bool IsBridgeCell(int gx, int gz) => _bridgeCells.Contains((gx, gz));

	/// <summary>The Terrain3D bridge, or null when the extension is not loaded and the fallback
	/// chunk meshes are being drawn instead.</summary>
	public Terrain3DBridge? Bridge => _bridge;

	/// <summary>The last scatter of ground vegetation, kept so the metrics runner can report what
	/// it placed and where. Null when there is no Terrain3D to instance into.</summary>
	public FoliageSpawner? Foliage => _foliage;

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
		_terrain.Size = size;                 // the layout grid, in lots
		// Never assume four. The server says what a lot is worth and this is the only place
		// that reads it; a client that guessed would put the whole village at the wrong scale
		// on the right island, which is exactly what a sunken town looks like.
		if (village.Island.MetresPerLot > 0) _terrain.MetresPerLot = village.Island.MetresPerLot;

		// How far the eye has to carry, so the fog is tuned for this world and not for the
		// 64 m one the palette was authored on. Only WorldPreviewRunner used to set this, which
		// meant the preview looked right and the game itself - and every screenshot of it - put
		// a 400 m island behind the haze of a 60 m one, washed out to nearly white.
		//
		// Twice the envelope, not the 1.2x the preview used: the far shot stands 430 m out and
		// at 1.2x the island still read through a veil. This whole correction is empirical and
		// says so in EnvironmentFactory; it wants re-tuning against the screenshot matrix rather
		// than another multiplier.
		Atmosphere.EnvironmentFactory.DepthReachM = (float)(_terrain.Manifest.EnvelopeM * 2.0);
		// And the sky with it. 32 m is the half-grid the atmosphere was authored against.
		Atmosphere.CloudManager.WorldScale = MathF.Max(1.0f, _terrain.Manifest.RadiusM / 32.0f);
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

		// Stone, scattered from the class byte the server publishes rather than from a second
		// opinion invented here. Needs Terrain3D: the instancer is what buys the levels of detail
		// and the culling, and a few hundred rock meshes without either is not worth drawing.
		if (_bridge is not null)
			new RockSpawner().Spawn(_bridge, _terrain, village);
		BuildRoads(_terrain, village);
		BuildBridges(_terrain, village);

		// And the ground cover over the rocks, from the same class byte - but only after the roads,
		// which is not a preference. The paving is painted into the terrain by BuildRoads and the
		// scatter asks the bridge which samples that covered; run first, it would be told there is
		// no paving anywhere and would sow grass down the middle of the high street.
		if (_bridge is not null)
		{
			_foliage = new FoliageSpawner();
			_foliage.Spawn(_bridge, _terrain, village);
		}

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
			float pw = Math.Max(0.8f, _terrain.Span(b.Plot.W) * FootprintScale);
			float pd = Math.Max(0.8f, _terrain.Span(b.Plot.D) * FootprintScale);
			int rot = (int)b.Plot.Rot;

			var (cornerX, cornerZ) = _terrain.CellCorner((int)gx, (int)gz);
			float x = (float)cornerX + _terrain.Span(b.Plot.W * 0.5);
			float z = (float)cornerZ + _terrain.Span(b.Plot.D * 0.5);
			// The lowest ground under the whole footprint, not the height at its centre: a plot is
			// six metres across and six metres of this hillside drops over a metre, so a building
			// pinned to its centre hangs a corner in the air downhill. `Drop` is what the
			// foundation skirt then has to reach down to cover.
			float rotY = rot * MathF.PI / 2.0f;
			var fit = GroundFit.Sample(_terrain, x, z, pw, pd, rotY);
			float ground = fit.Min;

			var buildingRoot = new Node3D
			{
				Name = $"Building_{b.Id}",
				Position = new Vector3(x, ground, z),
				Rotation = new Vector3(0, rotY, 0),
			};
			_objectsRoot!.AddChild(buildingRoot);

			AddBuildingCollider(buildingRoot, b, pw, pd);
			_buildingCells.UnionWith(PlotCells(b));
			_buildingMarkers.Add(BuildMarker(buildingRoot, b, pw, pd));

			var assembler = new BuildingAssembler { Name = "BuildingAssembler" };
			buildingRoot.AddChild(assembler);

			var tier = string.IsNullOrWhiteSpace(b.Tier) ? b.Kind : b.Tier;
			var style = string.IsNullOrWhiteSpace(b.Style) ? tier : b.Style;

			// The slots and the catalog have to agree on how tall this building is, so the form is
			// resolved once by BuildSlots and handed on rather than worked out twice.
			var form = BuildSlots(assembler, b, pw, pd);
			assembler.Catalog = BuildCatalog(b, form, pw, pd, fit.Drop);
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
		// As tall as the building it stands for: the box used to be a fixed 2 m, so a click on a
		// tower or a keep above head height missed it. BuildingForm is deterministic from the id,
		// so this is the same silhouette the assembler builds.
		float h = Mathf.Max(2.0f, BuildingForm.For(b, w, d).RidgeY);
		body.AddChild(new CollisionShape3D
		{
			Name = "Collision",
			Shape = new BoxShape3D { Size = new Vector3(w, h, d) },
			Position = new Vector3(0.0f, h * 0.5f, 0.0f),
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

	/// <summary>
	/// Hangs the slots this building needs and returns the form they were laid out for.
	///
	/// The positions used to be constants — walls at y=1, roof at y=2, windows at y=1.3 — which
	/// is why a tent and a keep were the same object with different names. They come off
	/// <see cref="BuildingForm"/> now, so a canvas A-frame gets low walls and no windows and a
	/// clock tower gets one shaft instead of four walls. What has not moved is where the building
	/// stands or how wide it is: that is the server's, and <paramref name="w"/> and
	/// <paramref name="d"/> arrive already decided.
	/// </summary>
	private static BuildingForm BuildSlots(BuildingAssembler assembler, BuildingData b, float w, float d)
	{
		var form = BuildingForm.For(b, w, d);
		float wallH = form.WallHeight;
		float t = 0.12f;
		float front = -d * 0.5f + t;
		float span = Math.Max(w, d);

		assembler.AddChild(MkSlot("Foundation", SlotType.Foundation, new Vector3(0, 0.12f, 0), span));

		if (form.IsTower)
		{
			// One shaft where a house has four walls. Its slot sits on the ground rather than at
			// mid-height, because a tower is built upward from its base and the taper is measured
			// from there.
			assembler.AddChild(MkSlot("Shaft", SlotType.Wall, Vector3.Zero, span));
		}
		else
		{
			assembler.AddChild(MkSlot("WallFront", SlotType.Wall, new Vector3(0, wallH * 0.5f, -d * 0.5f), w, 0f));
			assembler.AddChild(MkSlot("WallBack", SlotType.Wall, new Vector3(0, wallH * 0.5f, d * 0.5f), w, MathF.PI));
			assembler.AddChild(MkSlot("WallLeft", SlotType.Wall, new Vector3(-w * 0.5f, wallH * 0.5f, 0), d, MathF.PI * 0.5f));
			assembler.AddChild(MkSlot("WallRight", SlotType.Wall, new Vector3(w * 0.5f, wallH * 0.5f, 0), d, -MathF.PI * 0.5f));
		}

		assembler.AddChild(MkSlot("Roof", SlotType.Roof, new Vector3(0, wallH, 0), span));
		assembler.AddChild(MkSlot("Door", SlotType.Door,
			new Vector3(0, form.DoorHeight * 0.5f, form.IsTower ? ShaftFace(form, w, d, form.DoorHeight * 0.5f) : front), 0.9f));

		// Walls too low to carry a window get none. A tent with a sash in the gutter was the sort
		// of thing only a screenshot catches.
		if (form.HasWindows)
		{
			if (form.IsTower)
			{
				float lo = wallH * 0.42f, hi = wallH * 0.72f;
				assembler.AddChild(MkSlot("WindowLeft", SlotType.Window, new Vector3(0, lo, ShaftFace(form, w, d, lo)), 0.7f));
				assembler.AddChild(MkSlot("WindowRight", SlotType.Window, new Vector3(0, hi, ShaftFace(form, w, d, hi)), 0.7f));
			}
			else
			{
				float y = Math.Clamp(wallH * 0.62f, 0.75f, wallH - 0.48f);
				assembler.AddChild(MkSlot("WindowLeft", SlotType.Window, new Vector3(-w * 0.25f, y, front), 0.7f));
				assembler.AddChild(MkSlot("WindowRight", SlotType.Window, new Vector3(w * 0.25f, y, front), 0.7f));
			}
		}

		if (b.Kind == "civic")
		{
			float y = Math.Clamp(wallH - 0.34f, 0.55f, 2.4f);
			assembler.AddChild(MkSlot("Sign", SlotType.Sign,
				new Vector3(0, y, form.IsTower ? ShaftFace(form, w, d, y) : front), 0.9f));
		}

		assembler.AddChild(MkSlot("Ornament", SlotType.Ornament, new Vector3(0, form.RidgeY, 0), 0.5f));
		return form;
	}

	/// <summary>
	/// Z of the tower's front face at height <paramref name="y"/>. The shaft is an octagon yawed
	/// by half a facet so a flat side faces the door instead of a corner, and it tapers, so the
	/// face creeps inward as it climbs; hanging a door on the untapered radius leaves it floating.
	/// </summary>
	private static float ShaftFace(BuildingForm form, float w, float d, float y)
	{
		float radius = MathF.Min(w, d) * 0.5f;
		float t = Math.Clamp(y / MathF.Max(form.WallHeight, 0.01f), 0.0f, 1.0f);
		return -Mathf.Lerp(radius, radius * form.TaperTop, t) * 0.9239f + 0.06f;
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

	/// <summary>
	/// One piece per slot type, each already merged into a single mesh by
	/// <see cref="BuildingMassing"/>.
	///
	/// The roof's piece id comes from the form, which is what a hand-made prefab has to be named
	/// to take the slot: <c>roof_townhall_cupola</c> claims exactly one building, <c>roof_gable</c>
	/// would claim every gable on the island at once. See <c>PrefabOverrides</c>.
	/// </summary>
	private static BuildingPieceResource[] BuildCatalog(BuildingData b, BuildingForm form, float w, float d, float skirt)
	{
		// All four wall slots draw the same piece — BuildingAssembler.SelectPiece matches on slot
		// *type*, and there is one Wall type. Every plot the server publishes is square, so one
		// span is the right span; sizing on the longer of the two keeps the corners closed rather
		// than gapped should that ever stop being true.
		float wallSpan = MathF.Max(w, d);

		var list = new List<BuildingPieceResource>
		{
			Piece(SlotType.Foundation, "foundation", BuildingMassing.MakeFoundation(form, w, d, skirt)),
			Piece(SlotType.Wall, form.IsTower ? "tower_shaft" : "wall",
				form.IsTower
					? BuildingMassing.MakeTowerShaft(form, w, d)
					: BuildingMassing.MakeWall(form, wallSpan, form.WallHeight)),
			Piece(SlotType.Roof, form.RoofPieceId, BuildingMassing.MakeRoof(form, w, d)),
			Piece(SlotType.Door, "door", BuildingMassing.MakeDoor(form)),
			Piece(SlotType.Window, "window", BuildingMassing.MakeWindow(form)),
			Piece(SlotType.Sign, "sign", BuildingMassing.MakeSign(form)),
		};

		if (b.Ornaments != null)
		{
			foreach (var o in b.Ornaments)
			{
				var s = o?.ToString();
				if (string.IsNullOrWhiteSpace(s))
					continue;
				list.Add(Piece(SlotType.Ornament, s, BuildingMassing.MakeOrnament(form, s)));
			}
		}

		return list.ToArray();
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
	/// The paving, painted into the terrain rather than laid over it.
	///
	/// Twice this was geometry and twice it looked like geometry: first a slab per lot floating
	/// over the ground, then one continuous ribbon sitting on it. Both have the lot's square
	/// edges and both stop dead at a boundary no path ever had. A path is the ground being a
	/// different ground, and that is a texture with a metre or two of blend at its edge.
	///
	/// Falls back to nothing when Terrain3D is not loaded. That is deliberate: a village without
	/// visible paths is a cosmetic loss, and drawing the old mesh as well would mean carrying two
	/// answers to the same question forever.
	/// </summary>
	private void BuildRoads(TerrainField terrain, VillageData village)
	{
		ClearChildren(_roadRoot!);

		// Split first, paint second. The runs are what the village *is*, the painting is one
		// consumer of them; computing them behind the Terrain3D check would mean a build without
		// the extension has no roads at all rather than only invisible ones.
		_pathRuns.Clear();
		foreach (var path in village.Paths)
			_pathRuns.AddRange(SplitRuns(path.Cells));

		if (_bridge is null)
		{
			GD.PushWarning("no Terrain3D, so no paving: the paths are painted into the terrain");
			return;
		}

		var runs = new List<IReadOnlyList<(int Gx, int Gz)>>(_pathRuns);
		// The square is one block of ground rather than a line, so each of its lots goes in as a
		// run of its own and the distance field unions them into one paved area.
		if (village.Island.Town?.Paved is not null)
			foreach (var cell in village.Island.Town.Paved)
				if (cell.Count >= 2) runs.Add(new[] { (cell[0], cell[1]) });

		_bridge.PaintPaving(terrain, runs, terrain.MetresPerLot);
	}

	/// <summary>
	/// The cells of one path, split into continuous runs.
	///
	///  records only the cells a route freshly paves, so where a road joins one that
	/// already exists its cell list simply jumps. Treating that list as one polyline would paint
	/// a stripe straight across whatever lies between the two ends.
	/// </summary>
	private static List<IReadOnlyList<(int Gx, int Gz)>> SplitRuns(List<List<int>> cells)
	{
		var runs = new List<IReadOnlyList<(int Gx, int Gz)>>();
		List<(int Gx, int Gz)>? run = null;
		foreach (var cell in cells)
		{
			if (cell.Count < 2) continue;
			var here = (Gx: cell[0], Gz: cell[1]);
			bool joins = run is not null
				&& Math.Abs(here.Gx - run[^1].Gx) <= 1 && Math.Abs(here.Gz - run[^1].Gz) <= 1;
			if (!joins)
			{
				run = new List<(int, int)>();
				runs.Add(run);
			}
			run!.Add(here);
		}
		return runs;
	}

	// ---- bridges -------------------------------------------------------------

	private void BuildBridges(TerrainField terrain, VillageData village)
	{
		ClearChildren(_bridgeRoot!);
		_bridgeCells.Clear();

		int n = 0;
		foreach (var bridge in village.Bridges)
		{
			// Recorded whether or not a deck comes out of it: the cells are a crossing either
			// way, and nothing should be planted on them.
			foreach (var c in bridge.Cells)
				if (c.Count >= 2) _bridgeCells.Add((c[0], c[1]));

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
	/// A footbridge from bank to bank: a segmented deck that follows the two shores it joins,
	/// arched over the middle so it clears the water, on piers down to the bed.
	///
	/// It used to be one box at a fixed <c>DeckY</c> of 0.7 m. That was right when a bridge
	/// crossed a stream on an island whose whole relief was eight metres; on a crossing of
	/// eighty metres of open sea between two shores at different heights it is a plank lying
	/// in the water. The deck now starts and ends exactly on its abutments - so you can walk
	/// onto it - and the crown of the arch is what buys the clearance.
	/// </summary>
	private Node3D? TryBuildBridge(TerrainField terrain, BridgeData bridge)
	{
		if (bridge.Cells.Count < 1)
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

		// The abutments are one lot beyond the water at each end - that is the ground the deck
		// has to meet, and the reason the deck is longer than the water is wide.
		float lot = terrain.Span(1.0);
		int midX = (gxMin + gxMax) / 2, midZ = (gzMin + gzMax) / 2;
		var (nearX, nearZ) = terrain.CellWorld(alongX ? gxMin - 1 : midX, alongX ? midZ : gzMin - 1);
		var (farX, farZ) = terrain.CellWorld(alongX ? gxMax + 1 : midX, alongX ? midZ : gzMax + 1);

		var a = new Vector3((float)nearX, (float)terrain.WorldHeight(nearX, nearZ), (float)nearZ);
		var b = new Vector3((float)farX, (float)terrain.WorldHeight(farX, farZ), (float)farZ);
		float span = alongX ? MathF.Abs(b.X - a.X) : MathF.Abs(b.Z - a.Z);
		if (span < 0.5f)
			return null;

		const float DeckH = 0.14f;
		const float DeckW = 2.6f;
		const float RailingH = 0.95f;      // a rail you could hold, not a kerb
		const float Clearance = 2.6f;      // free height over the water at the crown
		const float MinArch = 0.35f;       // even a bridge over dry land has a little camber

		// The crown rises until it clears the water. Over a high-banked channel that is almost
		// nothing, and the arch is then there for the look rather than for the boats.
		float midBank = (a.Y + b.Y) * 0.5f;
		float arch = MathF.Max(MinArch, Clearance - midBank);

		Vector3 Deck(float t)
		{
			float y = Mathf.Lerp(a.Y, b.Y, t) + arch * MathF.Sin(MathF.PI * t);
			return new Vector3(Mathf.Lerp(a.X, b.X, t), y, Mathf.Lerp(a.Z, b.Z, t));
		}

		var root = new Node3D();
		int segments = Math.Max(2, (int)MathF.Ceiling(span / lot));
		float segLen = span / segments;
		float side = DeckW * 0.5f;
		float railY = DeckH * 0.5f + RailingH;

		// Built once and shared: every plank is the same length, and the posts and piers are
		// unit boxes scaled per instance. Reassigning Size on a shared BoxMesh is the bug this
		// file already carries a note about - every instance points at the same resource.
		var plank = new BoxMesh { Size = alongX ? new Vector3(segLen, DeckH, DeckW) : new Vector3(DeckW, DeckH, segLen) };
		plank.Material = PlankMat();
		var railSide = new BoxMesh { Size = alongX ? new Vector3(segLen, 0.09f, 0.07f) : new Vector3(0.07f, 0.09f, segLen) };
		railSide.Material = RailingMat();
		var unitBox = new BoxMesh { Size = Vector3.One };
		unitBox.Material = RailingMat();
		var pierMesh = new BoxMesh { Size = Vector3.One };
		pierMesh.Material = StoneMat();

		var lateral = alongX ? Vector3.Forward : Vector3.Right;

		for (int i = 0; i < segments; i++)
		{
			var p0 = Deck(i / (float)segments);
			var p1 = Deck((i + 1) / (float)segments);
			var mid = (p0 + p1) * 0.5f;

			// Pitch, so a plank lies along the slope instead of stepping down it. About Z for a
			// deck running along X, about X for one running along Z - and the sign flips with
			// the direction of travel, because the two axes turn opposite ways for the same rise.
			float rise = p1.Y - p0.Y;
			float run = alongX ? p1.X - p0.X : p1.Z - p0.Z;
			float dir = run < 0.0f ? -1.0f : 1.0f;
			float pitch = MathF.Atan2(rise, MathF.Abs(run));
			var basis = alongX
				? new Basis(Vector3.Back, -pitch * dir)
				: new Basis(Vector3.Right, pitch * dir);

			root.AddChild(new MeshInstance3D { Name = "Deck", Mesh = plank, Transform = new Transform3D(basis, mid) });

			foreach (int s in new[] { -1, 1 })
			{
				var offset = new Vector3(0.0f, railY, 0.0f) + lateral * (side * s);
				root.AddChild(new MeshInstance3D
				{
					Name = "Rail",
					Mesh = railSide,
					Transform = new Transform3D(basis, mid + basis * offset),
				});

				// Uprights every other segment, which is what makes it read as a railing rather
				// than as a handrail floating on nothing.
				if (i % 2 != 0)
					continue;
				var foot = mid + basis * (lateral * (side * s));
				root.AddChild(new MeshInstance3D
				{
					Name = "Post",
					Mesh = unitBox,
					Transform = new Transform3D(
						Basis.FromScale(new Vector3(0.09f, railY, 0.09f)),
						foot + new Vector3(0.0f, railY * 0.5f, 0.0f)),
				});
			}
		}

		// Piers, every few segments, from the underside of the deck down to the bed. Skipped
		// where the bed has already come up to meet it: that is the bank, and there the
		// abutment is the pier.
		int pierEvery = Math.Max(2, (int)MathF.Round(9.0f / segLen));
		for (int i = pierEvery; i < segments; i += pierEvery)
		{
			var p = Deck(i / (float)segments);
			float bed = (float)terrain.WorldHeight(p.X, p.Z);
			float top = p.Y - DeckH * 0.5f;
			float h = top - bed;
			if (h <= 0.4f)
				continue;
			root.AddChild(new MeshInstance3D
			{
				Name = "Pier",
				Mesh = pierMesh,
				Transform = new Transform3D(
					Basis.FromScale(new Vector3(0.45f, h, 0.45f)),
					new Vector3(p.X, bed + h * 0.5f, p.Z)),
			});
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

	/// <summary>
	/// The paving: PavingStones138 from ambientCG, CC0 - cobbles with moss in the joints. See
	/// assets/paving/SOURCE.md.
	///
	/// The UV scale is what decides whether this reads as a street or as gravel. The texture is
	/// about two metres of real ground across, so at 0.5 repeats per metre a cobble comes out
	/// the size of a cobble. Getting this wrong is the usual way a good texture looks cheap.
	/// </summary>
	private static StandardMaterial3D CobbleMat()
		=> _cobbleMat ??= new StandardMaterial3D
		{
			// Tinted down: the photograph was lit for a product page and reads chalk-white next
			// to this island's palette. The multiply keeps the stone's own variation.
			AlbedoColor = new Color(0.72f, 0.71f, 0.68f),
			AlbedoTexture = GD.Load<Texture2D>("res://assets/paving/paving138_col.jpg"),
			NormalEnabled = true,
			NormalTexture = GD.Load<Texture2D>("res://assets/paving/paving138_nrm.jpg"),
			NormalScale = 0.8f,
			RoughnessTexture = GD.Load<Texture2D>("res://assets/paving/paving138_rgh.jpg"),
			Roughness = 1.0f,
			Uv1Scale = new Vector3(0.5f, 0.5f, 0.5f),
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