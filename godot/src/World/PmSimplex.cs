using System;

namespace Promptholm.World;

/// <summary>
/// C# port of scripts/simplex.gd: 2D simplex noise (Gustavson) with the permutation
/// permuted by a seed-driven PmRng. Pure dotnet double arithmetic, so a straight
/// transcription stays bit-identical with the JS makeSimplex2D/fbm2 in shared/rng.mjs.
/// </summary>
public sealed class PmSimplex
{
	private static readonly double[] Grad2X = { 1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0 };
	private static readonly double[] Grad2Y = { 1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1 };

	private const double F2 = 0.3660254037844386;
	private const double G2 = 0.21132486540518713;

	private readonly int[] _perm = new int[512];
	private readonly int[] _permMod12 = new int[512];

	public PmSimplex(uint seed)
	{
		var rand = new PmRng(seed);
		var p = new int[256];
		for (int i = 0; i < 256; i++)
			p[i] = i;
		for (int i = 255; i > 0; i--)
		{
			int j = (int)Math.Floor(rand.Next() * (i + 1));
			(p[i], p[j]) = (p[j], p[i]);
		}
		for (int i = 0; i < 512; i++)
		{
			_perm[i] = p[i & 255];
			_permMod12[i] = _perm[i] % 12;
		}
	}

	public double Noise2(double xin, double yin)
	{
		double n0 = 0.0, n1 = 0.0, n2 = 0.0;
		double s = (xin + yin) * F2;
		int i = (int)Math.Floor(xin + s);
		int j = (int)Math.Floor(yin + s);
		double t = (i + j) * G2;
		double x0 = xin - (i - t);
		double y0 = yin - (j - t);
		int i1 = x0 > y0 ? 1 : 0;
		int j1 = x0 > y0 ? 0 : 1;
		double x1 = x0 - i1 + G2;
		double y1 = y0 - j1 + G2;
		double x2 = x0 - 1.0 + 2.0 * G2;
		double y2 = y0 - 1.0 + 2.0 * G2;
		int ii = i & 255;
		int jj = j & 255;
		int gi0 = _permMod12[ii + _perm[jj]];
		int gi1 = _permMod12[ii + i1 + _perm[jj + j1]];
		int gi2 = _permMod12[ii + 1 + _perm[jj + 1]];
		double t0 = 0.5 - x0 * x0 - y0 * y0;
		if (t0 >= 0.0)
		{
			t0 *= t0;
			n0 = t0 * t0 * (Grad2X[gi0] * x0 + Grad2Y[gi0] * y0);
		}
		double t1 = 0.5 - x1 * x1 - y1 * y1;
		if (t1 >= 0.0)
		{
			t1 *= t1;
			n1 = t1 * t1 * (Grad2X[gi1] * x1 + Grad2Y[gi1] * y1);
		}
		double t2 = 0.5 - x2 * x2 - y2 * y2;
		if (t2 >= 0.0)
		{
			t2 *= t2;
			n2 = t2 * t2 * (Grad2X[gi2] * x2 + Grad2Y[gi2] * y2);
		}
		return 70.0 * (n0 + n1 + n2);
	}

	public double Fbm2(double x, double y, int octaves = 4, double lacunarity = 2.0, double gain = 0.5)
	{
		double amp = 1.0;
		double freq = 1.0;
		double sum = 0.0;
		double norm = 0.0;
		for (int o = 0; o < octaves; o++)
		{
			sum += amp * Noise2(x * freq, y * freq);
			norm += amp;
			amp *= gain;
			freq *= lacunarity;
		}
		return sum / norm;
	}

	public static double SmoothstepJs(double a, double b, double x)
	{
		double t = Math.Clamp((x - a) / (b - a), 0.0, 1.0);
		return t * t * (3.0 - 2.0 * t);
	}
}