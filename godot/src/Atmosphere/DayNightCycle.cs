using System;
using Godot;

namespace Promptholm.Atmosphere;

/// <summary>
/// Day/night clock for Promptholm's sky. By default the hour tracks the real local clock
/// (DateTime.Now); setting ForceHour ≥ 0 pins the cycle (e.g. 21.0 for a frozen night).
/// Every frame it steers the DirectionalLight3D sun + moon around a 24h circle, tints the
/// light during sunrise/sunset and dims the sky ambient at night.
///
/// The node is self-contained: it adopts an existing "Sun" / "Moon" / "WorldEnvironment"
/// anywhere above it in the tree, or creates its own when none exist, so it works both as
/// a plain scene child and in the headless verification runner.
/// </summary>
[GlobalClass]
public partial class DayNightCycle : Node3D
{
	/// <summary>Sun elevation (degrees) below which glow/artificial lights switch on.</summary>
	public const float GlowThresholdDeg = 1.0f;

	/// <summary>Sun azimuth (degrees) — a fixed easterly-southwesterly sweep like the original scene.</summary>
	public const float SunYawDeg = 50.0f;

	/// <summary>If ≥ 0 the clock is frozen at this hour instead of syncing the real clock.</summary>
	[Export(PropertyHint.Range, "0,24,0.1")]
	public float ForceHour = -1.0f;

	private DirectionalLight3D? _sun;
	private DirectionalLight3D? _moon;
	private WorldEnvironment? _environment;
	private ProceduralSkyMaterial? _sky;

	/// <summary>Sun elevation in degrees last applied by ApplyHour (−90 = midnight, +90 = noon).</summary>
	public float SunElevationDeg { get; private set; } = 45.0f;

	/// <summary>1.0 = full daylight, 0.0 = deep night (linear ramp across ±10° around the horizon).</summary>
	public float DayFactor { get; private set; } = 1.0f;

	public float NightFactor => 1.0f - DayFactor;

	public DirectionalLight3D? Sun => _sun;
	public DirectionalLight3D? Moon => _moon;

	public float SunEnergy => _sun?.LightEnergy ?? 0.0f;
	public float MoonEnergy => _moon?.LightEnergy ?? 0.0f;
	public float AmbientEnergy => _environment?.Environment.AmbientLightEnergy ?? -1.0f;

	public bool IsNight => IsNightTime(Hour);

	/// <summary>The current hour: the forced debug hour when pinned, otherwise the real clock.</summary>
	public float Hour
	{
		get
		{
			if (ForceHour >= 0.0f)
				return ForceHour;
			return (float)DateTime.Now.TimeOfDay.TotalHours;
		}
	}

	/// <summary>
	/// Sun elevation for <paramref name="hour"/>: 0° at 06:00, +90° at 12:00 (noon), back to 0°
	/// at 18:00 and −90° at midnight. Derives from the standard hour-angle formula.
	/// </summary>
	public static float ElevationDegAt(float hour)
	{
		float hourAngle = Mathf.Tau * (hour - 6.0f) / 24.0f;
		return Mathf.RadToDeg(Mathf.Asin(Mathf.Sin(hourAngle)));
	}

	public static bool IsNightTime(float hour) => ElevationDegAt(hour) < 0.0f;

	/// <summary>True once the sun dips below the horizon (glow / lamp / lighthouse window).</summary>
	public static bool IsDuskOrNight(float hour) => ElevationDegAt(hour) < GlowThresholdDeg;

	public override void _Ready()
	{
		EnsureTargets();
	}

	public override void _Process(double delta)
	{
		ApplyHour();
	}

	/// <summary>Refreshes sun/moon/sky for the current <see cref="Hour"/>; returns that hour.</summary>
	public float ApplyHour()
	{
		float hour = Hour;
		ApplyHour(hour);
		return hour;
	}

	/// <summary>Applies a specific hour (used by the runner and tests); updates all sky targets.</summary>
	public void ApplyHour(float hour)
	{
		EnsureTargets();

		float el = ElevationDegAt(hour);
		SunElevationDeg = el;
		DayFactor = Mathf.Clamp(el / 10.0f, 0.0f, 1.0f);
		float nightBlend = Mathf.Clamp(-el / 10.0f, 0.0f, 1.0f);
		float horizonGlow = Mathf.Clamp(1.0f - Mathf.Abs(el) / 8.0f, 0.0f, 1.0f);

		if (_sun is not null)
		{
			_sun.Rotation = new Vector3(Mathf.DegToRad(-el), Mathf.DegToRad(SunYawDeg), 0.0f);
			var day = new Color(1.00f, 0.96f, 0.90f);
			var dusk = new Color(1.00f, 0.52f, 0.28f);
			var night = new Color(0.20f, 0.25f, 0.45f);
			_sun.LightColor = day.Lerp(dusk, horizonGlow).Lerp(night, nightBlend);
			_sun.LightEnergy = Mathf.Lerp(0.03f, 1.25f, DayFactor);
			_sun.ShadowEnabled = DayFactor > 0.05f;
		}

		if (_moon is not null)
		{
			// The moon mirrors the sun on the opposite side of the sky: when the sun is below
			// the horizon (el < 0) the moon sits above it and takes over the lighting.
			_moon.Rotation = new Vector3(Mathf.DegToRad(el), Mathf.DegToRad(SunYawDeg + 180.0f), 0.0f);
			_moon.LightColor = new Color(0.62f, 0.70f, 0.95f);
			_moon.LightEnergy = Mathf.Lerp(0.35f, 0.0f, DayFactor);
		}

		if (_environment is not null)
		{
			var env = _environment.Environment;
			env.AmbientLightEnergy = Mathf.Lerp(0.12f, 0.6f, DayFactor);
			env.AmbientLightColor = new Color(1.00f, 0.98f, 0.92f).Lerp(new Color(0.42f, 0.50f, 0.82f), nightBlend);
		}

		if (_sky is not null)
		{
			_sky.SkyTopColor = new Color(0.32f, 0.60f, 0.95f).Lerp(new Color(0.02f, 0.03f, 0.07f), nightBlend);
			_sky.SkyHorizonColor = new Color(0.95f, 0.86f, 0.72f).Lerp(new Color(0.04f, 0.06f, 0.10f), nightBlend);
			_sky.GroundBottomColor = new Color(0.06f, 0.09f, 0.14f).Lerp(new Color(0.01f, 0.02f, 0.04f), nightBlend);
			_sky.GroundHorizonColor = new Color(0.55f, 0.60f, 0.68f).Lerp(new Color(0.06f, 0.09f, 0.13f), nightBlend);
			_sky.EnergyMultiplier = Mathf.Lerp(0.30f, 1.0f, DayFactor);
			_sky.SkyEnergyMultiplier = Mathf.Lerp(0.20f, 1.0f, DayFactor);
			_sky.GroundEnergyMultiplier = Mathf.Lerp(0.30f, 1.0f, DayFactor);
		}
	}

	private void EnsureTargets()
	{
		if (_sun is null)
			_sun = FindUpstream<DirectionalLight3D>("Sun") ?? CreateSun();
		if (_moon is null)
			_moon = FindUpstream<DirectionalLight3D>("Moon") ?? CreateMoon();
		if (_environment is null)
		{
			_environment = FindUpstream<WorldEnvironment>("WorldEnvironment") ?? CreateEnvironment();
			var env = _environment.Environment;
			if (env.Sky is null || env.Sky.SkyMaterial is not ProceduralSkyMaterial)
				env.Sky = new Sky { SkyMaterial = new ProceduralSkyMaterial() };
		}
		_sky = _environment.Environment.Sky?.SkyMaterial as ProceduralSkyMaterial;
	}

	/// <summary>Searches this node and every ancestor up to the root for a child with the given
	/// name/types — i.e. our own managed light first, then a sibling or an ancestor-maintained one.</summary>
	private T? FindUpstream<T>(string name) where T : Node
	{
		for (Node? n = this; n is not null; n = n.GetParent())
		{
			var found = n.GetNodeOrNull<T>(name);
			if (found is not null)
				return found;
		}
		return null;
	}

	private DirectionalLight3D CreateSun()
	{
		var sun = new DirectionalLight3D
		{
			Name = "Sun",
			LightColor = new Color(1.0f, 0.96f, 0.90f),
			LightEnergy = 1.0f,
			ShadowEnabled = true,
			ShadowBias = 0.03f,
		};
		AddChild(sun);
		return sun;
	}

	private DirectionalLight3D CreateMoon()
	{
		var moon = new DirectionalLight3D
		{
			Name = "Moon",
			LightColor = new Color(0.62f, 0.70f, 0.95f),
			LightEnergy = 0.0f,
		};
		AddChild(moon);
		return moon;
	}

	private WorldEnvironment CreateEnvironment()
	{
		var env = new Godot.Environment
		{
			BackgroundMode = Godot.Environment.BGMode.Sky,
			Sky = new Sky { SkyMaterial = new ProceduralSkyMaterial() },
			AmbientLightSource = Godot.Environment.AmbientSource.Sky,
			AmbientLightSkyContribution = 0.4f,
			AmbientLightEnergy = 0.6f,
			TonemapMode = Godot.Environment.ToneMapper.Filmic,
		};
		var node = new WorldEnvironment { Name = "WorldEnvironment", Environment = env };
		AddChild(node);
		return node;
	}
}