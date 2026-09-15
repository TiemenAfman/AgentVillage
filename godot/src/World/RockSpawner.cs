using System;
using System.Collections.Generic;
using Godot;
using Promptholm.Data.Models;

namespace Promptholm.World;

/// <summary>
/// Where the rocks go.
///
/// The server already decided this and nobody was reading it. Every sample of the island carries
/// a class byte — sea, beach, dune, meadow, wood, scree, rock, cliff — chosen by the generator
/// from slope, height and distance to the coast, and published in the chunks. So this spawner
/// invents nothing: it asks what the ground *is* and puts the matching stone on it.
///
/// That is a deliberate break with <c>PropSpawner</c>, which rolls its own forest noise and
/// therefore disagrees with the island it is standing on. Two derivations of one fact is the
/// bug class this whole rewrite exists to remove.
///
///   rock, cliff   massifs. Big, chunky, angular - the skyline.
///   scree         slabs. Broken plates, smaller and denser, lying where they fell.
///   beach, dune   boulders. Rounded, because the sea rounds what it reaches.
///
/// Placement goes through Terrain3D's instancer rather than a MultiMesh of our own, which buys
/// levels of detail, a shadow impostor for the distance, and culling per 32-vertex cell.
/// </summary>
public sealed class RockSpawner
{
	/// <summary>Three shapes of each kind. One would be scaled and rotated into a field of
	/// identical twins - the eye finds a repeated silhouette long before it finds a repeated
	/// texture.</summary>
	private const int Variants = 3;

	/// <summary>Metres between candidate positions. Finer than this and neighbouring rocks
	/// interpenetrate; coarser and the scatter reads as a grid.</summary>
	private const int StrideM = 3;

	/// <summary>
	/// How much of a rock's radius is buried.
	///
	/// A stone resting exactly on the surface looks dropped, so a little of it goes under. Only a
	/// little: the slope is already handled by seating it on the lowest ground under its
	/// footprint, and stacking a big fixed sink on top of that buries the rock until only a cap
	/// shows - which the render after the first fix duly did.
	/// </summary>
	private const float Sink = 0.18f;

	/// <summary>
	/// How far each kind is drawn. Terrain3D defaults lod0_range to 32 m and a one-mesh asset
	/// has one LOD, so that default *was* the draw distance: on an island of 400 m the massifs -
	/// the skyline - vanished within throwing distance of the camera. Massifs go the farthest,
	/// with shadows, because a silhouette without a shadow floats; slabs and boulders are ground
	/// detail and fade where the eye stops separating them from the terrain grain.
	/// </summary>
	private static readonly Terrain3DBridge.MeshTuning MassifTuning = new(320.0f, 40.0f, true);
	private static readonly Terrain3DBridge.MeshTuning SlabTuning = new(140.0f, 24.0f, true);
	private static readonly Terrain3DBridge.MeshTuning BoulderTuning = new(100.0f, 20.0f, true);

	public int Placed { get; private set; }

	/// <summary>
	/// Scatter stone over the island.
	/// </summary>
	/// <param name="cleared">Lots the village has taken - plots, roads, the square. The forest
	/// never grows back there and neither does the scree.</param>
	public void Spawn(Terrain3DBridge bridge, TerrainField field, VillageData village)
	{
		// Ascending, and that is not cosmetic: Terrain3D grows its mesh list one slot at a time,
		// so registering id 3 while the list holds one entry is refused with "Mesh ID out of
		// range". Interleaving the three kinds - which is what a loop over variants does - loses
		// the last two ids silently apart from an error nobody reads.
		//
		// The ids used to be written out here as 0..8. They come from the bridge now, because the
		// rocks are no longer the only thing being scattered and a second hardcoded block would
		// have landed on top of this one.
		int firstMassif = -1, firstSlab = -1, firstBoulder = -1;
		for (int v = 0; v < Variants; v++)
		{
			int id = bridge.RegisterMeshAsset($"massif{v}", RockMesh.Massif((uint)(v * 97 + 13)), tuning: MassifTuning);
			if (v == 0) firstMassif = id;
		}
		for (int v = 0; v < Variants; v++)
		{
			int id = bridge.RegisterMeshAsset($"slab{v}", RockMesh.Slab((uint)(v * 89 + 31)), tuning: SlabTuning);
			if (v == 0) firstSlab = id;
		}
		for (int v = 0; v < Variants; v++)
		{
			int id = bridge.RegisterMeshAsset($"boulder{v}", RockMesh.Boulder((uint)(v * 71 + 53)), tuning: BoulderTuning);
			if (v == 0) firstBoulder = id;
		}

		var cleared = TerrainField.ClearedLots(village);
		var batches = new Dictionary<int, (Godot.Collections.Array T, List<Color> C)>();

		float half = field.EnvelopeHalf;
		float mps = field.MetresPerSample;
		int stride = Math.Max(1, (int)MathF.Round(StrideM / mps));

		for (int j = 0; j < field.N; j += stride)
		{
			for (int i = 0; i < field.N; i += stride)
			{
				byte cls = field.ClassOf(i, j);
				var kind = KindFor(cls);
				if (kind is null) continue;

				float wx = i * mps - half;
				float wz = j * mps - half;
				if (cleared.Contains(field.LotKeyAt(wx, wz))) continue;

				// One hash decides everything about this stone, so the island is the same island
				// on every machine and after every restart - and so that changing the density
				// does not reshuffle the rocks that were already there.
				uint h = PmRng.Hash32($"{field.IslandSeed}:rock:{i},{j}");
				var (chance, minSize, maxSize, shape) = kind.Value;
				int firstId = shape switch
				{
					Shape.Massif => firstMassif,
					Shape.Slab => firstSlab,
					_ => firstBoulder,
				};
				if ((h % 10000) / 10000.0f > chance) continue;

				float y = field.HeightOf(i, j);
				if (y <= 0.2f) continue;                       // not in the surf

				int id = firstId + (int)((h >> 13) % Variants);
				// Cubed, so most stones are small and a big one is an event. A uniform draw gives
				// a field of medium rocks, which is the least interesting of all worlds.
				float u = ((h >> 17) & 0xFF) / 255.0f;
				// Diameter, not radius: RockMesh builds a blob of unit radius, so the scale that
				// goes into the basis is half of this. Getting that wrong made everything twice
				// the size it should be, and an eleven-metre massif came out at twenty-two.
				float size = minSize + (maxSize - minSize) * u * u * u;
				float radius = size * 0.5f;

				float yaw = ((h >> 5) & 0xFF) / 255.0f * Mathf.Tau;
				float tilt = (((h >> 21) & 0x3F) / 63.0f - 0.5f) * 0.35f;
				var basis = new Basis(Vector3.Up, yaw) * new Basis(Vector3.Right, tilt);
				basis = basis.Scaled(new Vector3(radius, radius * (0.8f + ((h >> 9) & 0x1F) / 80.0f), radius));

				// Jitter inside the stride, or the whole scatter lands on a three-metre lattice.
				float jx = (((h >> 3) & 0xFF) / 255.0f - 0.5f) * StrideM;
				float jz = (((h >> 11) & 0xFF) / 255.0f - 0.5f) * StrideM;
				float px = wx + jx, pz = wz + jz;

				// Sit on the *lowest* ground the stone covers, not on the height at its middle.
				// On a slope the middle is well above the downhill edge, and a rock placed there
				// hangs in the air on one side - which is exactly what the first scatter did. Four
				// samples around the footprint is enough; the shape is convex and the error a
				// finer sample would catch is smaller than the sink.
				float ground = Floor(field, px, pz, radius * 0.8f);
				var at = new Vector3(px, ground - radius * Sink, pz);

				if (!batches.TryGetValue(id, out var batch))
				{
					batch = (new Godot.Collections.Array(), new List<Color>());
					batches[id] = batch;
				}
				batch.T.Add(new Transform3D(basis, at));
				batch.C.Add(Colors.White);
				Placed++;
			}
		}

		foreach (var (id, batch) in batches)
			bridge.AddInstances(id, batch.T, batch.C.ToArray());
		bridge.FinishInstances();

		GD.Print($"[RockSpawner] {Placed} stones over {batches.Count} shapes, " +
			$"{bridge.InstanceCount} instances rendered");
	}

	/// <summary>
	/// What grows on what, and how much of it.
	///
	/// The sizes are metres of diameter and they are the whole art direction: a massif has to be
	/// taller than a house or it is a boulder, and a scree plate has to be smaller than a person
	/// or it is a massif. The chances are per candidate position, three metres apart.
	/// </summary>
	private static (float Chance, float Min, float Max, Shape Shape)? KindFor(byte cls) => cls switch
	{
		TerrainClass.Rock or TerrainClass.Cliff => (0.10f, 2.0f, 8.5f, Shape.Massif),
		TerrainClass.Scree => (0.16f, 0.6f, 2.8f, Shape.Slab),
		TerrainClass.Beach or TerrainClass.Dune => (0.022f, 0.4f, 1.9f, Shape.Boulder),
		// A few strays out on the meadow, which is what stops the bare ground and the green
		// reading as two separate rooms with a hard door between them.
		TerrainClass.Meadow => (0.006f, 0.4f, 1.5f, Shape.Slab),
		_ => null,
	};

	/// <summary>Which of the three silhouettes a class of ground grows.</summary>
	private enum Shape { Massif, Slab, Boulder }

	/// <summary>The lowest ground under a disc of this radius.</summary>
	private static float Floor(TerrainField field, float x, float z, float radius)
	{
		float low = (float)field.WorldHeight(x, z);
		for (int k = 0; k < 4; k++)
		{
			float a = k * Mathf.Pi * 0.5f;
			float h = (float)field.WorldHeight(x + MathF.Cos(a) * radius, z + MathF.Sin(a) * radius);
			if (h < low) low = h;
		}
		return low;
	}

}
