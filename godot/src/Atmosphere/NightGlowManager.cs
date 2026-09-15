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
/// it places along the roads. Lamps are spawned from the cobblestone MultiMesh instances of
/// WorldManager.GroundRoot/Roads, so lamp positions always follow the actual road layout.
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
	private bool _lampsBuilt;
	private bool _glowOn;

	/// <summary>Whether the glow is currently enabled (night/dusk window).</summary>
	public bool GlowActive => _glowOn;

	/// <summary>Number of distinct building window materials being lit.</summary>
	public int WindowGlowCount => _windowMaterials.Count;

	/// <summary>Number of street lamps spawned along the roads.</summary>
	public int LampCount => _lampGlass.Count;

	/// <summary>Number of lanterns that actually cast light, as opposed to only glowing.</summary>
	public int LampLightCount => _lampLights.Count;

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
	/// Spawns lantern posts along the cobble tiles (roads + paved square). Built once; each
	/// lamp carries a small emissive glass box whose material lands in <see cref="_lampGlass"/>.
	/// </summary>
	private void EnsureLamps()
	{
		if (_lampsBuilt)
			return;

		// The flag used to be set before this check. GroundRoot/Roads exists as soon as
		// EnsureRoots has run but stays empty until BuildWorld fills it, so on the live-data
		// path — where VillageClient's poll arrives after the first Sync — this ran against an
		// empty Roads node, found no positions, and latched _lampsBuilt: the island then never
		// got a single street lamp. Only the village.json fallback path worked, by accident.
		var world = ResolveWorld();
		var roads = world?.GetNodeOrNull<Node3D>("GroundRoot/Roads");
		if (roads is null)
			return;

		var positions = new List<Vector3>();
		foreach (var roadChild in roads.GetChildren())
		{
			if (roadChild is not MultiMeshInstance3D mmi || mmi.Multimesh is null)
				continue;
			int count = mmi.Multimesh.InstanceCount;
			for (int i = 0; i < count; i += 6)
				positions.Add(mmi.Multimesh.GetInstanceTransform(i).Origin);
		}

		if (positions.Count == 0)
			return;

		_lampsBuilt = true;

		int placed = 0;
		foreach (var pos in positions)
		{
			if (placed >= 96)
				break;
			BuildLampAt(pos);
			placed++;
		}
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