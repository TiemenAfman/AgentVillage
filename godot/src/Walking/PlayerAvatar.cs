using Godot;
using Promptholm.Core;
using Promptholm.World;

namespace Promptholm.Walking;

public enum AvatarState
{
	Walking,
	Airborne,
	Swimming,
	Crouching,
}

/// <summary>
/// 3rd-person settler avatar (CharacterBody3D) for Walk-Mode: capsule collision, smooth
/// ground movement relative to the camera, jump (Space), sprint (Shift), crouch (C), and
/// a swimming state with buoyancy once the body dips to y &lt;= 0.05. The geometry comes from
/// SettlerMeshBuilder and is kept upright on the body, with only its visual child rotating
/// toward the movement direction.
/// </summary>
[GlobalClass]
public partial class PlayerAvatar : CharacterBody3D
{
	[Export] public float WalkSpeed { get; set; } = 5.0f;
	[Export] public float RunSpeed { get; set; } = 9.0f;
	[Export] public float SwimSpeed { get; set; } = 3.5f;
	[Export] public float JumpVelocity { get; set; } = 4.5f;
	[Export] public float Gravity { get; set; } = 12.0f;
	[Export] public float CrouchSpeedFactor { get; set; } = 0.55f;

	/// <summary>Body center height at or below which the avatar is considered swimming.</summary>
	[Export] public float WaterSurfaceY { get; set; } = 0.05f;

	/// <summary>The third-person camera that orients this avatar's movement.</summary>
	[Export] public ThirdPersonCamera? Camera { get; set; }

	/// <summary>The world manager that knows where every building's door lives on the island.</summary>
	[Export] public WorldManager? World { get; set; }

	public AvatarState State { get; private set; } = AvatarState.Walking;

	private const float CollisionRadius = 0.35f;
	private const float CollisionHeight = 1.5f;
	private const float CrouchHeight = 0.95f;

	private const float GroundAccel = 32.0f;
	private const float AirAccel = 9.0f;
	private const float SwimAccel = 18.0f;
	private const float BuoyancyStrength = 14.0f;
	private const float TurnSpeed = 10.0f;
	private const float InteractionRadius = 2.5f;

	private Node3D? _visual;
	private CollisionShape3D? _collision;
	private bool _crouched;
	private float _animTime;
	private string? _lastPrompt;
	private bool _lastInteractPushed;
	private bool _lastJumpHeld;

	public override void _Ready()
	{
		CollisionLayer = 2;
		CollisionMask = 1;
		FloorSnapLength = 0.2f;
		FloorStopOnSlope = false;

		var capsule = new CapsuleShape3D
		{
			Radius = CollisionRadius,
			Height = CollisionHeight,
		};
		_collision = new CollisionShape3D { Shape = capsule };
		AddChild(_collision);

		// Visual sits so its feet touch the capsule bottom (capsule center = body origin).
		_visual = SettlerMeshBuilder.BuildSettler();
		_visual.Position = new Vector3(0.0f, -CollisionHeight * 0.5f, 0.0f);
		AddChild(_visual);
	}

	public override void _Process(double delta)
	{
		float d = (float)delta;
		if (_visual is null)
			return;

		_animTime += d * 8.0f;

		float horizontal = new Vector2(Velocity.X, Velocity.Z).Length();
		float speed01 = Mathf.Clamp(horizontal / RunSpeed, 0.0f, 1.0f);
		SettlerMeshBuilder.PoseWalk(_visual, _animTime, speed01);

		// Slight forward tilt with speed; bob stays subtle over water.
		_visual.Rotation = new Vector3(-speed01 * 0.06f, _visual.Rotation.Y, 0.0f);

		UpdateInteraction();
	}

	public override void _PhysicsProcess(double delta)
	{
		float d = (float)delta;
		UpdateCrouch();
		var input = ReadMoveInput();
		bool inWater = GlobalPosition.Y <= WaterSurfaceY;

		// Sampled once per frame as an edge: one jump per press, no bunny-hop while held (#60).
		bool jumpHeld = Input.IsKeyPressed(Key.Space);
		bool jumpPressed = jumpHeld && !_lastJumpHeld;
		_lastJumpHeld = jumpHeld;

		if (inWater)
		{
			Swim(d, input);
		}
		else
		{
			Move(d, input, jumpPressed);
		}

		FaceMovementDirection(d);
	}

	private void Move(float d, Vector2 input, bool jumpPressed)
	{
		bool grounded = IsOnFloor();

		if (grounded)
		{
			State = _crouched ? AvatarState.Crouching : AvatarState.Walking;
			if (jumpPressed)
				Velocity = new Vector3(Velocity.X, JumpVelocity, Velocity.Z);
		}
		else
		{
			State = AvatarState.Airborne;
		}

		Velocity = new Vector3(Velocity.X, Velocity.Y - Gravity * d, Velocity.Z);

		float speed = _crouched ? WalkSpeed * CrouchSpeedFactor
			: Input.IsKeyPressed(Key.Shift) ? RunSpeed
			: WalkSpeed;
		float accel = grounded ? GroundAccel : AirAccel;
		HorizontallyMoveToward(input, speed, accel, d);
		MoveAndSlide();
	}

	/// <summary>
	/// Swimming physics: horizontal breaststroke-style motion at SwimSpeed plus a gentle
	/// buoyancy spring that floats the body back to the surface (y &asymp; 0). Jumping is not
	/// possible here; the avatar glides over the water line, ducking under bridges because
	/// their decks sit on footings at the banks and the span beneath them is empty.
	/// </summary>
	private void Swim(float d, Vector2 input)
	{
		State = AvatarState.Swimming;

		HorizontallyMoveToward(input, SwimSpeed * (_crouched ? CrouchSpeedFactor : 1.0f), SwimAccel, d);

		// Buoyancy spring toward the surface; never throws the body out of the water.
		float surface = 0.0f;
		float sinking = surface - GlobalPosition.Y;
		Velocity = new Vector3(
			Velocity.X,
			Mathf.MoveToward(Velocity.Y, sinking * BuoyancyStrength, 45.0f * d),
			Velocity.Z);
		if (GlobalPosition.Y > surface)
			Velocity = new Vector3(Velocity.X, Mathf.Min(Velocity.Y, 0.0f), Velocity.Z);

		MoveAndSlide();
	}

	/// <summary>
	/// Reads W/A/S/D into a move vector (y = +forward when W pressed) and pitches the
	/// intended horizontal direction through the camera yaw, so movement is relative to
	/// where the player is looking, like FreeFlyCamera does for flight.
	/// </summary>
	private Vector2 ReadMoveInput()
	{
		var input = Vector2.Zero;
		if (Input.IsKeyPressed(Key.W)) input.Y -= 1.0f;
		if (Input.IsKeyPressed(Key.S)) input.Y += 1.0f;
		if (Input.IsKeyPressed(Key.A)) input.X -= 1.0f;
		if (Input.IsKeyPressed(Key.D)) input.X += 1.0f;
		if (input.Length() > 1.0f)
			input = input.Normalized();
		return input;
	}

	private void HorizontallyMoveToward(Vector2 input, float speed, float accel, float d)
	{
		float yaw = Camera?.Yaw ?? 0.0f;
		var forward = new Vector3(-Mathf.Sin(yaw), 0.0f, -Mathf.Cos(yaw));
		var right = new Vector3(Mathf.Cos(yaw), 0.0f, -Mathf.Sin(yaw));

		var wish = right * input.X + forward * -input.Y;
		wish *= speed;

		Velocity = new Vector3(
			Mathf.MoveToward(Velocity.X, wish.X, accel * d),
			Velocity.Y,
			Mathf.MoveToward(Velocity.Z, wish.Z, accel * d));
	}

	/// <summary>Slowly slerps the visual facing direction toward the horizontal velocity.</summary>
	private void FaceMovementDirection(float d)
	{
		if (_visual is null)
			return;

		var horiz = new Vector2(Velocity.X, Velocity.Z);
		if (horiz.Length() < 0.1f)
			return;

		float targetYaw = Mathf.Atan2(-horiz.X, -horiz.Y);
		_visual.Rotation = new Vector3(_visual.Rotation.X, Mathf.LerpAngle(_visual.Rotation.Y, targetYaw, 1.0f - Mathf.Exp(-TurnSpeed * d)), 0.0f);
	}

	/// <summary>
	/// Proximity interaction: while the settler stands within InteractionRadius of a building
	/// door, a "[E] Inspect &lt;name&gt;" HUD prompt is published. Pressing E (or gamepad X) there
	/// publishes BuildingSelected for that building so the dossier opens. The prompt is only
	/// republished when the target actually changes.
	/// </summary>
	private void UpdateInteraction()
	{
		var marker = World?.NearestDossier(GlobalPosition, InteractionRadius);
		string? prompt = marker is null ? null : $"[E] Inspect {marker.Name}";

		if (prompt != _lastPrompt && EventBus.Instance is not null)
		{
			_lastPrompt = prompt;
			EventBus.Instance.PublishInteractionPrompt(prompt);
		}

		bool interact = Input.IsKeyPressed(Key.E) || Input.IsJoyButtonPressed(0, JoyButton.X);
		if (interact && !_lastInteractPushed && marker is not null && EventBus.Instance is not null)
			EventBus.Instance.PublishBuildingSelected(marker.Id);
		_lastInteractPushed = interact;
	}

	private bool UpdateCrouch()
	{
		bool crouch = Input.IsKeyPressed(Key.C);
		if (crouch == _crouched)
			return _crouched;

		_crouched = crouch;
		if (_collision?.Shape is CapsuleShape3D capsule)
			capsule.Height = _crouched ? CrouchHeight : CollisionHeight;
		return _crouched;
	}
}