using System;
using System.Collections.Generic;
using Godot;
using Promptholm.World;

namespace Promptholm.Atmosphere;

/// <summary>
/// Low-poly storybook clouds drifting lazily over the island (Phase 2 step 12). Each cloud
/// is a chunky cluster of matte-white puffs high above the terrain (y ∈ 22..26, far above
/// the tallest cliff and the lighthouse beam) and casts a soft moving shadow, exactly the
/// diorama look. Spawn positions are deterministic from the island seed; a gentle wind
/// pushes them along and they wrap around the world bounds so the sky never empties.
/// </summary>
[GlobalClass]
public partial class CloudManager : Node3D
{
	private const float WorldHalf = 60.0f;
	private const float DriftZRatio = 0.22f;

	/// <summary>Side of the drift rectangle; clouds orbit this square around the island.</summary>
	public const float AltitudeMin = 22.0f;
	public const float AltitudeMax = 26.0f;

	[Export] public uint Seed { get; set; } = 1337;
	[Export(PropertyHint.Range, "1,12")]
	public int MinClouds { get; set; } = 5;
	[Export(PropertyHint.Range, "1,12")]
	public int MaxClouds { get; set; } = 7;
	[Export(PropertyHint.Range, "0.0,5.0")]
	public float WindSpeed { get; set; } = 1.2f;
	[Export] public bool DriftEnabled { get; set; } = true;

	private readonly List<Node3D> _clouds = new();
	private readonly List<Vector3> _cloudDrift = new();

	private static readonly StandardMaterial3D _puffMat = new()
	{
		AlbedoColor = new Color(0.98f, 0.98f, 0.99f),
		Roughness = 1.0f,
	};

	/// <summary>Number of clouds currently spawned.</summary>
	public int CloudCount => _clouds.Count;

	public override void _Ready()
	{
		Build();
	}

	public override void _Process(double delta)
	{
		if (DriftEnabled)
			Advance((float)delta);
	}

	/// <summary>Applies the wind movement and wraps clouds back into the sky rectangle.</summary>
	public void Advance(float seconds)
	{
		for (int i = 0; i < _clouds.Count; i++)
		{
			var root = _clouds[i];
			var dir = _cloudDrift[i];
			root.Position += dir * seconds;

			var p = root.Position;
			if (p.X > WorldHalf) p.X = -WorldHalf;
			else if (p.X < -WorldHalf) p.X = WorldHalf;
			if (p.Z > WorldHalf) p.Z = -WorldHalf;
			else if (p.Z < -WorldHalf) p.Z = WorldHalf;
			root.Position = p;
		}
	}

	/// <summary>Rebuilds the whole sky, optionally with a new island seed.</summary>
	public void Rebuild(uint seed)
	{
		Seed = seed;
		Build();
	}

	public void Build()
	{
		foreach (var child in GetChildren())
		{
			RemoveChild(child);
			child.QueueFree();
		}
		_clouds.Clear();
		_cloudDrift.Clear();

		var rng = new PmRng(Seed).Fork("clouds");
		int count = MinClouds + rng.IntN(Math.Max(1, MaxClouds - MinClouds + 1));

		for (int i = 0; i < count; i++)
		{
			float x = (float)rng.RangeF(-WorldHalf, WorldHalf);
			float z = (float)rng.RangeF(-WorldHalf, WorldHalf);
			float y = AltitudeMin + (float)rng.RangeF(0.0, AltitudeMax - AltitudeMin);
			float size = 1.6f + (float)rng.RangeF(0.0, 1.6);
			float yaw = (float)rng.RangeF(0.0, Math.PI);

			var root = new Node3D
			{
				Name = "Cloud",
				Position = new Vector3(x, y, z),
				Rotation = new Vector3(0.0f, yaw, 0.0f),
			};
			AddChild(root);

			AddPuff(root, new Vector3(0.0f, 0.05f, 0.0f), new Vector3(2.1f, 1.15f, 1.6f) * size);
			AddPuff(root, new Vector3(-1.4f, -0.05f, 0.15f), new Vector3(1.5f, 0.95f, 1.25f) * size);
			AddPuff(root, new Vector3(1.5f, -0.05f, -0.2f), new Vector3(1.6f, 1.0f, 1.2f) * size);
			AddPuff(root, new Vector3(0.25f, 0.55f, 0.1f), new Vector3(1.35f, 0.75f, 1.1f) * size);
			AddPuff(root, new Vector3(-0.7f, 0.35f, -0.55f), new Vector3(1.1f, 0.7f, 0.95f) * size);
			AddPuff(root, new Vector3(0.0f, -0.42f, 0.05f), new Vector3(2.7f, 0.42f, 1.85f) * size);

			_clouds.Add(root);
			_cloudDrift.Add(new Vector3(WindSpeed, 0.0f, WindSpeed * DriftZRatio));
		}
	}

	private static void AddPuff(Node3D parent, Vector3 pos, Vector3 size)
	{
		var mesh = new BoxMesh { Size = size, Material = _puffMat };
		parent.AddChild(new MeshInstance3D
		{
			Name = "Puff",
			Mesh = mesh,
			Position = pos,
		});
	}

	/// <summary>Floating point altitude band the clouds fly in (for the headless verifier).</summary>
	public Vector2 CloudAltitudeBand => new(AltitudeMin, AltitudeMax);

	/// <summary>World-space position of the i-th cloud.</summary>
	public Vector3 CloudPosition(int index) => _clouds[index].Position;

	/// <summary>Repositions the i-th cloud (used by the headless verifier for wrap tests).</summary>
	public void MoveCloudTo(int index, Vector3 position)
	{
		if (index >= 0 && index < _clouds.Count)
			_clouds[index].Position = position;
	}

	/// <summary>True when every puff of the i-th cloud casts a shadow.</summary>
	public bool CloudCastsShadow(int index)
	{
		if (index < 0 || index >= _clouds.Count)
			return false;
		foreach (var child in _clouds[index].GetChildren())
		{
			if (child is MeshInstance3D mi && mi.CastShadow == GeometryInstance3D.ShadowCastingSetting.Off)
				return false;
		}
		return true;
	}

	/// <summary>True when the clouds actually move with the wind.</summary>
	public bool IsDrifting => DriftEnabled && WindSpeed > 0.0f;
}