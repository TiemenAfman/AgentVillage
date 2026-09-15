using System;
using System.Diagnostics;
using System.Net.Http;
using Godot;
using Promptholm.Buildings;
using Promptholm.Buildings.Slots;
using Promptholm.Data.Models;
using Promptholm.World;
using HttpClient = System.Net.Http.HttpClient;

namespace Promptholm.Tools;

/// <summary>
/// Headless end-to-end check against the live local server: fetch village.json, parse it
/// with the same VillageJson options VillageClient uses, build the world and assemble every
/// building. Prints the terrain hash and piece counts. Run with the server on port 4747:
///   Godot..._console.exe --headless --path &lt;godot dir&gt; --script res://src/Tools/VerifyLiveRunner.cs
/// </summary>
public partial class VerifyLiveRunner : SceneTree
{
	private const string ExpectedHash = "f7ec71ac";

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
		catch (System.Exception ex)
		{
			GD.PushError($"EXCEPTION during live build: {ex}");
			Quit(1);
		}

		return false;
	}

	private void Run()
	{
		var sw = Stopwatch.StartNew();

		using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
		string json = http.GetStringAsync("http://localhost:4747/village.json?ts=" + DateTime.UtcNow.Ticks).GetAwaiter().GetResult();
		var village = VillageJson.Parse<VillageData>(json);
		if (village is null)
		{
			GD.PushError("live village.json did not parse");
			Quit(1);
			return;
		}

		GD.Print($"village      : {village.Island.Name}  rev={village.DistrictsRev}");
		GD.Print($"buildings    : {village.Buildings.Count}  grid {village.Grid.Size}");
		Check(village.DistrictsRev is not null, "districtsRev parses (string-converter)");

		var world = new WorldManager { Name = "WorldManager" };
		Root.AddChild(world);
		world.BuildWorld(village);
		sw.Stop();

		GD.Print($"terrain hash : {world.Terrain?.WorldRev}   expected {ExpectedHash}");
		Check(world.Terrain?.WorldRev == ExpectedHash, "live island matches the generated terrain");

		var objects = world.GetNodeOrNull<Node3D>("ObjectsRoot");
		Check(objects?.GetChildCount() is not null and > 0, "buildings were placed in the scene");
		if (objects is null)
		{
			Quit(_fails == 0 ? 0 : 1);
			return;
		}

		int placed = 0;
		int totalPieces = 0;
		foreach (var child in objects.GetChildren())
		{
			if (child is not Node3D root)
				continue;
			var assembler = root.GetNodeOrNull<BuildingAssembler>("BuildingAssembler");
			if (assembler is null)
				continue;
			placed++;
			totalPieces += CountOccupiedSlots(assembler);
		}
		GD.Print($"assembled    : {placed} buildings, {totalPieces} pieces total");
		Check(placed == village.Buildings.Count, "every village building got an assembler");
		Check(totalPieces > placed * 7, "each building carried at least its base pieces");

		GD.Print($"built in     : {sw.ElapsedMilliseconds} ms");

		if (_fails == 0)
		{
			GD.Print("OK - live village.json drives the 3D world");
			Quit(0);
		}
		else
		{
			GD.PushError($"{_fails} check(s) FAILED");
			Quit(1);
		}
	}

	private static int CountOccupiedSlots(BuildingAssembler assembler)
	{
		int count = 0;
		foreach (var child in assembler.GetChildren())
		{
			if (child is BuildingSlot3D slot && slot.IsOccupied)
				count++;
		}
		return count;
	}

	private void Check(bool ok, string what)
	{
		if (ok)
		{
			GD.Print($"  [OK] {what}");
		}
		else
		{
			GD.PushError($"  [FAIL] {what}");
			_fails++;
		}
	}
}