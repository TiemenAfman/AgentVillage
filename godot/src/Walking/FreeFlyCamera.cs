using Godot;

namespace Promptholm.Walking;

/// <summary>
/// Free-fly / orbital camera for looking around the island. Right mouse drag looks,
/// WASD fly relative to the view, Q/E (and Space/Ctrl) move down/up, Shift boosts,
/// the mouse wheel adjusts the base flight speed. Movement and rotation are smoothed
/// with an exponential damp, so the camera glides rather than snaps.
/// </summary>
[GlobalClass]
public partial class FreeFlyCamera : Camera3D
{
	[Export] public float BaseSpeed { get; set; } = 14.0f;
	[Export] public float BoostMultiplier { get; set; } = 3.0f;
	[Export] public float LookSpeed { get; set; } = 0.005f;
	[Export] public float Smoothness { get; set; } = 12.0f;
	[Export] public float MinPitch { get; set; } = -1.4f;
	[Export] public float MaxPitch { get; set; } = 1.4f;
	[Export] public float SpeedMin { get; set; } = 1.0f;
	[Export] public float SpeedMax { get; set; } = 120.0f;

	private float _yaw;
	private float _pitch;
	private float _targetYaw;
	private float _targetPitch;
	private Vector3 _targetPosition;
	private bool _looking;

	public override void _Ready()
	{
		if (!Engine.IsEditorHint())
			MakeCurrent();
		_targetPosition = GlobalPosition;
	}

	public override void _Process(double delta)
	{
		HandleFlight((float)delta);
		Damp((float)delta);
	}

	public override void _UnhandledInput(InputEvent @event)
	{
		if (@event is InputEventMouseButton { ButtonIndex: MouseButton.Right } mouse)
			_looking = mouse.Pressed;
		else if (@event is InputEventMouseMotion motion && _looking)
			Look(motion.Relative);
		else if (@event is InputEventMouseButton { ButtonIndex: MouseButton.WheelUp } wheelUp)
			AdjustSpeed(wheelUp.Pressed ? 1.25f : 1.0f / 1.25f);
		else if (@event is InputEventMouseButton { ButtonIndex: MouseButton.WheelDown } wheelDown)
			AdjustSpeed(wheelDown.Pressed ? 1.0f / 1.25f : 1.25f);
	}

	/// <summary>Place the camera at <paramref name="position"/> looking at <paramref name="target"/>.</summary>
	public void Initialize(Vector3 position, Vector3 target)
	{
		GlobalPosition = position;
		_targetPosition = position;
		var f = (target - position).Normalized();
		_yaw = _targetYaw = Mathf.Atan2(f.X, -f.Z);
		_pitch = _targetPitch = Mathf.Clamp(Mathf.Atan2(f.Y, -f.Z), MinPitch, MaxPitch);
		ApplyRotation();
	}

	private void Look(Vector2 relative)
	{
		_targetYaw -= relative.X * LookSpeed;
		_targetPitch = Mathf.Clamp(_targetPitch - relative.Y * LookSpeed, MinPitch, MaxPitch);
	}

	private void AdjustSpeed(float factor)
		=> BaseSpeed = Mathf.Clamp(BaseSpeed * factor, SpeedMin, SpeedMax);

	private void HandleFlight(float delta)
	{
		var input = Vector2.Zero;
		if (Input.IsKeyPressed(Key.W)) input.Y -= 1.0f;
		if (Input.IsKeyPressed(Key.S)) input.Y += 1.0f;
		if (Input.IsKeyPressed(Key.A)) input.X -= 1.0f;
		if (Input.IsKeyPressed(Key.D)) input.X += 1.0f;
		if (input.Length() > 1.0f)
			input = input.Normalized();

		float up = 0.0f;
		if (Input.IsKeyPressed(Key.E) || Input.IsKeyPressed(Key.Space)) up += 1.0f;
		if (Input.IsKeyPressed(Key.Q) || Input.IsKeyPressed(Key.Ctrl)) up -= 1.0f;

		var forward = -GlobalBasis.Z;
		forward.Y = 0.0f;
		forward = forward.Normalized();
		var right = GlobalBasis.X;
		right.Y = 0.0f;
		right = right.Normalized();

		float speed = BaseSpeed * (Input.IsKeyPressed(Key.Shift) ? BoostMultiplier : 1.0f);
		var wish = forward * -input.Y + right * input.X + Vector3.Up * up;
		_targetPosition = GlobalPosition + wish * speed * delta;
	}

	private void Damp(float delta)
	{
		float k = 1.0f - Mathf.Exp(-Smoothness * delta);
		GlobalPosition = GlobalPosition.Lerp(_targetPosition, k);
		_yaw = Mathf.LerpAngle(_yaw, _targetYaw, k);
		_pitch = Mathf.Lerp(_pitch, _targetPitch, k);
		ApplyRotation();
	}

	private void ApplyRotation()
		=> Rotation = new Vector3(_pitch, _yaw, 0.0f);
}