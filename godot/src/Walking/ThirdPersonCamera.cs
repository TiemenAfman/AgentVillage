using Godot;

namespace Promptholm.Walking;

/// <summary>
/// 3rd-person camera mount following the settler avatar. A shoulder-level Node3D holds a
/// SpringArm3D with a Camera3D trailing behind it; the arm smooths collisions so the view
/// never clips through the terrain heightmap. Right mouse drag orbits yaw/pitch, the mouse
/// wheel zooms the arm length, and the whole mount glides to the avatar position.
/// </summary>
[GlobalClass]
public partial class ThirdPersonCamera : Node3D
{
	[Export] public float ShoulderHeight { get; set; } = 1.6f;
	[Export] public float SpringLength { get; set; } = 6.0f;
	[Export] public float ZoomMin { get; set; } = 3.0f;
	[Export] public float ZoomMax { get; set; } = 12.0f;
	[Export] public float LookSpeed { get; set; } = 0.005f;
	[Export] public float FollowSharpness { get; set; } = 10.0f;
	[Export] public float MinPitch { get; set; } = -0.9f;
	[Export] public float MaxPitch { get; set; } = 1.2f;

	public float Yaw { get; private set; } = Mathf.Pi;
	private float _pitch = -0.35f;
	private bool _looking;

	private SpringArm3D? _arm;
	private Camera3D? _camera;
	private Node3D? _target;

	public override void _Ready()
	{
		if (Engine.IsEditorHint())
			return;

		_arm = new SpringArm3D
		{
			Name = "SpringArm",
			SpringLength = SpringLength,
			CollisionMask = 1 | 4, // terrain heightmap (1) + buildings (4), never the avatar (2)
			Shape = new SphereShape3D { Radius = 0.25f },
		};
		AddChild(_arm);

		_camera = new Camera3D
		{
			Name = "Camera",
			Fov = 75.0f,
			Near = 0.05f,
			Far = 1200.0f,
		};
		_arm.AddChild(_camera);
		_camera.MakeCurrent();

		ApplyRotation();
	}

	public override void _Process(double delta)
	{
		if (Engine.IsEditorHint() || _target is null || _arm is null)
			return;

		ApplyRotation();

		// Glide toward the avatar's shoulder so the camera never snaps when the avatar jumps.
		var desired = _target.GlobalPosition + new Vector3(0.0f, ShoulderHeight, 0.0f);
		float k = 1.0f - Mathf.Exp(-FollowSharpness * (float)delta);
		GlobalPosition = GlobalPosition.Lerp(desired, k);
	}

	public override void _UnhandledInput(InputEvent @event)
	{
		if (@event is InputEventMouseButton { ButtonIndex: MouseButton.Right } mouse)
		{
			_looking = mouse.Pressed;
		}
		else if (@event is InputEventMouseMotion motion && _looking)
		{
			Yaw -= motion.Relative.X * LookSpeed;
			_pitch = Mathf.Clamp(_pitch - motion.Relative.Y * LookSpeed, MinPitch, MaxPitch);
		}
		else if (@event is InputEventMouseButton { ButtonIndex: MouseButton.WheelUp } wheelUp)
		{
			Zoom(wheelUp.Pressed ? 1.0f : -1.0f);
		}
		else if (@event is InputEventMouseButton { ButtonIndex: MouseButton.WheelDown } wheelDown)
		{
			Zoom(wheelDown.Pressed ? -1.0f : 1.0f);
		}
	}

	/// <summary>Make this camera follow <paramref name="avatar"/> and stay current.</summary>
	public void Attach(Node3D avatar)
	{
		_target = avatar;
		if (avatar is not null)
		{
			GlobalPosition = avatar.GlobalPosition + new Vector3(0.0f, ShoulderHeight, 0.0f);
			Yaw = Mathf.Pi;
			_pitch = -0.35f;
			ApplyRotation();
		}
	}

	public void SetZoom(float length)
	{
		if (_arm is not null)
			_arm.SpringLength = Mathf.Clamp(length, ZoomMin, ZoomMax);
	}

	private void Zoom(float dir) => SetZoom((_arm?.SpringLength ?? SpringLength) + dir * 1.5f);

	/// <summary>Orbits the arm ("neck") so the camera trails behind and above the avatar.</summary>
	private void ApplyRotation()
	{
		if (_arm is not null)
			_arm.Rotation = new Vector3(_pitch, Yaw, 0.0f);
	}
}