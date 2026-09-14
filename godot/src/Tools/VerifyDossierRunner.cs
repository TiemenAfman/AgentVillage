using System;
using Godot;
using Promptholm.Core;
using Promptholm.Data.Models;
using Promptholm.UI;
using Promptholm.World;

namespace Promptholm.Tools;

/// <summary>
/// Headless check for Phase 2 step 6: every spawned building carries a StaticBody3D with
/// building_id metadata, the door-proximity query (NearestDossier) reaches it, and the
/// BuildingDossierUI opens on BuildingSelected, shows the dossier fields and closes again
/// on Esc / unknown ids. Runs a short phase machine on the physics loop so node _Ready()
/// has fired before the UI is exercised. Run after a build with:
///   Godot..._console.exe --headless --path &lt;godot dir&gt; --script res://src/Tools/VerifyDossierRunner.cs
/// </summary>
public partial class VerifyDossierRunner : SceneTree
{
	private const uint Seed = 1337;
	private const int Size = 64;

	private int _ticks;
	private int _fails;
	private EventBus? _bus;
	private WorldManager? _world;
	private VillageData? _village;
	private BuildingDossierUI? _ui;

	public override void _Initialize()
	{
		try
		{
			// Nodes are added on the physics loop (Setup) so their _Ready runs before the checks.
		}
		catch (System.Exception ex)
		{
			GD.PushError($"EXCEPTION during dossier setup: {ex}");
			Quit(1);
		}
	}

	public override bool _PhysicsProcess(double delta)
	{
		_ticks++;
		try
		{
			if (_ticks == 1)
			{
				Setup();
			}
			else if (_ticks == 3)
			{
				RunChecks();
				Finish();
			}
		}
		catch (System.Exception ex)
		{
			GD.PushError($"EXCEPTION during dossier verification: {ex}");
			Quit(1);
		}
		return false;
	}

	private void Setup()
	{
		_bus = new EventBus { Name = "EventBus" };
		Root.AddChild(_bus);

		_village = SampleVillage();
		_world = new WorldManager { Name = "WorldManager" };
		Root.AddChild(_world);
		_world.BuildWorld(_village);

		_ui = new BuildingDossierUI { Name = "BuildingDossierUI" };
		Root.AddChild(_ui);
	}

	private void RunChecks()
	{
		VerifyWorld();
		VerifyDossier();
		VerifyPrompt();
	}

	private void VerifyWorld()
	{
		var building = Root.GetNodeOrNull<Node3D>("WorldManager/ObjectsRoot/Building_b1");
		Check(building is not null, "building root node exists");

		var collider = building?.GetNodeOrNull<StaticBody3D>("BuildingCollider");
		Check(collider is not null, "building carries a StaticBody3D");
		Check(collider is not null && collider.GetMeta("building_id", "").AsString() == "b1",
			"collider metadata 'building_id' = b1");
		Check(collider is not null && collider.GetChildCount() == 1 && collider.GetChild(0) is CollisionShape3D { Shape: BoxShape3D },
			"box collision shape attached to the collider");

		// Door sits on the front wall: d=2 → local z = -1 + 0.12 = -0.88.
		var door = building!.GlobalPosition + new Vector3(0.0f, 0.0f, -0.88f);
		var marker = _world!.NearestDossier(door, 2.5f);
		Check(marker is not null && marker.Id == "b1",
			$"nearest dossier at the door resolves to b1 (got {marker?.Id ?? "null"})");
		Check(marker is not null && marker.Name == "Ada Lovelace",
			$"door marker carries the settler name (got {marker?.Name ?? "null"})");
		// Point well outside any plot (40,40 is open water) — should return null.
		Check(_world.NearestDossier(new Vector3(40.0f, 0.0f, 40.0f), 2.5f) is null,
			"no dossier returned from a point far outside the island");

		Check(_world.IsBuildingCell(12, 12), "plot cell (12,12) is busy");
		Check(_world.IsBuildingCell(13, 13), "plot cell (13,13) is busy");
		Check(!_world.IsBuildingCell(20, 20), "empty cell (20,20) is free");
	}

	private void VerifyDossier()
	{
		var ui = _ui!;
		Check(!ui.IsOpen, "dossier starts closed");

		ui.SetVillage(_village!);
		_bus!.PublishBuildingSelected("b1");
		Check(ui.IsOpen, "dossier opened after BuildingSelected(b1)");
		Check(ui.CurrentBuildingId == "b1", "open dossier tracks building b1");

		Check(ui.GetNodeOrNull<Label>("DossierOverlay/Center/DossierPanel/Body/Header/Titles/SettlerName")?.Text == "Ada Lovelace",
			"header shows the settler name");
		Check(ui.GetNodeOrNull<Label>("DossierOverlay/Center/DossierPanel/Body/Header/Titles/SessionTitle")?.Text == "Notes on the Analytical Engine",
			"session title shown");
		Check(ui.GetNodeOrNull<Label>("DossierOverlay/Center/DossierPanel/Body/Meta/DistrictBadge")?.Text.Contains("Babbage Quarter") == true,
			"district badge resolved from the district object");
		Check(ui.GetNodeOrNull<Label>("DossierOverlay/Center/DossierPanel/Body/Meta/BranchBadge")?.Text.EndsWith("main") == true,
			"branch badge shows the git branch");
		Check(ui.GetNodeOrNull<Label>("DossierOverlay/Center/DossierPanel/Body/InfoCard/CardBody/InfoGrid/ModelStyle")?.Text == "Sonnet",
			$"model style prettified to Sonnet (got '{ui.GetNodeOrNull<Label>("DossierOverlay/Center/DossierPanel/Body/InfoCard/CardBody/InfoGrid/ModelStyle")?.Text}')");
		Check(ui.GetNodeOrNull<Label>("DossierOverlay/Center/DossierPanel/Body/InfoCard/CardBody/InfoGrid/TierBadge")?.Text == "Cottage",
			$"tier badge title-cased (got '{ui.GetNodeOrNull<Label>("DossierOverlay/Center/DossierPanel/Body/InfoCard/CardBody/InfoGrid/TierBadge")?.Text}')");
		Check(ui.GetNodeOrNull<Label>("DossierOverlay/Center/DossierPanel/Body/InfoCard/CardBody/InfoGrid/StatusBadge")?.Text == "Active",
			$"status badge shows Active (got '{ui.GetNodeOrNull<Label>("DossierOverlay/Center/DossierPanel/Body/InfoCard/CardBody/InfoGrid/StatusBadge")?.Text}')");
		Check(ui.GetNodeOrNull<Label>("DossierOverlay/Center/DossierPanel/Body/StatsGrid/HumanTurns")?.Text == "5",
			"human turns formatted");
		Check(ui.GetNodeOrNull<Label>("DossierOverlay/Center/DossierPanel/Body/StatsGrid/ToolCalls")?.Text == "12",
			"tool calls formatted");
		Check(ui.GetNodeOrNull<Label>("DossierOverlay/Center/DossierPanel/Body/StatsGrid/FilesTouched")?.Text == "3",
			"files touched formatted");
		Check(ui.GetNodeOrNull<Label>("DossierOverlay/Center/DossierPanel/Body/StatsGrid/TokensInput")?.Text == "10,000",
			"input tokens formatted");
		Check(ui.GetNodeOrNull<Label>("DossierOverlay/Center/DossierPanel/Body/StatsGrid/TokensOutput")?.Text == "2,000",
			"output tokens formatted");
		Check(ui.GetNodeOrNull<Label>("DossierOverlay/Center/DossierPanel/Body/StatsGrid/TokensCache")?.Text == "400",
			"cache tokens summed (read + create)");

		var apprentices = ui.GetNodeOrNull<VBoxContainer>("DossierOverlay/Center/DossierPanel/Body/Apprentices");
		Check(apprentices is not null && apprentices.GetChildCount() == 1, "one apprentice listed");
		var apprenticeName = apprentices?.GetChildOrNull<HBoxContainer>(0)?.GetChildOrNull<Label>(1);
		Check(apprenticeName?.Text == "Loom Shed",
			$"apprentice name resolved from the shed building (got '{apprenticeName?.Text}')");

		// Esc closes the dossier again.
		ui._UnhandledInput(new InputEventKey { Pressed = true, Keycode = Key.Escape });
		Check(!ui.IsOpen, "dossier closes on Esc");

		// Unknown ids are a no-op.
		_bus.PublishBuildingSelected("nope");
		Check(!ui.IsOpen, "picking an unknown id does not open the dossier");
	}

	private void VerifyPrompt()
	{
		var ui = _ui!;
		var bar = ui.GetNodeOrNull<PanelContainer>("InteractionPrompt");
		var text = ui.GetNodeOrNull<Label>("InteractionPrompt/PromptText");

		Check(bar?.Visible == false, "prompt bar hidden by default");

		_bus!.PublishInteractionPrompt("[E] Inspect Ada Lovelace");
		Check(bar?.Visible == true, "prompt bar shown on InteractionPromptChanged");
		Check(text?.Text == "[E] Inspect Ada Lovelace", "prompt text matches the building");

		_bus.PublishInteractionPrompt(null);
		Check(bar?.Visible == false, "prompt bar hides on a null prompt");
	}

	private static VillageData SampleVillage()
		=> new()
		{
			Island = new IslandData { Name = "Verify Isle", Seed = Seed, TerrainHash = "f7ec71ac" },
			Grid = new GridData { Size = Size },
			Districts = new() { new DistrictData { Id = "d1", Name = "Babbage Quarter" } },
			Buildings = new()
			{
				new BuildingData
				{
					Id = "b1",
					Kind = "house",
					Name = "Ada Lovelace",
					Title = "Notes on the Analytical Engine",
					GitBranch = "main",
					Model = "claude-sonnet-4-5",
					Tier = "cottage",
					Active = true,
					District = new DistrictData { Id = "d1", Name = "Babbage Quarter" },
					Plot = new PlotData { Gx = 12, Gz = 12, W = 2, D = 2 },
					Sheds = new() { "s1" },
					Stats = new BuildingStats
					{
						HumanTurns = 5,
						ToolCalls = 12,
						FilesTouched = 3,
						Tokens = new TokenCounts { Input = 10_000, Output = 2_000, CacheRead = 300, CacheCreation = 100 },
					},
				},
				new BuildingData
				{
					Id = "s1",
					Kind = "shed",
					Name = "Loom Shed",
					Plot = new PlotData { Gx = 16, Gz = 16, W = 1, D = 1 },
				},
			},
		};

	private void Finish()
	{
		if (_fails == 0)
		{
			GD.Print("OK - building colliders, door proximity and dossier UI round-trip");
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