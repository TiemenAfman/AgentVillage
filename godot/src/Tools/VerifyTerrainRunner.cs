using System;
using System.Diagnostics;
using Godot;
using Promptholm.World;

namespace Promptholm.Tools;

/// <summary>
/// Headless check that the C# terrain matches the JS one bit for bit, mirroring
/// tools/verify_terrain.gd. Run after a build with:
///   Godot..._console.exe --headless --path <godot dir> --script res://src/Tools/VerifyTerrainRunner.cs
/// The expected hash is island.terrainHash from village.json; anything else means the
/// island Godot draws is not the island the server laid its houses out on.
/// </summary>
public partial class VerifyTerrainRunner : SceneTree
{
	private const uint Seed = 1337;
	private const int Size = 64;
	private const string Expected = "f7ec71ac";

	public override void _Initialize()
	{
		var sw = Stopwatch.StartNew();
		var terrain = TerrainGenerator.Generate(Seed, Size);
		sw.Stop();

		GD.Print($"seed        : {Seed}  size {Size}");
		GD.Print($"hash        : {terrain.TerrainHash}   expected {Expected}");
		GD.Print($"built in    : {sw.ElapsedMilliseconds} ms");
		GD.Print($"hill/lake   : {terrain.HillCentre.X:F6}, {terrain.HillCentre.Y:F6} / {terrain.LakeCentre.X:F6}, {terrain.LakeCentre.Y:F6}");
		GD.Print($"rivers      : {terrain.Rivers.Count}");
		for (int i = 0; i < terrain.Rivers.Count; i++)
		{
			var c = terrain.Rivers[i];
			GD.Print($"  course of {c.Count} cells, {c[0]} -> {c[^1]}");
		}
		GD.Print($"land cells  : {terrain.LandCells.Count}");
		GD.Print($"beach cells : {terrain.BeachCells.Count}");
		GD.Print($"coast cells : {terrain.CoastCells.Count}");
		GD.Print($"river cells : {terrain.RiverCells.Count}  banks {terrain.RiverBankCells.Count}");

		if (terrain.TerrainHash == Expected)
		{
			GD.Print("OK - identical to the JS terrain");
			Quit(0);
		}
		else
		{
			GD.PushError("MISMATCH - the C# port does not agree with shared/terrain.mjs");
			Quit(1);
		}
	}
}