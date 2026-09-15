using Godot;
using Promptholm.Core;
using Promptholm.Data.Models;
using Promptholm.World;

namespace Promptholm.Walking;

/// <summary>
/// Toggles between sky-inspection (FreeFlyCamera) and 3rd-person Walk-Mode (PlayerAvatar +
/// ThirdPersonCamera). Tab switches; entering Walk-Mode builds a terrain heightmap collider
/// once per world and spawns the settler on solid ground near the island centre, clamped to
/// the TerrainField.WorldHeight. When village data is reloaded (F5) the collider is
/// rebuilt and a walking avatar is snapped back onto the new ground.
/// </summary>
[GlobalClass]
public partial class WalkModeManager : Node3D
{
	/// <summary>The free-fly camera to deactivate while walking the island.</summary>
	[Export] public FreeFlyCamera? FlyCamera { get; set; }

	/// <summary>The world manager whose TerrainField drives the collider and spawn point.</summary>
	[Export] public WorldManager? World { get; set; }

	public bool InWalkMode => _walkMode;

	private bool _walkMode;
	private bool _lastTab;
	private PlayerAvatar? _avatar;
	private ThirdPersonCamera? _walkCamera;
	private StaticBody3D? _terrainCollider;
	private TerrainField? _colliderTerrain;

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

		if (EventBus.Instance is not null)
			EventBus.Instance.PublishInteractionPrompt(null);

		GD.Print("[WalkMode] back to inspection view; Tab drops in as the settler.");
	}

	private PlayerAvatar BuildAvatar()
	{
		var avatar = new PlayerAvatar
		{
			Name = "SettlerAvatar",
			Camera = _walkCamera,
			World = World,
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

		// Still a heightfield, and deliberately: the generator caps its own gradient at 45
		// degrees and hands anything steeper to separate geometry, so the ground stays
		// single-valued and the cheapest large-area collider in the engine keeps working.
		_terrainCollider = new StaticBody3D { Name = "TerrainCollider" };
		_terrainCollider.AddChild(TerrainMeshBuilder.BuildCollider(terrain));
		AddChild(_terrainCollider);
		_colliderTerrain = terrain;

		GD.Print($"[WalkMode] terrain collider built ({terrain.N}x{terrain.N} heightmap).");
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

		// Flat ground, not merely the nearest ground. On the old 64 m island every land cell was
		// within half a metre of level and "closest to the origin" was good enough; this island
		// has real relief, and dropping the settler onto a 45-degree face leaves it sliding -
		// CharacterBody3D reports IsOnFloor() false on anything steeper than FloorMaxAngle, so it
		// never finishes arriving.
		const double maxSpawnSlope = 0.30;

		double bestScore = double.MaxValue;
		double sx = 0.0, sz = 0.0, sh = 0.35;
		foreach (var cell in terrain.LandCells)
		{
			var (wx, wz) = terrain.CellWorld(cell.X, cell.Z);
			double h = terrain.WorldHeight(wx, wz);
			if (h < 0.35)
				continue;
			// Never spawn inside a building's plot; the door is the entry point.
			if (World?.IsBuildingCell(cell.X, cell.Z) == true)
				continue;
			double slope = terrain.Slope(cell.X, cell.Z);
			if (slope > maxSpawnSlope)
				continue;
			// Distance decides, with a nudge towards the flattest of the near candidates.
			double score = wx * wx + wz * wz + slope * 400.0;
			if (score >= bestScore)
				continue;
			bestScore = score;
			sx = wx;
			sz = wz;
			sh = h;
		}

		if (bestScore == double.MaxValue)
		{
			GD.PushWarning("no gentle ground to stand on; falling back to the island's centroid");
			var centre = terrain.MainLandmass.Centroid;
            sx = centre[0];
            sz = centre[1];
			sh = terrain.WorldHeight(sx, sz);
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