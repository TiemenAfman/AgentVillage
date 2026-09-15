using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;
using Godot;
using Promptholm.Data.Models;

namespace Promptholm.World;

/// <summary>
/// The island, as the server built it.
///
/// This replaces <c>TerrainGenerator</c>, and the difference is not that it is shorter. The old
/// one was a bit-exact port whose whole job was to arrive independently at numbers the server had
/// already worked out, and <c>island.terrainHash</c> existed to notice when the two drifted. There
/// is one generator now; this reads its output.
///
/// The coordinate system changed with it. The old grid was 64 cells of one metre, indexed by
/// <c>(gx, gz)</c> with the island in the middle; this is a sample lattice one metre apart over the
/// whole 1024 m envelope, and world positions are metres from the origin either way. Chunks that
/// were never published — open ocean far from any land — read as deep water rather than as a hole.
/// </summary>
public sealed class TerrainField
{
	/// <summary>Depth used where no chunk was published. Below the generator's seabed floor, so a
	/// published chunk always wins on the seam between the two.</summary>
	public const float UnpublishedY = -34.0f;

	public WorldManifest Manifest { get; private init; } = new();

	/// <summary>Samples per side of the whole envelope, corner lattice.</summary>
	public int N { get; private init; }

	public float MetresPerSample { get; private init; } = 1.0f;
	public float EnvelopeM { get; private init; }
	/// <summary>Half the envelope, in metres: the distance from the origin to its rim.</summary>
	public float EnvelopeHalf { get; private init; }

	/// <summary>Height in metres per sample, row-major, N a side.</summary>
	public float[] Heights { get; private init; } = Array.Empty<float>();

	/// <summary>Terrain class per sample; see <see cref="TerrainClass"/>.</summary>
	public byte[] Classes { get; private init; } = Array.Empty<byte>();

	public string WorldRev => Manifest.WorldRev;
	public int ChunkCount { get; private init; }

	// ---- loading ------------------------------------------------------------------

	/// <summary>
	/// Assemble a field from a byte source. The source is given paths relative to the world root
	/// ("manifest.json", "chunk/-1_2.a1b2c3d4.bin") and returns their contents or null; that is
	/// all that differs between reading <c>res://world/</c> and fetching from the server, so the
	/// loading logic lives here once.
	/// </summary>
	public static TerrainField Load(Func<string, byte[]?> read)
	{
		byte[]? manifestBytes = read("manifest.json") ?? throw new InvalidOperationException(
			"no world manifest: the server has not published a world, and res://world/ is missing");

		var manifest = JsonSerializer.Deserialize<WorldManifest>(manifestBytes, VillageJson.DefaultOptions)
			?? throw new InvalidOperationException("the world manifest did not parse");

		if (manifest.WorldV != 2)
			throw new InvalidOperationException($"world format v{manifest.WorldV}, this build reads v2");

		int n = (int)Math.Round(manifest.EnvelopeM / manifest.MetresPerSample) + 1;
		var heights = new float[n * n];
		var classes = new byte[n * n];
		// Everything is open ocean until a chunk says otherwise. Filling first means an envelope
		// with half its chunks unpublished still renders as a sea with an island in it, which is
		// exactly what a partly grown island is.
		Array.Fill(heights, UnpublishedY);
		Array.Fill(classes, TerrainClass.Sea);

		float half = manifest.EnvelopeM / 2.0f;
		int loaded = 0;

		foreach (var info in manifest.Chunks)
		{
			byte[]? raw = read($"chunk/{info.Cx}_{info.Cz}.{info.Hash}.bin");
			if (raw is null)
			{
				GD.PushWarning($"world chunk {info.Cx},{info.Cz} is in the manifest but missing");
				continue;
			}

			var chunk = TerrainChunk.Decode(raw);
			int originI = (int)Math.Round((chunk.Cx * manifest.ChunkM + half) / manifest.MetresPerSample);
			int originJ = (int)Math.Round((chunk.Cz * manifest.ChunkM + half) / manifest.MetresPerSample);

			for (int j = 0; j < chunk.Samples; j++)
			{
				int dj = originJ + j;
				if (dj < 0 || dj >= n) continue;
				for (int i = 0; i < chunk.Samples; i++)
				{
					int di = originI + i;
					if (di < 0 || di >= n) continue;
					int dst = di + dj * n;
					int src = i + j * chunk.Samples;
					heights[dst] = chunk.Heights[src];
					classes[dst] = chunk.Classes[src];
				}
			}
			loaded++;
		}

		// A manifest with chunks and not one of them readable is not a partly grown island, it is
		// a broken build - and it fails in the most misleading way there is: the field is all sea,
		// so every house lands on water and the village looks like it sank. That happened for real.
		// `export_presets.cfg` carried `include_filter="*.json"`, which ships village.json and
		// manifest.json and leaves every `.bin` chunk behind, and the only sign was a warning per
		// chunk in a console the player does not have.
		if (manifest.Chunks.Count > 0 && loaded == 0)
		{
			GD.PushError(
				$"the world manifest names {manifest.Chunks.Count} chunks and none of them could be read. "
				+ "In an exported build this means export_presets.cfg is not shipping *.bin; "
				+ "in the editor it means res://world/chunk/ is empty or out of date with the manifest.");
		}

		return new TerrainField
		{
			Manifest = manifest,
			N = n,
			MetresPerSample = manifest.MetresPerSample,
			EnvelopeM = manifest.EnvelopeM,
			EnvelopeHalf = half,
			Heights = heights,
			Classes = classes,
			ChunkCount = loaded,
		};
	}

	/// <summary>Load the copy baked into the project, which is what runs when no server answers.</summary>
	public static TerrainField LoadFromResources(string root = "res://world")
		=> Load(path =>
		{
			string full = $"{root}/{path}";
			return Godot.FileAccess.FileExists(full) ? Godot.FileAccess.GetFileAsBytes(full) : null;
		});

	// ---- queries ------------------------------------------------------------------

	public bool InField(int i, int j) => i >= 0 && j >= 0 && i < N && j < N;

	/// <summary>Sample index nearest a world position, clamped to the envelope.</summary>
	public (int I, int J) SampleAt(float x, float z) => (
		Math.Clamp((int)MathF.Round((x + EnvelopeHalf) / MetresPerSample), 0, N - 1),
		Math.Clamp((int)MathF.Round((z + EnvelopeHalf) / MetresPerSample), 0, N - 1));

	/// <summary>World position of a sample, in metres.</summary>
	public (float X, float Z) WorldOf(int i, int j) => (i * MetresPerSample - EnvelopeHalf, j * MetresPerSample - EnvelopeHalf);

	public float HeightOf(int i, int j) =>
		InField(i, j) ? Heights[i + j * N] : UnpublishedY;

	public byte ClassOf(int i, int j) =>
		InField(i, j) ? Classes[i + j * N] : TerrainClass.Sea;

	/// <summary>Bilinear ground height at a world position. The one query everything stands on.</summary>
	public float HeightAt(float x, float z)
	{
		float fx = Math.Clamp((x + EnvelopeHalf) / MetresPerSample, 0.0f, N - 1.0001f);
		float fz = Math.Clamp((z + EnvelopeHalf) / MetresPerSample, 0.0f, N - 1.0001f);
		int i = (int)fx, j = (int)fz;
		float u = fx - i, v = fz - j;
		float h00 = Heights[i + j * N];
		float h10 = Heights[i + 1 + j * N];
		float h01 = Heights[i + (j + 1) * N];
		float h11 = Heights[i + 1 + (j + 1) * N];
		return Mathf.Lerp(Mathf.Lerp(h00, h10, u), Mathf.Lerp(h01, h11, u), v);
	}

	public byte ClassAt(float x, float z)
	{
		var (i, j) = SampleAt(x, z);
		return Classes[i + j * N];
	}

	public bool IsLandAt(float x, float z) => !TerrainClass.IsWater(ClassAt(x, z));

	/// <summary>Slope magnitude in metres per metre, from a central difference.</summary>
	public float SlopeOf(int i, int j)
	{
		float gx = (HeightOf(Math.Min(i + 1, N - 1), j) - HeightOf(Math.Max(i - 1, 0), j)) / (2.0f * MetresPerSample);
		float gz = (HeightOf(i, Math.Min(j + 1, N - 1)) - HeightOf(i, Math.Max(j - 1, 0))) / (2.0f * MetresPerSample);
		return MathF.Sqrt(gx * gx + gz * gz);
	}

	/// <summary>
	/// Walk every land sample. An iterator and not a materialised list on purpose: the old island
	/// had 1,841 land cells and this one has around 90,000, so handing out an array of tuples
	/// would allocate megabytes every time somebody wanted to scatter a few trees.
	/// </summary>
	public IEnumerable<(int I, int J)> LandSamples()
	{
		for (int j = 0; j < N; j++)
			for (int i = 0; i < N; i++)
				if (!TerrainClass.IsWater(Classes[i + j * N]))
					yield return (i, j);
	}

	public int CountClass(byte cls)
	{
		int n = 0;
		foreach (byte c in Classes) if (c == cls) n++;
		return n;
	}

	// ---- the layout grid, for now -------------------------------------------------
	//
	// The village is expressed in **lots**: `plot.gx`, `path.cells`, every parcel bitmap count
	// lots, and a lot is four metres. That is the one number this whole layer exists to apply.
	//
	// It used to be one metre to the cell, which is why a road was a metre wide and two people
	// could not pass on it. The server now plans in lots of four (lib/world/lotfield.mjs) and
	// says so in `village.island.metresPerLot`; nothing here should ever assume the figure.

	/// <summary>Side of the layout grid in lots. Set from `village.grid.size`.</summary>
	public int Size { get; set; } = 256;

	/// <summary>Metres to the lot. From `village.island.metresPerLot`; four, at the time of writing.</summary>
	public double MetresPerLot { get; set; } = 4.0;

	/// <summary>Half the layout grid, in lots.</summary>
	public double Half => Size / 2.0;

	/// <summary>A span of lots in metres: the one place a footprint or a tile gets its size.</summary>
	public float Span(double lots) => (float)(lots * MetresPerLot);

	/// <summary>The world seed, for the hashes that scatter props and fields.</summary>
	public uint IslandSeed => (uint)Manifest.Seed;

	public bool InGrid(int gx, int gz) => gx >= 0 && gz >= 0 && gx < Size && gz < Size;

	/// <summary>Centre of a lot, in world metres. Mirrors `cellWorld` in lib/world/lotfield.mjs,
	/// which is the definition: if these two disagree the village stands somewhere the server
	/// never put it.</summary>
	public (double X, double Z) CellWorld(int gx, int gz)
		=> ((gx - Half + 0.5) * MetresPerLot, (gz - Half + 0.5) * MetresPerLot);

	/// <summary>Corner of a block of lots, in world metres: where a plot's geometry starts.</summary>
	public (double X, double Z) CellCorner(int gx, int gz)
		=> ((gx - Half) * MetresPerLot, (gz - Half) * MetresPerLot);

	/// <summary>
	/// The lot a world position falls in, packed into one long so it can go in a set.
	///
	/// Every scatterer needs this and they all need the same answer: the scatter runs on samples
	/// and the village's cleared ground is expressed in lots, so somebody has to convert, and two
	/// spawners converting separately is one sign error away from a forest growing through the
	/// market square.
	/// </summary>
	public long LotKeyAt(float wx, float wz)
	{
		int gx = (int)Math.Floor(wx / MetresPerLot + Half);
		int gz = (int)Math.Floor(wz / MetresPerLot + Half);
		return ((long)gx << 32) | (uint)gz;
	}

	/// <summary>The lots the village has taken — plots, roads, the square — in the same key space
	/// as <see cref="LotKeyAt"/>. Nothing wild grows back on them.</summary>
	public static HashSet<long> ClearedLots(VillageData village)
	{
		var set = new HashSet<long>();
		foreach (var cell in village.Cleared)
			if (cell.Count >= 2) set.Add(((long)cell[0] << 32) | (uint)cell[1]);
		return set;
	}

	/// <summary>Ground height at a world position. Kept in double for the callers that were
	/// written against the old generator.</summary>
	public double WorldHeight(double x, double z) => HeightAt((float)x, (float)z);

	public double CellHeightAt(int gx, int gz)
	{
		var (x, z) = CellWorld(gx, gz);
		return WorldHeight(x, z);
	}

	public bool IsLand(int gx, int gz)
	{
		if (!InGrid(gx, gz)) return false;
		var (x, z) = CellWorld(gx, gz);
		return IsLandAt((float)x, (float)z);
	}

	public bool IsWater(int gx, int gz) => !IsLand(gx, gz);

	public bool IsBeach(int gx, int gz)
	{
		if (!InGrid(gx, gz)) return false;
		var (x, z) = CellWorld(gx, gz);
		return TerrainClass.IsSand(ClassAt((float)x, (float)z));
	}

	public double Slope(int gx, int gz)
	{
		var (x, z) = CellWorld(gx, gz);
		var (i, j) = SampleAt((float)x, (float)z);
		return SlopeOf(i, j);
	}

	/// <summary>Layout cells that are land. Built once and cached; the grid is small.</summary>
	public List<(int X, int Z)> LandCells
	{
		get
		{
			if (_landCells is not null) return _landCells;
			_landCells = new List<(int, int)>();
			for (int gz = 0; gz < Size; gz++)
				for (int gx = 0; gx < Size; gx++)
					if (IsLand(gx, gz)) _landCells.Add((gx, gz));
			return _landCells;
		}
	}

	private List<(int X, int Z)>? _landCells;

	/// <summary>Where the high ground is. The old generator knew because it put the hill there;
	/// this reads it off the manifest, where the server named it.</summary>
	public (double X, double Y) HillCentre => (MainLandmass.Peak.At[0], MainLandmass.Peak.At[1]);

	/// <summary>The main island: the largest landmass, and where the town stands.</summary>
	public LandmassInfo MainLandmass =>
		Manifest.Landmasses.Count > 0 ? Manifest.Landmasses[0] : new LandmassInfo();
}

// ---- the manifest, as the server writes it ----------------------------------------

public sealed class WorldManifest
{
	[JsonPropertyName("worldV")] public int WorldV { get; set; }
	[JsonPropertyName("worldRev")] public string WorldRev { get; set; } = "";
	[JsonPropertyName("seed")] public long Seed { get; set; }
	[JsonPropertyName("envelopeM")] public float EnvelopeM { get; set; } = 1024.0f;
	[JsonPropertyName("radiusM")] public float RadiusM { get; set; } = 208.0f;
	[JsonPropertyName("metresPerSample")] public float MetresPerSample { get; set; } = 1.0f;
	[JsonPropertyName("chunkM")] public float ChunkM { get; set; } = 64.0f;
	[JsonPropertyName("quantum")] public float Quantum { get; set; } = 1.0f / 256.0f;
	[JsonPropertyName("seaLevel")] public float SeaLevel { get; set; }
	[JsonPropertyName("clipped")] public bool Clipped { get; set; }
	/// <summary>Metres from a river bed to its surface. Fresh water is a class here, not a height:
	/// a stream at thirty metres is still a stream.</summary>
	[JsonPropertyName("riverDepth")] public float RiverDepth { get; set; } = 1.1f;
	[JsonPropertyName("lakeDepth")] public float LakeDepth { get; set; } = 2.2f;
	[JsonPropertyName("landmasses")] public List<LandmassInfo> Landmasses { get; set; } = new();
	[JsonPropertyName("landings")] public List<LandingInfo> Landings { get; set; } = new();
	[JsonPropertyName("rivers")] public List<RiverInfo> Rivers { get; set; } = new();
	[JsonPropertyName("lakes")] public List<LakeInfo> Lakes { get; set; } = new();
	[JsonPropertyName("chunks")] public List<ChunkInfo> Chunks { get; set; } = new();
}

public sealed class ChunkInfo
{
	[JsonPropertyName("cx")] public int Cx { get; set; }
	[JsonPropertyName("cz")] public int Cz { get; set; }
	[JsonPropertyName("hash")] public string Hash { get; set; } = "";
	[JsonPropertyName("bytes")] public int Bytes { get; set; }
	[JsonPropertyName("minY")] public float MinY { get; set; }
	[JsonPropertyName("maxY")] public float MaxY { get; set; }
}

public sealed class LandmassInfo
{
	[JsonPropertyName("index")] public int Index { get; set; }
	[JsonPropertyName("areaHa")] public float AreaHa { get; set; }
	[JsonPropertyName("centroid")] public float[] Centroid { get; set; } = { 0, 0 };
	/// <summary>minX, minZ, maxX, maxZ in metres.</summary>
	[JsonPropertyName("bounds")] public float[] Bounds { get; set; } = { 0, 0, 0, 0 };
	[JsonPropertyName("peak")] public PeakInfo Peak { get; set; } = new();

	public Vector3 CentreXZ => new(Centroid[0], 0.0f, Centroid[1]);
	public float RadiusM => MathF.Max(Bounds[2] - Bounds[0], Bounds[3] - Bounds[1]) * 0.5f;
}

public sealed class PeakInfo
{
	[JsonPropertyName("at")] public float[] At { get; set; } = { 0, 0 };
	[JsonPropertyName("y")] public float Y { get; set; }

	public Vector3 Position => new(At[0], Y, At[1]);
}

public sealed class LandingInfo
{
	[JsonPropertyName("landmass")] public int Landmass { get; set; }
	[JsonPropertyName("at")] public float[] At { get; set; } = { 0, 0 };
}

public sealed class RiverInfo
{
	[JsonPropertyName("id")] public string Id { get; set; } = "";
	[JsonPropertyName("source")] public float[] Source { get; set; } = { 0, 0 };
	[JsonPropertyName("mouth")] public float[] Mouth { get; set; } = { 0, 0 };
	[JsonPropertyName("lengthM")] public float LengthM { get; set; }
	[JsonPropertyName("spine")] public List<float[]> Spine { get; set; } = new();
}

public sealed class LakeInfo
{
	[JsonPropertyName("id")] public string Id { get; set; } = "";
	[JsonPropertyName("centre")] public float[] Centre { get; set; } = { 0, 0 };
	[JsonPropertyName("radiusM")] public float RadiusM { get; set; }
	[JsonPropertyName("surfaceY")] public float SurfaceY { get; set; }
}
