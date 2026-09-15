using System;
using System.Globalization;
using Godot;
using Promptholm.Atmosphere;
using Promptholm.World;

namespace Promptholm.Tools;

/// <summary>
/// Renders the world the server published, with the atmosphere the island already has, and
/// nothing else. Run WITHOUT --headless (the dummy driver gives a black image) and WITH
/// --fixed-fps 60:
///
///   Godot..._console.exe --path &lt;godot&gt; --fixed-fps 60 \
///     --script res://src/Tools/WorldPreviewRunner.cs -- --hour 12.5 --out shot.png
///
/// Deliberately not the full <c>Main</c> scene. The village still stands on the old 64 m grid,
/// so putting its houses on this island would place them all in one corner and the picture would
/// say more about that than about the terrain. Buildings arrive when the layout is re-founded;
/// this shows the ground, the water and the light, which is what this step changed.
/// </summary>
public partial class WorldPreviewRunner : SceneTree
{
	/// <summary>SDFGI needs about twenty frames to converge and volumetric fog another sixteen;
	/// capturing early compares noise rather than the look.</summary>
	private const int SettleFrames = 120;

	private int _frames;
	private bool _armed;
	private string _outPath = "";
	private float _hour = 12.5f;
	private Vector2I _size = new(1600, 1000);
	private float _elevationDeg = 22.0f;
	private float _azimuthDeg = 215.0f;
	private float _distanceScale = 1.9f;
	private bool _noWater;

	private WorldEnvironment? _worldEnv;
	private DirectionalLight3D? _sun;
	private DirectionalLight3D? _moon;
	private ProceduralSkyMaterial? _sky;

	public override void _Initialize()
	{
		ParseArgs();
		if (DisplayServer.GetName() == "headless")
		{
			GD.PushError("WorldPreviewRunner needs a real display server; drop --headless.");
			Quit(1);
			return;
		}
		DisplayServer.WindowSetSize(_size);
	}

	public override bool _Process(double delta)
	{
		_frames++;
		// Frame one, not _Initialize: the tree is not live yet during _Initialize and every
		// GlobalTransform read inside it trips "Condition !is_inside_tree() is true".
		if (_frames == 1)
		{
			try
			{
				Setup();
			}
			catch (Exception e)
			{
				GD.PushError($"EXCEPTION building the world preview: {e}");
				Quit(1);
			}
			return false;
		}

		if (_frames < SettleFrames || _armed) return false;

		_armed = true;
		// SceneTree._Process runs before the draw, so reading the viewport here would hand back
		// the previous frame.
		RenderingServer.Singleton.Connect(
			RenderingServer.SignalName.FramePostDraw,
			Callable.From(Capture),
			(uint)GodotObject.ConnectFlags.OneShot);
		return false;
	}

	private void Setup()
	{
		var field = TerrainField.LoadFromResources();
		var m = field.Manifest;
		GD.Print($"world {m.WorldRev}, seed {m.Seed}: {field.ChunkCount} chunks, {m.Landmasses.Count} landmasses");

		var root = new Node3D { Name = "WorldPreview" };
		Root.AddChild(root);

		// ---- atmosphere: the island's own, unchanged ----------------------------
		// Tell the atmosphere how big the world is before it builds anything. The fog distances
		// were set for a 64 m island; left alone they bury a 400 m one in haze.
		EnvironmentFactory.DepthReachM = m.EnvelopeM * 1.2f;

		var environment = EnvironmentFactory.CreateIsland();
		_sky = environment.Sky.SkyMaterial as ProceduralSkyMaterial;
		_worldEnv = new WorldEnvironment { Name = "WorldEnvironment", Environment = environment };
		root.AddChild(_worldEnv);

		_sun = EnvironmentFactory.CreateSun();
		_moon = EnvironmentFactory.CreateMoon();
		root.AddChild(_sun);
		root.AddChild(_moon);

		// The shadow cascades were bounded for a 64 m island. This one is 400 m across and sits
		// in a 1024 m envelope, so they have to reach further or the far half of the island
		// stands in flat light.
		_sun.DirectionalShadowMaxDistance = 520.0f;

		EnvironmentFactory.Apply(environment, _sky, _sun, _moon, AtmospherePalette.Sample(_hour), _hour);

		// ---- the ground ---------------------------------------------------------
		var terrainRoot = new Node3D { Name = "Terrain" };
		root.AddChild(terrainRoot);
		var stats = TerrainMeshBuilder.BuildInto(terrainRoot, field, GroundMaterial(field));
		GD.Print($"terrain: {stats.Chunks} meshes, {stats.Vertices:N0} verts, {stats.Triangles:N0} tris in {stats.Milliseconds} ms");

		if (!_noWater)
		{
			var water = new WaterPlane { Name = "WaterPlane" };
			root.AddChild(water);
			water.Build();
		}

		// What the ground actually occupies, which is the first thing to check when an island
		// comes out looking drowned or inside out.
		var aabb = new Aabb();
		bool first = true;
		foreach (var child in terrainRoot.GetChildren())
		{
			if (child is not MeshInstance3D mi || mi.Mesh is null) continue;
			var box = mi.Mesh.GetAabb();
			aabb = first ? box : aabb.Merge(box);
			first = false;
		}
		GD.Print($"terrain aabb: pos {aabb.Position.Round()} size {aabb.Size.Round()}");

		// ---- a camera derived from the island, not from a remembered coordinate ----
		var main = field.MainLandmass;
		float radius = MathF.Max(60.0f, main.RadiusM);
		float distance = radius * _distanceScale;
		float el = Mathf.DegToRad(_elevationDeg);
		float az = Mathf.DegToRad(_azimuthDeg);
		var target = new Vector3(main.Centroid[0], main.Peak.Y * 0.35f, main.Centroid[1]);
		var eye = target + new Vector3(
			MathF.Cos(az) * MathF.Cos(el), MathF.Sin(el), MathF.Sin(az) * MathF.Cos(el)) * distance;

		root.AddChild(new Camera3D
		{
			Name = "PreviewCamera",
			Current = true,
			Fov = 52.0f,
			Far = 4000.0f,
			// LookAt is a no-op before the node is in the tree, so build the basis directly.
			Transform = new Transform3D(Basis.Identity, eye).LookingAt(target, Vector3.Up),
		});

		GD.Print($"camera at {eye.Round()} looking at {target.Round()}, island radius {radius:F0} m");
	}

	/// <summary>
	/// The terrain shader, with its noise scales set for this island's size. They are metres in
	/// the shader's own units, so a value tuned for a 64 m island spans less than one noise cell
	/// on a 400 m one and the ground comes out flat.
	/// </summary>
	private static ShaderMaterial GroundMaterial(TerrainField field)
	{
		var material = new ShaderMaterial
		{
			Shader = GD.Load<Shader>("res://shaders/stylized_terrain.gdshader"),
		};
		material.SetShaderParameter("macro_noise", TerrainNoise(0.9f, 1337));
		material.SetShaderParameter("detail_noise", TerrainNoise(2.4f, 91));
		material.SetShaderParameter("macro_scale", 0.012f);
		material.SetShaderParameter("detail_scale", 0.14f);
		material.SetShaderParameter("macro_amount", 0.55f);
		material.SetShaderParameter("detail_amount", 0.14f);
		material.SetShaderParameter("rock_slope_lo", 0.45f);
		material.SetShaderParameter("rock_slope_hi", 0.85f);
		material.SetShaderParameter("land_min", 0.20f);
		return material;
	}

	private static NoiseTexture2D TerrainNoise(float frequency, int seed) => new()
	{
		Width = 512,
		Height = 512,
		Seamless = true,
		Noise = new FastNoiseLite
		{
			NoiseType = FastNoiseLite.NoiseTypeEnum.SimplexSmooth,
			Frequency = frequency / 512.0f,
			Seed = seed,
			FractalOctaves = 4,
		},
	};

	private void Capture()
	{
		var image = Root.GetTexture()?.GetImage();
		if (image is null)
		{
			GD.PushError("no viewport image; was this run with --headless?");
			Quit(1);
			return;
		}

		string path = string.IsNullOrEmpty(_outPath) ? "world-preview.png" : _outPath;
		string absolute = path.StartsWith("res://") || path.StartsWith("user://")
			? ProjectSettings.GlobalizePath(path)
			: path;
		var err = image.SavePng(absolute);
		if (err != Error.Ok)
		{
			GD.PushError($"SavePng({absolute}) failed: {err}");
			Quit(1);
			return;
		}

		GD.Print($"wrote {absolute}  ({image.GetWidth()}x{image.GetHeight()}, hour {_hour})");
		Quit(0);
	}

	private void ParseArgs()
	{
		var args = OS.GetCmdlineUserArgs();
		for (int i = 0; i < args.Length; i++)
		{
			string a = args[i];
			string? next = i + 1 < args.Length ? args[i + 1] : null;
			switch (a)
			{
				case "--hour" when next is not null: _hour = ParseFloat(next); i++; break;
				case "--out" when next is not null: _outPath = next; i++; break;
				case "--elevation" when next is not null: _elevationDeg = ParseFloat(next); i++; break;
				case "--azimuth" when next is not null: _azimuthDeg = ParseFloat(next); i++; break;
				case "--zoom" when next is not null: _distanceScale = ParseFloat(next); i++; break;
				case "--no-water": _noWater = true; break;
				case "--size" when next is not null:
					var parts = next.Split('x');
					if (parts.Length == 2
						&& int.TryParse(parts[0], out int w)
						&& int.TryParse(parts[1], out int h))
					{
						_size = new Vector2I(w, h);
					}
					i++;
					break;
			}
		}
	}

	private static float ParseFloat(string s) =>
		float.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out float v) ? v : 0.0f;
}
