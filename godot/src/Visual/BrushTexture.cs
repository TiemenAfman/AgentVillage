using System;
using Godot;

namespace Promptholm.Visual;

/// <summary>
/// Hand-painted texture, generated.
///
/// Walk up to a rock in the reference and the surface is not a photograph: it is brush strokes.
/// Elongated, directional, laid over one another, each with a visible edge where it stops. That
/// is the whole difference between this look and a photoscan, and it is also why noise does not
/// get there — noise is isotropic, and a stroke has a direction, a length and an end.
///
/// So the strokes are drawn rather than sampled:
///
///   * each stroke is a long, thin lobe with a soft head and a fading tail
///   * a few hundred of them, at a few angles, at three sizes, layered
///   * the result is posterised, because a painter's stroke has a step at its edge and a
///     gradient does not — this is the single thing that reads as "painted" rather than "noisy"
///
/// Seamless by construction: every stroke is drawn nine times, once per wrap of the tile, so a
/// stroke that runs off one edge arrives on the other.
/// </summary>
public static class BrushTexture
{
	/// <summary>
	/// A tiling field of brush strokes in 0..1.
	/// </summary>
	/// <param name="size">Pixels a side. 512 is plenty: this is grain, not detail.</param>
	/// <param name="strokes">How many. More is denser, not finer.</param>
	/// <param name="steps">Posterisation levels. Low is painterly, high is muddy.</param>
	/// <param name="lean">0 = strokes point anywhere, 1 = all the same way. A rock face wants
	/// some alignment, like a wall that was painted in one direction, but not perfect order.</param>
	/// <param name="low">What the darkest stroke maps to, and <paramref name="high"/> the
	/// lightest. Leave at 0..1 for a height field; set them around 1 for an albedo, where this
	/// has to *modulate* the colour rather than mask it — a field averaging 0.35 multiplied into
	/// sandstone gives tar, which is exactly what the first attempt looked like.</param>
	public static ImageTexture Strokes(uint seed, int size = 512, int strokes = 420, int steps = 5, float lean = 0.55f, float low = 0.0f, float high = 1.0f)
	{
		var field = new float[size * size];
		var rng = new RandomNumberGenerator { Seed = seed };

		// One dominant direction with the rest scattered around it. Painting a surface leaves
		// strokes that mostly agree; strokes that agree *entirely* read as corduroy.
		float bias = rng.Randf() * Mathf.Tau;

		for (int s = 0; s < strokes; s++)
		{
			float angle = Mathf.LerpAngle(rng.Randf() * Mathf.Tau, bias, lean) + rng.RandfRange(-0.35f, 0.35f);
			// Three sizes, so the surface has a few broad sweeps and a lot of small marks - the
			// same reason terrain noise has octaves.
			int band = s % 3;
			float length = size * (band == 0 ? 0.26f : band == 1 ? 0.13f : 0.06f) * rng.RandfRange(0.7f, 1.3f);
			float width = length * rng.RandfRange(0.10f, 0.19f);
			float weight = (band == 0 ? 0.5f : band == 1 ? 0.8f : 1.0f) * rng.RandfRange(0.6f, 1.0f);

			float cx = rng.Randf() * size;
			float cy = rng.Randf() * size;
			Stamp(field, size, cx, cy, angle, length, width, weight);
		}

		// Normalise, then posterise. The step is what a brush leaves behind and a gradient does not.
		float lo = float.MaxValue, hi = float.MinValue;
		foreach (float v in field) { if (v < lo) lo = v; if (v > hi) hi = v; }
		float span = MathF.Max(1e-5f, hi - lo);

		var image = Image.CreateEmpty(size, size, true, Image.Format.Rgb8);
		for (int y = 0; y < size; y++)
		{
			for (int x = 0; x < size; x++)
			{
				float v = (field[x + y * size] - lo) / span;
				v = MathF.Round(v * steps) / steps;
				v = low + v * (high - low);
				image.SetPixel(x, y, new Color(v, v, v));
			}
		}
		image.GenerateMipmaps();
		return ImageTexture.CreateFromImage(image);
	}

	/// <summary>
	/// The same field, as a normal map — so the strokes catch the light instead of merely
	/// tinting. Derived from the height field rather than drawn again, which keeps the two
	/// exactly in register.
	/// </summary>
	public static ImageTexture StrokeNormals(uint seed, int size = 512, float strength = 2.2f, int strokes = 420, int steps = 5, float lean = 0.55f)
	{
		var height = Strokes(seed, size, strokes, steps, lean).GetImage();
		var image = Image.CreateEmpty(size, size, true, Image.Format.Rgb8);
		for (int y = 0; y < size; y++)
		{
			for (int x = 0; x < size; x++)
			{
				// Wrapped differences: the height map tiles, so its normal map has to as well.
				float l = height.GetPixel((x - 1 + size) % size, y).R;
				float r = height.GetPixel((x + 1) % size, y).R;
				float d = height.GetPixel(x, (y - 1 + size) % size).R;
				float u = height.GetPixel(x, (y + 1) % size).R;
				var n = new Vector3((l - r) * strength, (d - u) * strength, 1.0f).Normalized();
				image.SetPixel(x, y, new Color(n.X * 0.5f + 0.5f, n.Y * 0.5f + 0.5f, n.Z * 0.5f + 0.5f));
			}
		}
		image.GenerateMipmaps();
		return ImageTexture.CreateFromImage(image);
	}

	/// <summary>
	/// One stroke: a lobe that is long along its own axis and narrow across it, softest at the
	/// tail. Drawn nine times so it wraps — a stroke that leaves the right edge comes back on
	/// the left, which is what makes the tile seamless without any blending afterwards.
	/// </summary>
	private static void Stamp(float[] field, int size, float cx, float cy, float angle, float length, float width, float weight)
	{
		float ca = MathF.Cos(angle), sa = MathF.Sin(angle);
		int reach = (int)MathF.Ceiling(MathF.Max(length, width));

		for (int wy = -1; wy <= 1; wy++)
		{
			for (int wx = -1; wx <= 1; wx++)
			{
				float ox = cx + wx * size, oy = cy + wy * size;
				int x0 = (int)MathF.Floor(ox) - reach, x1 = (int)MathF.Ceiling(ox) + reach;
				int y0 = (int)MathF.Floor(oy) - reach, y1 = (int)MathF.Ceiling(oy) + reach;
				if (x1 < 0 || y1 < 0 || x0 >= size || y0 >= size) continue;

				for (int y = Math.Max(0, y0); y <= Math.Min(size - 1, y1); y++)
				{
					for (int x = Math.Max(0, x0); x <= Math.Min(size - 1, x1); x++)
					{
						float dx = x - ox, dy = y - oy;
						// Into the stroke's own frame: u runs along it, v across it.
						float u = (dx * ca + dy * sa) / length;
						float v = (-dx * sa + dy * ca) / width;
						float r2 = u * u + v * v;
						if (r2 >= 1.0f) continue;
						// Soft falloff, and heavier at the head than the tail, so the mark has a
						// direction you can see rather than being a symmetrical smear.
						float falloff = (1.0f - r2) * (1.0f - r2);
						float taper = 0.65f + 0.35f * (0.5f - u * 0.5f);
						field[x + y * size] += falloff * taper * weight;
					}
				}
			}
		}
	}
}
