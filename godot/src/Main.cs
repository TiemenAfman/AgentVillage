using Godot;
using Promptholm.Atmosphere;
using Promptholm.Core;
using Promptholm.Data;
using Promptholm.Data.Models;
using Promptholm.UI;
using Promptholm.Walking;
using Promptholm.World;

namespace Promptholm;

[GlobalClass]
public partial class Main : Node3D
{
	private WorldManager? _worldManager;

	public override void _Ready()
	{
		GD.Print("[Main] Initializing Promptholm Main (C#)...");

		_worldManager = GetNodeOrNull<WorldManager>("WorldManager");
		if (_worldManager is null)
		{
			_worldManager = new WorldManager { Name = "WorldManager" };
			AddChild(_worldManager);
		}

		var camera = GetNodeOrNull<FreeFlyCamera>("FreeFlyCamera");
		if (camera is null)
		{
			camera = new FreeFlyCamera { Name = "FreeFlyCamera" };
			AddChild(camera);
		}

		// Diagonal viewpoint above the island, looking at the village centre.
		camera.Initialize(new Vector3(32.0f, 15.0f, 60.0f), Vector3.Zero);

		// Tab drops in as the settler (Walk-Mode); the manager lazily builds the terrain
		// collider and spawns the avatar on solid ground the first time walk mode starts.
		var walkManager = new WalkModeManager
		{
			Name = "WalkModeManager",
			FlyCamera = camera,
			World = _worldManager,
		};
		AddChild(walkManager);

		// Dossier overlay driven by EventBus; invisible until a building is selected.
		var dossier = new BuildingDossierUI { Name = "BuildingDossierUI" };
		AddChild(dossier);

		EnsureLighting();

		// Day/night sky: drives the real-clock sun/moon and sky, and switches on window/lamp
		// glow + the rotating lighthouse beam once the sun dips below the horizon. The cycle
		// adopts the Sun/WorldEnvironment created above (added after EnsureLighting on purpose),
		// so no duplicate lights/environments are made.
		var cycle = new DayNightCycle { Name = "DayNightCycle" };
		var atmosphere = new Node3D { Name = "Atmosphere" };
		AddChild(atmosphere);
		atmosphere.AddChild(cycle);
		atmosphere.AddChild(new NightGlowManager { Name = "NightGlowManager", Cycle = cycle, World = _worldManager });
		atmosphere.AddChild(new LighthouseController { Name = "LighthouseController", Cycle = cycle, World = _worldManager });

		if (EventBus.Instance is not null)
		{
			EventBus.Instance.VillageDataLoaded += OnVillageDataLoaded;
		}

		var villageClient = GetNodeOrNull("/root/VillageClient") as VillageClient;
		if (villageClient?.LastData is not null)
		{
			OnVillageDataLoaded(villageClient.LastData);
		}
		else
		{
			var fallback = LoadFallbackVillage();
			if (fallback is not null)
			{
				GD.Print($"[Main] Using res://village.json fallback: island={fallback.Island.Name}, seed={fallback.Island.Seed}, buildings={fallback.Buildings.Count}");
				_worldManager.BuildWorld(fallback);
			}
			else
			{
				GD.PushWarning("[Main] No village data and no fallback file; rendering an empty default island so the scene still has a world.");
				var defaultVillage = new VillageData
				{
					Island = new IslandData { Name = "Promptholm Default", Seed = 1337, TerrainHash = "f7ec71ac" },
					Grid = new GridData { Size = 64 }
				};
				_worldManager.BuildWorld(defaultVillage);
			}
		}
	}

	/// <summary>
	/// Reads res://village.json and parses it into VillageData. This is the F5 fast path:
	/// instead of waiting for the 5s client poll (or an empty default island), the scene
	/// is populated the moment the game starts.
	/// </summary>
	private static VillageData? LoadFallbackVillage()
	{
		const string path = "res://village.json";
		if (!Godot.FileAccess.FileExists(path))
		{
			GD.PushWarning($"[Main] {path} not present; no fallback.");
			return null;
		}

		using var file = Godot.FileAccess.Open(path, Godot.FileAccess.ModeFlags.Read);
		if (file is null)
		{
			GD.PushWarning($"[Main] could not open {path}.");
			return null;
		}

		try
		{
			return VillageJson.Parse<VillageData>(file.GetAsText());
		}
		catch (System.Exception ex)
		{
			GD.PushError($"[Main] failed to parse {path}: {ex.Message}");
			return null;
		}
	}

	public override void _ExitTree()
	{
		if (EventBus.Instance is not null)
		{
			EventBus.Instance.VillageDataLoaded -= OnVillageDataLoaded;
		}
	}

	/// <summary>
	/// Warm mid-afternoon sun (pitch −42°, yaw 50°) casting shadows, plus a soft blue
	/// procedural sky with a warm horizon, sky-lit ambient and filmic tonemapping.
	/// </summary>
	private void EnsureLighting()
	{
		if (GetNodeOrNull<DirectionalLight3D>("Sun") is null)
		{
			var sun = new DirectionalLight3D
			{
				Name = "Sun",
				LightColor = new Color(1.0f, 0.96f, 0.88f),
				LightEnergy = 1.2f,
				ShadowEnabled = true,
				ShadowBias = 0.03f,
				Rotation = new Vector3(Mathf.DegToRad(-42.0f), Mathf.DegToRad(50.0f), 0.0f),
			};
			AddChild(sun);
		}

		if (GetNodeOrNull<WorldEnvironment>("WorldEnvironment") is null)
		{
			var skyMaterial = new ProceduralSkyMaterial
			{
				SkyTopColor = new Color(0.32f, 0.60f, 0.95f),
				SkyHorizonColor = new Color(0.95f, 0.86f, 0.72f),
				GroundBottomColor = new Color(0.06f, 0.09f, 0.14f),
				GroundHorizonColor = new Color(0.55f, 0.60f, 0.68f),
				SunAngleMax = 15.0f,
			};

			var environment = new Godot.Environment
			{
				BackgroundMode = Godot.Environment.BGMode.Sky,
				Sky = new Sky { SkyMaterial = skyMaterial },
				AmbientLightSource = Godot.Environment.AmbientSource.Sky,
				AmbientLightSkyContribution = 0.4f,
				AmbientLightEnergy = 0.6f,
				TonemapMode = Godot.Environment.ToneMapper.Filmic,
			};

			AddChild(new WorldEnvironment { Name = "WorldEnvironment", Environment = environment });
		}
	}

	private void OnVillageDataLoaded(VillageData village)
	{
		GD.Print($"[Main] Received VillageData: island={village.Island.Name}, seed={village.Island.Seed}, buildings={village.Buildings.Count}");
		_worldManager?.BuildWorld(village);
	}
}