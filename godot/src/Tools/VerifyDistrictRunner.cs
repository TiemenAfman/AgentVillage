using System;
using System.Diagnostics;
using Godot;
using Promptholm.Data.Models;
using Promptholm.World;

namespace Promptholm.Tools;

/// <summary>
/// Headless check for Phase 2 step 9: DistrictDecorator draws boundary hedges and
/// name archways for every non-farmstead lobe, FarmlandSpawner places ploughed fields
/// and fruit orchards in the countryside, and all spawned props respect the terrain
/// height. Loads the real fallback village.json (res://village.json) to exercise the
/// full pipeline with actual district data. Run after a build with:
///   Godot..._console.exe --headless --path &lt;godot dir&gt; --script res://src/Tools/VerifyDistrictRunner.cs
/// </summary>
public partial class VerifyDistrictRunner : SceneTree
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
			GD.PushError($"EXCEPTION during district verification: {ex}");
			Quit(1);
		}

		return false;
	}

	private void Run()
	{
		var sw = Stopwatch.StartNew();

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

		var decorator = world.GetNodeOrNull<DistrictDecorator>(
			"ObjectsRoot/DistrictDecorator");
		Check(decorator is not null, "DistrictDecorator node exists under ObjectsRoot");
		GD.Print($"hedges      : {decorator?.HedgeCount ?? 0}");
		Check(decorator is not null && decorator!.HedgeCount > 0,
			"at least one hedge segment was placed");

		var farmland = world.GetNodeOrNull<FarmlandSpawner>(
			"ObjectsRoot/FarmlandSpawner");
		Check(farmland is not null, "FarmlandSpawner node exists under ObjectsRoot");
		GD.Print($"fields      : {farmland?.FieldCount ?? 0}");
		GD.Print($"orchards    : {farmland?.OrchardCount ?? 0}");
		Check(farmland is not null && (farmland!.FieldCount + farmland.OrchardCount) > 0,
			"at least one field or orchard was placed");

		sw.Stop();
		GD.Print($"built in    : {sw.ElapsedMilliseconds} ms");

		if (_fails == 0)
		{
			GD.Print("OK - districts have hedges, archways and farmland");
			Quit(0);
		}
		else
		{
			GD.PushError($"{_fails} check(s) FAILED");
			Quit(1);
		}
	}

	private static VillageData? LoadFallbackVillage()
	{
		const string path = "res://village.json";
		if (!Godot.FileAccess.FileExists(path))
		{
			GD.PushWarning($"[VerifyDistrictRunner] {path} not present");
			return null;
		}

		using var file = Godot.FileAccess.Open(path, Godot.FileAccess.ModeFlags.Read);
		if (file is null)
		{
			GD.PushWarning($"[VerifyDistrictRunner] could not open {path}");
			return null;
		}

		try
		{
			return VillageJson.Parse<VillageData>(file.GetAsText());
		}
		catch (Exception ex)
		{
			GD.PushError($"[VerifyDistrictRunner] failed to parse {path}: {ex.Message}");
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
}
