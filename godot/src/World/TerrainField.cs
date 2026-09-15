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
	public float Half { get; private init; }

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

		return new TerrainField
		{
			Manifest = manifest,
			N = n,
			MetresPerSample = manifest.MetresPerSample,
			EnvelopeM = manifest.EnvelopeM,
			Half = half,
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
		Math.Clamp((int)MathF.Round((x + Half) / MetresPerSample), 0, N - 1),
		Math.Clamp((int)MathF.Round((z + Half) / MetresPerSample), 0, N - 1));

	/// <summary>World position of a sample, in metres.</summary>
	public (float X, float Z) WorldOf(int i, int j) => (i * MetresPerSample - Half, j * MetresPerSample - Half);

	public float HeightOf(int i, int j) =>
		InField(i, j) ? Heights[i + j * N] : UnpublishedY;

	public byte ClassOf(int i, int j) =>
		InField(i, j) ? Classes[i + j * N] : TerrainClass.Sea;

	/// <summary>Bilinear ground height at a world position. The one query everything stands on.</summary>
	public float HeightAt(float x, float z)
	{
		float fx = Math.Clamp((x + Half) / MetresPerSample, 0.0f, N - 1.0001f);
		float fz = Math.Clamp((z + Half) / MetresPerSample, 0.0f, N - 1.0001f);
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
