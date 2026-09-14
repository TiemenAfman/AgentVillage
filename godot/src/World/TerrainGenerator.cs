using System;
using System.Collections.Generic;

namespace Promptholm.World;

/// <summary>A drained polder, as village.json describes one under <c>polders</c>.</summary>
public sealed record PolderSpec(IReadOnlyList<(int X, int Z)> Cells, IReadOnlyList<(int X, int Z)> Dike);

/// <summary>
/// C# port of scripts/terrain.gd (which is itself a port of shared/terrain.mjs). The
/// island is not in village.json: only the seed is, and both the Node layout and the
/// browser renderer build the ground from it. Godot has to agree with them to the last
/// bit, or a house lands in the sea here and on grass there. <see cref="TerrainHash"/>
/// against island.terrainHash is the check that says whether it does.
/// All arithmetic is double, matching GDScript's 64-bit float; integer branches are uint.
/// </summary>
public sealed class TerrainGenerator
{
	public const double SeaLevel = 0.0;
	public const double BeachMax = 0.35;
	public const double BuildSlopeMax = 0.6;
	public const double BuildHeightMax = 4.2;
	public const double PolderH = 96.0 / 256.0;
	public const double DikeH = 224.0 / 256.0;

	private const double RiverBed = -0.55;
	private const double RiverRise = 1.5;
	private const double RiverW0 = 0.6;
	private const double RiverW1 = 0.95;
	private const double RiverPull = 0.45;
	private const double RiverWobble = 0.16;
	private const double RiverCentreKeep = 11.0;
	private const int RiverMouthReach = 2;
	private const int RiverNear = 4;
	private const double LakeR = 4.0;

	private static readonly double[] Dir16X =
	{
		1, 0.9238795325112867, 0.7071067811865476, 0.3826834323650898,
		0, -0.3826834323650898, -0.7071067811865476, -0.9238795325112867,
		-1, -0.9238795325112867, -0.7071067811865476, -0.3826834323650898,
		0, 0.3826834323650898, 0.7071067811865476, 0.9238795325112867,
	};
	private static readonly double[] Dir16Y =
	{
		0, 0.3826834323650898, 0.7071067811865476, 0.9238795325112867,
		1, 0.9238795325112867, 0.7071067811865476, 0.3826834323650898,
		0, -0.3826834323650898, -0.7071067811865476, -0.9238795325112867,
		-1, -0.9238795325112867, -0.7071067811865476, -0.3826834323650898,
	};

	public int Size { get; private set; }
	public int N { get; private set; }
	public double Half { get; private set; }
	public double[] H { get; private set; } = Array.Empty<double>();
	public uint IslandSeed { get; private set; }
	public (double X, double Y) HillCentre { get; private set; }
	public (double X, double Y) LakeCentre { get; private set; }
	public List<List<(int X, int Z)>> Rivers { get; private set; } = new();
	public List<(int X, int Z)> RiverCells { get; private set; } = new();
	public List<(int X, int Z)> RiverBankCells { get; private set; } = new();
	public List<(int X, int Z)> LandCells { get; private set; } = new();
	public List<(int X, int Z)> BeachCells { get; private set; } = new();
	public List<(int X, int Z)> CoastCells { get; private set; } = new();
	private byte[] _wet = Array.Empty<byte>();
	public string TerrainHash { get; private set; } = "";

	public TerrainGenerator(uint seed, int gridSize = 64, IReadOnlyList<PolderSpec>? polders = null)
	{
		IslandSeed = seed;
		Size = gridSize;
		N = gridSize + 1;
		Half = gridSize / 2.0;
		Build(polders);
	}

	public static TerrainGenerator Generate(uint seed, int gridSize = 64, IReadOnlyList<PolderSpec>? polders = null)
		=> new(seed, gridSize, polders);

	private void Build(IReadOnlyList<PolderSpec>? polders)
	{
		H = new double[N * N];
		var nShape = new PmSimplex(PmRng.Hash32(IslandSeed.ToString() + ":shape"));
		var nCoast = new PmSimplex(PmRng.Hash32(IslandSeed.ToString() + ":coast"));
		var rng = new PmRng(IslandSeed).Fork("terrain");

		int kHill = rng.IntN(16);
		double hillDist = 11.0 + rng.RangeF(0.0, 4.0);
		HillCentre = (Dir16X[kHill] * hillDist, Dir16Y[kHill] * hillDist);
		int kSh = (kHill + (rng.Chance(0.5) ? 2 : 14)) % 16;
		var shoulderCentre = (Dir16X[kSh] * (hillDist - 2.0), Dir16Y[kSh] * (hillDist - 2.0));
		int kLake = (kHill + 7 + rng.IntN(3)) % 16;
		double lakeDist = 8.0 + rng.RangeF(0.0, 4.0);
		LakeCentre = (Dir16X[kLake] * lakeDist, Dir16Y[kLake] * lakeDist);
		double coastScale = Half * 0.9375;

		for (int j = 0; j < N; j++)
		{
			for (int i = 0; i < N; i++)
			{
				double x = i - Half;
				double z = j - Half;
				double e01 = nShape.Fbm2(x * 0.055, z * 0.055, 4) * 0.5 + 0.5;
				double d = Math.Sqrt(x * x + z * z) / coastScale;
				double dw = d + 0.18 * nCoast.Fbm2(x * 0.03, z * 0.03, 2);
				double fall = 1.0 - PmSimplex.SmoothstepJs(0.55, 1.0, dw);
				double h = (0.35 + 0.65 * e01) * fall * 3.2 - 0.6;
				h -= 1.9 * PmSimplex.SmoothstepJs(0.9, 1.35, dw);
				double th = Math.Clamp(1.0 - DistTo(x, z, HillCentre) / 8.0, 0.0, 1.0);
				h += 4.6 * Bump(th);
				double ts = Math.Clamp(1.0 - DistTo(x, z, shoulderCentre) / 6.0, 0.0, 1.0);
				h += 1.8 * Bump(ts);
				double tl = Math.Clamp(1.0 - DistTo(x, z, LakeCentre) / LakeR, 0.0, 1.0);
				double sl = Bump(tl);
				if (sl > 0.0)
					h = Math.Min(h, Lerp(0.3, -0.9, sl));
				H[i + j * N] = h;
			}
		}

		H = BoxBlur(BoxBlur(H));
		Quantise();

		// Rivers are drawn from a fork of their own: taking these numbers from rng would
		// shift every later draw and move the hill on every island that already exists.
		var rr = new PmRng(IslandSeed).Fork("rivers");
		var courses = new List<List<(int X, int Z)>>();
		var sides = new List<int>();
		if (rr.Chance(0.55))
			sides.AddRange(new[] { 1, -1 });
		else
			sides.Add(rr.Chance(0.5) ? 1 : -1);

		foreach (int side in sides)
		{
			int kSrc = (kHill + side * (2 + rr.IntN(2)) + 16) % 16;
			int kEnd = (kHill + side * (4 + rr.IntN(3)) + 16) % 16;
			int startX = (int)Math.Floor(HillCentre.X + Dir16X[kSrc] * 3.0 + Half - 0.5 + 0.5);
			int startZ = (int)Math.Floor(HillCentre.Y + Dir16Y[kSrc] * 3.0 + Half - 0.5 + 0.5);
			var mouthX = Dir16X[kEnd] * (Half - 2.0);
			var mouthZ = Dir16Y[kEnd] * (Half - 2.0);
			var course = RiverCourse((startX, startZ), (mouthX, mouthZ));
			if (course.Count >= 6)
				courses.Add(course);
		}
		foreach (var course in courses)
			CarveRiver(course);
		if (courses.Count > 0)
			Quantise();
		Rivers = courses;

		if (polders != null)
		{
			foreach (var p in polders)
			{
				foreach (var c in p.Cells)
					SetCell(c.X, c.Z, PolderH);
				foreach (var c in p.Dike)
					SetCell(c.X, c.Z, DikeH);
			}
		}

		Classify();
		TerrainHash = HashHeights();
	}

	// ---- helpers ----------------------------------------------------------------

	private static double DistTo(double x, double z, (double X, double Y) c)
	{
		double dx = x - c.X;
		double dz = z - c.Y;
		return Math.Sqrt(dx * dx + dz * dz);
	}

	private static double Bump(double t) => t * t * (3.0 - 2.0 * t);

	private static double Lerp(double a, double b, double t) => a + (b - a) * t;

	private double[] BoxBlur(double[] src)
	{
		var outv = new double[N * N];
		for (int j = 0; j < N; j++)
		{
			for (int i = 0; i < N; i++)
			{
				double sum = 0.0;
				int cnt = 0;
				for (int dj = -1; dj <= 1; dj++)
				{
					int jj = j + dj;
					if (jj < 0 || jj >= N)
						continue;
					for (int di = -1; di <= 1; di++)
					{
						int ii = i + di;
						if (ii < 0 || ii >= N)
							continue;
						sum += src[ii + jj * N];
						cnt++;
					}
				}
				outv[i + j * N] = sum / cnt;
			}
		}
		return outv;
	}

	private void Quantise()
	{
		for (int k = 0; k < H.Length; k++)
			H[k] = Math.Max(-2.5, PmRng.JsRound(H[k] * 256.0) / 256.0);
	}

	private void SetCell(int gx, int gz, double v)
	{
		if (gx < 0 || gz < 0 || gx >= Size || gz >= Size)
			return;
		H[gx + gz * N] = v;
		H[gx + 1 + gz * N] = v;
		H[gx + (gz + 1) * N] = v;
		H[gx + 1 + (gz + 1) * N] = v;
	}

	public double CellHeightAt(int gx, int gz)
		=> 0.25 * (H[gx + gz * N] + H[gx + 1 + gz * N] + H[gx + (gz + 1) * N] + H[gx + 1 + (gz + 1) * N]);

	public bool InGrid(int gx, int gz) => gx >= 0 && gz >= 0 && gx < Size && gz < Size;

	// ---- rivers -----------------------------------------------------------------

	private List<(int X, int Z)> RiverCourse((int X, int Z) start, (double X, double Y) mouth)
	{
		var course = new List<(int X, int Z)>();
		var seen = new byte[Size * Size];
		var cur = start;
		if (!InGrid(cur.X, cur.Z) || Middle(cur.X, cur.Z))
			return course;
		for (int step = 0; step < Size * 3; step++)
		{
			course.Add(cur);
			seen[cur.X + cur.Z * Size] = 1;
			if (CellHeightAt(cur.X, cur.Z) < SeaLevel)
				break;
			// Stop where the beach begins and let the sea do the rest, but only where the
			// water is near enough: stopping on a flat that is merely low leaves a pond.
			if (CellHeightAt(cur.X, cur.Z) < BeachMax && SeaWithin(cur.X, cur.Z, RiverMouthReach))
				break;
			double d0 = ToMouth(cur.X, cur.Z, mouth);
			var best = (X: 0, Z: 0);
			bool hasBest = false;
			double bestScore = double.PositiveInfinity;
			for (int dir = 0; dir < 4; dir++)
			{
				var (dx, dz) = (dir == 0) ? (1, 0) : (dir == 1) ? (-1, 0) : (dir == 2) ? (0, 1) : (0, -1);
				int nx = cur.X + dx;
				int nz = cur.Z + dz;
				if (!InGrid(nx, nz) || seen[nx + nz * Size] == 1 || Middle(nx, nz))
					continue;
				double wob = (PmRng.Hash32($"river:{nx}:{nz}") % 1000 / 1000.0 - 0.5) * 2.0 * RiverWobble;
				double score = CellHeightAt(nx, nz) + RiverPull * (ToMouth(nx, nz, mouth) - d0) + wob;
				if (score < bestScore)
				{
					bestScore = score;
					best = (nx, nz);
					hasBest = true;
				}
			}
			if (!hasBest)
				break;
			cur = best;
		}
		return course;
	}

	private double ToMouth(int gx, int gz, (double X, double Y) mouth)
	{
		double x = gx - Half + 0.5;
		double z = gz - Half + 0.5;
		double dx = x - mouth.X;
		double dz = z - mouth.Y;
		return Math.Sqrt(dx * dx + dz * dz);
	}

	private bool Middle(int gx, int gz)
	{
		double x = gx - Half + 0.5;
		double z = gz - Half + 0.5;
		return Math.Sqrt(x * x + z * z) < RiverCentreKeep;
	}

	private bool SeaWithin(int gx, int gz, int r)
	{
		for (int dz = -r; dz <= r; dz++)
		{
			for (int dx = -r; dx <= r; dx++)
			{
				int nx = gx + dx;
				int nz = gz + dz;
				if (!InGrid(nx, nz) || CellHeightAt(nx, nz) < SeaLevel)
					return true;
			}
		}
		return false;
	}

	private void CarveRiver(List<(int X, int Z)> course)
	{
		int n = course.Count;
		int reach = (int)Math.Ceiling(RiverW1 - RiverBed / RiverRise) + 2;
		for (int s = 0; s < n; s++)
		{
			var c = course[s];
			double w = RiverW0 + (RiverW1 - RiverW0) * (n > 1 ? (double)s / (n - 1) : 1.0);
			double cx = c.X + 0.5;
			double cz = c.Z + 0.5;
			for (int j = Math.Max(0, c.Z - reach); j <= Math.Min(Size, c.Z + reach); j++)
			{
				for (int i = Math.Max(0, c.X - reach); i <= Math.Min(Size, c.X + reach); i++)
				{
					double dx = i - cx;
					double dz = j - cz;
					double t = RiverBed + RiverRise * Math.Max(0.0, Math.Sqrt(dx * dx + dz * dz) - w);
					int k = i + j * N;
					if (t < H[k])
						H[k] = t;
				}
			}
		}
	}

	// ---- classification ----------------------------------------------------------

	// Which cells the rivers actually made wet, and which ended up as their banks. Derived
	// from IsWater() rather than from the course, so what is drawn and what a bridge may be
	// thrown over can never disagree with what the layout calls water.
	private void Classify()
	{
		_wet = new byte[Size * Size];
		RiverCells = new List<(int X, int Z)>();
		RiverBankCells = new List<(int X, int Z)>();
		LandCells = new List<(int X, int Z)>();
		BeachCells = new List<(int X, int Z)>();
		CoastCells = new List<(int X, int Z)>();

		var nearRiver = new byte[Size * Size];
		foreach (var course in Rivers)
		{
			foreach (var c in course)
			{
				for (int dz = -RiverNear; dz <= RiverNear; dz++)
				{
					for (int dx = -RiverNear; dx <= RiverNear; dx++)
					{
						int nx = c.X + dx;
						int nz = c.Z + dz;
						if (InGrid(nx, nz))
							nearRiver[nx + nz * Size] = 1;
					}
				}
			}
		}

		for (int gz = 0; gz < Size; gz++)
		{
			for (int gx = 0; gx < Size; gx++)
			{
				if (nearRiver[gx + gz * Size] == 0 || !IsWater(gx, gz))
					continue;
				_wet[gx + gz * Size] = 1;
				RiverCells.Add((gx, gz));
			}
		}

		for (int gz = 0; gz < Size; gz++)
		{
			for (int gx = 0; gx < Size; gx++)
			{
				int k = gx + gz * Size;
				if (nearRiver[k] == 0 || _wet[k] == 1)
					continue;
				bool touches = gx + 1 < Size && _wet[gx + 1 + gz * Size] == 1;
				if (!touches && gx > 0)
					touches = _wet[gx - 1 + gz * Size] == 1;
				if (!touches && gz + 1 < Size)
					touches = _wet[gx + (gz + 1) * Size] == 1;
				if (!touches && gz > 0)
					touches = _wet[gx + (gz - 1) * Size] == 1;
				if (touches)
					RiverBankCells.Add((gx, gz));
			}
		}

		for (int gz = 0; gz < Size; gz++)
		{
			for (int gx = 0; gx < Size; gx++)
			{
				if (!IsLand(gx, gz))
					continue;
				LandCells.Add((gx, gz));
				if (IsBeach(gx, gz))
					BeachCells.Add((gx, gz));
				if (IsWater(gx + 1, gz) || IsWater(gx - 1, gz) || IsWater(gx, gz + 1) || IsWater(gx, gz - 1))
					CoastCells.Add((gx, gz));
			}
		}
	}

	// ---- queries ----------------------------------------------------------------

	public bool IsLand(int gx, int gz)
	{
		if (!InGrid(gx, gz))
			return false;
		return H[gx + gz * N] >= SeaLevel
			&& H[gx + 1 + gz * N] >= SeaLevel
			&& H[gx + (gz + 1) * N] >= SeaLevel
			&& H[gx + 1 + (gz + 1) * N] >= SeaLevel;
	}

	public bool IsWater(int gx, int gz) => !InGrid(gx, gz) || CellHeightAt(gx, gz) < SeaLevel;

	public bool IsBeach(int gx, int gz)
	{
		if (!IsLand(gx, gz))
			return false;
		return H[gx + gz * N] < BeachMax
			&& H[gx + 1 + gz * N] < BeachMax
			&& H[gx + (gz + 1) * N] < BeachMax
			&& H[gx + 1 + (gz + 1) * N] < BeachMax;
	}

	public (double X, double Z) CellWorld(int gx, int gz)
		=> (gx - Half + 0.5, gz - Half + 0.5);

	/// <summary>Bilinear height at a world position, like terrain.gd world_height().</summary>
	public double WorldHeight(double x, double z)
	{
		double fx = Math.Clamp(x + Half, 0.0, Size - 1e-6);
		double fz = Math.Clamp(z + Half, 0.0, Size - 1e-6);
		int i = (int)Math.Floor(fx);
		int j = (int)Math.Floor(fz);
		double u = fx - i;
		double v = fz - j;
		double h00 = Corner(i, j);
		double h10 = Corner(i + 1, j);
		double h01 = Corner(i, j + 1);
		double h11 = Corner(i + 1, j + 1);
		return h00 + (h10 - h00) * u + (h01 - h00) * v + (h00 - h10 - h01 + h11) * u * v;
	}

	/// <summary>Height field access with clamped corners, like terrain.gd corner().</summary>
	public double Corner(int i, int j)
		=> H[Math.Clamp(i, 0, Size) + Math.Clamp(j, 0, Size) * N];

	/// <summary>FNV-1a over each height, two bytes per vertex, exactly like terrain.gd.</summary>
	public string HashHeights()
	{
		uint h = 0x811c9dc5;
		for (int k = 0; k < H.Length; k++)
		{
			int v = PmRng.JsRoundToInt(H[k] * 256.0);
			h ^= (uint)(v & 0xFF);
			h = PmRng.Imul(h, 0x01000193);
			h ^= (uint)((v >> 8) & 0xFF);
			h = PmRng.Imul(h, 0x01000193);
		}
		return h.ToString("x8");
	}
}