using System;
using System.Collections.Generic;
using Godot;
using Promptholm.Atmosphere;
using Promptholm.Data.Models;
using Promptholm.World;

namespace Promptholm.Tools;

/// <summary>
/// Measures the world instead of asserting hard-coded values, and holds the line on the
/// numbers that describe whether it looks generated or designed.
///
/// The other runners pin literal colours and vertex counts, which freezes the current look and
/// blocks every improvement. These numbers do the opposite: they only get stricter as the world
/// gets better.
///   materials    distinct StandardMaterial3D objects in the scene — waste, and it breaks batching
///   silhouettes  distinct building shapes; the headline problem is 163 buildings in ~2 shapes
///   spacing      nearest wall-to-wall gap between buildings, in metres
///   relief       how much vertical range the island actually has
///   instances    scattered meshes — rocks and the four layers of ground cover
///   frame        draw calls, primitives and milliseconds, from the street viewpoint
///
/// The last one only happens with a real renderer attached: under --headless Godot loads the dummy
/// driver, which draws nothing and would report a frame that costs nothing. So the geometry
/// measurements run either way and the frame measurement is skipped when there is nothing to
/// measure. That is why there are two commands rather than one.
///
///   Godot..._console.exe --headless --path &lt;godot dir&gt; --script res://src/Tools/VerifyMetricsRunner.cs
///   Godot..._console.exe          --path &lt;godot dir&gt; --script res://src/Tools/VerifyMetricsRunner.cs -- --frame
///
/// Two switches exist for the frame run, and only for it:
///   --layers &lt;n&gt;     bitmask into <see cref="FoliageSpawner.Layer"/>: 1 cover, 2 blades,
///                    4 ferns, 8 bushes. So --layers 3 is cover and blades and nothing else.
///   --no-instances   hides every scattered mesh through Terrain3D's own switch, which is the
///                    other half of a with/without comparison.
/// </summary>
public partial class VerifyMetricsRunner : SceneTree
{
	/// <summary>
	/// Ceiling on distinct materials. Was 101 before the shared Palette, 65 after; the ceiling
	/// sits just above that so a reintroduced per-mesh <c>new StandardMaterial3D</c> trips it.
	///
	/// Raised from 75 when the foliage arrived: six painted cards need six materials, because each
	/// one carries a different painting, and the ferns and bushes share a seventh. That is one
	/// material per kind of thing, which is what this metric is for - the waste it was written to
	/// catch is a <c>new StandardMaterial3D</c> per instance, and those still trip it.
	/// </summary>
	private const int MaxMaterials = 85;

	/// <summary>Floor on distinct building silhouettes. Higher is better.</summary>
	private const int MinSilhouettes = 2;

	/// <summary>Frames to let the renderer settle before the stopwatch starts. Same reasoning as
	/// <c>ScreenshotRunner</c>: SDFGI and volumetric fog take about twenty frames to converge, and
	/// timing that is timing the warm-up.</summary>
	private const int SettleFrames = 120;

	/// <summary>Frames averaged over. One frame is noise; a second of them is a number.</summary>
	private const int SampleFrames = 90;

	private int _ticks;
	private int _fails;

	private bool _frameRun;
	private bool _showInstances = true;
	private WorldManager? _world;
	private ulong _sampleStartUsec;
	private double _drawCalls, _primitives;

	public override void _Initialize()
	{
		ParseArgs();
	}

	public override bool _Process(double delta)
	{
		_ticks++;

		try
		{
			if (_ticks == 1)
			{
				Run();
				return false;
			}
			if (!_frameRun) return false;

			// Averaged over a window rather than read once: the first frame after the world is
			// built carries every shader compile in it.
			if (_ticks == SettleFrames)
			{
				_sampleStartUsec = Time.GetTicksUsec();
				_drawCalls = 0.0;
				_primitives = 0.0;
			}
			if (_ticks > SettleFrames && _ticks <= SettleFrames + SampleFrames)
			{
				_drawCalls += Performance.GetMonitor(Performance.Monitor.RenderTotalDrawCallsInFrame);
				_primitives += Performance.GetMonitor(Performance.Monitor.RenderTotalPrimitivesInFrame);
			}
			if (_ticks == SettleFrames + SampleFrames)
			{
				ReportFrame();
				Finish();
			}
		}
		catch (Exception ex)
		{
			GD.PushError($"EXCEPTION during metrics run: {ex}");
			Quit(1);
		}

		return false;
	}

	private void Run()
	{
		var village = LoadVillage();
		if (village is null)
		{
			GD.PushError("Could not load res://village.json");
			Quit(1);
			return;
		}

		var world = new WorldManager { Name = "WorldManager" };
		Root.AddChild(world);
		world.BuildWorld(village);
		_world = world;

		MeasureMaterials(world);
		MeasureBuildings(world);
		MeasureRelief(world);
		MeasureInstances(world);

		if (_frameRun && HasRealRenderer())
		{
			SetUpFrame(world, village);
			return;                      // the rest happens once the renderer has settled
		}

		if (_frameRun)
		{
			GD.PushError("--frame needs a real display server; this run used --headless " +
				"(dummy rendering driver), which draws nothing. Drop --headless.");
			Quit(1);
			return;
		}

		Finish();
	}

	private void Finish()
	{
		if (_fails == 0)
		{
			GD.Print("OK - world metrics within bounds");
			Quit(0);
		}
		else
		{
			GD.PushError($"{_fails} metric(s) out of bounds");
			Quit(1);
		}
	}

	// ---- the scatter ----------------------------------------------------------

	/// <summary>
	/// How many instanced meshes are actually in the scene, and where the first ten of them stand.
	///
	/// The transforms are printed because a count is a weak claim about determinism: two runs can
	/// place the same number of plants in different places, and the whole argument for hashing the
	/// sample rather than drawing from a stream is that they cannot. Two runs of this command have
	/// to print the same ten lines.
	/// </summary>
	private void MeasureInstances(WorldManager world)
	{
		var bridge = world.Bridge;
		if (bridge is null)
		{
			GD.Print("instances    : no Terrain3D, so nothing is instanced");
			return;
		}

		var foliage = world.Foliage;
		GD.Print($"instances    : {bridge.InstanceCount} rendered; foliage {foliage?.Placed ?? 0} " +
			$"(cover {Layer(foliage, FoliageSpawner.Layer.Cover)}, blades {Layer(foliage, FoliageSpawner.Layer.Blades)}, " +
			$"ferns {Layer(foliage, FoliageSpawner.Layer.Ferns)}, bushes {Layer(foliage, FoliageSpawner.Layer.Bushes)})");

		var first = foliage?.FirstTransforms ?? new List<Transform3D>();
		for (int k = 0; k < first.Count; k++)
		{
			var t = first[k];
			GD.Print($"  xform[{k}]   at ({t.Origin.X:0.0000}, {t.Origin.Y:0.0000}, {t.Origin.Z:0.0000}) " +
				$"scale {t.Basis.Scale.Y:0.0000} yaw {t.Basis.GetEuler().Y:0.0000}");
		}
	}

	private static int Layer(FoliageSpawner? foliage, FoliageSpawner.Layer layer)
		=> foliage?.Count(layer) ?? 0;

	// ---- the frame ------------------------------------------------------------

	/// <summary>
	/// A camera where a player would actually stand, at the resolution the screenshots use.
	///
	/// The world here is the bare <see cref="WorldManager"/> rather than <c>Main</c>, so it gets the
	/// sun and the environment added by hand: no clouds, no window glow, no HUD. That makes this
	/// figure slightly cheaper than the game's own frame, and it is the right trade - what the
	/// number is for is comparing one layer of vegetation against the next, and everything left out
	/// is a constant in both.
	/// </summary>
	private void SetUpFrame(WorldManager world, VillageData village)
	{
		DisplayServer.WindowSetSize(new Vector2I(1920, 1080));
		// Uncapped, or the measurement reports the refresh rate rather than the cost of the frame.
		DisplayServer.WindowSetVsyncMode(DisplayServer.VSyncMode.Disabled);
		Engine.MaxFps = 0;

		Root.AddChild(EnvironmentFactory.CreateSun());
		Root.AddChild(new WorldEnvironment { Name = "WorldEnvironment", Environment = EnvironmentFactory.CreateIsland() });

		var shot = ShotCatalog.Resolve(ShotCatalog.Find("street")!.Value, world.Terrain, village);
		var camera = new Camera3D
		{
			Name = "MetricsCamera",
			Fov = shot.Fov,
			Near = 0.1f,
			Far = 4000.0f,
			Transform = new Transform3D(Basis.Identity, shot.Position).LookingAt(shot.Target, Vector3.Up),
		};
		Root.AddChild(camera);
		camera.MakeCurrent();
		world.Bridge?.SetCamera(camera);
		if (!_showInstances) world.Bridge?.SetShowInstances(false);

		GD.Print($"frame        : street @ 1920x1080, instances {(_showInstances ? "on" : "hidden")}, " +
			$"layers {FoliageSpawner.Enabled}");
	}

	private void ReportFrame()
	{
		double seconds = (Time.GetTicksUsec() - _sampleStartUsec) / 1_000_000.0;
		double ms = seconds * 1000.0 / SampleFrames;
		GD.Print($"draw calls   : {_drawCalls / SampleFrames:0}");
		GD.Print($"primitives   : {_primitives / SampleFrames:N0}");
		GD.Print($"frame (ms)   : {ms:0.00}   ({1000.0 / ms:0} fps over {SampleFrames} frames)");
	}

	/// <summary>True when a real rendering backend is attached; --headless loads the dummy one.</summary>
	private static bool HasRealRenderer()
	{
		var driver = DisplayServer.GetName();
		return !driver.Equals("headless", StringComparison.OrdinalIgnoreCase)
			&& !driver.Equals("dummy", StringComparison.OrdinalIgnoreCase);
	}

	private void ParseArgs()
	{
		var args = OS.GetCmdlineUserArgs();
		for (int i = 0; i < args.Length; i++)
		{
			switch (args[i])
			{
				case "--frame":
					_frameRun = true;
					break;
				case "--no-instances":
					_showInstances = false;
					break;
				case "--layers" when i + 1 < args.Length && int.TryParse(args[i + 1], out int mask):
					FoliageSpawner.Enabled = (FoliageSpawner.Layer)mask;
					i++;
					break;
			}
		}
	}

	// ---- materials ------------------------------------------------------------

	private void MeasureMaterials(Node root)
	{
		var seen = new HashSet<ulong>();
		CollectMaterials(root, seen);
		GD.Print($"materials    : {seen.Count} distinct (ceiling {MaxMaterials})");
		Check(seen.Count <= MaxMaterials, $"distinct materials stay under the ceiling ({seen.Count})");
	}

	private static void CollectMaterials(Node node, HashSet<ulong> into)
	{
		switch (node)
		{
			case MeshInstance3D mi:
				Add(into, mi.MaterialOverride);
				if (mi.Mesh is not null)
				{
					for (int s = 0; s < mi.Mesh.GetSurfaceCount(); s++)
						Add(into, mi.Mesh.SurfaceGetMaterial(s));
				}
				break;

			case MultiMeshInstance3D mmi:
				Add(into, mmi.MaterialOverride);
				if (mmi.Multimesh?.Mesh is not null)
				{
					for (int s = 0; s < mmi.Multimesh.Mesh.GetSurfaceCount(); s++)
						Add(into, mmi.Multimesh.Mesh.SurfaceGetMaterial(s));
				}
				break;
		}

		foreach (var child in node.GetChildren())
			CollectMaterials(child, into);
	}

	private static void Add(HashSet<ulong> into, Material? material)
	{
		if (material is not null)
			into.Add(material.GetInstanceId());
	}

	// ---- buildings ------------------------------------------------------------

	private void MeasureBuildings(WorldManager world)
	{
		var objects = world.GetNodeOrNull<Node3D>("ObjectsRoot");
		if (objects is null)
		{
			Check(false, "ObjectsRoot exists");
			return;
		}

		var boxes = new List<Aabb>();
		var silhouettes = new HashSet<(int A, int H, int B)>();

		foreach (var child in objects.GetChildren())
		{
			if (child is not Node3D root
				|| !root.Name.ToString().StartsWith("Building_", StringComparison.Ordinal))
			{
				continue;
			}

			var box = MergedAabb(root);
			if (box.Size == Vector3.Zero)
				continue;

			// Spacing needs the box in world space: buildings carry a yaw of rot * 90 degrees,
			// so simply offsetting the local box by root.Position would keep X and Z unswapped
			// for half of them and quietly report the wrong gaps.
			boxes.Add(root.GlobalTransform * box);

			// Silhouette identity at 10 cm resolution: footprint and height are what the eye
			// reads from a distance. Width and depth are sorted so a rotated copy of the same
			// box counts as the same shape, because it is.
			float a = MathF.Min(box.Size.X, box.Size.Z);
			float b = MathF.Max(box.Size.X, box.Size.Z);
			silhouettes.Add((
				(int)MathF.Round(a * 10.0f),
				(int)MathF.Round(box.Size.Y * 10.0f),
				(int)MathF.Round(b * 10.0f)));
		}

		GD.Print($"buildings    : {boxes.Count}");

		var widths = new List<float>(boxes.Count);
		foreach (var box in boxes)
			widths.Add(MathF.Max(box.Size.X, box.Size.Z));
		widths.Sort();
		GD.Print($"footprint (m): min {widths[0]:0.00}  median {widths[widths.Count / 2]:0.00}  max {widths[^1]:0.00}");

		GD.Print($"silhouettes  : {silhouettes.Count} distinct (floor {MinSilhouettes})");
		Check(silhouettes.Count >= MinSilhouettes, $"buildings come in more than one shape ({silhouettes.Count})");

		MeasureSpacing(boxes);
	}

	/// <summary>Nearest wall-to-wall gap per building, in metres; negative means overlapping.</summary>
	private void MeasureSpacing(List<Aabb> boxes)
	{
		if (boxes.Count < 2)
			return;

		var gaps = new List<float>(boxes.Count);
		for (int i = 0; i < boxes.Count; i++)
		{
			float best = float.MaxValue;
			for (int j = 0; j < boxes.Count; j++)
			{
				if (i == j)
					continue;

				float dx = Separation(boxes[i].Position.X, boxes[i].Size.X, boxes[j].Position.X, boxes[j].Size.X);
				float dz = Separation(boxes[i].Position.Z, boxes[i].Size.Z, boxes[j].Position.Z, boxes[j].Size.Z);
				best = MathF.Min(best, MathF.Max(dx, dz));
			}
			gaps.Add(best);
		}

		gaps.Sort();
		int overlapping = 0;
		foreach (var gap in gaps)
		{
			if (gap < 0.0f)
				overlapping++;
		}

		GD.Print($"spacing (m)  : min {gaps[0]:0.00}  median {gaps[gaps.Count / 2]:0.00}  max {gaps[^1]:0.00}");
		GD.Print($"overlapping  : {overlapping} of {gaps.Count} buildings touch or intersect a neighbour");
	}

	/// <summary>Gap between two intervals on one axis; negative when they overlap.</summary>
	private static float Separation(float aMin, float aSize, float bMin, float bSize)
	{
		float aMax = aMin + aSize;
		float bMax = bMin + bSize;
		if (bMin > aMax)
			return bMin - aMax;
		if (aMin > bMax)
			return aMin - bMax;
		return -MathF.Min(aMax - bMin, bMax - aMin);
	}

	// ---- relief ---------------------------------------------------------------

	private void MeasureRelief(WorldManager world)
	{
		// From the field rather than from a mesh. Terrain3D draws the ground internally, so there
		// is no geometry of ours to measure - and the island's own numbers were always the better
		// question anyway.
		var field = world.Terrain;
		if (field is null)
		{
			Check(false, "the world has terrain");
			return;
		}

		float peak = float.MinValue, floor = float.MaxValue;
		foreach (float h in field.Heights) { if (h > peak) peak = h; if (h < floor) floor = h; }

		var main = field.MainLandmass;
		float across = MathF.Max(main.Bounds[2] - main.Bounds[0], main.Bounds[3] - main.Bounds[1]);
		GD.Print($"island       : {across:0} m across, {main.AreaHa:0.0} ha, floor {floor:0.0} m, peak {peak:0.00} m");
		GD.Print($"landmasses   : {field.Manifest.Landmasses.Count}   rivers {field.Manifest.Rivers.Count}   lakes {field.Manifest.Lakes.Count}");

		Check(peak > 0.0f, "the island rises above sea level");
		Check(across > 120.0f, $"the island is a place and not a rock ({across:0} m across)");
	}

	// ---- plumbing -------------------------------------------------------------

	/// <summary>Bounding box of every mesh under a building, in the building's own space.</summary>
	private static Aabb MergedAabb(Node3D root)
	{
		var result = new Aabb();
		bool any = false;
		Walk(root, root, ref result, ref any);
		return result;

		static void Walk(Node3D origin, Node node, ref Aabb into, ref bool any)
		{
			if (node is VisualInstance3D visual and not MultiMeshInstance3D)
			{
				var box = visual.GetAabb();
				if (box.Size != Vector3.Zero)
				{
					var local = origin.GlobalTransform.AffineInverse() * visual.GlobalTransform;
					box = local * box;
					into = any ? into.Merge(box) : box;
					any = true;
				}
			}

			foreach (var child in node.GetChildren())
				Walk(origin, child, ref into, ref any);
		}
	}

	private static VillageData? LoadVillage()
	{
		const string path = "res://village.json";
		if (!Godot.FileAccess.FileExists(path))
			return null;

		using var file = Godot.FileAccess.Open(path, Godot.FileAccess.ModeFlags.Read);
		return file is null ? null : VillageJson.Parse<VillageData>(file.GetAsText());
	}

	private void Check(bool ok, string what)
	{
		if (ok)
		{
			GD.Print($"  [OK]   {what}");
		}
		else
		{
			GD.PushError($"  [FAIL] {what}");
			_fails++;
		}
	}
	/// <summary>
	/// The ground is no longer one mesh: the server publishes the island as 64 m chunks and each
	/// gets its own MeshInstance3D, so it can be culled, given a level of detail and occluded.
	/// This picks the chunk that reaches highest - by volume the winner is a slab of open seabed,
	/// which has plenty of mesh in it and no island at all.
	/// </summary>
	private static MeshInstance3D? HighestTerrainChunk(Node3D world)
	{
		MeshInstance3D? best = null;
		float bestTop = float.MinValue;
		foreach (var mi in TerrainChunks(world))
		{
			var aabb = mi.Mesh!.GetAabb();
			float top = aabb.Position.Y + aabb.Size.Y;
			if (top > bestTop) { bestTop = top; best = mi; }
		}
		return best;
	}

	private static System.Collections.Generic.IEnumerable<MeshInstance3D> TerrainChunks(Node3D world)
	{
		var terrain = world.GetNodeOrNull<Node3D>("GroundRoot/Terrain");
		if (terrain is null) yield break;
		foreach (var child in terrain.GetChildren())
			if (child is MeshInstance3D mi && mi.Mesh is not null)
				yield return mi;
	}


}
