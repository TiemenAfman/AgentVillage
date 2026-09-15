using System;
using System.Collections.Generic;
using Godot;
using Promptholm.Visual;

namespace Promptholm.World;

/// <summary>
/// Turns a loaded <see cref="TerrainField"/> into geometry: one mesh per published chunk.
///
/// One mesh for the whole island was fine at 64 m. On a 1024 m envelope it is not: a single
/// ArrayMesh cannot be frustum-culled, cannot be given a level of detail and cannot be occluded,
/// so standing on the shore you draw the far side of the island through the hill in front of you.
/// Per chunk, all three come free, and 64 m is the same number the navmesh will tile on and the
/// same number the chunks are published in - which is not a coincidence, it is exactly the size
/// of the island this project started with.
/// </summary>
public static class TerrainMeshBuilder
{
	/// <summary>Sea-only chunks are sampled every this many metres. Nobody reads the bottom of the
	/// ocean at a metre; what matters is that the water has something to tint against.</summary>
	public const int SeaStride = 4;

	public sealed record Stats(int Chunks, int Vertices, int Triangles, ulong Milliseconds);

	/// <summary>
	/// Build every published chunk under <paramref name="root"/>, replacing whatever was there.
	/// </summary>
	public static Stats BuildInto(Node3D root, TerrainField field, Material material)
	{
		var clock = Time.GetTicksMsec();

		foreach (var child in root.GetChildren())
		{
			root.RemoveChild(child);
			child.QueueFree();
		}

		int vertices = 0, triangles = 0, built = 0;
		foreach (var info in field.Manifest.Chunks)
		{
			// Land at full resolution, open water coarse. The manifest already says which is
			// which, so this costs nothing to decide.
			int stride = info.MaxY > 0.0f ? 1 : SeaStride;
			var mesh = BuildChunkMesh(field, info, stride, out int v, out int t);
			if (mesh is null) continue;

			root.AddChild(new MeshInstance3D
			{
				Name = $"Chunk_{info.Cx}_{info.Cz}",
				Mesh = mesh,
				MaterialOverride = material,
				// The sea floor never casts anything worth seeing and there is a lot of it.
				CastShadow = info.MaxY > 0.0f
					? GeometryInstance3D.ShadowCastingSetting.On
					: GeometryInstance3D.ShadowCastingSetting.Off,
			});
			vertices += v;
			triangles += t;
			built++;
		}

		return new Stats(built, vertices, triangles, Time.GetTicksMsec() - clock);
	}

	private static ArrayMesh? BuildChunkMesh(TerrainField field, ChunkInfo info, int stride, out int vertexCount, out int triangleCount)
	{
		vertexCount = 0;
		triangleCount = 0;

		float mps = field.MetresPerSample;
		int span = (int)MathF.Round(field.Manifest.ChunkM / mps);       // 64 samples of ground
		int cols = span / stride + 1;                                   // plus the shared edge
		if (cols < 2) return null;

		// Where this chunk starts in the field's own lattice.
		int originI = (int)MathF.Round((info.Cx * field.Manifest.ChunkM + field.Half) / mps);
		int originJ = (int)MathF.Round((info.Cz * field.Manifest.ChunkM + field.Half) / mps);

		var verts = new Vector3[cols * cols];
		var colours = new Color[cols * cols];
		var normals = new Vector3[cols * cols];

		for (int j = 0; j < cols; j++)
		{
			int sj = originJ + j * stride;
			for (int i = 0; i < cols; i++)
			{
				int si = originI + i * stride;
				int k = i + j * cols;
				var (wx, wz) = field.WorldOf(si, sj);
				float y = field.HeightOf(si, sj);
				verts[k] = new Vector3(wx, y, wz);
				// Godot reads ArrayMesh vertex colours as linear. Skipping this conversion is
				// what once turned the whole island a bleached mint, and it does not look like a
				// bug - it looks like somebody chose bad colours.
				colours[k] = Palette.Terrain(field.ClassOf(si, sj)).SrgbToLinear();

				// From the field rather than from the mesh, so a chunk's edge normals match its
				// neighbour's exactly and the seam does not catch the light.
				float hl = field.HeightOf(si - stride, sj);
				float hr = field.HeightOf(si + stride, sj);
				float hd = field.HeightOf(si, sj - stride);
				float hu = field.HeightOf(si, sj + stride);
				float step = 2.0f * stride * mps;
				normals[k] = new Vector3(hl - hr, step, hd - hu).Normalized();
			}
		}

		int quads = cols - 1;
		var indices = new int[quads * quads * 6];
		int at = 0;
		for (int j = 0; j < quads; j++)
		{
			for (int i = 0; i < quads; i++)
			{
				int a = i + j * cols;
				int b = a + 1;
				int c = a + cols;
				int d = c + 1;
				// Winding matters and is easy to get backwards: reversed, every triangle faces
				// away, backface culling hides it, and the island renders as a handful of
				// slivers rather than as nothing - which reads like a broken mesh rather than
				// like a flipped one.
				indices[at++] = a; indices[at++] = b; indices[at++] = c;
				indices[at++] = b; indices[at++] = d; indices[at++] = c;
			}
		}

		var arrays = new Godot.Collections.Array();
		arrays.Resize((int)Mesh.ArrayType.Max);
		arrays[(int)Mesh.ArrayType.Vertex] = verts;
		arrays[(int)Mesh.ArrayType.Normal] = normals;
		arrays[(int)Mesh.ArrayType.Color] = colours;
		arrays[(int)Mesh.ArrayType.Index] = indices;

		var mesh = new ArrayMesh();
		mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);

		vertexCount = verts.Length;
		triangleCount = indices.Length / 3;
		return mesh;
	}

	/// <summary>
	/// Collision for the whole envelope as one <see cref="HeightMapShape3D"/>.
	///
	/// Still a heightfield, and deliberately: the ground is single-valued by construction - the
	/// generator caps its own gradient at 45 degrees and hands anything steeper to a rock shell,
	/// which is separate geometry with its own trimesh. So the cheapest large-area collider in the
	/// engine keeps doing the job it is good at.
	/// </summary>
	public static CollisionShape3D BuildCollider(TerrainField field)
	{
		var data = new float[field.N * field.N];
		Array.Copy(field.Heights, data, data.Length);

		return new CollisionShape3D
		{
			Name = "TerrainCollider",
			Shape = new HeightMapShape3D
			{
				MapWidth = field.N,
				MapDepth = field.N,
				MapData = data,
			},
			// A HeightMapShape3D is centred on its own middle, and its samples are one unit
			// apart - which is exactly metresPerSample here, so no scaling is needed. The half
			// sample offset puts sample 0 at the corner of the envelope rather than half a metre
			// inside it.
			Position = new Vector3(0.5f * field.MetresPerSample, 0.0f, 0.5f * field.MetresPerSample),
		};
	}

	/// <summary>Chunks whose ground rises above the waterline, nearest a point first. Useful for
	/// deciding where to put a camera without knowing anything about the island.</summary>
	public static List<ChunkInfo> LandChunksNear(TerrainField field, Vector2 at)
	{
		var list = new List<ChunkInfo>();
		foreach (var c in field.Manifest.Chunks)
			if (c.MaxY > 0.0f) list.Add(c);

		float chunkM = field.Manifest.ChunkM;
		list.Sort((a, b) =>
		{
			float da = new Vector2(a.Cx * chunkM - at.X, a.Cz * chunkM - at.Y).LengthSquared();
			float db = new Vector2(b.Cx * chunkM - at.X, b.Cz * chunkM - at.Y).LengthSquared();
			return da.CompareTo(db);
		});
		return list;
	}
}
