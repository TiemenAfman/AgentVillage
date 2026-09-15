using System;
using Godot;

namespace Promptholm.World;

/// <summary>
/// How a thing meets the ground.
///
/// Every spawner used to sample <see cref="TerrainField.WorldHeight"/> at one point and put the
/// object there. For a tree trunk that is right — a trunk *is* a point. For anything with a
/// footprint it is not: a 3-lot plot spans about six metres, and six metres of hillside here
/// drops well over a metre, so a house pinned to its centre height hangs a corner in the air on
/// the downhill side and buries the uphill one. The 0.24 m foundation plinth was never going to
/// cover that. The hedges showed it worst, because a boundary runs *across* the slope by
/// definition.
///
/// The rule this class encodes: a footprint sits at the LOWEST ground under it, never the mean
/// and never the centre. Sitting low can only bury an edge, and buried reads as "dug in";
/// sitting high reads as broken. <see cref="Fit.Drop"/> then says how deep a skirt has to reach
/// to hide the gap the slope leaves under the object.
/// </summary>
public static class GroundFit
{
	/// <summary>Ground under one footprint: the lowest and highest sample, and the spread.</summary>
	public readonly record struct Fit(float Min, float Max, float Mean)
	{
		/// <summary>How far the ground falls away across the footprint. What a skirt must cover.</summary>
		public float Drop => Max - Min;
	}

	/// <summary>
	/// Samples the terrain over a rotated rectangle centred on (cx, cz). `steps` is the grid
	/// resolution per axis — 4 gives 25 samples, which catches the corners plus anything
	/// lumpy in between. The corners are what matter: a rock under the middle of a house is
	/// hidden, a corner in the air is not.
	/// </summary>
	public static Fit Sample(TerrainField field, float cx, float cz, float w, float d, float rotY, int steps = 4)
	{
		steps = Math.Max(1, steps);
		float cos = MathF.Cos(rotY);
		float sin = MathF.Sin(rotY);
		float hw = w * 0.5f;
		float hd = d * 0.5f;

		float min = float.MaxValue;
		float max = float.MinValue;
		double sum = 0.0;
		int n = 0;

		for (int i = 0; i <= steps; i++)
		{
			float lx = -hw + w * i / steps;
			for (int j = 0; j <= steps; j++)
			{
				float lz = -hd + d * j / steps;
				// Local footprint corner rotated into world space, then sampled.
				float wx = cx + lx * cos - lz * sin;
				float wz = cz + lx * sin + lz * cos;
				float h = (float)field.WorldHeight(wx, wz);
				if (h < min) min = h;
				if (h > max) max = h;
				sum += h;
				n++;
			}
		}

		return new Fit(min, max, (float)(sum / Math.Max(1, n)));
	}

	/// <summary>The Y a footprint object should stand at so that no part of it floats.</summary>
	public static float SitOn(TerrainField field, float cx, float cz, float w, float d, float rotY, int steps = 4)
		=> Sample(field, cx, cz, w, d, rotY, steps).Min;

	/// <summary>
	/// A thing that spans two points — a hedge block, a fence rail, an archway beam. Returns the
	/// midpoint height to stand at and the pitch to rotate around the segment's own cross-axis so
	/// the piece lies along the slope instead of across it.
	///
	/// The height returned is the lower end, not the midpoint's own ground: a block tilted to the
	/// slope still has to clear the dip in between, and on this terrain a hedge run crosses plenty
	/// of small dips.
	/// </summary>
	public static (float Y, float Pitch) FitSegment(TerrainField field, Vector3 a, Vector3 b, int samples = 4)
	{
		samples = Math.Max(1, samples);
		float ya = (float)field.WorldHeight(a.X, a.Z);
		float yb = (float)field.WorldHeight(b.X, b.Z);

		float low = MathF.Min(ya, yb);
		for (int i = 1; i < samples; i++)
		{
			float t = (float)i / samples;
			float x = Mathf.Lerp(a.X, b.X, t);
			float z = Mathf.Lerp(a.Z, b.Z, t);
			low = MathF.Min(low, (float)field.WorldHeight(x, z));
		}

		float run = new Vector2(b.X - a.X, b.Z - a.Z).Length();
		// Pitch is negative because a piece whose local +X climbs must rotate nose-up about -Z.
		float pitch = run > 0.001f ? -MathF.Atan2(yb - ya, run) : 0.0f;

		// Midpoint of the two ends, then dropped to whatever the dip in between needs.
		float mid = (ya + yb) * 0.5f;
		return (MathF.Min(mid, low + (mid - low) * 0.35f), pitch);
	}
}
