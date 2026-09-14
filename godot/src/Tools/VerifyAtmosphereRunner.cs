using System;
using Godot;
using Promptholm.Atmosphere;
using Promptholm.Buildings.Slots;
using Promptholm.Data.Models;
using Promptholm.World;

namespace Promptholm.Tools;

/// <summary>
/// Headless check for Phase 2 step 8: the DayNightCycle drives a real daylight night cycle
/// (sun up at noon, dark + glowing windows/lamps at 23:00, dusk at 19:30) and the rotating
/// lighthouse beam switches on at night and keeps turning. Run after a build with:
///   Godot..._console.exe --headless --path &lt;godot dir&gt; --script res://src/Tools/VerifyAtmosphereRunner.cs
/// </summary>
public partial class VerifyAtmosphereRunner : SceneTree
{
	private const uint Seed = 1337;
	private const int Size = 64;

	private int _ticks;
	private int _fails;
	private WorldManager? _world;
	private DayNightCycle? _cycle;
	private NightGlowManager? _glow;
	private LighthouseController? _lighthouse;

	public override void _Initialize()
	{
	}

	public override bool _PhysicsProcess(double delta)
	{
		_ticks++;
		try
		{
			if (_ticks == 1)
				Setup();
			else if (_ticks == 3)
			{
				RunDay();
				RunNight();
				RunDusk();
				Finish();
			}
		}
		catch (Exception ex)
		{
			GD.PushError($"EXCEPTION during atmosphere verification: {ex}");
			Quit(1);
		}
		return false;
	}

	private void Setup()
	{
		var village = SampleVillage();
		_world = new WorldManager { Name = "WorldManager" };
		Root.AddChild(_world);
		_world.BuildWorld(village);

		var atmosphere = new Node3D { Name = "Atmosphere" };
		Root.AddChild(atmosphere);

		_cycle = new DayNightCycle { Name = "DayNightCycle" };
		atmosphere.AddChild(_cycle);

		_glow = new NightGlowManager { Name = "NightGlowManager", Cycle = _cycle, World = _world };
		atmosphere.AddChild(_glow);

		_lighthouse = new LighthouseController { Name = "LighthouseController", Cycle = _cycle, World = _world };
		atmosphere.AddChild(_lighthouse);
	}

	private void RunDay()
	{
		GD.Print("--- 12:00 (full daylight) ---");
		_cycle!.ForceHour = 12.0f;
		_cycle.ApplyHour();
		_glow!.ForceHour = 12.0f;
		_glow.Sync();
		_lighthouse!.ForceHour = 12.0f;
		_lighthouse.ResolveSite();
		_lighthouse.SetActive(DayNightCycle.IsDuskOrNight(12.0f));

		Check(_cycle.SunElevationDeg > 70.0f, $"sun is high at noon (elevation {_cycle.SunElevationDeg:0.0}°)");
		Check(_cycle.DayFactor >= 0.9f, "daylight factor is near-maximal");
		Check(!_cycle.IsNight, "cycle reports day, not night");
		Check(_cycle.SunEnergy >= 1.0f, $"sun energy is full ({_cycle.SunEnergy:0.00})");
		Check(_cycle.AmbientEnergy >= 0.4f, $"sky ambient is bright ({_cycle.AmbientEnergy:0.00})");

		var windowMat = FindWindowMaterial();
		Check(windowMat is not null, "found a window material on a sample building");
		Check(windowMat?.EmissionEnabled == false, "window glow is off during daylight");

		Check(_glow.LampCount > 0, $"street lamps were spawned along the roads ({_glow.LampCount})");
		var lampGlass = FindLampGlass();
		Check(lampGlass is not null, "first street lamp carries a glass panel");
		Check(lampGlass?.EmissionEnabled == false, "lamp emission is off during daylight");

		Check(_lighthouse.Site is not null, "lighthouse building located under ObjectsRoot");
		Check(!_lighthouse.Active, "lighthouse beam is off during daylight");
	}

	private void RunNight()
	{
		GD.Print("--- 23:00 (deep night) ---");
		_cycle!.ForceHour = 23.0f;
		_cycle.ApplyHour();
		_glow!.ForceHour = 23.0f;
		_glow.Sync();
		_lighthouse!.ForceHour = 23.0f;
		_lighthouse.ResolveSite();
		_lighthouse.SetActive(DayNightCycle.IsDuskOrNight(23.0f));

		Check(_cycle.SunElevationDeg < -40.0f, $"sun is far below the horizon at 23:00 ({_cycle.SunElevationDeg:0.0}°)");
		Check(_cycle.IsNight, "cycle reports night");
		Check(_cycle.DayFactor <= 0.05f, "daylight factor is near-zero");
		Check(_cycle.SunEnergy < 0.15f, $"sun energy has collapsed ({_cycle.SunEnergy:0.00})");
		Check(_cycle.MoonEnergy > 0.2f, $"moonlight takes over ({_cycle.MoonEnergy:0.00})");
		Check(_cycle.AmbientEnergy < 0.25f, $"sky ambient is dim ({_cycle.AmbientEnergy:0.00})");

		Check(_glow.GlowActive, "glow manager switched on at night");
		var windowMat = FindWindowMaterial();
		Check(windowMat?.EmissionEnabled == true, "window glow is on at night");
		Check(windowMat is not null
			&& Mathf.Abs(windowMat.Emission.R - NightGlowManager.GlowColour.R) < 0.02f
			&& Mathf.Abs(windowMat.Emission.G - NightGlowManager.GlowColour.G) < 0.02f
			&& Mathf.Abs(windowMat.Emission.B - NightGlowManager.GlowColour.B) < 0.02f,
			"window glow uses the warm lantern colour");
		var lampGlass = FindLampGlass();
		Check(lampGlass?.EmissionEnabled == true, "street lamp emission is on at night");

		Check(_lighthouse.Active, "lighthouse beam is on at night");
		Check(_lighthouse.Lantern?.Visible == true, "lantern room is visible");
		Check(_lighthouse.Beam?.Visible == true, "rotating spot light is attached and enabled");

		float yaw0 = _lighthouse.BeamYawDeg;
		_lighthouse.Advance(1.0f);
		float yaw1 = _lighthouse.BeamYawDeg;
		Check(Mathf.Abs(yaw1 - yaw0) > 30.0f,
			$"beam rotates with the clock (yaw {yaw0:0.0}° → {yaw1:0.0}° over 1 s)");
	}

	private void RunDusk()
	{
		GD.Print("--- 19:30 (dusk) ---");
		_cycle!.ForceHour = 19.5f;
		_cycle.ApplyHour();
		_glow!.ForceHour = 19.5f;
		_glow.Sync();
		_lighthouse!.ForceHour = 19.5f;
		_lighthouse.SetActive(DayNightCycle.IsDuskOrNight(19.5f));

		Check(_cycle.SunElevationDeg < 0.0f, $"sun below the horizon after 19:30 ({_cycle.SunElevationDeg:0.0}°)");
		Check(_cycle.IsNight, "cycle treats 19:30 as night");
		Check(_glow.GlowActive, "glow switches on at dusk");
		Check(_lighthouse.Active, "lighthouse switches on at dusk");
	}

	private StandardMaterial3D? FindWindowMaterial()
	{
		var slot = Root.GetNodeOrNull<BuildingSlot3D>(
			"WorldManager/ObjectsRoot/Building_b-house/BuildingAssembler/WindowLeft");
		if (slot?.AttachedPiece is MeshInstance3D mi)
			return mi.MaterialOverride as StandardMaterial3D;
		return null;
	}

	private StandardMaterial3D? FindLampGlass()
	{
		foreach (var child in _glow!.GetChildren())
		{
			if (!child.Name.ToString().StartsWith("StreetLamp", StringComparison.Ordinal))
				continue;
			if (child is Node3D lampNode)
				return lampNode.GetNodeOrNull<MeshInstance3D>("Glass")?.MaterialOverride as StandardMaterial3D;
		}
		return null;
	}

	private static VillageData SampleVillage()
	{
		return new VillageData
		{
			Island = new IslandData { Name = "Atmosphere Isle", Seed = Seed, TerrainHash = "f7ec71ac" },
			Grid = new GridData { Size = Size },
			Buildings = new()
			{
				new BuildingData
				{
					Id = "b-house",
					Kind = "house",
					Tier = "house",
					Plot = new PlotData { Gx = 20, Gz = 20, W = 2, D = 2, Rot = 0 },
				},
				new BuildingData
				{
					Id = "b-civic",
					Kind = "civic",
					Tier = "civic",
					Plot = new PlotData { Gx = 24, Gz = 20, W = 2, D = 2, Rot = 1 },
				},
				new BuildingData
				{
					Id = "lighthouse",
					Kind = "civic",
					Tier = "civic",
					Name = "The lighthouse",
					Plot = new PlotData { Gx = 4, Gz = 30, W = 1, D = 1, Rot = 0 },
				},
			},
			Paths = new()
			{
				new PathData
				{
					Id = "p1",
					Cells = new() { new() { 26, 20 }, new() { 27, 20 }, new() { 28, 20 }, new() { 29, 20 } },
				},
			},
		};
	}

	private void Finish()
	{
		if (_fails == 0)
		{
			GD.Print("OK - day/night cycle, night glow and rotating lighthouse verified");
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
			GD.Print($"  [OK] {what}");
		else
		{
			GD.PushError($"  [FAIL] {what}");
			_fails++;
		}
	}
}