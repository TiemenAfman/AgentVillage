using System;
using System.Collections.Generic;
using Godot;

namespace Promptholm.World;

/// <summary>
/// The two kinds of ground vegetation that are geometry rather than a texture card.
///
/// A card is the right answer for grass: a blade has no thickness worth modelling and a cut-out
/// silhouette is one texture fetch. It is the wrong answer for a fern and for a bush, for opposite
/// reasons. A fern is mostly gap - a card of one would be 90% discarded fragments, paying the full
/// overdraw of a quad for a tenth of its area - and eight triangles draw the same fronds with no
/// alpha at all. A bush is the other extreme: it has real volume, and a flat card of a bush is a
/// cardboard cut-out the moment you walk past it.
///
/// Both are built the way <see cref="RockMesh"/> builds stone - no files, low poly, flat colour,
/// facets doing the work a texture would otherwise do - so they belong to the same island as the
/// boulders they grow between.
///
/// One rule they both obey: <b>UV.v is 1 at the root and 0 at the tip</b>. That is what
/// shaders/foliage_wind.gdshaderinc reads to know how far a vertex may travel in the wind, and it
/// is the same convention Terrain3D's generated texture card already has - so one wind function
/// serves all four layers instead of each needing to know its own geometry.
/// </summary>
public static class FoliageMesh
{
	/// <summary>
	/// A fern: a few tapered fronds arching out of one root.
	///
	/// Three segments to a frond and no more. The arc is shallow, so a fourth segment changes the
	/// silhouette by less than a pixel at the distance these are visible from, and the count is
	/// multiplied by every fern on the island.
	/// </summary>
	public static ArrayMesh Fern(uint seed, int fronds = 4, int segments = 3)
	{
		var rng = new RandomNumberGenerator { Seed = seed };
		var verts = new List<Vector3>();
		var normals = new List<Vector3>();
		var uvs = new List<Vector2>();
		var indices = new List<int>();

		float spin = rng.Randf() * Mathf.Tau;
		for (int f = 0; f < fronds; f++)
		{
			// Fanned evenly and then jittered: evenly spaced alone reads as a mechanism, jittered
			// alone leaves two fronds on top of each other.
			float yaw = spin + f * Mathf.Tau / fronds + rng.RandfRange(-0.35f, 0.35f);
			var outward = new Vector3(MathF.Cos(yaw), 0.0f, MathF.Sin(yaw));
			float reach = rng.RandfRange(0.40f, 0.62f);
			float rise = rng.RandfRange(0.72f, 1.0f);
			float halfW = rng.RandfRange(0.085f, 0.135f);

			int first = verts.Count;
			for (int s = 0; s <= segments; s++)
			{
				float t = (float)s / segments;
				// Up fast, out slowly, and drooping at the end - the shape of a frond that has
				// grown against gravity and then lost.
				float y = rise * MathF.Sin(t * 1.35f) ;
				var centre = outward * (reach * t * t) + new Vector3(0.0f, y, 0.0f);
				// Across the frond, level with the ground: a leaf is a horizontal blade.
				var across = new Vector3(-outward.Z, 0.0f, outward.X) * (halfW * (1.0f - t * 0.85f));
				verts.Add(centre - across);
				verts.Add(centre + across);
				uvs.Add(new Vector2(0.0f, 1.0f - t));
				uvs.Add(new Vector2(1.0f, 1.0f - t));
			}

			// A ribbon lit as if it faced mostly upward. The true face normal of a near-horizontal
			// strip is up anyway; tilting it out along the frond keeps the far side of the fern
			// from going flat.
			var normal = (Vector3.Up * 3.0f - outward).Normalized();
			for (int s = 0; s <= segments; s++) { normals.Add(normal); normals.Add(normal); }

			for (int s = 0; s < segments; s++)
			{
				int a = first + s * 2;
				indices.Add(a); indices.Add(a + 1); indices.Add(a + 2);
				indices.Add(a + 1); indices.Add(a + 3); indices.Add(a + 2);
			}
		}

		return Assemble(verts, normals, uvs, indices);
	}

	/// <summary>
	/// A leafy bush: a handful of faceted blobs pushed into one clump.
	///
	/// Clustered blobs rather than one squashed sphere because a bush read as a single blob is a
	/// green ball, and the thing that makes it a shrub is the notch where two masses meet. Faceted
	/// for the same reason <see cref="RockMesh"/> is: flat faces meeting at hard edges is what this
	/// island's light has to work with.
	/// </summary>
	public static ArrayMesh Bush(uint seed, int blobs = 5)
	{
		var rng = new RandomNumberGenerator { Seed = seed };
		var verts = new List<Vector3>();
		var normals = new List<Vector3>();
		var indices = new List<int>();

		for (int b = 0; b < blobs; b++)
		{
			// One big mass with smaller ones leaning on it, rather than four equals - a clump of
			// equals is a bunch of grapes.
			float radius = b == 0 ? rng.RandfRange(0.44f, 0.52f) : rng.RandfRange(0.24f, 0.38f);
			float yaw = rng.Randf() * Mathf.Tau;
			float out2 = b == 0 ? 0.0f : rng.RandfRange(0.20f, 0.42f);
			var at = new Vector3(MathF.Cos(yaw) * out2, rng.RandfRange(0.30f, 0.62f), MathF.Sin(yaw) * out2);

			Blob(verts, normals, indices, rng, at, radius);
		}

		// Sit the clump on y = 0 and normalise it to a metre tall, so the spawner's scale is in
		// metres of bush rather than in whatever this happened to come out as.
		float low = float.MaxValue, high = float.MinValue;
		foreach (var v in verts) { if (v.Y < low) low = v.Y; if (v.Y > high) high = v.Y; }
		float span = MathF.Max(0.01f, high - low);
		var uvs = new List<Vector2>(verts.Count);
		for (int i = 0; i < verts.Count; i++)
		{
			var v = new Vector3(verts[i].X / span, (verts[i].Y - low) / span, verts[i].Z / span);
			verts[i] = v;
			// v = 1 at the base of the bush, 0 at its crown: the crown is what the wind moves.
			uvs.Add(new Vector2(0.5f, 1.0f - v.Y));
		}

		return Assemble(verts, normals, uvs, indices);
	}

	/// <summary>One faceted lump, welded into the buffers that are already there.</summary>
	private static void Blob(List<Vector3> verts, List<Vector3> normals, List<int> indices,
		RandomNumberGenerator rng, Vector3 at, float radius)
	{
		// Three rings and six segments: thirty-six triangles, and the point of a low count here is that
		// the silhouette should have corners in it.
		var sphere = new SphereMesh { Radius = 1.0f, Height = 2.0f, RadialSegments = 6, Rings = 3 };
		var arrays = sphere.GetMeshArrays();
		var source = (Vector3[])arrays[(int)Mesh.ArrayType.Vertex];
		var index = (int[])arrays[(int)Mesh.ArrayType.Index];

		// Two phases drawn once per blob rather than per vertex: the displacement has to be a
		// smooth function of direction, so anything random inside the loop would tear the surface
		// instead of lumping it.
		float phaseA = rng.Randf() * Mathf.Tau;
		float phaseB = rng.Randf() * Mathf.Tau;

		var moved = new Vector3[source.Length];
		for (int i = 0; i < source.Length; i++)
		{
			// Displaced on direction rather than on index, the same trap RockMesh documents: a
			// SphereMesh duplicates its vertices along the UV seam, and pushing the two copies
			// apart splits the blob open along a meridian.
			var dir = source[i].Normalized();
			float wobble = 1.0f
				+ 0.20f * MathF.Sin(dir.X * 4.1f + dir.Y * 2.7f + phaseA)
				+ 0.12f * MathF.Sin(dir.Z * 6.3f - dir.Y * 3.1f + phaseB);
			moved[i] = at + dir * radius * wobble * new Vector3(1.0f, 0.82f, 1.0f);
		}

		for (int t = 0; t + 2 < index.Length; t += 3)
		{
			var a = moved[index[t]];
			var b = moved[index[t + 1]];
			var c = moved[index[t + 2]];
			var n = (b - a).Cross(c - a).Normalized();
			if (!n.IsFinite() || n.LengthSquared() < 0.5f) continue;
			int first = verts.Count;
			verts.Add(a); verts.Add(b); verts.Add(c);
			normals.Add(n); normals.Add(n); normals.Add(n);
			indices.Add(first); indices.Add(first + 1); indices.Add(first + 2);
		}
	}

	private static ArrayMesh Assemble(List<Vector3> verts, List<Vector3> normals,
		List<Vector2> uvs, List<int> indices)
	{
		var arrays = new Godot.Collections.Array();
		arrays.Resize((int)Mesh.ArrayType.Max);
		arrays[(int)Mesh.ArrayType.Vertex] = verts.ToArray();
		arrays[(int)Mesh.ArrayType.Normal] = normals.ToArray();
		arrays[(int)Mesh.ArrayType.TexUV] = uvs.ToArray();
		arrays[(int)Mesh.ArrayType.Index] = indices.ToArray();

		var mesh = new ArrayMesh();
		mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);
		return mesh;
	}
}
