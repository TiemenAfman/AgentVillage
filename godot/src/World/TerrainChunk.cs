using System;
using System.IO;
using System.IO.Compression;

namespace Promptholm.World;

/// <summary>
/// One 64 m square of ground as it arrives from the server: heights and a terrain class per
/// sample, gzipped, with the heights delta-coded along +x.
///
/// This is the whole of what used to be <c>TerrainGenerator</c> plus <c>PmRng</c> plus
/// <c>PmSimplex</c> — about nine hundred lines of bit-exact port whose only job was to arrive at
/// the same numbers the server had already worked out. Reading the numbers instead is not a
/// simplification for its own sake: it is what removes the whole category of bug where two
/// implementations of <c>isBeach</c> drift apart and a house ends up in the sea on one side and
/// on grass on the other.
///
/// Format is written by <c>lib/world/chunks.mjs</c>. Keep the two in step; the magic and the
/// sample count are checked on the way in so a mismatch fails loudly rather than rendering
/// noise.
/// </summary>
public sealed class TerrainChunk
{
	public const string Magic = "PHC1";
	private const int HeaderBytes = 20;

	public int Cx { get; private init; }
	public int Cz { get; private init; }
	public int Samples { get; private init; }
	public float Quantum { get; private init; }

	/// <summary>Heights in metres, row-major, <see cref="Samples"/> a side.</summary>
	public float[] Heights { get; private init; } = Array.Empty<float>();

	/// <summary>Terrain class per sample; the values in <see cref="TerrainClass"/>.</summary>
	public byte[] Classes { get; private init; } = Array.Empty<byte>();

	public static TerrainChunk Decode(byte[] gzipped)
	{
		byte[] raw;
		using (var input = new MemoryStream(gzipped))
		using (var gzip = new GZipStream(input, CompressionMode.Decompress))
		using (var output = new MemoryStream())
		{
			gzip.CopyTo(output);
			raw = output.ToArray();
		}

		if (raw.Length < HeaderBytes)
			throw new InvalidDataException($"chunk is {raw.Length} bytes, too short to hold a header");

		string magic = System.Text.Encoding.ASCII.GetString(raw, 0, 4);
		if (magic != Magic)
			throw new InvalidDataException($"not a Promptholm chunk: magic {magic}");

		int cx = BitConverter.ToInt32(raw, 4);
		int cz = BitConverter.ToInt32(raw, 8);
		int samples = BitConverter.ToUInt16(raw, 14);
		float quantum = BitConverter.ToSingle(raw, 16);

		int count = samples * samples;
		int expected = HeaderBytes + count * 2 + count;
		if (raw.Length < expected)
			throw new InvalidDataException($"chunk ({cx},{cz}) is {raw.Length} bytes, expected {expected}");

		var heights = new float[count];
		// Delta-coded, restarting each row, so a row decodes without the one before it.
		for (int j = 0; j < samples; j++)
		{
			short running = 0;
			for (int i = 0; i < samples; i++)
			{
				int k = i + j * samples;
				running += BitConverter.ToInt16(raw, HeaderBytes + k * 2);
				heights[k] = running * quantum;
			}
		}

		var classes = new byte[count];
		Buffer.BlockCopy(raw, HeaderBytes + count * 2, classes, 0, count);

		return new TerrainChunk
		{
			Cx = cx,
			Cz = cz,
			Samples = samples,
			Quantum = quantum,
			Heights = heights,
			Classes = classes,
		};
	}
}

/// <summary>
/// What a sample of ground is, as the server decided. Mirrors <c>CLASS</c> in
/// <c>lib/world/classify.mjs</c>.
///
/// This replaces <c>terrainHash</c> as the thing that keeps both sides honest. The thresholds
/// that decide beach from meadow used to be written out in two languages and the hash existed to
/// notice when the copies drifted; shipping the verdict means there is only ever one opinion.
/// </summary>
public static class TerrainClass
{
	public const byte Sea = 0;
	public const byte Shallow = 1;
	public const byte Beach = 2;
	public const byte Dune = 3;
	public const byte Meadow = 4;
	public const byte Wood = 5;
	public const byte Scree = 6;
	public const byte Rock = 7;
	public const byte Cliff = 8;
	public const byte River = 9;
	public const byte Lake = 10;
	public const byte Polder = 11;

	public static bool IsWater(byte cls) => cls is Sea or Shallow or River or Lake;
	public static bool IsSand(byte cls) => cls is Beach or Dune;
	public static bool IsBare(byte cls) => cls is Scree or Rock or Cliff;

	public static string Name(byte cls) => cls switch
	{
		Sea => "sea", Shallow => "shallow", Beach => "beach", Dune => "dune",
		Meadow => "meadow", Wood => "wood", Scree => "scree", Rock => "rock",
		Cliff => "cliff", River => "river", Lake => "lake", Polder => "polder",
		_ => $"class {cls}",
	};
}
