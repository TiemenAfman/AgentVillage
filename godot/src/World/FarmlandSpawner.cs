using System;
using System.Collections.Generic;
using Godot;
using Promptholm.Data.Models;
using Promptholm.Visual;

namespace Promptholm.World;

/// <summary>
/// Ploughed farmland and fruit orchards in the countryside between hamlets, matching
/// the V1 hamlets.js planFields / buildFieldDecals / orchardTrees visual. Fields are
/// flat loam-brown slabs with furrow ridges along the long axis, orchards are a
/// regular grid of stylised fruit trees. All placed cells are returned so
/// <see cref="PropSpawner"/> can skip them.
/// </summary>
[GlobalClass]
public partial class FarmlandSpawner : Node3D
{
	private static readonly Color FieldBase = new(0.42f, 0.34f, 0.25f);
	private static readonly Color FieldFurrow = new(0.49f, 0.42f, 0.31f);
	private static readonly Color OrchardTrunk = new(0.45f, 0.31f, 0.18f);
	private static readonly Color OrchardFoliage = new(0.30f, 0.58f, 0.22f);
	private static readonly Color OrchardFruit = new(0.72f, 0.22f, 0.18f);

	public int FieldCount { get; private set; }
	public int OrchardCount { get; private set; }

	/// <summary>
	/// Scan the countryside for ploughed fields and orchards, draw them, and return the
	/// set of cell coordinates occupied so <see cref="PropSpawner"/> can skip them.
	/// </summary>
	public IReadOnlySet<(int, int)> SpawnFields(
		TerrainField terrain, VillageData village)
	{
		foreach (var child in GetChildren())
		{
			RemoveChild(child);
			child.QueueFree();
		}
		FieldCount = 0;
		OrchardCount = 0;

		int size = terrain.Size;
		var owner = ParcelRaster.DecodeOwners(village, size);
		var cleared = BuildClearedSet(terrain, village);

		var fieldCells = new HashSet<(int, int)>();
		var slabTfs = new List<Transform3D>();
		var furrowTfs = new List<Transform3D>();
		var orchardTfs = new List<Transform3D>();

		var rng = new PmRng(terrain.IslandSeed).Fork("fields");

		for (int gz = 1; gz < size - 1; gz++)
		{
			for (int gx = 1; gx < size - 1; gx++)
			{
				if (!Candidate(gx, gz, terrain, owner, cleared))
					continue;

				uint h = PmRng.Hash32($"{terrain.IslandSeed}:field:{gx},{gz}");
				if ((h % 1000) / 1000.0 > 0.35)
					continue;

				short mine = owner[gx + gz * size];
				int roll = (int)((h >> 10) % 100);

				if (mine == ParcelRaster.None)
				{
					int w = 2 + (int)((h >> 17) % 2);
					int d = 3 + (int)((h >> 19) % 2);

					if (roll < 62 && Fits(gx, gz, w, d, terrain, owner, cleared))
					{
						Take(gx, gz, w, d, fieldCells);
						BuildFieldSlabs(gx, gz, w, d, terrain, slabTfs, furrowTfs);
						FieldCount++;
					}
					else if (Fits(gx, gz, 3, 3, terrain, owner, cleared))
					{
						Take(gx, gz, 3, 3, fieldCells);
						BuildOrchardTrees(gx, gz, terrain, orchardTfs);
						OrchardCount++;
					}
				}
			}
		}

		if (slabTfs.Count > 0)
			AddChild(FillMulti(FieldSlabMesh(terrain.Span(1.0)), slabTfs));
		if (furrowTfs.Count > 0)
			AddChild(FillMulti(FurrowMesh(), furrowTfs));
		if (orchardTfs.Count > 0)
			AddChild(FillMulti(OrchardTreeMesh(), orchardTfs));

		GD.Print($"[FarmlandSpawner] {FieldCount} fields, {OrchardCount} orchards, "
			+ $"{fieldCells.Count} cells");

		return fieldCells;
	}

	// ---- candidate checks -------------------------------------------------------

	private static bool Candidate(int gx, int gz, TerrainField terrain,
		short[] owner, HashSet<long> cleared)
	{
		int size = terrain.Size;
		if (gx < 1 || gz < 1 || gx >= size - 1 || gz >= size - 1)
			return false;
		long key = (long)gz * size + gx;
		if (cleared.Contains(key))
			return false;
		if (!terrain.IsLand(gx, gz) || terrain.IsBeach(gx, gz))
			return false;
		if (terrain.Slope(gx, gz) >= 0.35)
			return false;
		return true;
	}

	private static bool Fits(int gx, int gz, int w, int d,
		TerrainField terrain, short[] owner, HashSet<long> cleared)
	{
		for (int z = 0; z < d; z++)
			for (int x = 0; x < w; x++)
				if (!Candidate(gx + x, gz + z, terrain, owner, cleared))
					return false;
		return true;
	}

	private static void Take(int gx, int gz, int w, int d,
		HashSet<(int, int)> fieldCells)
	{
		for (int z = 0; z < d; z++)
			for (int x = 0; x < w; x++)
				fieldCells.Add((gx + x, gz + z));
	}

	// ---- cleared set ------------------------------------------------------------

	private static HashSet<long> BuildClearedSet(TerrainField terrain,
		VillageData village)
	{
		int size = terrain.Size;
		var cleared = new HashSet<long>();

		foreach (var cell in village.Cleared)
		{
			if (cell.Count >= 2)
			{
				int cx = cell[0], cz = cell[1];
				if (cx >= 0 && cz >= 0 && cx < size && cz < size)
					cleared.Add((long)cz * size + cx);
			}
		}

		foreach (var polder in village.Polders)
		{
			if (polder.Dike is not null)
			{
				foreach (var cell in polder.Dike)
				{
					if (cell.Count >= 2)
					{
						int cx = cell[0], cz = cell[1];
						if (cx >= 0 && cz >= 0 && cx < size && cz < size)
							cleared.Add((long)cz * size + cx);
					}
				}
			}
		}

		const int margin = 1;
		foreach (var b in village.Buildings)
		{
			var p = b.Plot;
			if (p is null) continue;
			int gx0 = Math.Clamp(p.Gx - margin, 0, size - 1);
			int gz0 = Math.Clamp(p.Gz - margin, 0, size - 1);
			int gx1 = Math.Clamp(p.Gx + p.W - 1 + margin, 0, size - 1);
			int gz1 = Math.Clamp(p.Gz + p.D - 1 + margin, 0, size - 1);
			for (int gz = gz0; gz <= gz1; gz++)
				for (int gx = gx0; gx <= gx1; gx++)
					cleared.Add((long)gz * size + gx);
		}

		return cleared;
	}

	// ---- field mesh --------------------------------------------------------------

	private static void BuildFieldSlabs(int gx, int gz, int w, int d,
		TerrainField terrain, List<Transform3D> slabTfs,
		List<Transform3D> furrowTfs)
	{
		float half = (float)terrain.Half;
		// This file was written when a layout cell was a metre. It is four now, so everything
		// measured in cells - positions, field widths, furrow spacing - is a length in lots
		// and gets multiplied here. What is measured in metres, like the width of a furrow or
		// the size of a tree, is left alone: a plum tree does not grow when the grid does.
		float lot = terrain.Span(1.0);

		for (int z = 0; z < d; z++)
		{
			for (int x = 0; x < w; x++)
			{
				int cx = gx + x, cz = gz + z;
				float wx = (cx - half + 0.5f) * lot;
				float wz = (cz - half + 0.5f) * lot;
				float y = (float)terrain.WorldHeight(wx, wz) + 0.045f;
				slabTfs.Add(new Transform3D(Basis.Identity,
					new Vector3(wx, y, wz)));
			}
		}

		float ox = (gx - half) * lot;
		float oz = (gz - half) * lot;
		bool alongX = w >= d;
		// A furrow every metre, whatever a lot is worth: the spacing is a fact about ploughing.
		int steps = (int)Math.Round((alongX ? d : w) * lot);

		for (int s = 1; s < steps; s++)
		{
			float o = s;
			float fy;
			Vector3 pos;
			if (alongX)
			{
				float midX = ox + w * 0.5f * lot;
				float fZ = oz + o;
				fy = (float)terrain.WorldHeight(midX, fZ) + 0.055f;
				pos = new Vector3(midX, fy, fZ);
			}
			else
			{
				float fX = ox + o;
				float midZ = oz + d * 0.5f * lot;
				fy = (float)terrain.WorldHeight(fX, midZ) + 0.055f;
				pos = new Vector3(fX, fy, midZ);
			}

			Basis basis;
			if (alongX)
			{
				float fW = w * lot - 0.16f;
				basis = new Basis(
					new Vector3(fW, 0, 0),
					new Vector3(0, 0.02f, 0),
					new Vector3(0, 0, 0.10f));
			}
			else
			{
				float fD = d * lot - 0.16f;
				basis = new Basis(
					new Vector3(0.10f, 0, 0),
					new Vector3(0, 0.02f, 0),
					new Vector3(0, 0, fD));
			}

			furrowTfs.Add(new Transform3D(basis, pos));
		}
	}

	// ---- orchard mesh ------------------------------------------------------------

	private static void BuildOrchardTrees(int gx, int gz,
		TerrainField terrain, List<Transform3D> orchardTfs)
	{
		float half = (float)terrain.Half;
		float lot = terrain.Span(1.0);

		for (int z = 0; z < 3; z++)
		{
			for (int x = 0; x < 3; x++)
			{
				int cx = gx + x, cz = gz + z;
				float wx = (cx - half + 0.5f) * lot;
				float wz = (cz - half + 0.5f) * lot;
				float y = (float)terrain.WorldHeight(wx, wz);

				uint h = PmRng.Hash32($"orch:{cx},{cz}");
				float scale = 0.46f + (h % 20) / 100f;

				var basis = new Basis(
					new Vector3(scale, 0, 0),
					new Vector3(0, scale, 0),
					new Vector3(0, 0, scale));
				orchardTfs.Add(new Transform3D(basis,
					new Vector3(wx, y, wz)));
			}
		}
	}

	// ---- mesh factories ----------------------------------------------------------

	private static StandardMaterial3D Mat(Color c)
		=> Palette.Solid(c, 0.9f);

	private static BoxMesh FieldSlabMesh(float lot)
	{
		var box = new BoxMesh { Size = new Vector3(lot, 0.06f, lot) };
		box.Material = Mat(FieldBase);
		return box;
	}

	private static BoxMesh FurrowMesh()
	{
		var box = new BoxMesh { Size = Vector3.One };
		box.Material = Mat(FieldFurrow);
		return box;
	}

	/// <summary>
	/// One stylised fruit tree: trunk cylinder + spherical foliage dome + three fruit
	/// flecks, base on y = 0 so instances sit flush on the ground.
	/// </summary>
	private static ArrayMesh OrchardTreeMesh()
	{
		var trunk = new CylinderMesh
		{
			TopRadius = 0.06f,
			BottomRadius = 0.09f,
			Height = 0.9f,
			RadialSegments = 5,
		};

		var crown = new SphereMesh
		{
			Radius = 0.55f,
			Height = 0.9f,
			RadialSegments = 7,
			Rings = 4,
		};

		return MergeSurfaces(
			(trunk, new Vector3(0, 0.45f, 0), Mat(OrchardTrunk)),
			(crown, new Vector3(0, 1.3f, 0), Mat(OrchardFoliage)));
	}

	private static ArrayMesh MergeSurfaces(
		params (Mesh mesh, Vector3 offset, Material mat)[] parts)
	{
		var result = new ArrayMesh();
		foreach (var (mesh, offset, mat) in parts)
		{
			var src = mesh.SurfaceGetArrays(0);
			var verts = (Vector3[]?)src[(int)Mesh.ArrayType.Vertex]
				?? Array.Empty<Vector3>();
			var normals = (Vector3[]?)src[(int)Mesh.ArrayType.Normal]
				?? Array.Empty<Vector3>();
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

	// ---- MultiMesh helper --------------------------------------------------------

	private static MultiMeshInstance3D FillMulti(Mesh mesh,
		List<Transform3D> tfs)
	{
		var mm = new MultiMesh
		{
			Mesh = mesh,
			TransformFormat = MultiMesh.TransformFormatEnum.Transform3D,
		};
		var mmi = new MultiMeshInstance3D { Multimesh = mm };
		mm.InstanceCount = tfs.Count;
		for (int i = 0; i < tfs.Count; i++)
			mm.SetInstanceTransform(i, tfs[i]);
		return mmi;
	}
}
