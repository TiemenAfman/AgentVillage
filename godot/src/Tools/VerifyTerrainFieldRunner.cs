using System;
using System.Diagnostics;
using Godot;
using Promptholm.World;

namespace Promptholm.Tools;

/// <summary>
/// Headless check that the client can read the world the server published. Run with:
///   Godot..._console.exe --headless --path &lt;godot dir&gt; --script res://src/Tools/VerifyTerrainFieldRunner.cs
///
/// This replaces VerifyTerrainRunner, and the change of question is the point. That one asked
/// "does the C# port of the generator agree with the JS one, to the bit" — a question that only
/// existed because the same algorithm was written twice. There is one generator now, so the
/// question becomes "does the decoder read what the encoder wrote", which is a far smaller thing
/// to get wrong and a far easier thing to fix when it is.
/// </summary>
public partial class VerifyTerrainFieldRunner : SceneTree
{
	private int _failures;

	public override void _Initialize()
	{
		var sw = Stopwatch.StartNew();
		TerrainField field;
		try
		{
			field = TerrainField.LoadFromResources();
		}
		catch (Exception e)
		{
			GD.PushError($"could not load res://world: {e.Message}");
			Quit(1);
			return;
		}
		sw.Stop();

		var m = field.Manifest;
		GD.Print($"worldRev    : {m.WorldRev}   seed {m.Seed}   v{m.WorldV}");
		GD.Print($"envelope    : {m.EnvelopeM} m at {m.MetresPerSample} m/sample -> {field.N}x{field.N}");
		GD.Print($"chunks      : {field.ChunkCount} of {m.Chunks.Count} loaded in {sw.ElapsedMilliseconds} ms");
		GD.Print($"landmasses  : {m.Landmasses.Count}   rivers {m.Rivers.Count}   lakes {m.Lakes.Count}");

		var main = field.MainLandmass;
		GD.Print($"main island : {main.AreaHa:F2} ha, peak {main.Peak.Y:F1} m at ({main.Peak.At[0]:F0}, {main.Peak.At[1]:F0})");

		int land = 0, sea = 0, beach = 0, river = 0, lake = 0, rock = 0;
		float lo = float.MaxValue, hi = float.MinValue;
		foreach (byte c in field.Classes)
		{
			if (TerrainClass.IsWater(c)) sea++; else land++;
			if (c == TerrainClass.Beach) beach++;
			if (c == TerrainClass.River) river++;
			if (c == TerrainClass.Lake) lake++;
			if (TerrainClass.IsBare(c)) rock++;
		}
		foreach (float h in field.Heights) { if (h < lo) lo = h; if (h > hi) hi = h; }

		GD.Print($"samples     : {land} land, {sea} water  ({beach} beach, {river} river, {lake} lake, {rock} bare)");
		GD.Print($"height range: {lo:F1} .. {hi:F1} m");

		Check(field.ChunkCount == m.Chunks.Count, $"every chunk the manifest names was read ({field.ChunkCount}/{m.Chunks.Count})");
		Check(!m.Clipped, "the island does not run off the edge of the envelope");
		Check(land > 50_000, $"there is an island to stand on ({land} land samples)");
		Check(hi > 15.0f, $"it has relief ({hi:F1} m)");
		Check(hi <= 60.0f, $"and is not a spike ({hi:F1} m)");
		Check(river > 100, $"the watercourses arrived ({river} samples)");
		Check(m.Landmasses.Count >= 4, $"the archipelago arrived ({m.Landmasses.Count} landmasses)");

		// The peak the manifest names has to be where the samples say it is. This is the one
		// check that would catch a chunk written at the wrong offset, which is the mistake this
		// format makes easiest and the hardest to see in a screenshot.
		float atPeak = field.HeightAt(main.Peak.At[0], main.Peak.At[1]);
		Check(MathF.Abs(atPeak - main.Peak.Y) < 0.5f,
			$"the samples agree with the named peak ({atPeak:F2} m against {main.Peak.Y:F2} m)");

		// And the sea is where the sea should be: at the centroid of a skerry there is land, and
		// a long way outside every landmass there is not.
		if (m.Landmasses.Count > 1)
		{
			var skerry = m.Landmasses[1];
			Check(field.IsLandAt(skerry.Centroid[0], skerry.Centroid[1]),
				$"landmass 1 has land at its own centroid ({skerry.Centroid[0]:F0}, {skerry.Centroid[1]:F0})");
		}
		Check(!field.IsLandAt(m.EnvelopeM / 2 - 8, m.EnvelopeM / 2 - 8), "the far corner of the envelope is open sea");

		if (_failures == 0)
		{
			GD.Print("OK - the client reads the world the server wrote");
			Quit(0);
		}
		else
		{
			GD.PushError($"{_failures} check(s) failed");
			Quit(1);
		}
	}

	private void Check(bool ok, string what)
	{
		GD.Print(ok ? $"  ok   {what}" : $"  FAIL {what}");
		if (!ok) _failures++;
	}
}
