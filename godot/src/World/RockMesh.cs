using System;
using System.Collections.Generic;
using Godot;
using Promptholm.Visual;

namespace Promptholm.World;

/// <summary>
/// The rocks, built here rather than loaded.
///
/// There is not a single mesh file in this project - every tree, house and boulder is primitives
/// stitched together at run time - and for this look that is an advantage rather than a stopgap.
/// The reference is faceted: flat faces meeting at hard edges, with the shading doing the work a
/// photograph would otherwise do. That is what a low-poly blob with per-face normals *is*, and it
/// is a dozen lines; a photoscanned boulder would have to be dragged back towards it.
///
/// Three silhouettes, because the reference has three and they are not interchangeable:
///
///   massif   the mountain-scale block. Chunky and angular, barely squashed - this is the one
///            that gives the skyline, and it is deliberately not the flat plate below. Getting
///            those two confused reads as a field of tents.
///   slab     the broken plate on a scree slope. Same faceting, pressed flat.
///   boulder  at the waterline. Rounded, egg-like, worn smooth by the sea. Smoothed normals,
///            gentle jitter.
///
/// Both come off the same generator; what differs is how far the vertices are pushed and whether
/// the normals are averaged. Geology gets that right for free - the sea rounds what it reaches.
/// </summary>
public static class RockMesh
{
	/// <summary>Colour of bare stone. Warm, not the cool grey this project used to use: every
	/// reference image is sandstone, and a grey rock reads as concrete beside a red roof.</summary>
	public static readonly Color Stone = new(0.66f, 0.58f, 0.46f);

	/// <summary>The mountain-scale block: chunky, angular, hard edges, and thick.</summary>
	public static ArrayMesh Massif(uint seed) => Build(seed, faceted: true, jitter: 0.38f, squash: 0.92f, rings: 3, segments: 6);

	/// <summary>A broken plate for a scree slope: the same faceting, pressed flat.</summary>
	public static ArrayMesh Slab(uint seed) => Build(seed, faceted: true, jitter: 0.46f, squash: 0.44f, rings: 2, segments: 5);

	/// <summary>A rounded, wave-worn boulder for the shore.</summary>
	public static ArrayMesh Boulder(uint seed) => Build(seed, faceted: false, jitter: 0.14f, squash: 0.78f, rings: 5, segments: 11);

	/// <summary>
	/// A blob of unit radius, displaced and re-normalled.
	///
	/// Displacement is keyed on the vertex *direction* rather than on its index, which matters:
	/// a SphereMesh duplicates vertices along its UV seam, and pushing those two copies by
	/// different amounts splits the rock open along a meridian.
	/// </summary>
	private static ArrayMesh Build(uint seed, bool faceted, float jitter, float squash, int rings, int segments)
	{
		var sphere = new SphereMesh { Radius = 1.0f, Height = 2.0f, RadialSegments = segments, Rings = rings };
		var arrays = sphere.GetMeshArrays();
		var source = (Vector3[])arrays[(int)Mesh.ArrayType.Vertex];
		var indices = (int[])arrays[(int)Mesh.ArrayType.Index];

		var moved = new Vector3[source.Length];
		for (int i = 0; i < source.Length; i++)
		{
			var dir = source[i].Normalized();
			// Three bands of noise over the direction, so the surface has a big lump, a few
			// medium ones and a little roughness - the same trick the terrain uses, at the
			// scale of one stone.
			float r = 1.0f
				+ jitter * Wobble(seed, dir, 1.7f)
				+ jitter * 0.55f * Wobble(seed ^ 0x9E37u, dir, 3.9f)
				+ jitter * 0.28f * Wobble(seed ^ 0x85EBu, dir, 8.3f);
			moved[i] = dir * r * new Vector3(1.0f, squash, 1.0f);
		}

		var vertices = new List<Vector3>(indices.Length);
		var normals = new List<Vector3>(indices.Length);

		if (faceted)
		{
			// One normal per triangle. This is the whole look: without it the same geometry
			// reads as a lumpy potato, with it as broken stone.
			for (int t = 0; t + 2 < indices.Length; t += 3)
			{
				var a = moved[indices[t]];
				var b = moved[indices[t + 1]];
				var c = moved[indices[t + 2]];
				var n = Outward(a, b, c);
				if (n == Vector3.Zero) continue;
				vertices.Add(a); vertices.Add(b); vertices.Add(c);
				normals.Add(n); normals.Add(n); normals.Add(n);
			}
		}
		else
		{
			// Averaged over the triangles that share a position, not over the ones that share an
			// index - otherwise the UV seam shades as a crease straight down the stone.
			var sum = new Dictionary<Vector3I, Vector3>();
			for (int t = 0; t + 2 < indices.Length; t += 3)
			{
				var a = moved[indices[t]];
				var b = moved[indices[t + 1]];
				var c = moved[indices[t + 2]];
				var n = Outward(a, b, c);
				if (n == Vector3.Zero) continue;
				foreach (var v in new[] { a, b, c })
				{
					var key = Key(v);
					sum[key] = sum.TryGetValue(key, out var had) ? had + n : n;
				}
			}
			for (int t = 0; t + 2 < indices.Length; t += 3)
			{
				var a = moved[indices[t]];
				var b = moved[indices[t + 1]];
				var c = moved[indices[t + 2]];
				if ((b - a).Cross(c - a).LengthSquared() < 1e-9f) continue;
				foreach (var v in new[] { a, b, c })
				{
					vertices.Add(v);
					normals.Add(sum[Key(v)].Normalized());
				}
			}
		}

		var built = new Godot.Collections.Array();
		built.Resize((int)Mesh.ArrayType.Max);
		built[(int)Mesh.ArrayType.Vertex] = vertices.ToArray();
		built[(int)Mesh.ArrayType.Normal] = normals.ToArray();

		var mesh = new ArrayMesh();
		mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, built);
		mesh.SurfaceSetMaterial(0, StoneMaterial());
		return mesh;
	}

	private static StandardMaterial3D? _stone;

	/// <summary>
	/// Stone, textured in **world space** rather than by UV.
	///
	/// These meshes carry no UVs at all - they are generated here and unwrapping procedural
	/// geometry is work nobody wants to do twice. Triplanar mapping in world space sidesteps it
	/// entirely: the texture is sampled from where the surface *is*, so a rock gets its grain
	/// without an unwrap, two rocks lying against each other line up, and a rock scaled to
	/// fifteen metres does not smear the way a UV-mapped one would.
	///
	/// The detail is a normal map only, generated from noise rather than photographed. That is
	/// the whole stylised-versus-photoscan decision in one place: the silhouette and the facets
	/// carry the shape, and this adds the suggestion of grain under raking light without putting
	/// a photograph of granite on a hand-made block.
	/// </summary>
	private static StandardMaterial3D StoneMaterial()
	{
		if (_stone is not null) return _stone;

		var noise = new FastNoiseLite
		{
			NoiseType = FastNoiseLite.NoiseTypeEnum.SimplexSmooth,
			Frequency = 0.035f,
			FractalOctaves = 4,
		};
		var grain = new NoiseTexture2D
		{
			Noise = noise,
			Width = 512,
			Height = 512,
			Seamless = true,
			AsNormalMap = true,
			BumpStrength = 3.5f,
		};

		_stone = Palette.Solid(Stone, 0.92f);
		_stone.NormalEnabled = true;
		_stone.NormalTexture = grain;
		_stone.NormalScale = 0.55f;
		// Sampled from world position, not from UVs the mesh does not have. Sharpness keeps the
		// three projections from mushing into each other on a facet that faces a corner.
		_stone.Uv1Triplanar = true;
		_stone.Uv1WorldTriplanar = true;
		_stone.Uv1TriplanarSharpness = 2.0f;
		// One repeat per two metres: fine enough to read as stone up close, coarse enough that a
		// fifteen-metre massif is not sandpaper.
		_stone.Uv1Scale = new Vector3(0.5f, 0.5f, 0.5f);
		return _stone;
	}

	/// <summary>
	/// The face normal, pointing away from the middle of the stone.
	///
	/// The cross product alone gives whichever way the winding happens to run, and SphereMesh
	/// winds the two hemispheres opposite ways once its vertices have been displaced. Half the
	/// facets then face inward and shade black, which is exactly what the first render showed.
	/// A rock is star-shaped around its own centre, so "outward" is simply "away from the
	/// origin" and there is nothing to get wrong.
	/// </summary>
	private static Vector3 Outward(Vector3 a, Vector3 b, Vector3 c)
	{
		var n = (b - a).Cross(c - a);
		if (n.LengthSquared() < 1e-9f) return Vector3.Zero;
		n = n.Normalized();
		return n.Dot((a + b + c) / 3.0f) < 0.0f ? -n : n;
	}

	/// <summary>Positions rounded to a tenth of a millimetre, so two copies of a seam vertex
	/// hash to the same bucket.</summary>
	private static Vector3I Key(Vector3 v)
		=> new((int)MathF.Round(v.X * 10000f), (int)MathF.Round(v.Y * 10000f), (int)MathF.Round(v.Z * 10000f));

	/// <summary>Smooth pseudo-noise over a direction, in −1..1. Three hashed lobes is enough
	/// shape for a stone and costs nothing next to a real noise field.</summary>
	private static float Wobble(uint seed, Vector3 dir, float frequency)
	{
		float acc = 0.0f;
		for (int k = 0; k < 3; k++)
		{
			uint h = PmRng.Hash32($"rock:{seed}:{frequency}:{k}");
			var axis = new Vector3(
				((h & 0xFF) / 255.0f) - 0.5f,
				(((h >> 8) & 0xFF) / 255.0f) - 0.5f,
				(((h >> 16) & 0xFF) / 255.0f) - 0.5f).Normalized();
			float phase = ((h >> 24) & 0xFF) / 255.0f * Mathf.Tau;
			acc += MathF.Sin(dir.Dot(axis) * frequency + phase);
		}
		return acc / 3.0f;
	}
}
