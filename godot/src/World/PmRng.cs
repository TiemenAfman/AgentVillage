// COSMETIC ONLY - this never decides where anything stands.
//
// It used to. Both this and PmSimplex existed to reproduce the server's terrain bit for bit in
// C#, and island.terrainHash was the assertion that they did. The server ships the terrain now,
// so what is left is decoration: which way a tree faces, which patch of ground grows a field.
// If you find yourself reaching for this to decide a position, a height or a classification,
// that answer belongs on the server and should arrive as data.

using System;

namespace Promptholm.World;

/// <summary>
/// C# port of scripts/rng.gd (which is itself a port of shared/rng.mjs).
/// The contract: integer maths only, no transcendental functions, and every step masks
/// back to uint32, so Godot's C# build and the JS reference agree bit for bit.
/// JS numbers are int32 inside the bitwise operators while .NET uint wraps modulo 2^32,
/// which is the same thing after masking.
/// </summary>
public sealed class PmRng
{
	private readonly uint _seed;
	private uint _state;

	public const uint U32 = 0xFFFFFFFF;

	public PmRng(uint seed)
	{
		_seed = seed;
		_state = seed;
	}

	/// <summary>GDScript's split-half Math.imul collapsed to one wrapping uint multiply.</summary>
	public static uint Imul(uint a, uint b) => unchecked(a * b);

	/// <summary>
	/// 32-bit FNV-1a over UTF-16 code units. GDScript hashes with <c>unicode_at()</c> — the
	/// same thing a C# char is — so byte-for-byte identical inputs are required.
	/// </summary>
	public static uint Hash32(string s)
	{
		uint h = 0x811c9dc5;
		foreach (char c in s)
		{
			h ^= (uint)c;
			h *= 0x01000193;
		}
		return h;
	}

	/// <summary>JS Math.round: half rounds towards +infinity (GDScript round() does not).</summary>
	public static double JsRound(double x) => Math.Floor(x + 0.5);

	/// <summary>JS Math.round as a 32-bit int, the form the terrain hash needs.</summary>
	public static int JsRoundToInt(double x) => (int)Math.Floor(x + 0.5);

	/// <summary>Mulberry32. Each step stays a positive uint, so signed/unsigned shifts agree.</summary>
	public double Next()
	{
		_state += 0x6d2b79f5;
		uint t = _state;
		t = Imul(t ^ (t >> 15), t | 1);
		t ^= t + Imul(t ^ (t >> 7), t | 61);
		return (t ^ (t >> 14)) / 4294967296.0;
	}

	public int IntN(int n) => (int)Math.Floor(Next() * n);

	public double RangeF(double a, double b) => a + Next() * (b - a);

	public bool Chance(double p) => Next() < p;

	/// <summary>The seed string is str(seed_value), i.e. the unsigned constructor seed.</summary>
	public PmRng Fork(string label) => new(Hash32(_seed.ToString() + ":" + label));
}