using Godot;
using Promptholm.Core;
using Promptholm.Data.Models;
using Promptholm.World;

namespace Promptholm.Walking;

/// <summary>
/// Toggles between sky-inspection (FreeFlyCamera) and 3rd-person Walk-Mode (PlayerAvatar +
/// ThirdPersonCamera). Tab switches; entering Walk-Mode builds a terrain heightmap collider
/// once per world and spawns the settler on solid ground near the island centre, clamped to
/// the TerrainGenerator.WorldHeight. When village data is reloaded (F5) the collider is
/// rebuilt and a walking avatar is snapped back onto the new ground.
/// </summary>
[GlobalClass]
public partial class WalkModeManager : Node3D
{
	/// <summary>The free-fly camera to deactivate while walking the island.</summary>
	[Export] public FreeFlyCamera? FlyCamera { get; set; }

	/// <summary>The world manager whose TerrainGenerator drives the collider and spawn point.</summary>
	[Export] public WorldManager? World { get; set; }

	public bool InWalkMode => _walkMode;

	private bool _walkMode;
	private bool _lastTab;
	private PlayerAvatar? _avatar;
	private ThirdPersonCamera? _walkCamera;
	private StaticBody3D? _terrainCollider;
	private TerrainGenerator? _colliderTerrain;

	public override void _Ready()
	{
		if (Engine.IsEditorHint())
			return;

		if (EventBus.Instance is not null)
			EventBus.Instance.VillageDataLoaded += OnVillageDataLoaded;
	}

	public override void _ExitTree()
	{
		if (EventBus.Instance is not null)
			EventBus.Instance.VillageDataLoaded -= OnVillageDataLoaded;
	}

	public override void _Process(double delta)
	{
		if (Engine.IsEditorHint())
			return;

		bool tab = Input.IsKeyPressed(Key.Tab);
		if (tab && !_lastTab)
			ToggleMode();
		_lastTab = tab;
	}

	/// <summary>Today's entry point: the game starts in inspection view; call to drop in.</summary>
	public void EnterWalkMode()
	{
		ToggleMode(forceWalk: true);
	}

	public void ExitWalkMode()
	{
		ToggleMode(forceWalk: false);
	}

	private void ToggleMode(bool? forceWalk = null)
	{
		bool enabled = forceWalk ?? !_walkMode;
		if (enabled == _walkMode)
			return;
		_walkMode = enabled;

		if (_walkMode)
			EnableWalk();
		else
			DisableWalk();
	}

	private void EnableWalk()
	{
		EnsureTerrainCollider();

		_walkCamera ??= BuildCamera();
		_avatar ??= BuildAvatar();

		_avatar.Camera = _walkCamera;
		PlaceAvatarOnGround();

		_avatar.Visible = true;
		_avatar.SetProcess(true);
		_avatar.SetPhysicsProcess(true);

		_walkCamera.Attach(_avatar);
		_walkCamera.Visible = true;

		FlyCamera?.SetProcess(false);
		var cam = _walkCamera.GetNodeOrNull<Camera3D>("SpringArm/Camera");
		if (cam is not null)
			cam.Current = true;

		GD.Print("[WalkMode] settler walks the island; Tab returns to sky view.");
	}

	private void DisableWalk()
	{
		if (_avatar is not null)
		{
			_avatar.Visible = false;
			_avatar.SetProcess(false);
			_avatar.SetPhysicsProcess(false);
		}
		if (_walkCamera is not null)
			_walkCamera.Visible = false;

		FlyCamera?.SetProcess(true);
		FlyCamera?.MakeCurrent();

		GD.Print("[WalkMode] back to inspection view; Tab drops in as the settler.");
	}

	private PlayerAvatar BuildAvatar()
	{
		var avatar = new PlayerAvatar
		{
			Name = "SettlerAvatar",
			Camera = _walkCamera,
		};
		AddChild(avatar);
		return avatar;
	}

	private ThirdPersonCamera BuildCamera()
	{
		var cam = new ThirdPersonCamera { Name = "SettlerCamera" };
		AddChild(cam);
		return cam;
	}

	/// <summary>
	/// Recreates ground collision from World.Terrain as a HeightMapShape3D when the world
	/// (or its terrain hash) changed. One StaticBody3D lifting the heightmap onto the grid.
	/// </summary>
	private void EnsureTerrainCollider()
	{
		var terrain = World?.Terrain;
		if (terrain is null)
			return;

		if (_terrainCollider is not null && ReferenceEquals(_colliderTerrain, terrain))
			return;

		if (_terrainCollider is not null)
		{
			RemoveChild(_terrainCollider);
			_terrainCollider.QueueFree();
			_terrainCollider = null;
		}

		int n = terrain.N;
		var heights = new float[n * n];
		for (int i = 0; i < heights.Length; i++)
			heights[i] = (float)terrain.H[i];

		var shape = new HeightMapShape3D
		{
			MapWidth = n,
			MapDepth = n,
			MapData = heights,
		};

		_terrainCollider = new StaticBody3D { Name = "TerrainCollider" };
		var collider = new CollisionShape3D
		{
			Shape = shape,
			Position = new Vector3(0.5f, 0.0f, 0.5f),
		};
		_terrainCollider.AddChild(collider);
		AddChild(_terrainCollider);
		_colliderTerrain = terrain;

		GD.Print($"[WalkMode] terrain collider built ({n}x{n} heightmap).");
	}

	/// <summary>
	/// Solid ground near the island centre: the land cell (h &gt;= 0.35, i.e. past the beach)
	/// closest to the origin, snapped to WorldHeight so the settler's feet never float.
	/// </summary>
	private Vector3 FindGroundSpawn()
	{
		var terrain = World?.Terrain;
		if (terrain is null)
			return new Vector3(0.0f, 0.8f, 0.0f);

		double bestDist = double.MaxValue;
		double sx = 0.0, sz = 0.0, sh = 0.35;
		foreach (var cell in terrain.LandCells)
		{
			var (wx, wz) = terrain.CellWorld(cell.X, cell.Z);
			double h = terrain.WorldHeight(wx, wz);
			if (h < 0.35)
				continue;
			double d2 = wx * wx + wz * wz;
			if (d2 >= bestDist)
				continue;
			bestDist = d2;
			sx = wx;
			sz = wz;
			sh = h;
		}

		return new Vector3((float)sx, (float)sh + 0.8f, (float)sz);
	}

	private void PlaceAvatarOnGround()
	{
		if (_avatar is null || World?.Terrain is null)
			return;

		var (x, y, z) = FindGroundSpawn();
		_avatar.GlobalPosition = new Vector3(x, y, z);
	}

	private void OnVillageDataLoaded(VillageData village)
	{
		_colliderTerrain = null;
		EnsureTerrainCollider();
		if (_walkMode)
			PlaceAvatarOnGround();
	}
}