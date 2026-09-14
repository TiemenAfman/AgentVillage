using System;
using System.Collections.Generic;
using Godot;
using Promptholm.Data.Models;

namespace Promptholm.World;

/// <summary>
/// Deterministic prop placement on land tiles, drawn as MultiMesh so a thousand trees and
/// rocks cost a handful of draw calls. The distribution is derived from the island seed
/// (PmRng "props" + a "forest" simplex), so the same seed always scatters the same props.
/// Every instance is clamped to the bilinear terrain height so nothing floats or sinks.
/// </summary>
[GlobalClass]
public partial class PropSpawner : Node3D
{
	private static readonly Color FoliageColour = new(0.24f, 0.62f, 0.30f);
	private static readonly Color FoliageDark = new(0.15f, 0.48f, 0.24f);
	private static readonly Color TrunkColour = new(0.45f, 0.31f, 0.18f);
	private static readonly Color RockColour = new(0.52f, 0.52f, 0.53f);

	/// <summary>
	/// Deterministic prop placement on land tiles, drawn as MultiMesh so a thousand trees
	/// and rocks cost a handful of draw calls. Beach cells and building plots (plus a
	/// one-cell margin) are skipped. The distribution is derived from the island seed
	/// (PmRng "props" + a "forest" simplex), so the same seed always scatters the same
	/// props. Every instance is clamped strictly to the terrain elevation via
	/// TerrainGenerator.WorldHeight so nothing floats or sinks.
	/// </summary>
	public void SpawnProps(TerrainGenerator terrain, VillageData village)
	{
		foreach (var child in GetChildren())
		{
			RemoveChild(child);
			child.QueueFree();
		}

		var blocked = CollectBlockedCells(terrain, village);

		var rng = new PmRng(terrain.IslandSeed).Fork("props");
		var forest = new PmSimplex(PmRng.Hash32(terrain.IslandSeed.ToString() + ":forest"));

		var trees = new List<Transform3D>();
		var rocks = new List<Transform3D>();

		foreach (var cell in terrain.LandCells)
		{
			if (terrain.IsBeach(cell.X, cell.Z))
				continue;
			if (blocked.Contains((long)cell.Z * terrain.Size + cell.X))
				continue;

			var (wx, wz) = terrain.CellWorld(cell.X, cell.Z);
			double forestN = forest.Noise2(wx * 0.10, wz * 0.10);
			double treeDensity = Math.Clamp(0.055 + forestN * 0.045, 0.01, 0.16);
			double roll = rng.Next();
			double ground = terrain.WorldHeight(wx, wz);

			if (roll < treeDensity)
			{
				float scale = (float)(0.75 + forestN * 0.2 + rng.Next() * 0.3);
				float yaw = (float)rng.RangeF(0.0, Math.Tau);
				var basis = RotScale(yaw, 0.0f, new Vector3(scale, scale, scale));
				trees.Add(new Transform3D(basis, new Vector3((float)wx, (float)ground, (float)wz)));
			}
			else if (roll < treeDensity + 0.014)
			{
				float scale = (float)(0.5 + rng.Next() * 1.1);
				float yaw = (float)rng.RangeF(0.0, Math.Tau);
				float tilt = (float)rng.RangeF(-0.12, 0.12);
				var basis = RotScale(yaw, tilt, new Vector3(scale, scale * 0.8f, scale));
				rocks.Add(new Transform3D(basis, new Vector3((float)wx, (float)ground, (float)wz)));
			}
		}

		FillMulti(CreateInstance(PlantPineMesh()), trees);
		FillMulti(CreateInstance(BoxMeshFor(RockColour, new Vector3(0.8f, 0.62f, 0.74f))), rocks);

		GD.Print($"[PropSpawner] {trees.Count} trees, {rocks.Count} rocks");
	}

	/// <summary>
	/// Cell indices covered by every building plot plus a one-cell margin, clamped to the
	/// grid. Prop cells are keyed as gz * size + gx, the same space as TerrainGenerator
	/// cell coordinates.
	/// </summary>
	private static HashSet<long> CollectBlockedCells(TerrainGenerator terrain, VillageData village)
	{
		var blocked = new HashSet<long>();
		int size = terrain.Size;
		const int margin = 1;

		foreach (var b in village.Buildings)
		{
			var p = b.Plot;
			if (p is null)
				continue;

			int gx0 = Math.Clamp(p.Gx - margin, 0, size - 1);
			int gz0 = Math.Clamp(p.Gz - margin, 0, size - 1);
			int gx1 = Math.Clamp(p.Gx + p.W - 1 + margin, 0, size - 1);
			int gz1 = Math.Clamp(p.Gz + p.D - 1 + margin, 0, size - 1);

			for (int gz = gz0; gz <= gz1; gz++)
			{
				for (int gx = gx0; gx <= gx1; gx++)
					blocked.Add((long)gz * size + gx);
			}
		}

		return blocked;
	}

	private static void FillMulti(MultiMeshInstance3D mmi, List<Transform3D> transforms)
	{
		var mm = mmi.Multimesh!;
		mm.InstanceCount = transforms.Count;
		for (int i = 0; i < transforms.Count; i++)
			mm.SetInstanceTransform(i, transforms[i]);
	}

	private static MultiMeshInstance3D CreateInstance(Mesh mesh)
	{
		var mm = new MultiMesh
		{
			Mesh = mesh,
			TransformFormat = MultiMesh.TransformFormatEnum.Transform3D,
		};
		return new MultiMeshInstance3D { Multimesh = mm };
	}

	/// <summary>Final rotation/scale matrix M = Ryaw * Rtilt * S, computed per column.</summary>
	private static Basis RotScale(float yaw, float tilt, Vector3 scale)
	{
		Vector3 Col(Vector3 local)
		{
			var v = new Vector3(local.X * scale.X, local.Y * scale.Y, local.Z * scale.Z);

			// Rtilt about local X: y' = y·cos − z·sin, z' = y·sin + z·cos.
			float ct = Mathf.Cos(tilt), st = Mathf.Sin(tilt);
			float y2 = v.Y * ct - v.Z * st;
			float z2 = v.Y * st + v.Z * ct;
			v = new Vector3(v.X, y2, z2);

			// Ryaw about global Y: x' = x·cos + z·sin, z' = −x·sin + z·cos.
			float cy = Mathf.Cos(yaw), sy = Mathf.Sin(yaw);
			float x3 = v.X * cy + v.Z * sy;
			float z3 = -v.X * sy + v.Z * cy;
			return new Vector3(x3, v.Y, z3);
		}

		return new Basis(Col(Vector3.Right), Col(Vector3.Up), Col(Vector3.Back));
	}

	private static BoxMesh BoxMeshFor(Color colour, Vector3 size)
	{
		var box = new BoxMesh { Size = size };
		box.Material = SolidMaterial(colour);
		return box;
	}

	/// <summary>
	/// One stylised pine as a single ArrayMesh: trunk cylinder plus two stacked foliage
	/// cones, every surface with its own material so the merge needs one draw call each.
	/// The mesh is authored with the base on y = 0 so instances sit flush on the ground.
	/// </summary>
	private static ArrayMesh PlantPineMesh()
	{
		var trunk = new CylinderMesh
		{
			TopRadius = 0.09f,
			BottomRadius = 0.14f,
			Height = 1.7f,
			RadialSegments = 6,
		};

		var foliageLow = new CylinderMesh
		{
			TopRadius = 0.0f,
			BottomRadius = 0.8f,
			Height = 1.9f,
			RadialSegments = 7,
		};

		var foliageHigh = new CylinderMesh
		{
			TopRadius = 0.0f,
			BottomRadius = 0.55f,
			Height = 1.2f,
			RadialSegments = 7,
		};

		return MergeSurfaces(
			(trunk, new Vector3(0.0f, 0.85f, 0.0f), SolidMaterial(TrunkColour)),
			(foliageLow, new Vector3(0.0f, 2.15f, 0.0f), SolidMaterial(FoliageColour)),
			(foliageHigh, new Vector3(0.0f, 2.9f, 0.0f), SolidMaterial(FoliageDark)));
	}

	/// <summary>Translates each part and keeps one ArrayMesh surface per part with its material.</summary>
	private static ArrayMesh MergeSurfaces(params (Mesh mesh, Vector3 offset, Material mat)[] parts)
	{
		var result = new ArrayMesh();
		foreach (var (mesh, offset, mat) in parts)
		{
			var src = mesh.SurfaceGetArrays(0);
			var verts = (Vector3[]?)src[(int)Mesh.ArrayType.Vertex] ?? Array.Empty<Vector3>();
			var normals = (Vector3[]?)src[(int)Mesh.ArrayType.Normal] ?? Array.Empty<Vector3>();
			var index = (int[]?)src[(int)Mesh.ArrayType.Index];

			var translated = new Vector3[verts.Length];
			for (int i = 0; i < verts.Length; i++)
				translated[i] = verts[i] + offset;

			var arrays = new Godot.Collections.Array();
			arrays.Resize((int)Mesh.ArrayType.Max);
			arrays[(int)Mesh.ArrayType.Vertex] = translated;
			arrays[(int)Mesh.ArrayType.Normal] = normals;
			arrays[(int)Mesh.ArrayType.Index] = index!;

			int surface = result.GetSurfaceCount();
			result.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);
			result.SurfaceSetMaterial(surface, mat);
		}
		return result;
	}

	private static StandardMaterial3D SolidMaterial(Color colour)
		=> new() { AlbedoColor = colour, Roughness = 0.9f };
}