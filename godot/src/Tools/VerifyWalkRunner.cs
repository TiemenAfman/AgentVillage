using System;
using Godot;
using Promptholm.Data.Models;
using Promptholm.Walking;
using Promptholm.World;

namespace Promptholm.Tools;

/// <summary>
/// Headless check that Walk-Mode spawns the settler on solid ground, builds the terrain
/// heightmap collider, and that the swimming state buoys the avatar back to the surface.
/// The SceneTree subclass drives the real physics loop, so MoveAndSlide + buoyancy run.
/// Run after a build with:
///   Godot..._console.exe --headless --path &lt;godot dir&gt; --script res://src/Tools/VerifyWalkRunner.cs
/// </summary>
public partial class VerifyWalkRunner : SceneTree
{
	private const uint Seed = 1337;
	private const int Size = 64;

	private int _fails;
	private int _ticks;
	private Phase _phase = Phase.Ground;
	private WalkModeManager? _manager;
	private PlayerAvatar? _avatar;
	private float _groundY;
	private float _peakY;

	private enum Phase
	{
		Ground,
		Jump,
		Swim,
		Done,
	}

	public override void _Initialize()
	{
		try
		{
			var world = new WorldManager { Name = "WorldManager" };
			Root.AddChild(world);
			world.BuildWorld(new VillageData
			{
				Island = new IslandData { Seed = Seed, TerrainHash = "f7ec71ac" },
				Grid = new GridData { Size = Size },
			});

			_manager = new WalkModeManager { Name = "WalkModeManager", World = world };
			Root.AddChild(_manager);
		}
		catch (System.Exception ex)
		{
			GD.PushError($"EXCEPTION during walk setup: {ex}");
			Quit(1);
		}
	}

	public override bool _PhysicsProcess(double delta)
	{
		// Leave the avatar parked in walk mode from the start so its state settles.
		if (_ticks == 0)
			_manager?.EnterWalkMode();

		_ticks++;
		if (_manager is null || _manager.InWalkMode == false)
			return false;

		switch (_phase)
		{
			case Phase.Ground:
				RunGroundChecks();
				break;
			case Phase.Jump:
				RunJumpChecks();
				break;
			case Phase.Swim:
				RunSwimChecks();
				break;
		}

		return false;
	}

	private void RunGroundChecks()
	{
		if (_ticks < 80)
			return;

		_avatar = Root.GetNodeOrNull<PlayerAvatar>("WalkModeManager/SettlerAvatar");
		Check(_avatar is not null, "settler avatar exists after walk mode started");
		Check(_avatar?.IsOnFloor() == true, "avatar landed on the terrain heightmap collider");

		var collider = Root.GetNodeOrNull<StaticBody3D>("WalkModeManager/TerrainCollider");
		Check(collider is not null, "terrain heightmap collider exists");
		Check(_avatar is not null && _avatar.GlobalPosition.Y > 0.5f, "avatar floats at ground height (no fall-through)");

		GD.Print($"ground   : avatar Y={_avatar?.GlobalPosition.Y:0.00}, state={_avatar?.State}, collider={(collider is not null)}");
		_phase = Phase.Jump;
		_ticks = 0;
	}

	/// <summary>
	/// Issue #60: Space on solid ground must lift the settler. The key is injected through
	/// Input.ParseInputEvent, which fills the same keys_pressed table PlayerAvatar reads back
	/// with Input.IsKeyPressed - so this exercises the real input path, not a stub.
	/// </summary>
	private void RunJumpChecks()
	{
		if (_avatar is null)
			return;

		if (_ticks == 1)
		{
			_groundY = _avatar.GlobalPosition.Y;
			_peakY = _groundY;
			PressSpace(true);
			return;
		}

		_peakY = Mathf.Max(_peakY, _avatar.GlobalPosition.Y);
		if (_ticks < 40)
			return;

		bool seen = Input.IsKeyPressed(Key.Space);
		PressSpace(false);

		float lift = _peakY - _groundY;
		GD.Print($"jump     : ground Y={_groundY:0.00}, peak Y={_peakY:0.00}, lift={lift:0.00} m, key seen={seen}");
		Check(seen, "injected Space reaches Input.IsKeyPressed");
		Check(lift > 0.3f, $"Space lifts the settler off the ground (lift={lift:0.00} m)");

		_phase = Phase.Swim;
		// Drop the settler far out at sea, below the surface; buoyancy must bring it back.
		_avatar.GlobalPosition = new Vector3(40.0f, -2.0f, 40.0f);
		_avatar.Velocity = Vector3.Zero;
		_ticks = 0;
	}

	private static void PressSpace(bool down)
		=> Input.ParseInputEvent(new InputEventKey
		{
			Keycode = Key.Space,
			PhysicalKeycode = Key.Space,
			Pressed = down,
		});

	private void RunSwimChecks()
	{
		if (_ticks < 120)
			return;

		Check(_avatar?.State == AvatarState.Swimming, "avatar entered the swimming state in deep water");
		float y = _avatar?.GlobalPosition.Y ?? -99f;
		Check(y is > -0.3f and < 1.2f, $"buoyancy floats the avatar near the surface (y={y:0.00})");

		GD.Print($"swim     : avatar Y={y:0.00}, state={_avatar?.State}");
		_phase = Phase.Done;

		if (_fails == 0)
		{
			GD.Print("OK - walk mode spawns on solid ground, collides with terrain and floats in water");
			Quit(0);
		}
		else
		{
			GD.PushError($"{_fails} check(s) FAILED");
			Quit(1);
		}
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