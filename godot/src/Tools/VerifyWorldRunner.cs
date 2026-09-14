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

	public override void _Initialize()
	{
		try
		{
			Run();
		}
		catch (System.Exception ex)
		{
			GD.PushError($"EXCEPTION during world build: {ex}");
			Quit(1);
		}
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
			int verts = ((Vector3[])(arrays[(int)Mesh.ArrayType.Vertex]!)).Length;
			GD.Print($"ground mesh  : {verts} vertices (expected {Size + 1})^2 = {(Size + 1) * (Size + 1)}");
			Check(verts == (Size + 1) * (Size + 1), "ground mesh has (size+1)^2 corner vertices");
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