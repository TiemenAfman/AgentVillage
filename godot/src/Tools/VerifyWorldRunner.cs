using System;
using System.Collections.Generic;
using System.Diagnostics;
using Godot;
using Promptholm.Buildings;
using Promptholm.Buildings.Slots;
using Promptholm.Data.Models;
using Promptholm.World;

namespace Promptholm.Tools;

/// <summary>
/// Headless check that WorldManager builds the 3D ground from the TerrainGenerator and
/// live-assembles each building through the BuildingAssembler at the PlotData position.
/// Run after a build with:
///   Godot..._console.exe --headless --path &lt;godot dir&gt; --script res://src/Tools/VerifyWorldRunner.cs
/// </summary>
public partial class VerifyWorldRunner : SceneTree
{
	private const uint Seed = 1337;
	private const int Size = 64;
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
			GD.PushError($"EXCEPTION during world build: {ex}");
			Quit(1);
		}

		return false;
	}

	private void Run()
	{
		var sw = Stopwatch.StartNew();

		var world = new WorldManager { Name = "WorldManager" };
		Root.AddChild(world);

		world.BuildWorld(SampleVillage());
		sw.Stop();

		GD.Print($"terrain hash : {world.Terrain?.TerrainHash}   expected {ExpectedHash}");
		Check(world.Terrain?.TerrainHash == ExpectedHash, "terrain hash matches the JS island");

		var meshInstance = FindIslandMesh(world);
		Check(meshInstance is not null, "ground ArrayMesh exists under GroundRoot");
		if (meshInstance?.Mesh is Mesh am)
		{
			var arrays = am.SurfaceGetArrays(0);
			var positions = (Vector3[])(arrays[(int)Mesh.ArrayType.Vertex]!);
			int verts = positions.Length;
			var aabb = am.GetAabb();
			GD.Print($"ground mesh  : {verts} vertices, aabb {aabb.Position} size {aabb.Size}");

			// The old assertion pinned verts == (size+1)^2, which froze an implementation detail
			// and blocked the seabed apron. What actually matters is the contract: every data
			// corner is still represented, and the mesh reaches far enough past the island that
			// its edge is never visible through the water.
			Check(verts >= (Size + 1) * (Size + 1),
				"ground mesh covers at least the data grid's corners");
			Check(aabb.Size.X > 2.0f * WorldManager.SeabedReachMetres * 0.9f,
				$"seabed reaches past the island so no mesh edge shows ({aabb.Size.X:0} m across)");
			Check(aabb.Position.Y <= WorldManager.SeabedFloorY + WorldManager.SeabedRelief + 0.01f,
				$"seabed sinks to the open-ocean floor ({aabb.Position.Y:0.0} m)");

			// Land must be untouched by the apron: the highest point still comes from terrain.H.
			double peak = 0.0;
			foreach (var h in world.Terrain!.H)
				peak = Math.Max(peak, h);
			Check(Mathf.Abs(aabb.Position.Y + aabb.Size.Y - (float)peak) < 0.01f,
				$"land heights are unchanged (peak {peak:0.00} m)");
		}

		var buildings = world.GetNodeOrNull<Node3D>("ObjectsRoot");
		Check(buildings is not null, "ObjectsRoot exists");
		int buildingCount = 0;
		if (buildings is not null)
		{
			foreach (var child in buildings.GetChildren())
			{
				if (child.Name.ToString().StartsWith("Building_", StringComparison.Ordinal))
					buildingCount++;
			}
		}
		GD.Print($"buildings    : {buildingCount}");
		Check(buildingCount == 4, "all 4 sample buildings were placed");

		int totalPieces = 0;
		if (buildings is not null)
		{
			foreach (var child in buildings.GetChildren())
			{
				if (child is not Node3D root)
					continue;
				if (!root.Name.ToString().StartsWith("Building_", StringComparison.Ordinal))
					continue;
				var assembler = root.GetNodeOrNull<BuildingAssembler>("BuildingAssembler");
				Check(assembler is not null, $"building '{root.Name}' has a BuildingAssembler");
				if (assembler is null)
					continue;

				int occupied = CountOccupiedSlots(assembler);
				totalPieces += occupied;
				GD.Print($"  {root.Name}: tier-positioned, {occupied} pieces attached");
				Check(occupied >= 7, $"building '{root.Name}' assembled at least foundation/walls/roof/door pieces");
			}
		}

		Check(totalPieces >= 28, $"total attached pieces across buildings ({totalPieces})");

		var roads = world.GetNodeOrNull<Node3D>("GroundRoot/Roads");
		Check(roads is not null && roads!.GetChildCount() > 0, "cobblestone MultiMesh exists under GroundRoot/Roads");
		var bridgesRoot = world.GetNodeOrNull<Node3D>("ObjectsRoot/Bridges");
		int bridgeCount = bridgesRoot?.GetChildCount() ?? 0;
		GD.Print($"bridges      : {bridgeCount}");
		Check(bridgeCount == 1, "bridge deck was built under ObjectsRoot/Bridges");

		// Rebuild. VillageClient polls and calls BuildWorld again on every change, so the second
		// build is the normal case, not an edge case — and it is the only one that exercised the
		// road/bridge teardown. That teardown called RemoveChild on the WorldManager instead of
		// on the root it was iterating, so nothing was ever detached and the counts doubled.
		int roadsFirst = roads?.GetChildCount() ?? 0;
		world.BuildWorld(SampleVillage());

		roads = world.GetNodeOrNull<Node3D>("GroundRoot/Roads");
		bridgesRoot = world.GetNodeOrNull<Node3D>("ObjectsRoot/Bridges");
		int roadsSecond = roads?.GetChildCount() ?? 0;
		int bridgesSecond = bridgesRoot?.GetChildCount() ?? 0;
		GD.Print($"rebuild      : roads {roadsFirst} -> {roadsSecond}, bridges {bridgeCount} -> {bridgesSecond}");
		Check(roadsSecond == roadsFirst, "rebuilding replaces the road tiles instead of stacking them");
		Check(bridgesSecond == bridgeCount, "rebuilding replaces the bridges instead of stacking them");

		int rebuiltBuildings = 0;
		foreach (var child in world.GetNodeOrNull<Node3D>("ObjectsRoot")!.GetChildren())
			if (child.Name.ToString().StartsWith("Building_", StringComparison.Ordinal))
				rebuiltBuildings++;
		Check(rebuiltBuildings == buildingCount, "rebuilding replaces the buildings instead of stacking them");

		sw.Stop();
		GD.Print($"built in     : {sw.ElapsedMilliseconds} ms");

		if (_fails == 0)
		{
			GD.Print("OK - world builds and buildings assemble at their plot positions");
			Quit(0);
		}
		else
		{
			GD.PushError($"{_fails} check(s) FAILED");
			Quit(1);
		}
	}

	private static VillageData SampleVillage()
	{
		var buildings = new List<BuildingData>
		{
			Building("b-house", "house", "house-tier-2", 20, 20, 2, 2, 0, []),
			Building("b-hut", "hut", "hut", 10, 30, 1, 1, 2, []),
			Building("b-civic", "civic", "civic", 40, 40, 3, 3, 1, new List<object> { "flag" }),
			Building("b-tent", "tent", "tent", 30, 12, 1, 1, 0, []),
		};

		return new VillageData
		{
			Island = new IslandData
			{
				Seed = Seed,
				TerrainHash = ExpectedHash,
				Town = new TownData
				{
					Paved = new List<List<int>> { new() { 30, 20 }, new() { 31, 20 } },
				},
			},
			Grid = new GridData { Size = Size },
			Buildings = buildings,
			Paths = new List<PathData>
			{
				new() { Id = "p1", Cells = new List<List<int>> { new() { 20, 20 }, new() { 21, 20 }, new() { 22, 20 } } },
			},
			Bridges = new List<BridgeData>
			{
				new()
				{
					Id = "b1",
					Axis = "z",
					Cells = new List<List<int>>
					{
						new() { 33, 28 },
						new() { 33, 29 },
						new() { 33, 30 },
					},
				},
			},
		};
	}

	private static BuildingData Building(string id, string kind, string tier, int gx, int gz, int w, int d, int rot, List<object> ornaments)
	{
		return new BuildingData
		{
			Id = id,
			Kind = kind,
			Tier = tier,
			Plot = new PlotData { Gx = gx, Gz = gz, W = w, D = d, Rot = rot },
			Ornaments = ornaments,
		};
	}

	private static MeshInstance3D? FindIslandMesh(Node3D root)
	{
		var ground = root.GetNodeOrNull<Node3D>("GroundRoot");
		return ground?.GetNodeOrNull<MeshInstance3D>("IslandMesh");
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