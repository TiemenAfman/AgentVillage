using System;
using System.Collections.Generic;
using Godot;
using Promptholm.Buildings;
using Promptholm.Buildings.Slots;
using Promptholm.World;
using Promptholm.Visual;

namespace Promptholm.Atmosphere;

/// <summary>
/// Switches on the warm candle/lantern glow the moment the sun dips below the horizon: it
/// enables emission on every building window material and on the glass of the street lamps
/// it places along the roads. Lamps follow <see cref="WorldManager.PathRuns"/> - the same lot
/// runs the paving painter gets - so they sit on the roads the village actually has.
/// The manager is self-contained: it accepts an explicit WorldManager / DayNightCycle export
/// and falls back to a tree-wide lookup of a node named "WorldManager" / "DayNightCycle".
/// </summary>
[GlobalClass]
public partial class NightGlowManager : Node3D
{
	/// <summary>Warm candle/lantern yellow emitted from windows and lamp glass at night.</summary>
	public static readonly Color GlowColour = new(1.0f, 0.75f, 0.35f);

	/// <summary>Subtle warm glow the warm-lit window panes keep during daylight hours.</summary>
	public const float WindowDayGlow = 0.35f;

	/// <summary>One lantern per this many lots along a run: lots are 4 m, so a lamp every 20 m.</summary>
	public const int LotsPerLamp = 5;

	/// <summary>Runs shorter than this are a stub of paving rather than a street, and stay dark.</summary>
	public const int MinRunLots = 2;

	/// <summary>Ceiling on the lantern count. Beyond it the candidates are thinned, not cut off.</summary>
	public const int MaxLamps = 96;

	/// <summary>How far off the centre of its lot a post stands, as a fraction of the lot.</summary>
	private const float VergeFraction = 0.45f;

	private static readonly Color LampMetal = new(0.14f, 0.14f, 0.16f);

	[Export]
	public DayNightCycle? Cycle;

	[Export]
	public WorldManager? World;

	[Export(PropertyHint.Range, "0,24,0.1")]
	public float ForceHour = -1.0f;

	private readonly List<StandardMaterial3D> _windowMaterials = new();
	private readonly List<StandardMaterial3D> _lampGlass = new();
	private readonly List<OmniLight3D> _lampLights = new();
	private WorldManager? _resolvedWorld;
	private DayNightCycle? _resolvedCycle;
	private string? _lampLayout;
	private bool _glowOn;

	/// <summary>Whether the glow is currently enabled (night/dusk window).</summary>
	public bool GlowActive => _glowOn;

	/// <summary>Number of distinct building window materials being lit.</summary>
	public int WindowGlowCount => _windowMaterials.Count;

	/// <summary>
	/// Number of street lamps spawned along the roads. Counted off the posts' lights, one each:
	/// the glass is a single Palette-cached material shared by every lantern, so counting those
	/// answered "1" for a fully lit village and "1" for a village with one lamp in it.
	/// </summary>
	public int LampCount => _lampLights.Count;

	/// <summary>Number of distinct emissive materials on the lamp glass (shared across posts).</summary>
	public int LampGlassCount => _lampGlass.Count;

	/// <summary>The current hour used for decisions: forced debug hour, else the synced cycle.</summary>
	public float Hour
	{
		get
		{
			if (ForceHour >= 0.0f)
				return ForceHour;
			if (Cycle is not null)
				return Cycle.Hour;
			return _resolvedCycle?.Hour ?? 12.0f;
		}
	}

	public override void _Ready()
	{
		// Driven by the cycle instead of by the frame. Sync walks all 163 buildings to toggle a
		// handful of materials; doing that sixty times a second for a value that changes over
		// minutes was pure waste.
		SetProcess(false);
		var cycle = ResolveCycle();
		if (cycle is not null)
			cycle.AtmosphereChanged += OnAtmosphereChanged;
		Sync();
	}

	public override void _ExitTree()
	{
		if (_resolvedCycle is not null)
			_resolvedCycle.AtmosphereChanged -= OnAtmosphereChanged;
	}

	private void OnAtmosphereChanged(float hour, float windowGlow, float lampEnergy)
	{
		RebuildIfNeeded();
		ApplyGlow(DayNightCycle.IsDuskOrNight(hour), lampEnergy);
	}

	/// <summary>Re-evaluates the glow state for the current hour and toggles all materials.</summary>
	public void Sync()
	{
		RebuildIfNeeded();
		float hour = Hour;
		ApplyGlow(DayNightCycle.IsDuskOrNight(hour), AtmospherePalette.Sample(hour).LampEnergy);
	}

	private void RebuildIfNeeded()
	{
		CollectWindowMaterials();
		EnsureLamps();
	}

	private void ApplyGlow(bool on, float lampEnergy)
	{
		foreach (var mat in _windowMaterials)
			SetGlow(mat, on, WindowDayGlow);
		foreach (var mat in _lampGlass)
			SetGlow(mat, on, 0.0f);
		foreach (var lamp in _lampLights)
			lamp.LightEnergy = on ? Mathf.Max(0.25f, lampEnergy) * 0.85f : 0.0f;

		_glowOn = on;
	}

	private static void SetGlow(StandardMaterial3D mat, bool on, float dayEnergy)
	{
		mat.Emission = GlowColour;
		mat.EmissionEnabled = on || dayEnergy > 0.0f;
		mat.EmissionEnergyMultiplier = on ? 1.2f : dayEnergy;
	}

	private WorldManager? ResolveWorld()
	{
		if (_resolvedWorld is not null)
			return _resolvedWorld;
		if (World is not null || GetTree()?.Root is not null)
		{
			_resolvedWorld = World ?? FindNodeInTree<WorldManager>("WorldManager");
		}
		return _resolvedWorld;
	}

	private DayNightCycle? ResolveCycle()
	{
		if (_resolvedCycle is not null)
			return _resolvedCycle;
		if (Cycle is not null || GetTree()?.Root is not null)
		{
			_resolvedCycle = Cycle ?? FindNodeInTree<DayNightCycle>("DayNightCycle");
		}
		return _resolvedCycle;
	}

	/// <summary>Collects the per-building window materials from every BuildingAssembler window slot.</summary>
	private void CollectWindowMaterials()
	{
		_windowMaterials.Clear();

		var world = ResolveWorld();
		var objects = world?.GetNodeOrNull<Node3D>("ObjectsRoot");
		if (objects is null)
			return;

		foreach (var child in objects.GetChildren())
		{
			if (child is not Node3D root)
				continue;
			if (!root.Name.ToString().StartsWith("Building_", StringComparison.Ordinal))
				continue;

			var assembler = root.GetNodeOrNull<BuildingAssembler>("BuildingAssembler");
			if (assembler is null)
				continue;

			foreach (var slotChild in assembler.GetChildren())
			{
				if (slotChild is not BuildingSlot3D slot)
					continue;
				if (slot.Type != SlotType.Window || !slot.IsOccupied)
					continue;

				StandardMaterial3D? mat = slot.AttachedPiece is MeshInstance3D directMi
					? directMi.MaterialOverride as StandardMaterial3D
					: slot.AttachedPiece?.GetChildOrNull<MeshInstance3D>(0)?.MaterialOverride as StandardMaterial3D
						?? slot.AttachedPiece?.GetChildOrNull<MeshInstance3D>(0)?.Mesh?.SurfaceGetMaterial(0) as StandardMaterial3D;
				if (mat is null || _windowMaterials.Contains(mat))
					continue;
				_windowMaterials.Add(mat);
			}
		}
	}

	/// <summary>
	/// Spawns lantern posts along the village's paths. Each lamp carries a small emissive glass
	/// box whose material lands in <see cref="_lampGlass"/>.
	///
	/// This used to read lamp positions out of the cobblestone MultiMesh under GroundRoot/Roads.
	/// That node has been empty since the paving became a texture painted into the Terrain3D
	/// control map: there is no road geometry left to walk. The roads survive only as the lot
	/// runs WorldManager hands the painter, so that is what the lamps follow now - which also
	/// means they no longer need Terrain3D to be loaded at all.
	/// </summary>
	private void EnsureLamps()
	{
		var world = ResolveWorld();
		var terrain = world?.Terrain;
		var runs = world?.PathRuns;
		if (terrain is null || runs is null || runs.Count == 0)
			return;

		// Keyed on the layout rather than latched on a bool. A bool set before the roads existed
		// was what left the island dark on the live-data path, where VillageClient's poll arrives
		// after the first Sync; and a bool set after is still wrong the moment a new village comes
		// in over the same session, because the lamps would then stand along yesterday's streets.
		string layout = LampLayout(terrain, runs);
		if (layout == _lampLayout)
			return;

		ClearLamps();
		_lampLayout = layout;

		var spots = LampSpots(terrain, world!, runs);
		// Thinned rather than truncated: taking the first 96 would light one half of the village
		// and leave the other half black, because the runs arrive in path order, not in map order.
		int stride = Math.Max(1, (spots.Count + MaxLamps - 1) / MaxLamps);
		for (int i = 0; i < spots.Count; i += stride)
			BuildLampAt(spots[i]);

		GD.Print($"[NightGlow] {_lampLights.Count} street lamps along {runs.Count} path runs");
	}

	/// <summary>A cheap fingerprint of the road layout: changes exactly when the streets do.</summary>
	private static string LampLayout(TerrainField terrain, IReadOnlyList<IReadOnlyList<(int Gx, int Gz)>> runs)
	{
		uint h = PmRng.Hash32(terrain.WorldRev);
		foreach (var run in runs)
		{
			if (run.Count == 0)
				continue;
			h = PmRng.Hash32($"{h}:{run.Count}:{run[0].Gx},{run[0].Gz}");
		}
		return $"{terrain.IslandSeed}:{runs.Count}:{h:x8}";
	}

	/// <summary>Picks the lots that get a lantern and works out where on each lot the post goes.</summary>
	private static List<Vector3> LampSpots(
		TerrainField terrain, WorldManager world, IReadOnlyList<IReadOnlyList<(int Gx, int Gz)>> runs)
	{
		var spots = new List<Vector3>();
		var taken = new HashSet<(int, int)>();

		foreach (var run in runs)
		{
			if (run.Count < MinRunLots)
				continue;

			// Where the first lamp of a run lands is fixed by the run's own first lot, so the
			// same village always lights the same corners while two parallel streets do not line
			// their posts up with each other. Short runs still get exactly one.
			int span = Math.Min(LotsPerLamp, run.Count);
			uint start = PmRng.Hash32($"{terrain.IslandSeed}:lamp:{run[0].Gx},{run[0].Gz}") % (uint)span;

			for (int i = (int)start; i < run.Count; i += LotsPerLamp)
			{
				var cell = run[i];
				if (!taken.Add((cell.Gx, cell.Gz)))
					continue;
				// A deck over open water carries no post: a bridge is a plank, not ground, and a
				// crossing the server never bridged is water all the same.
				if (world.IsBridgeCell(cell.Gx, cell.Gz) || terrain.IsWater(cell.Gx, cell.Gz))
					continue;
				spots.Add(LampSpot(terrain, run, i));
			}
		}
		return spots;
	}

	/// <summary>
	/// A lamp stands beside the path, not in the middle of it. The post is pushed to the verge
	/// along the perpendicular of the run's local direction; if that verge turns out to be water
	/// or off the island it keeps to the centre line rather than wading in.
	/// </summary>
	private static Vector3 LampSpot(TerrainField terrain, IReadOnlyList<(int Gx, int Gz)> run, int i)
	{
		var cell = run[i];
		var (cx, cz) = terrain.CellWorld(cell.Gx, cell.Gz);

		var back = run[Math.Max(0, i - 1)];
		var ahead = run[Math.Min(run.Count - 1, i + 1)];
		float dx = ahead.Gx - back.Gx;
		float dz = ahead.Gz - back.Gz;
		float len = Mathf.Sqrt(dx * dx + dz * dz);
		float perpX = len > 0.0f ? -dz / len : 1.0f;
		float perpZ = len > 0.0f ? dx / len : 0.0f;

		// Which verge, decided per lot, so a street gets lamps left and right instead of a guard
		// of honour down one side.
		float side = (PmRng.Hash32($"lamp:side:{cell.Gx},{cell.Gz}") & 1u) == 0u ? 1.0f : -1.0f;
		float reach = (float)terrain.MetresPerLot * VergeFraction * side;

		float x = (float)cx + perpX * reach;
		float z = (float)cz + perpZ * reach;
		if (!terrain.IsLandAt(x, z))
		{
			x = (float)cx;
			z = (float)cz;
		}
		return new Vector3(x, (float)terrain.WorldHeight(x, z), z);
	}

	/// <summary>Frees the current lantern posts. Detached at once, not merely queued, because the
	/// rebuild that follows walks the children again in the same frame.</summary>
	private void ClearLamps()
	{
		foreach (var child in GetChildren())
		{
			if (!child.Name.ToString().StartsWith("StreetLamp", StringComparison.Ordinal))
				continue;
			RemoveChild(child);
			child.QueueFree();
		}
		_lampGlass.Clear();
		_lampLights.Clear();
	}

	/// <summary>Small stylised lantern post: tall pole, dark cap, emissive glass and cone topper.</summary>
	private void BuildLampAt(Vector3 pos)
	{
		var root = new Node3D { Name = "StreetLamp", Position = pos };
		AddChild(root);

		root.AddChild(new MeshInstance3D
		{
			Name = "Pole",
			Mesh = new CylinderMesh { TopRadius = 0.05f, BottomRadius = 0.07f, Height = 1.55f, RadialSegments = 6 },
			Position = new Vector3(0.0f, 0.79f, 0.0f),
			MaterialOverride = Solid(LampMetal),
		});

		root.AddChild(new MeshInstance3D
		{
			Name = "Cap",
			Mesh = new BoxMesh { Size = new Vector3(0.26f, 0.22f, 0.26f) },
			Position = new Vector3(0.0f, 1.62f, 0.0f),
			MaterialOverride = Solid(LampMetal),
		});

		// One shared material for every lantern: they all switch on together, and a private
		// StandardMaterial3D per post meant ninety-odd identical resources.
		var glass = Palette.Emissive(GlowColour, GlowColour, 1.4f, 0.6f);
		root.AddChild(new MeshInstance3D
		{
			Name = "Glass",
			Mesh = new BoxMesh { Size = new Vector3(0.18f, 0.20f, 0.18f) },
			Position = new Vector3(0.0f, 1.67f, 0.0f),
			MaterialOverride = glass,
		});
		if (!_lampGlass.Contains(glass))
			_lampGlass.Add(glass);

		root.AddChild(new MeshInstance3D
		{
			Name = "Topper",
			Mesh = new CylinderMesh { TopRadius = 0.0f, BottomRadius = 0.16f, Height = 0.24f, RadialSegments = 5 },
			Position = new Vector3(0.0f, 1.84f, 0.0f),
			MaterialOverride = Solid(LampMetal),
		});

		// The lantern used to be emissive glass and nothing else: it looked lit but threw no
		// light, so the night streets stayed as dark as the fields. A real omni, shadowless and
		// distance-faded, is cheap under clustered shading — and with a volumetric contribution
		// each one gets a halo in the fog, which is most of what makes a lit village read.
		var lamp = new OmniLight3D
		{
			Name = "Lantern",
			Position = new Vector3(0.0f, 1.67f, 0.0f),
			LightColor = GlowColour,
			LightEnergy = 0.0f,
			OmniRange = 9.0f,
			ShadowEnabled = false,
			LightVolumetricFogEnergy = 1.5f,
			DistanceFadeEnabled = true,
			DistanceFadeBegin = 60.0f,
			DistanceFadeLength = 20.0f,
		};
		root.AddChild(lamp);
		_lampLights.Add(lamp);
	}

	private static StandardMaterial3D Solid(Color colour) => Palette.Solid(colour, 0.82f);

	/// <summary>Breadth-first search from the tree root for a node with the given name/types.</summary>
	private static T? FindNodeInTree<T>(string name) where T : Node
	{
		var root = GetTreeRoot();
		if (root is null)
			return null;

		var queue = new Queue<Node>();
		queue.Enqueue(root);
		while (queue.Count > 0)
		{
			var n = queue.Dequeue();
			if (n is T match && string.Equals(n.Name.ToString(), name, StringComparison.Ordinal))
				return match;
			foreach (var child in n.GetChildren())
				queue.Enqueue(child);
		}
		return null;
	}

	private static Node? GetTreeRoot()
		=> Godot.Engine.GetMainLoop() is SceneTree tree ? tree.Root : null;
}