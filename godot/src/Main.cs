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
	private CloudManager? _cloudManager;
	private SettlerChatUI? _chat;
	private VillageData? _village;

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

// Phase-2 step 10: unified island HUD overlay (src/UI/ — self-contained, no world coupling).
		AddChild(new IslandHud());

		// Dossier overlay driven by EventBus; invisible until a building is selected.
		var dossier = new BuildingDossierUI { Name = "BuildingDossierUI" };
		AddChild(dossier);

		// Talking to a settler: reads and carries on that session's own transcript. A layer above
		// the dossier, because you can open it while the dossier stands.
		_chat = new SettlerChatUI { Name = "SettlerChatUI" };
		AddChild(_chat);

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

		_cloudManager = new CloudManager { Name = "CloudManager" };
		atmosphere.AddChild(_cloudManager);

		if (EventBus.Instance is not null)
		{
			EventBus.Instance.VillageDataLoaded += OnVillageDataLoaded;
			EventBus.Instance.SettlerTalkRequested += OnSettlerTalkRequested;
		}

		PublishInitialVillage();
	}

	/// <summary>
	/// Hands the first village data to everyone at once, over the EventBus.
	///
	/// Both start-up paths used to call BuildWorld directly, which meant the world was built
	/// but EventBus.VillageDataLoaded never fired — and IslandHud only updates on that signal.
	/// So the HUD sat at "0 settlers / 0 apprentices / 0 districts" above a fully built town
	/// until VillageClient's first successful poll of localhost:4747, and forever if the Node
	/// server was not running. res://village.json carries the real numbers (97/351/12); they
	/// simply never reached the card.
	/// </summary>
	private void PublishInitialVillage()
	{
		var villageClient = GetNodeOrNull("/root/VillageClient") as VillageClient;
		var village = villageClient?.LastData;

		if (village is not null)
		{
			GD.Print($"[Main] Using VillageClient data: island={village.Island.Name}, buildings={village.Buildings.Count}");
		}
		else
		{
			village = LoadFallbackVillage();
			if (village is not null)
			{
				GD.Print($"[Main] Using res://village.json fallback: island={village.Island.Name}, seed={village.Island.Seed}, buildings={village.Buildings.Count}");
			}
			else
			{
				GD.PushWarning("[Main] No village data and no fallback file; rendering an empty default island so the scene still has a world.");
				village = new VillageData
				{
					Island = new IslandData { Name = "Promptholm Default", Seed = 1337, TerrainHash = "f7ec71ac" },
					Grid = new GridData { Size = 64 },
				};
			}
		}

		if (EventBus.Instance is not null)
			EventBus.Instance.PublishVillageData(village);
		else
			OnVillageDataLoaded(village);
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
			EventBus.Instance.SettlerTalkRequested -= OnSettlerTalkRequested;
		}
	}

	/// <summary>
	/// Sun and environment, both from EnvironmentFactory so the scene, the showroom and the
	/// headless runners cannot drift apart. DayNightCycle is added afterwards on purpose: it
	/// adopts whatever it finds upstream rather than building a second set.
	/// </summary>
	private void EnsureLighting()
	{
		if (GetNodeOrNull<DirectionalLight3D>("Sun") is null)
			AddChild(EnvironmentFactory.CreateSun());

		if (GetNodeOrNull<WorldEnvironment>("WorldEnvironment") is null)
		{
			AddChild(new WorldEnvironment
			{
				Name = "WorldEnvironment",
				Environment = EnvironmentFactory.CreateIsland(),
			});
		}
	}

	private void OnVillageDataLoaded(VillageData village)
	{
		GD.Print($"[Main] Received VillageData: island={village.Island.Name}, seed={village.Island.Seed}, buildings={village.Buildings.Count}");
		_village = village;
		_worldManager?.BuildWorld(village);
		_cloudManager?.Rebuild(village.Island.Seed);
	}

	/// <summary>
	/// Opens the conversation with whoever lives in this building. The lookup is here rather than
	/// in the chat panel because Main is what holds the village; the panel is handed one settler
	/// and knows nothing about the island.
	/// </summary>
	private void OnSettlerTalkRequested(string buildingId)
	{
		if (_chat is null || _village is null) return;

		foreach (var b in _village.Buildings)
		{
			if (b.Id != buildingId) continue;
			_chat.Open(b);
			return;
		}
	}
}