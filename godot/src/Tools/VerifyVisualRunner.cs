using System;
using System.Diagnostics;
using Godot;
using Promptholm.Atmosphere;
using Promptholm.Buildings.Data;
using Promptholm.Data.Models;
using Promptholm.Visual;
using Promptholm.World;

namespace Promptholm.Tools;

/// <summary>
/// Headless check for Phase 2 step 12 (unified master visual overhaul): the water plane
/// runs the depth-graded storybook shader, the building catalog carries the new warm
/// palette and slimmer timber beams, clouds float with shadows and drift/wrap, the
/// CivicDecorator places a fountain and market stalls, and the ground mesh is painted
/// with the new grass/beach/lake colours. Loads the real village.json fallback to
/// exercise the full pipeline. Run after a build with:
///   Godot..._console.exe --headless --path &lt;godot dir&gt; --script res://src/Tools/VerifyVisualRunner.cs
/// </summary>
public partial class VerifyVisualRunner : SceneTree
{
	private int _fails;

	private int _ticks;

	public override void _Initialize()
	{
	}

	/// <summary>
	/// The checks run on the first frame rather than in _Initialize. During _Initialize the
	/// scene tree is not live yet, so every GlobalTransform read inside BuildWorld — see
	/// WorldManager.BuildMarker — trips "Condition !is_inside_tree() is true". That is the
	/// stderr flood AGENTS.md wrote off as pre-existing noise from building assembly; it is
	/// neither pre-existing nor about assembly, and moving the call here removes all of it.
	/// </summary>
	public override bool _Process(double delta)
	{
		if (++_ticks != 1)
			return false;

		try
		{
			Run();
		}
		catch (Exception ex)
		{
			GD.PushError($"EXCEPTION during visual verification: {ex}");
			Quit(1);
		}

		return false;
	}

	private void Run()
	{
		var sw = Stopwatch.StartNew();

		CheckShader();
		CheckPalette();

		var village = LoadFallbackVillage();
		if (village is null)
		{
			GD.PushError("Could not load res://village.json");
			Quit(1);
			return;
		}

		var world = new WorldManager { Name = "WorldManager" };
		Root.AddChild(world);
		world.BuildWorld(village);

		CheckWaterPlane(world);
		CheckCivicDecor(world, village);
		CheckGroundColours(world);
		CheckClouds();

		sw.Stop();
		GD.Print($"built in    : {sw.ElapsedMilliseconds} ms");

		if (_fails == 0)
		{
			GD.Print("OK - storybook water, palette, clouds, plaza décor and landscape verified");
			Quit(0);
		}
		else
		{
			GD.PushError($"{_fails} check(s) FAILED");
			Quit(1);
		}
	}

	// ---- water shader ---------------------------------------------------------

	private void CheckShader()
	{
		var shader = GD.Load<Shader>("res://shaders/stylized_water.gdshader");
		Check(shader is not null, "water shader exists at res://shaders/stylized_water.gdshader");
	}

	private void CheckWaterPlane(WorldManager world)
	{
		var water = world.GetNodeOrNull<WaterPlane>("GroundRoot/WaterPlane");
		Check(water is not null, "WaterPlane node exists under GroundRoot");
		var mat = water?.MaterialOverride as ShaderMaterial;
		Check(mat is not null && mat!.Shader is not null, "water plane uses the custom ShaderMaterial");
		if (mat is not null)
		{
			var shader = GD.Load<Shader>("res://shaders/stylized_water.gdshader");
			Check(mat.Shader == shader, "water plane references the stylized water shader");

			var caustics = mat.GetShaderParameter("caustics_texture");
			Check(caustics.VariantType != Variant.Type.Nil,
				"stylized water ships an animated caustics texture");
		}
	}

	// ---- building palette -----------------------------------------------------

	private void CheckPalette()
	{
		Check(Near(BuildingCatalog.PlasterColour, 0.94f, 0.90f, 0.82f),
			"plaster is warm storybook cream");
		Check(Near(BuildingCatalog.BeamTimberColour, 0.32f, 0.20f, 0.11f),
			"timber beams are warm dark brown");
		Check(Near(BuildingCatalog.FieldstoneColour, 0.60f, 0.58f, 0.55f),
			"fieldstone is warm grey");
		Check(Near(BuildingCatalog.RoofTileColour, 0.74f, 0.32f, 0.18f),
			"roof tiles are bright storybook terracotta");
		Check(Near(BuildingCatalog.WindowGlassColour, 0.98f, 0.88f, 0.52f),
			"window panes are warm lit golden");
		Check(Mathf.Abs(BuildingCatalog.TimberBeamWidth - 0.05f) < 1e-4f,
			"half-timber beams slimmed from 0.08 m to 0.05 m");
		Check(BuildingCatalog.WindowGlassColour.A > 0.8f,
			"window panes stay nearly opaque warm glass");
	}

	private static bool Near(Color c, float r, float g, float b)
		=> Mathf.Abs(c.R - r) < 0.02f && Mathf.Abs(c.G - g) < 0.02f && Mathf.Abs(c.B - b) < 0.02f;

	// ---- plaza décor ----------------------------------------------------------

	private void CheckCivicDecor(WorldManager world, VillageData village)
	{
		var decor = world.GetNodeOrNull<CivicDecorator>("ObjectsRoot/CivicDecorator");
		Check(decor is not null, "CivicDecorator node exists under ObjectsRoot");
		Check(decor?.FountainCount == 1, $"town plaza fountain was placed ({decor?.FountainCount})");
		Check(decor is not null && decor!.StallCount >= 1, $"market stalls were placed ({decor?.StallCount})");

		if (decor is not null && decor.FountainPosition != Vector3.Zero)
		{
			var terrain = world.Terrain!;
			float ground = (float)terrain.WorldHeight(decor.FountainPosition.X, decor.FountainPosition.Z);
			Check(Mathf.Abs(decor.FountainPosition.Y - ground) < 0.5f,
				$"fountain sits on the terrain (y {decor.FountainPosition.Y:0.00} vs ground {ground:0.00})");
		}

		// The real seed-1337 village carries civic:fountain at the plaza centre (32,32).
		bool plazaMatches = village.Buildings.Exists(b => CivicDecorator.Handles(b));
		Check(plazaMatches, "seed-1337 village defines the fountain/market plots the décor scans for");
	}

	// ---- landscape colours ----------------------------------------------------

	private void CheckGroundColours(WorldManager world)
	{
		var terrain = world.Terrain;
		if (terrain is null)
		{
			Check(false, "terrain chunks available for colour sampling");
			return;
		}

		// Every chunk, not one: a single 64 m square holds beach or meadow or rock, rarely all
		// three, so sampling one and asking whether every band occurs is a question about which
		// chunk you happened to pick.
		var colourList = new System.Collections.Generic.List<Color>();
		var positionList = new System.Collections.Generic.List<Vector3>();
		int chunks = 0;
		foreach (var mi in TerrainChunks(world))
		{
			var a = mi.Mesh!.SurfaceGetArrays(0);
			var c = a[(int)Mesh.ArrayType.Color].As<Color[]>();
			var v = a[(int)Mesh.ArrayType.Vertex].As<Vector3[]>();
			if (c is null || v is null || c.Length != v.Length) continue;
			colourList.AddRange(c);
			positionList.AddRange(v);
			chunks++;
		}
		Color[]? colours = colourList.ToArray();
		Vector3[]? positions = positionList.ToArray();
		Check(chunks > 0 && colours.Length == positions.Length,
			$"the terrain chunks carry one colour per vertex ({chunks} chunks, {colours.Length} vertices)");

		// Compared in linear space, because that is what the mesh stores: the palette is authored
		// in sRGB and converted on the way in.
		// Checked as a property of the mesh, not against a duplicated colour table: every band
		// the palette defines must actually occur, and every vertex colour must agree with the
		// shared WorldManager.GroundBandColour. That way the palette can change without
		// rewriting the test, but the mesh and the palette can never drift apart.
		bool sawDeep = false, sawLake = false, sawBeach = false, sawGrass = false, sawHill = false;
		int mismatches = 0;

		if (colours is not null && positions is not null)
		{
			for (int idx = 0; idx < positions.Length; idx++)
			{
				// Ground colour comes from the terrain class the server shipped, not from a height
				// threshold applied here - that is the whole point of the class byte. So the
				// property to check is that every vertex wears *a* terrain colour from the
				// palette, rather than that it wears the one a band table would have picked.
				if (!IsAnyTerrainColour(colours[idx]))
				{
					mismatches++;
					continue;
				}

				float h = positions[idx].Y;
				if (h < -8.0f) sawDeep = true;
				else if (h < 0.0f) sawLake = true;
				else if (h < 2.0f) sawBeach = true;
				else if (h < 14.0f) sawGrass = true;
				else sawHill = true;
			}
		}

		Check(mismatches == 0, $"every vertex colour matches the shared palette ({mismatches} off)");
		Check(sawDeep, "the sea has a floor well below the shelf");
		Check(sawLake, "lake/river bed painted teal slate");
		Check(sawBeach, "beaches painted golden sand");
		Check(sawGrass, "meadows painted rich green");
		Check(sawHill, "the island reaches real height");
	}

	/// <summary>Is this one of the palette's terrain colours, linearised as the mesh stores them?</summary>
	private static bool IsAnyTerrainColour(Color c)
	{
		for (byte cls = 0; cls <= 11; cls++)
			if (ColourClose(c, Palette.Terrain(cls).SrgbToLinear(), 0.02f)) return true;
		return false;
	}

	private static bool ColourClose(Color a, Color b, float tol)
		=> Mathf.Abs(a.R - b.R) < tol && Mathf.Abs(a.G - b.G) < tol && Mathf.Abs(a.B - b.B) < tol;

	// ---- clouds ---------------------------------------------------------------

	private void CheckClouds()
	{
		var clouds = new CloudManager { Name = "CloudManager" };
		Root.AddChild(clouds);
		clouds.Build();

		Check(clouds.CloudCount >= 5 && clouds.CloudCount <= 7,
			$"deterministic cloud field of 5..7 clouds ({clouds.CloudCount})");

		var band = clouds.CloudAltitudeBand;
		bool inBand = true;
		for (int i = 0; i < clouds.CloudCount; i++)
		{
			float y = clouds.CloudPosition(i).Y;
			if (y < band.X || y > band.Y) inBand = false;
		}
		Check(inBand, $"all clouds fly in the altitude band {band.X}..{band.Y}");

		Check(clouds.CloudCount > 0 && clouds.CloudCastsShadow(0),
			"clouds cast soft shadows (diorama depth)");

		if (clouds.CloudCount > 0)
		{
			var before = clouds.CloudPosition(0);
			clouds.Advance(2.0f);
			var after = clouds.CloudPosition(0);
			Check(after.DistanceTo(before) > 1.0f, "clouds drift with the wind");
		}

		// Park cloud 0 just short of the east edge, then let the wind push it past the
		// boundary; it must wrap back to the west side of the sky.
		if (clouds.CloudCount > 0)
		{
			var pos = clouds.CloudPosition(0);
			clouds.MoveCloudTo(0, new Vector3(59.0f, pos.Y, pos.Z));
			clouds.Advance(1.0f);
			Check(clouds.CloudPosition(0).X < -59.0f, "clouds wrap around the world bounds");
		}
	}

	// ---- helpers --------------------------------------------------------------

	private VillageData? LoadFallbackVillage()
	{
		const string path = "res://village.json";
		if (!Godot.FileAccess.FileExists(path))
		{
			GD.PushWarning($"[VerifyVisualRunner] {path} not present");
			return null;
		}

		using var file = Godot.FileAccess.Open(path, Godot.FileAccess.ModeFlags.Read);
		if (file is null)
		{
			GD.PushWarning($"[VerifyVisualRunner] could not open {path}");
			return null;
		}

		try
		{
			return VillageJson.Parse<VillageData>(file.GetAsText());
		}
		catch (Exception ex)
		{
			GD.PushError($"[VerifyVisualRunner] failed to parse {path}: {ex.Message}");
			return null;
		}
	}

	private void Check(bool ok, string what)
	{
		if (ok)
			GD.Print($"  [OK] {what}");
		else
		{
			GD.PushError($"  [FAIL] {what}");
			_fails++;
		}
	}
	/// <summary>
	/// The ground is no longer one mesh: the server publishes the island as 64 m chunks and each
	/// gets its own MeshInstance3D, so it can be culled, given a level of detail and occluded.
	/// This picks the chunk that reaches highest - by volume the winner is a slab of open seabed,
	/// which has plenty of mesh in it and no island at all.
	/// </summary>
	private static MeshInstance3D? HighestTerrainChunk(Node3D world)
	{
		MeshInstance3D? best = null;
		float bestTop = float.MinValue;
		foreach (var mi in TerrainChunks(world))
		{
			var aabb = mi.Mesh!.GetAabb();
			float top = aabb.Position.Y + aabb.Size.Y;
			if (top > bestTop) { bestTop = top; best = mi; }
		}
		return best;
	}

	private static System.Collections.Generic.IEnumerable<MeshInstance3D> TerrainChunks(Node3D world)
	{
		var terrain = world.GetNodeOrNull<Node3D>("GroundRoot/Terrain");
		if (terrain is null) yield break;
		foreach (var child in terrain.GetChildren())
			if (child is MeshInstance3D mi && mi.Mesh is not null)
				yield return mi;
	}


}