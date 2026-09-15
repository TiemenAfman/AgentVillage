using System;
using Godot;

namespace Promptholm.Visual;

/// <summary>
/// The silhouettes on a texture card, painted rather than photographed.
///
/// Terrain3D's instancer draws foliage as <c>TYPE_TEXTURE_CARD</c> - a crossed quad with one
/// texture on it - so what a blade of grass actually is, in this world, is an alpha cut-out. That
/// makes the cut-out the whole of the art direction for two of the four layers, and a downloaded
/// grass atlas would decide it for us the same way the ambientCG photoscans decided the ground
/// until <see cref="BrushTexture"/> took it back.
///
/// So a card is drawn: a handful of tapered blades swept along a Bezier, each one filled with a
/// single flat value of its own. That last part is the thing that reads as painted. A gradient
/// down a blade looks rendered; a tuft of overlapping flat shapes, each a slightly different
/// green, looks like something a brush left behind - which is the same argument
/// <see cref="BrushTexture"/> makes for posterising its strokes, one scale down.
///
/// Two things the image deliberately does not carry:
///
///   * **No colour.** The RGB is a modulation around 1.0 - a vertical gradient from shaded base
///     to lit tip, times the per-blade value, times the brush grain - and the hue arrives per
///     instance as <c>COLOR</c>, from <see cref="Palette.Terrain"/>. That is the same division
///     the terrain already uses (splatted grain, colour map on top), so grass growing on meadow
///     and grass growing in a wood are one texture and two tints rather than two paintings.
///   * **No soft edge.** The alpha is hard, because the shader cuts it with a scissor rather
///     than blending: a cut-out costs no sorting and casts a real shadow. Mipmaps erode a thin
///     blade as it recedes, which is why the scissor threshold sits well below half.
/// </summary>
public static class CardTexture
{
	/// <summary>
	/// One card's worth of blades.
	/// </summary>
	/// <param name="Count">How many blades in the tuft. More is a denser clump, not a bigger one.</param>
	/// <param name="Height">How far up the card the tallest blade reaches, 0..1. Leaving headroom
	/// matters: a blade that touches the top edge is cut off square by the card, and a field of
	/// square-topped grass is the single most obvious sign of a texture card.</param>
	/// <param name="Spread">How far the bases fan out from the centre, as a fraction of the card.</param>
	/// <param name="Arch">How far a tip leans away from its base, as a fraction of the card. Low
	/// is upright meadow grass, high is the splayed sprawl of ground cover.</param>
	/// <param name="Width">Width of a blade at its base, as a fraction of the card.</param>
	public readonly record struct Tuft(int Count, float Height, float Spread, float Arch, float Width);

	/// <summary>Where the blade is darkest, at its base, and lightest, at the tip. Both around 1.0
	/// because this modulates the instance colour rather than being one.</summary>
	private const float BaseValue = 0.52f, TipValue = 0.92f;

	/// <summary>
	/// Paint one card as RGBA8: a modulation in RGB, the silhouette in alpha.
	/// </summary>
	public static Image Paint(uint seed, int size, Tuft tuft)
	{
		var rng = new RandomNumberGenerator { Seed = seed };

		// Coverage and value are kept apart so a blade can paint itself over a neighbour without
		// averaging into it. Averaging is exactly the thing that turns a tuft into a smudge.
		var cover = new float[size * size];
		var value = new float[size * size];

		for (int b = 0; b < tuft.Count; b++)
		{
			// Bases fan out from the middle, tips lean further than their bases - so the tuft
			// opens upward like a real clump instead of standing as a parallel comb.
			float baseX = size * (0.5f + rng.RandfRange(-tuft.Spread, tuft.Spread));
			float lean = rng.RandfRange(-tuft.Arch, tuft.Arch) * size;
			// Tallest blades in the middle of the clump, short ones at the edges.
			float reach = tuft.Height * size * rng.RandfRange(0.45f, 1.0f);
			float tipX = baseX + lean;
			float tipY = reach;
			// The control point sits high and barely leaned, which is what gives a blade its
			// stiff-then-bending curve rather than a uniform arc.
			float ctrlX = baseX + lean * 0.22f;
			float ctrlY = reach * 0.72f;

			float width = tuft.Width * size * rng.RandfRange(0.75f, 1.25f);
			float shade = rng.RandfRange(0.80f, 1.12f);

			Sweep(cover, value, size, baseX, 0.0f, ctrlX, ctrlY, tipX, tipY, width, shade);
		}

		// The same brush that paints the ground and the boulders, at the scale of a leaf: without
		// it every blade is a flat fill and the card reads as vector art rather than as paint.
		var grain = BrushTexture.Strokes(seed ^ 0x51ed1023u, size, 240, 4, 0.40f, 0.88f, 1.12f, 0.55f).GetImage();

		var image = Image.CreateEmpty(size, size, false, Image.Format.Rgba8);
		for (int y = 0; y < size; y++)
		{
			for (int x = 0; x < size; x++)
			{
				int k = x + y * size;
				// Row 0 of an Image is the top, and the card's UV puts v = 1 at the bottom, so
				// height above the base counts down from the last row.
				float up = 1.0f - (float)y / (size - 1);
				float lum = Mathf.Lerp(BaseValue, TipValue, up) * value[k] * grain.GetPixel(x, y).R;
				// A hair of warm/cool per pixel band, so a wall of cards does not read as one
				// colour multiplied by one texture.
				float drift = (grain.GetPixel(x, y).R - 1.0f) * 0.35f;
				image.SetPixel(x, y, new Color(
					lum * (1.0f + drift), lum, lum * (1.0f - drift),
					cover[k] >= 0.5f ? 1.0f : 0.0f));
			}
		}
		return image;
	}

	/// <summary>
	/// One blade: a disc swept along a quadratic Bezier, narrowing to nothing at the tip.
	///
	/// Swept rather than rasterised as a polygon because the taper is the whole shape - a blade is
	/// a wedge with a curve in it, and a two-triangle strip would need many more segments to hide
	/// its corners than this needs steps.
	/// </summary>
	private static void Sweep(float[] cover, float[] value, int size,
		float x0, float y0, float cx, float cy, float x2, float y2, float width, float shade)
	{
		// Enough steps that consecutive discs overlap: the curve is at most the card's diagonal.
		int steps = Math.Max(12, (int)(size * 0.6f));
		for (int s = 0; s <= steps; s++)
		{
			float t = (float)s / steps;
			float u = 1.0f - t;
			float px = u * u * x0 + 2.0f * u * t * cx + t * t * x2;
			float py = u * u * y0 + 2.0f * u * t * cy + t * t * y2;
			// Taper towards the tip, but not linearly: a blade of grass keeps most of its width
			// for most of its length and then runs out quickly.
			float r = MathF.Max(0.45f, width * 0.5f * MathF.Pow(1.0f - t, 0.55f));

			int iy = (int)MathF.Round((size - 1) - py);
			int ix = (int)MathF.Round(px);
			int reach = (int)MathF.Ceiling(r);
			for (int dy = -reach; dy <= reach; dy++)
			{
				int y = iy + dy;
				if (y < 0 || y >= size) continue;
				for (int dx = -reach; dx <= reach; dx++)
				{
					int x = ix + dx;
					if (x < 0 || x >= size) continue;
					if (dx * dx + dy * dy > r * r) continue;
					int k = x + y * size;
					cover[k] = 1.0f;
					value[k] = shade;
				}
			}
		}
	}
}
