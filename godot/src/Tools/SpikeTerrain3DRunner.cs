using System;
using Godot;
using Promptholm.World;

namespace Promptholm.Tools;

/// <summary>
/// A spike, not a feature: does Terrain3D load on Godot 4.7.2 mono, and can the island we already
/// bake be pushed into it from C#?
///
/// Terrain3D declares compatibility_minimum 4.4 and its own notes say 4.4 to 4.6; 4.7 is
/// untested by its author. And because it is a GDExtension, C# gets no generated bindings for it -
/// everything goes through ClassDB.Instantiate and Call by name, which is the second thing this
/// has to establish.
///
///   Godot..._console.exe --headless --path &lt;godot&gt; --script res://src/Tools/SpikeTerrain3DRunner.cs
/// </summary>
public partial class SpikeTerrain3DRunner : SceneTree
{
	private int _failures;

	private int _frames;

	public override bool _Process(double delta)
	{
		_frames++;
		// Terrain3D builds its data object when it enters the tree, so nothing here can run in
		// _Initialize - the same rule the rest of the runners follow, for the same reason.
		if (_frames < 2) return false;

		try
		{
			Run();
		}
		catch (Exception e)
		{
			GD.PushError($"EXCEPTION: {e}");
			_failures++;
		}

		GD.Print(_failures == 0
			? "OK - Terrain3D loads and takes our heightmap on this Godot build"
			: $"{_failures} check(s) failed");
		Quit(_failures == 0 ? 0 : 1);
		return true;
	}

	private void Run()
	{
		Check(ClassDB.ClassExists("Terrain3D"), "the Terrain3D class is registered");
		Check(ClassDB.ClassExists("Terrain3DData"), "Terrain3DData is registered");
		Check(ClassDB.ClassExists("Terrain3DRegion"), "Terrain3DRegion is registered");
		if (_failures > 0) return;

		// No generated C# bindings for a GDExtension: everything is by name.
		var terrain = ClassDB.Instantiate("Terrain3D").AsGodotObject() as Node3D;
		Check(terrain is not null, "a Terrain3D node can be instantiated from C#");
		if (terrain is null) return;

		Root.AddChild(terrain);
		// The node has to be in the tree before it has data; the scene tree is what builds it.
		terrain.Set("vertex_spacing", 1.0f);
		GD.Print($"region_size  : {terrain.Get("region_size")}   vertex_spacing {terrain.Get("vertex_spacing")}");

		var data = terrain.Get("data").AsGodotObject();
		Check(data is not null, "the terrain exposes its data object");
		if (data is null) return;

		// ---- push one of our own chunks in ------------------------------------------
		var field = TerrainField.LoadFromResources();
		var main = field.MainLandmass;
		GD.Print($"our island   : {main.AreaHa:F2} ha, peak {main.Peak.Y:F1} m");

		// A region is the unit Terrain3D stores: build one from our heights and hand it over.
		// import_images turned out to be the wrong door - it wants whole images aligned to the
		// region grid - and add_region with a Terrain3DRegion is the direct one.
		terrain.Call("change_region_size", 64);
		int size = terrain.Get("region_size").AsInt32();
		GD.Print($"region_size  : {size} m");

		// Region location is in regions, not metres. Take the one holding the island's peak.
		int rx = (int)MathF.Floor(main.Peak.At[0] / size);
		int rz = (int)MathF.Floor(main.Peak.At[1] / size);
		float originX = rx * size, originZ = rz * size;

		var heightImage = Image.CreateEmpty(size, size, false, Image.Format.Rf);
		float lo = float.MaxValue, hi = float.MinValue;
		for (int j = 0; j < size; j++)
		{
			for (int i = 0; i < size; i++)
			{
				float h = field.HeightAt(originX + i, originZ + j);
				heightImage.SetPixel(i, j, new Color(h, 0, 0));
				lo = MathF.Min(lo, h);
				hi = MathF.Max(hi, h);
			}
		}
		GD.Print($"pushing      : region ({rx},{rz}) at ({originX:F0}, {originZ:F0}), heights {lo:F1} .. {hi:F1} m");

		var region = ClassDB.Instantiate("Terrain3DRegion").AsGodotObject();
		Check(region is not null, "a Terrain3DRegion can be built from C#");
		if (region is null) return;
		region.Call("set_region_size", size);
		region.Call("set_vertex_spacing", 1.0f);
		region.Call("set_location", new Vector2I(rx, rz));
		region.Call("set_height_map", heightImage);
		region.Call("sanitize_maps");
		region.Call("calc_height_range");

		data.Call("add_region", region, true);
		int regions = data.Call("get_region_count").AsInt32();
		Check(regions > 0, $"the region was added ({regions})");

		// ---- does it agree with us? --------------------------------------------------
		int sampled = 0, close = 0;
		float worst = 0.0f;
		for (int j = 4; j < size - 4; j += 7)
		{
			for (int i = 4; i < size - 4; i += 7)
			{
				float ours = field.HeightAt(originX + i, originZ + j);
				float theirs = data.Call("get_height", new Vector3(originX + i, 0, originZ + j)).AsSingle();
				if (float.IsNaN(theirs)) continue;
				sampled++;
				float diff = MathF.Abs(theirs - ours);
				worst = MathF.Max(worst, diff);
				if (diff < 0.30f) close++;
			}
		}
		GD.Print($"agreement    : {close}/{sampled} samples within 0.30 m, worst {worst:F2} m");
		Check(sampled > 0, "Terrain3D returns heights inside the region");
		Check(sampled > 0 && close == sampled, "the heights it returns are the heights we gave it");

		// ---- the thing tunnels need ---------------------------------------------------
		Check(ClassDB.ClassHasMethod("Terrain3DData", "set_control_hole"), "holes are a per-pixel control bit - this is how a tunnel mouth is cut");
		Check(ClassDB.ClassHasMethod("Terrain3DData", "set_control_navigation"), "ground can be painted navigable");
		Check(ClassDB.ClassHasMethod("Terrain3D", "generate_nav_mesh_source_geometry"), "it feeds Godot's navmesh baker");
		Check(ClassDB.ClassHasMethod("Terrain3D", "bake_mesh"), "the terrain can be baked to a static mesh");
		Check(ClassDB.ClassHasMethod("Terrain3D", "set_mesh_lods"), "the clipmap has levels of detail");
		Check(ClassDB.ClassHasMethod("Terrain3D", "set_collision_mode"), "collision is generated for us");
	}

	private void Check(bool ok, string what)
	{
		GD.Print(ok ? $"  ok   {what}" : $"  FAIL {what}");
		if (!ok) _failures++;
	}
}
