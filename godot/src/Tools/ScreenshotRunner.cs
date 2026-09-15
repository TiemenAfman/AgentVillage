using System;
using Godot;
using Promptholm.Atmosphere;
using Promptholm.Data.Models;
using Promptholm.World;

namespace Promptholm.Tools;

/// <summary>
/// Renders one fixed viewpoint at one fixed hour to a PNG, then quits. This is the harness
/// the visual overhaul is judged by: the nine Verify*Runners assert numbers, and numbers are
/// exactly how "20 visual checks green" and an unusable screenshot came to coexist.
///
/// Must run WITHOUT --headless: headless selects the dummy rendering driver, so the viewport
/// texture comes back empty. The runner detects that and fails loudly rather than writing a
/// black PNG that silently poisons a before/after comparison.
///
///   Godot..._console.exe --path &lt;godot dir&gt; --script res://src/Tools/ScreenshotRunner.cs \
///       --resolution 1920x1080 -- --hour 21.0 --shot harbour --out C:\path\harbour_2100.png
/// </summary>
public partial class ScreenshotRunner : SceneTree
{
	/// <summary>
	/// Frames to let the renderer settle before capturing. SDFGI needs ~20 frames to converge,
	/// volumetric fog temporal reprojection ~16, and an Incremental sky spreads its radiance
	/// update over several more. Capturing early compares noise instead of the look.
	/// </summary>
	private const int SettleFrames = 120;

	private int _frames;
	private bool _captureArmed;
	private string _outPath = "";
	private string _shotName = "overlook";
	private float _hour = 12.5f;
	private Vector2I _size = new(1920, 1080);
	private Vector3? _posOverride;
	private Vector3? _targetOverride;
	private float _fovOverride = -1.0f;
	private bool _showHud;

	public override void _Initialize()
	{
		try
		{
			ParseArgs();

			if (!HasRealRenderer())
			{
				GD.PushError(
					"ScreenshotRunner needs a real display server; it looks like this run used " +
					"--headless (dummy rendering driver). Drop --headless and run again.");
				Quit(1);
				return;
			}

			DisplayServer.WindowSetSize(_size);
		}
		catch (Exception ex)
		{
			GD.PushError($"EXCEPTION during screenshot setup: {ex}");
			Quit(1);
		}
	}

	public override bool _Process(double delta)
	{
		_frames++;

		// Build on the first frame, not in _Initialize. During _Initialize the tree is not live
		// yet, so every GlobalTransform read inside BuildWorld (WorldManager.BuildMarker) trips
		// "Condition !is_inside_tree() is true" — roughly 27k lines of stderr per run, which is
		// the noise AGENTS.md wrote off as pre-existing.
		if (_frames == 1)
		{
			try
			{
				Setup();
			}
			catch (Exception ex)
			{
				GD.PushError($"EXCEPTION during screenshot setup: {ex}");
				Quit(1);
			}
			return false;
		}

		if (_frames < SettleFrames || _captureArmed)
			return false;

		// One-shot on FramePostDraw: SceneTree._Process runs *before* the draw, so reading the
		// viewport texture here would hand back the previous frame.
		_captureArmed = true;
		RenderingServer.Singleton.Connect(
			RenderingServer.SignalName.FramePostDraw,
			Callable.From(Capture),
			(uint)GodotObject.ConnectFlags.OneShot);
		return false;
	}

	// ---- setup ----------------------------------------------------------------

	private void Setup()
	{
		// Mount the real main scene rather than assembling a lookalike. The lookalike was a
		// trap: DayNightCycle only adopts an existing WorldEnvironment if it finds one upstream,
		// so without Main it silently built its own — the copy without glow. Every shot taken
		// that way showed a different image than the game does, which is exactly the failure
		// this harness exists to catch.
		var main = new Main { Name = "Main" };
		Root.AddChild(main);

		var world = main.GetNodeOrNull<WorldManager>("WorldManager");
		if (world?.Terrain is null)
		{
			GD.PushError("Main did not build a world; is res://village.json present?");
			Quit(1);
			return;
		}

		PinHour(main);

		if (!_showHud)
		{
			foreach (var child in main.GetChildren())
			{
				if (child is CanvasLayer overlay)
					overlay.Visible = false;
			}
		}

		PlaceCamera(world);

		GD.Print($"[shot] {_shotName} @ {_hour:0.0}h -> {_outPath}");
	}

	/// <summary>
	/// Pins the atmosphere to the requested hour. Without this the scene follows the wall clock,
	/// so the same command would produce a different image depending on when it ran.
	/// </summary>
	private void PinHour(Node main)
	{
		var cycle = main.GetNodeOrNull<DayNightCycle>("Atmosphere/DayNightCycle");
		if (cycle is null)
		{
			GD.PushWarning("[shot] no DayNightCycle under Main/Atmosphere; hour not pinned");
			return;
		}

		cycle.ForceHour = _hour;
		cycle.ApplyHour(_hour);

		var glow = main.GetNodeOrNull<NightGlowManager>("Atmosphere/NightGlowManager");
		if (glow is not null)
		{
			glow.ForceHour = _hour;
			glow.Sync();
		}

		var lighthouse = main.GetNodeOrNull<LighthouseController>("Atmosphere/LighthouseController");
		if (lighthouse is not null)
		{
			lighthouse.ForceHour = _hour;
			lighthouse.ResolveSite();
			lighthouse.SetActive(DayNightCycle.IsDuskOrNight(_hour));
		}
	}

	private void PlaceCamera(WorldManager world)
	{
		var shot = ShotCatalog.Find(_shotName)
			?? throw new ArgumentException($"unknown shot '{_shotName}'; known: {ShotCatalog.Names()}");
		// Framed relative to the island, resolved against the one that is actually loaded.
		shot = ShotCatalog.Resolve(shot, world.Terrain, LoadVillage());

		var pos = _posOverride ?? shot.Position;
		var target = _targetOverride ?? shot.Target;
		float fov = _fovOverride > 0.0f ? _fovOverride : shot.Fov;

		if (shot.GroundRelative && _posOverride is null && world.Terrain is not null)
		{
			pos.Y += (float)world.Terrain.WorldHeight(pos.X, pos.Z);
			target.Y += (float)world.Terrain.WorldHeight(target.X, target.Z);
		}

		// Build the orientation ourselves instead of calling LookAt: during _Initialize the
		// node has not entered the tree yet, so LookAt reads an identity global transform and
		// silently leaves the camera pointing down -Z. Up is chosen away from the view
		// direction so a straight-down shot does not degenerate.
		var forward = (target - pos).Normalized();
		var up = Mathf.Abs(forward.Dot(Vector3.Up)) > 0.999f ? Vector3.Forward : Vector3.Up;

		var camera = new Camera3D
		{
			Name = "ShotCamera",
			Fov = fov,
			Near = 0.1f,
			Far = 4000.0f,
			Transform = new Transform3D(Basis.Identity, pos).LookingAt(target, up),
		};
		Root.AddChild(camera);
		camera.MakeCurrent();
		GD.Print($"[shot] camera pos={pos} target={target} fov={fov}");
	}

	// ---- capture --------------------------------------------------------------

	private void Capture()
	{
		try
		{
			var image = Root.GetTexture()?.GetImage();
			if (image is null || image.IsEmpty())
			{
				GD.PushError("viewport image came back empty - no frame was rendered");
				Quit(1);
				return;
			}

			var absolute = ProjectSettings.GlobalizePath(_outPath);
			var dir = absolute.GetBaseDir();
			if (!string.IsNullOrEmpty(dir))
				DirAccess.MakeDirRecursiveAbsolute(dir);

			var err = image.SavePng(absolute);
			if (err != Error.Ok)
			{
				GD.PushError($"SavePng({absolute}) failed: {err}");
				Quit(1);
				return;
			}

			GD.Print($"[shot] wrote {image.GetWidth()}x{image.GetHeight()} -> {absolute}");
			Quit(0);
		}
		catch (Exception ex)
		{
			GD.PushError($"EXCEPTION during capture: {ex}");
			Quit(1);
		}
	}

	// ---- plumbing -------------------------------------------------------------

	/// <summary>
	/// True when a real rendering backend is attached. Under --headless Godot loads the dummy
	/// driver, which renders nothing and would hand back a blank image.
	/// </summary>
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
			string key = args[i];
			string value = i + 1 < args.Length ? args[i + 1] : "";
			switch (key)
			{
				case "--hour":
					_hour = float.Parse(value, System.Globalization.CultureInfo.InvariantCulture);
					i++;
					break;
				case "--shot":
					_shotName = value;
					i++;
					break;
				case "--out":
					_outPath = value;
					i++;
					break;
				case "--size":
					_size = ParseSize(value);
					i++;
					break;
				case "--pos":
					_posOverride = ParseVec(value);
					i++;
					break;
				case "--target":
					_targetOverride = ParseVec(value);
					i++;
					break;
				case "--fov":
					_fovOverride = float.Parse(value, System.Globalization.CultureInfo.InvariantCulture);
					i++;
					break;
				case "--hud":
					// The HUD is part of what the player sees, but it covers the corners of the
					// frame, so judging the 3D look is easier without it.
					_showHud = true;
					break;
				case "--layers":
					// Bitmask into FoliageSpawner.Layer: 1 cover, 2 blades, 4 ferns, 8 bushes.
					// A before/after of a visual change is the only honest way to judge it, and
					// for ground vegetation "before" means the same frame without that layer -
					// not a different commit, which would also move the buildings and the light.
					World.FoliageSpawner.Enabled = (World.FoliageSpawner.Layer)int.Parse(value);
					i++;
					break;
			}
		}

		if (string.IsNullOrWhiteSpace(_outPath))
			_outPath = $"user://shots/{_shotName}_{_hour:00.0}.png";
	}

	/// <summary>Parses "x,y,z" into a world-space vector (ad-hoc framing without a rebuild).</summary>
	private static Vector3 ParseVec(string text)
	{
		var parts = text.Split(',');
		if (parts.Length != 3)
			throw new ArgumentException($"expected x,y,z but got '{text}'");
		var ci = System.Globalization.CultureInfo.InvariantCulture;
		return new Vector3(
			float.Parse(parts[0], ci), float.Parse(parts[1], ci), float.Parse(parts[2], ci));
	}

	private static Vector2I ParseSize(string text)
	{
		var parts = text.Split('x', 'X');
		if (parts.Length != 2)
			throw new ArgumentException($"expected WIDTHxHEIGHT but got '{text}'");
		return new Vector2I(int.Parse(parts[0]), int.Parse(parts[1]));
	}

	private static VillageData? LoadVillage()
	{
		const string path = "res://village.json";
		if (!Godot.FileAccess.FileExists(path))
			return null;

		using var file = Godot.FileAccess.Open(path, Godot.FileAccess.ModeFlags.Read);
		return file is null ? null : VillageJson.Parse<VillageData>(file.GetAsText());
	}
}
