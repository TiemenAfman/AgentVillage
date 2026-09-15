using System;
using Godot;
using Promptholm.World;

namespace Promptholm.Tools;

/// <summary>
/// A spike, not a feature: can Terrain3D's instancer be driven from C#, and does anything appear?
///
/// This is risk #1 of the foliage plan. The instancer has no generated C# bindings — it is reached
/// through <c>ClassDB</c> and <c>Call</c> by name, with no compile-time checking whatsoever — and
/// the addon ships no documentation, so every method name below was read out of the binary rather
/// than out of a manual. Before a rock and vegetation system is built on top of it, it is worth
/// thirty lines to find out whether it works at all.
///
/// What it has to establish, in order:
///   1. the instancer object exists and is reachable
///   2. a Terrain3DMeshAsset can be built from a runtime-generated mesh (no .tscn on disk)
///   3. add_transforms accepts a batch and the instances survive update_mmis
///   4. they are actually rendered, not merely stored
///
///   Godot..._console.exe --path &lt;godot&gt; --script res://src/Tools/SpikeInstancerRunner.cs
///                        -- --out shot.png
/// </summary>
public partial class SpikeInstancerRunner : SceneTree
{
	private const int MeshId = 0;
	private const int Count = 240;

	private int _ticks;
	private int _failures;
	private string _out = "";
	private Terrain3DBridge? _bridge;

	public override bool _Process(double delta)
	{
		_ticks++;
		// Terrain3D builds its data object when it enters the tree, so nothing here can run on
		// the first frame - the rule the rest of the runners follow, for the same reason.
		if (_ticks == 1)
		{
			ParseArgs();
			return false;
		}

		if (_ticks == 2)
		{
			try
			{
				Run();
			}
			catch (Exception e)
			{
				GD.PushError($"EXCEPTION: {e}");
				_failures++;
			}
			// Give it a frame to render before the screenshot, if one was asked for.
			if (_out.Length > 0) return false;
			Finish();
			return true;
		}

		if (_ticks < 6) return false;
		Capture();
		Finish();
		return true;
	}

	private void Run()
	{
		var field = TerrainField.LoadFromResources();
		var root = new Node3D { Name = "World" };
		Root.AddChild(root);

		_bridge = Terrain3DBridge.Build(root, field);
		Check(_bridge is not null, "Terrain3D loads and takes the island");
		if (_bridge is null) return;

		// ---- 1: is there an instancer at all? ------------------------------------
		var instancer = _bridge.Node.Call("get_instancer").AsGodotObject();
		Check(instancer is not null, "the terrain exposes an instancer");
		if (instancer is null) return;

		// ---- 2: a mesh asset from a mesh we made here ----------------------------
		// Terrain3DMeshAsset wants a PackedScene, which normally means a .tscn on disk. A
		// procedural world has no such file, so the scene is packed in memory - if this does not
		// work the whole approach needs rethinking, which is the point of finding out now.
		var asset = ClassDB.Instantiate("Terrain3DMeshAsset").AsGodotObject();
		Check(asset is not null, "a Terrain3DMeshAsset can be instantiated from C#");
		if (asset is null) return;

		var holder = new MeshInstance3D { Name = "Rock", Mesh = RockMesh.Slab(7) };
		var scene = new PackedScene();
		Check(scene.Pack(holder) == Error.Ok, "a runtime mesh can be packed into a PackedScene");

		asset.Set("name", "spike-rock");
		asset.Set("id", MeshId);
		asset.Set("scene_file", scene);
		asset.Set("height_offset", 0.0f);
		asset.Set("cast_shadows", (int)GeometryInstance3D.ShadowCastingSetting.On);

		var assets = _bridge.Node.Get("assets").AsGodotObject();
		Check(assets is not null, "the terrain exposes its asset list");
		if (assets is null) return;
		assets.Call("set_mesh_asset", MeshId, asset);
		int meshes = assets.Call("get_mesh_count").AsInt32();
		Check(meshes > 0, $"the mesh asset was accepted ({meshes} in the list)");

		// ---- 3: a batch of transforms -------------------------------------------
		// Scattered over the island's own land rather than over a blank square: an instance
		// outside a published region has nowhere to be stored, and finding that out here is
		// cheaper than finding it out inside a spawner.
		var transforms = new Godot.Collections.Array();
		var colours = new Color[Count];
		var rng = new RandomNumberGenerator { Seed = 1337 };
		var land = field.LandCells;
		Check(land.Count > 0, $"the island has land to scatter on ({land.Count} lots)");

		int placed = 0;
		for (int i = 0; i < Count && land.Count > 0; i++)
		{
			var cell = land[(int)(rng.Randi() % (uint)land.Count)];
			var (wx, wz) = field.CellWorld(cell.X, cell.Z);
			float y = (float)field.WorldHeight(wx, wz);
			float s = 0.6f + rng.Randf() * 2.4f;
			var basis = new Basis(Vector3.Up, rng.Randf() * Mathf.Tau).Scaled(new Vector3(s, s * 0.7f, s));
			transforms.Add(new Transform3D(basis, new Vector3((float)wx, y, (float)wz)));
			colours[placed++] = Colors.White;
		}
		var colourArray = new Color[placed];
		Array.Copy(colours, colourArray, placed);

		instancer.Call("add_transforms", MeshId, transforms, colourArray, false);
		instancer.Call("update_mmis", true);
		GD.Print($"[spike] submitted {placed} transforms");

		// ---- 4: did any of it become geometry? ----------------------------------
		int mmis = CountMultiMeshes(_bridge.Node);
		int instances = TotalInstances(_bridge.Node);
		GD.Print($"[spike] MultiMeshInstance3D nodes under the terrain: {mmis}");
		GD.Print($"[spike] instances across them: {instances}");
		Check(mmis > 0, "the instancer built MultiMesh nodes");
		Check(instances > 0, $"and they carry instances ({instances} of {placed} submitted)");

		PlaceCamera(field);
	}

	/// <summary>Everything the instancer made lives under the terrain node; count it rather than
	/// trusting a return value, because a stored instance and a drawn one are different claims.</summary>
	private static int CountMultiMeshes(Node node)
	{
		int n = node is MultiMeshInstance3D ? 1 : 0;
		foreach (var child in node.GetChildren()) n += CountMultiMeshes(child);
		return n;
	}

	private static int TotalInstances(Node node)
	{
		int n = node is MultiMeshInstance3D mmi && mmi.Multimesh is not null ? mmi.Multimesh.InstanceCount : 0;
		foreach (var child in node.GetChildren()) n += TotalInstances(child);
		return n;
	}

	private void PlaceCamera(TerrainField field)
	{
		var peak = field.MainLandmass.Peak;
		var target = new Vector3(peak.At[0], peak.Y, peak.At[1]);
		var pos = target + new Vector3(70.0f, 45.0f, 90.0f);
		var camera = new Camera3D
		{
			Name = "SpikeCamera",
			Fov = 55.0f,
			Far = 3000.0f,
			Transform = new Transform3D(Basis.Identity, pos).LookingAt(target, Vector3.Up),
		};
		Root.AddChild(camera);
		camera.MakeCurrent();
		_bridge?.SetCamera(camera);

		var sun = new DirectionalLight3D
		{
			Name = "SpikeSun",
			LightEnergy = 1.1f,
			ShadowEnabled = true,
			Rotation = new Vector3(-0.85f, -0.7f, 0.0f),
		};
		Root.AddChild(sun);
		Root.AddChild(new WorldEnvironment
		{
			Environment = new Godot.Environment
			{
				BackgroundMode = Godot.Environment.BGMode.Sky,
				Sky = new Sky { SkyMaterial = new ProceduralSkyMaterial() },
				AmbientLightSource = Godot.Environment.AmbientSource.Sky,
				AmbientLightEnergy = 0.7f,
			},
		});
	}

	private void Capture()
	{
		if (_out.Length == 0) return;
		var image = Root.GetViewport().GetTexture().GetImage();
		if (image.SavePng(_out) == Error.Ok) GD.Print($"[spike] wrote {image.GetWidth()}x{image.GetHeight()} -> {_out}");
		else { GD.PushError($"could not write {_out}"); _failures++; }
	}

	private void ParseArgs()
	{
		var args = OS.GetCmdlineUserArgs();
		for (int i = 0; i < args.Length; i++)
			if (args[i] == "--out" && i + 1 < args.Length) _out = args[i + 1];
	}

	private void Finish()
	{
		GD.Print(_failures == 0
			? "OK - the instancer takes runtime meshes and transforms from C#"
			: $"{_failures} check(s) failed");
		Quit(_failures == 0 ? 0 : 1);
	}

	private void Check(bool ok, string what)
	{
		GD.Print(ok ? $"  ok   {what}" : $"  FAIL {what}");
		if (!ok) _failures++;
	}
}
