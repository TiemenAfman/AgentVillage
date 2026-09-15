using System;
using Godot;
using Promptholm.World;

namespace Promptholm.Atmosphere;

/// <summary>
/// The rotating lighthouse beam: finds the world's lighthouse building (id/node name
/// containing "lighthouse", else the fallback plot at gx:4, gz:30), builds a lantern room
/// with a sweeping SpotLight3D plus an additive emissive beam cone and a small warm glow,
/// and rotates the beam once every 8 seconds. The whole lantern only becomes visible during
/// the dusk/night window (see DayNightCycle.IsDuskOrNight).
/// </summary>
[GlobalClass]
public partial class LighthouseController : Node3D
{
	/// <summary>One full revolution of the beam, in seconds.</summary>
	public const float RevolutionSeconds = 8.0f;

	private static readonly Color BeamColour = new(1.0f, 0.96f, 0.85f);

	[Export]
	public DayNightCycle? Cycle;

	[Export]
	public WorldManager? World;

	[Export(PropertyHint.Range, "0,24,0.1")]
	public float ForceHour = -1.0f;

	private Node3D? _site;
	private Node3D? _lantern;
	private Node3D? _rotator;
	private SpotLight3D? _beam;
	private DayNightCycle? _resolvedCycle;
	private bool _active;
	private float _yaw;

	/// <summary>Whether the lantern/beam is currently switched on.</summary>
	public bool Active => _active;

	/// <summary>Current beam yaw in degrees (for tests/debug).</summary>
	public float BeamYawDeg => Mathf.RadToDeg(_yaw);

	/// <summary>The lighthouse building scene root, or null when it could not be located.</summary>
	public Node3D? Site => _site;

	/// <summary>The lantern room under the site (glow + beam assembly), or null until built.</summary>
	public Node3D? Lantern => _lantern;

	/// <summary>The sweeping spot light, or null until the lantern is built.</summary>
	public SpotLight3D? Beam => _beam;

	/// <summary>The configured or discovered day/night source.</summary>
	public DayNightCycle? CycleSource => Cycle ?? _resolvedCycle;

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

	public override void _Process(double delta)
	{
		DropFreedSite();
		ResolveCycleSource();
		if (_site is null && ResolveLighthouseSite())
			BuildLantern();

		if (Math.Abs(delta) > 0.001)
			Advance((float)delta);

		SetActive(DayNightCycle.IsDuskOrNight(Hour));
	}

	/// <summary>Resolves and builds the lantern if the lighthouse has been located. Returns success.</summary>
	public bool ResolveSite()
	{
		if (_site is not null)
			return true;
		bool found = ResolveLighthouseSite();
		if (found)
			BuildLantern();
		return found;
	}

	/// <summary>Advances the beam yaw by a fixed number of seconds (frame-independent).</summary>
	public void Advance(float seconds)
	{
		_yaw = Mathf.Wrap(_yaw + Mathf.Tau * seconds / RevolutionSeconds, 0.0f, Mathf.Tau);
		if (GodotObject.IsInstanceValid(_rotator))
			_rotator!.Rotation = new Vector3(Mathf.DegToRad(-12.0f), _yaw, 0.0f);
	}

	/// <summary>Turns the lantern room, glow and beam on or off.</summary>
	public void SetActive(bool on)
	{
		_active = on;
		if (GodotObject.IsInstanceValid(_lantern))
			_lantern!.Visible = on;
	}

	/// <summary>
	/// Drops the cached lantern once the world has been rebuilt underneath it. WorldManager
	/// frees every Building_* node on a rebuild - which happens on an ordinary start, the moment
	/// the second VillageData arrives - while this controller lives on outside ObjectsRoot.
	/// Touching the freed site then throws ObjectDisposedException from _Process, and an export
	/// build dies on that where the editor only logs it. Clearing the references lets the next
	/// frame find the new lighthouse and rebuild the lantern on it.
	/// </summary>
	private void DropFreedSite()
	{
		if (_site is null || GodotObject.IsInstanceValid(_site))
			return;
		_site = null;
		_lantern = null;
		_rotator = null;
		_beam = null;
	}

	private void ResolveCycleSource()
	{
		if (_resolvedCycle is not null || Cycle is not null)
			return;
		Node? n = this;
		while (n is not null)
		{
			foreach (var child in n.GetChildren())
			{
				if (child != this && child is DayNightCycle cyc)
				{
					_resolvedCycle = cyc;
					return;
				}
			}
			n = n.GetParent();
		}
	}

	private bool ResolveLighthouseSite()
	{
		var world = World ?? FindWorldInTree();
		var objects = world?.GetNodeOrNull<Node3D>("ObjectsRoot");
		if (objects is null)
			return false;

		foreach (var child in objects.GetChildren())
		{
			if (child is not Node3D node)
				continue;
			if (!node.Name.ToString().StartsWith("Building_", StringComparison.Ordinal))
				continue;
			if (node.Name.ToString().Contains("lighthouse", StringComparison.OrdinalIgnoreCase))
			{
				_site = node;
				return true;
			}
		}
		return false;
	}

	private void BuildLantern()
	{
		var site = _site;
		if (site is null)
			return;

		// Lantern room hovering above the tower roof.
		var lantern = new Node3D { Name = "LighthouseLantern" };
		lantern.Position = new Vector3(0.0f, 2.7f, 0.0f);
		site.AddChild(lantern);

		// Warm steady glow above the lantern room.
		lantern.AddChild(new OmniLight3D
		{
			Name = "LanternGlow",
			LightColor = new Color(1.0f, 0.80f, 0.45f),
			LightEnergy = 1.4f,
			OmniRange = 7.0f,
		});

		// Rotating assembly: spot light + additive beam cone, both aimed along -Z (pitch −12°).
		var rotator = new Node3D { Name = "BeamRotator" };
		lantern.AddChild(rotator);

		var beamLight = new SpotLight3D
		{
			Name = "BeamLight",
			LightColor = BeamColour,
			LightEnergy = 3.0f,
			SpotAngle = 12.0f,
			SpotAttenuation = 6.0f,
			SpotRange = 42.0f,
		};
		rotator.AddChild(beamLight);

		var cone = new CylinderMesh
		{
			TopRadius = 0.55f,
			BottomRadius = 1.1f,
			Height = 7.0f,
			RadialSegments = 14,
		};
		cone.Material = new StandardMaterial3D
		{
			AlbedoColor = new Color(1.0f, 0.82f, 0.45f, 0.10f),
			ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
			Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
			BlendMode = BaseMaterial3D.BlendModeEnum.Add,
			EmissionEnabled = true,
			Emission = new Color(1.0f, 0.80f, 0.45f),
			EmissionEnergyMultiplier = 1.8f,
		};
		// Rotate the cone primitive (axis along Y) so it lies along -Z with the light.
		// +90° puts the narrow top (r 0.55) at the lantern and the wide bottom (r 1.1)
		// out at the sweep end, i.e. the beam visibly diverges away from the tower.
		rotator.AddChild(new MeshInstance3D
		{
			Name = "BeamCone",
			Mesh = cone,
			Rotation = new Vector3(Mathf.DegToRad(90.0f), 0.0f, 0.0f),
			Position = new Vector3(0.0f, 0.0f, -3.5f),
		});

		_lantern = lantern;
		_rotator = rotator;
		_beam = beamLight;
		_lantern.Visible = _active;
		Advance(0.0f);
	}

	private static WorldManager? FindWorldInTree()
	{
		var root = Godot.Engine.GetMainLoop() is SceneTree tree ? tree.Root : null;
		if (root is null)
			return null;

		var queue = new System.Collections.Generic.Queue<Node>();
		queue.Enqueue(root);
		while (queue.Count > 0)
		{
			var n = queue.Dequeue();
			if (n is WorldManager world && string.Equals(n.Name.ToString(), "WorldManager", StringComparison.Ordinal))
				return world;
			foreach (var child in n.GetChildren())
				queue.Enqueue(child);
		}
		return null;
	}
}