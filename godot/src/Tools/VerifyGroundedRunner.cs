using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Promptholm.Data.Models;
using Promptholm.World;

namespace Promptholm.Tools;

/// <summary>
/// Does anything on this island hang in the air?
///
/// Written because the rondgang of 15 September found floating grass, floating gates and houses
/// with a corner over the edge, and not one of the runners had noticed: they count materials,
/// silhouettes and instances, which are all questions about whether a thing exists, never about
/// where it ended up. A scatter of two hundred thousand blades is exactly the kind of thing no
/// one can eyeball, so it wants measuring, not looking at.
///
/// Method: walk every MultiMesh the terrain instancer built plus the decorator meshes in the
/// scene, take each instance's origin, and compare its Y against the terrain directly under it.
/// A plant may sit *in* the ground — being buried is how a hedge closes a gap on a slope — so
/// only positive clearance counts as a fault, and a small tolerance absorbs the fact that a
/// heightfield read between samples is interpolated while the mesh is not.
///
///   Godot..._console.exe --headless --path &lt;godot&gt; --script res://src/Tools/VerifyGroundedRunner.cs
/// </summary>
public partial class VerifyGroundedRunner : SceneTree
{
	/// <summary>
	/// Clearance above which an instance counts as floating. A blade of grass leans, and a leaning
	/// card lifts its own origin a little; below this the eye reads it as standing on the ground.
	/// </summary>
	private const float FloatTolerance = 0.25f;

	/// <summary>Share of a group's instances allowed to exceed the tolerance before it fails.</summary>
	private const float AllowedShare = 0.02f;

	private int _ticks;
	private int _fails;
	private WorldManager? _world;

	public override bool _Process(double delta)
	{
		_ticks++;
		try
		{
			// The bare WorldManager rather than Main: this measures where the spawners put things,
			// and Main would drag in the HUD, the camera rig and the day/night cycle to do it.
			if (_ticks == 1)
			{
				var village = LoadVillage();
				if (village is null)
				{
					GD.PushError("could not load res://village.json");
					Quit(1);
					return false;
				}
				_world = new WorldManager { Name = "WorldManager" };
				Root.AddChild(_world);
				_world.BuildWorld(village);
				return false;
			}
			// Terrain3D rebuilds its MultiMesh tree once at the end of the scatter, so nothing is
			// measurable on the frame that asked for it.
			if (_ticks < 4) return false;

			if (_world?.Terrain is null)
			{
				GD.PushError("no terrain; nothing to measure");
				Quit(1);
				return false;
			}

			var field = _world.Terrain;
			var groups = new Dictionary<string, List<float>>();
			Walk(_world, field, groups, "");

			if (groups.Count == 0)
			{
				GD.PushError("found no instanced geometry at all — the scatter did not run");
				Quit(1);
				return false;
			}

			foreach (var (name, clearances) in groups.OrderBy(g => g.Key, StringComparer.Ordinal))
			{
				int n = clearances.Count;
				int floating = clearances.Count(c => c > FloatTolerance);
				float share = n == 0 ? 0.0f : (float)floating / n;
				float worst = n == 0 ? 0.0f : clearances.Max();
				float median = Median(clearances);

				string detail = $"{name}: {n} instances, {floating} floating "
					+ $"({share * 100.0f:0.0}%), worst {worst:0.00} m, median {median:+0.00;-0.00} m";
				Check(share <= AllowedShare, detail);
			}

			if (_fails == 0)
			{
				GD.Print("OK - everything instanced stands on the ground");
				Quit(0);
			}
			else
			{
				GD.PushError($"{_fails} group(s) FLOATING");
				Quit(1);
			}
			return false;
		}
		catch (Exception e)
		{
			GD.PushError($"VerifyGroundedRunner blew up: {e}");
			Quit(1);
			return false;
		}
	}

	/// <summary>
	/// Collects clearance-above-ground for every MultiMesh instance in the tree, keyed by the
	/// node's own name so a failure says which scatter is wrong rather than that something is.
	/// </summary>
	private static void Walk(Node node, TerrainField field, Dictionary<string, List<float>> groups, string path)
	{
		if (node is MultiMeshInstance3D mmi && mmi.Multimesh is { InstanceCount: > 0 } mm && mm.Mesh is not null)
		{
			// The instance's *bottom*, not its origin. A box keeps its origin at its centre, so
			// measuring the origin calls a correctly-seated 0.72 m gatepost "floating by 0.36 m"
			// and the whole report becomes noise. The mesh's own AABB is what says where the
			// underside of this particular thing is.
			var local = mm.Mesh.GetAabb();
			var toWorld = mmi.GlobalTransform;
			var list = new List<float>(mm.InstanceCount);
			for (int i = 0; i < mm.InstanceCount; i++)
			{
				var xf = toWorld * mm.GetInstanceTransform(i);
				var at = xf.Origin;
				float ground = (float)field.WorldHeight(at.X, at.Z);
				// Unpublished ocean reads as a floor far below; an instance over it is not a
				// placement fault and would swamp the statistics.
				if (ground <= TerrainField.UnpublishedY + 0.5f) continue;
				list.Add(BottomOf(local, xf) - ground);
			}
			if (list.Count > 0)
			{
				string key = string.IsNullOrEmpty(path) ? mmi.Name.ToString() : $"{path}/{mmi.Name}";
				if (!groups.TryGetValue(key, out var acc)) groups[key] = acc = new List<float>();
				acc.AddRange(list);
			}
		}

		foreach (var child in node.GetChildren())
			Walk(child, field, groups, node is Node3D ? node.Name.ToString() : path);
	}

	/// <summary>
	/// Lowest world-space Y of an AABB carried through a transform. All eight corners, because a
	/// rotated or sheared box does not keep its lowest corner where it started — and every plant
	/// here is placed with a yaw.
	/// </summary>
	private static float BottomOf(Aabb local, Transform3D xf)
	{
		float min = float.MaxValue;
		for (int c = 0; c < 8; c++)
		{
			var corner = local.Position + new Vector3(
				(c & 1) != 0 ? local.Size.X : 0.0f,
				(c & 2) != 0 ? local.Size.Y : 0.0f,
				(c & 4) != 0 ? local.Size.Z : 0.0f);
			min = MathF.Min(min, (xf * corner).Y);
		}
		return min;
	}

	private static VillageData? LoadVillage()
	{
		const string path = "res://village.json";
		if (!Godot.FileAccess.FileExists(path))
			return null;

		using var file = Godot.FileAccess.Open(path, Godot.FileAccess.ModeFlags.Read);
		return file is null ? null : VillageJson.Parse<VillageData>(file.GetAsText());
	}

	private static float Median(List<float> xs)
	{
		if (xs.Count == 0) return 0.0f;
		var sorted = xs.OrderBy(x => x).ToList();
		return sorted[sorted.Count / 2];
	}

	private void Check(bool ok, string what)
	{
		if (ok)
		{
			GD.Print($"  [OK] {what}");
		}
		else
		{
			GD.PushError($"  [FAIL] {what}");
			_fails++;
		}
	}
}
