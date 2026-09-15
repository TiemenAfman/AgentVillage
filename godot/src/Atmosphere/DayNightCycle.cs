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

	/// <summary>Where the hour comes from when <see cref="ForceHour"/> is not set.</summary>
	public enum ClockSource
	{
		/// <summary>A compressed in-game day, so a whole cycle is visible in a few minutes.</summary>
		Simulated,

		/// <summary>The machine's wall clock, as the island originally did.</summary>
		RealClock,
	}

	/// <summary>
	/// Default is Simulated, not RealClock. Tying the sky to DateTime.Now meant the image
	/// depended on when you pressed F5 — open the island at three in the morning and you got a
	/// black screen and assumed it was broken. A simulated day also means the whole cycle can be
	/// watched in a couple of minutes, which is how you judge a lighting change.
	/// </summary>
	[Export] public ClockSource Source { get; set; } = ClockSource.Simulated;

	/// <summary>Hour the simulated clock starts at.</summary>
	[Export(PropertyHint.Range, "0,24,0.1")]
	public float StartHour { get; set; } = 8.5f;

	/// <summary>Real minutes for one simulated day.</summary>
	[Export] public float DayLengthMinutes { get; set; } = 24.0f;

	/// <summary>If ≥ 0 the clock is frozen at this hour. Always wins, whatever the source.</summary>
	[Export(PropertyHint.Range, "0,24,0.1")]
	public float ForceHour = -1.0f;

	private DirectionalLight3D? _sun;
	private DirectionalLight3D? _moon;
	private WorldEnvironment? _environment;
	private ProceduralSkyMaterial? _sky;
	private Node3D? _moonVisual;
	private AtmosphereState _state = AtmospherePalette.Sample(12.0f);
	private float _simulatedHour;
	private float _lastStateHour = float.NaN;
	private bool _stateValid;

	/// <summary>
	/// How far the hour must move before the expensive tier runs again: 0.02 h is about 1.2
	/// simulated minutes, so on a 24-minute day the sky rebuilds around three times a second
	/// instead of sixty.
	/// </summary>
	private const float HourEpsilonRad = 0.02f * Mathf.Tau / 24.0f;

	/// <summary>The authored atmosphere for the hour last applied.</summary>
	public AtmosphereState State => _state;

	/// <summary>Sun elevation in degrees last applied by ApplyHour (−90 = midnight, +90 = noon).</summary>
	public float SunElevationDeg { get; private set; } = 45.0f;

	/// <summary>1.0 = full daylight, 0.0 = deep night (linear ramp across ±10° around the horizon).</summary>
	public float DayFactor { get; private set; } = 1.0f;

	public float NightFactor => 1.0f - DayFactor;

	public DirectionalLight3D? Sun => _sun;
	public DirectionalLight3D? Moon => _moon;

	/// <summary>Billboard moon disc + halo + light shaft child, moved with the moon light.</summary>
	public Node3D? MoonVisual => _moonVisual;

	public bool MoonShadowsEnabled => _moon?.ShadowEnabled == true;
	public bool MoonVisualVisible => _moonVisual?.Visible == true;

	public float SunEnergy => _sun?.LightEnergy ?? 0.0f;
	public float MoonEnergy => _moon?.LightEnergy ?? 0.0f;
	public float AmbientEnergy => _environment?.Environment.AmbientLightEnergy ?? -1.0f;

	public bool IsNight => IsNightTime(Hour);

	/// <summary>The current hour: pinned if ForceHour is set, else from <see cref="Source"/>.</summary>
	public float Hour
	{
		get
		{
			if (ForceHour >= 0.0f)
				return ForceHour;
			if (Source == ClockSource.RealClock)
				return (float)DateTime.Now.TimeOfDay.TotalHours;
			return _simulatedHour;
		}
	}

	/// <summary>
	/// Sun elevation for <paramref name="hour"/>, from <see cref="AtmospherePalette"/>. It peaks
	/// at 58 degrees rather than in the zenith: the old curve put the sun straight overhead at
	/// noon, which is the flattest light there is and left midday with no modelling at all.
	/// </summary>
	public static float ElevationDegAt(float hour) => AtmospherePalette.SunElevationDeg(hour);

	public static bool IsNightTime(float hour) => AtmospherePalette.IsNight(hour);

	/// <summary>True once the sun is low enough for glow, lamps and the lighthouse.</summary>
	public static bool IsDuskOrNight(float hour) => AtmospherePalette.IsDuskOrNight(hour);

	/// <summary>Fires when the expensive tier has rewritten the atmosphere for a new hour.</summary>
	[Signal]
	public delegate void AtmosphereChangedEventHandler(float hour, float windowGlow, float lampEnergy);

	public override void _Ready()
	{
		_simulatedHour = StartHour;
		EnsureTargets();
	}

	/// <summary>
	/// Two tiers. Sun and moon rotate every frame because that is a couple of node transforms.
	/// Everything else — sky gradient, ambient, fog, glow — only rewrites when the hour has moved
	/// far enough to see, because writing the ProceduralSkyMaterial forces a sky radiance rebuild
	/// and this used to happen sixty times a second for an image that changes over minutes.
	/// </summary>
	public override void _Process(double delta)
	{
		if (Source == ClockSource.Simulated && ForceHour < 0.0f && DayLengthMinutes > 0.0f)
		{
			_simulatedHour = Mathf.PosMod(
				_simulatedHour + (float)delta * 24.0f / (DayLengthMinutes * 60.0f), 24.0f);
		}

		float hour = Hour;

		if (!_stateValid || Mathf.Abs(Mathf.AngleDifference(
				hour * Mathf.Tau / 24.0f, _lastStateHour * Mathf.Tau / 24.0f)) > HourEpsilonRad)
		{
			ApplyHour(hour);
		}
		else
		{
			ApplyRotations(hour);
		}
	}

	/// <summary>Cheap per-frame tier: only the celestial transforms.</summary>
	private void ApplyRotations(float hour)
	{
		float elevation = AtmospherePalette.SunElevationDeg(hour);
		float azimuth = AtmospherePalette.SunAzimuthDeg(hour);

		if (_sun is not null)
			_sun.Rotation = new Vector3(Mathf.DegToRad(-elevation), Mathf.DegToRad(azimuth), 0.0f);
		if (_moon is not null)
			_moon.Rotation = new Vector3(Mathf.DegToRad(elevation), Mathf.DegToRad(azimuth + 180.0f), 0.0f);
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

		float elevation = AtmospherePalette.SunElevationDeg(hour);
		SunElevationDeg = elevation;

		// Daylight ramp across the first 12 degrees above the horizon. The old ramp used 10
		// degrees on a curve that reached 90 at noon, so anything under the horizon was full
		// night — that is why 18:20 rendered pitch black.
		DayFactor = Mathf.Clamp(elevation / 12.0f, 0.0f, 1.0f);

		_state = AtmospherePalette.Sample(hour);

		if (_environment is not null)
			EnvironmentFactory.Apply(_environment.Environment, _sky, _sun, _moon, _state, hour);

		if (_moonVisual is not null)
			_moonVisual.Visible = elevation < 0.0f;

		_lastStateHour = hour;
		_stateValid = true;
		EmitSignal(SignalName.AtmosphereChanged, hour, _state.WindowGlow, _state.LampEnergy);
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
		var sun = EnvironmentFactory.CreateSun();
		AddChild(sun);
		return sun;
	}

	private DirectionalLight3D CreateMoon()
	{
		var moon = EnvironmentFactory.CreateMoon();
		AddChild(moon);
		_moonVisual = CreateMoonVisual(moon);
		return moon;
	}

	/// <summary>
	/// Visible moon: a bright emitter disc with a softer halo and a faint forward shaft,
	/// parented to the moon light so it mirrors the rotation. The headless runner checks
	/// it is hidden by day and shown at night.
	/// </summary>
	private static Node3D CreateMoonVisual(DirectionalLight3D anchor)
	{
		var visual = new Node3D { Name = "MoonVisual", Position = new Vector3(0.0f, 0.0f, -600.0f) };
		anchor.AddChild(visual);

		var discMat = new StandardMaterial3D
		{
			ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
			AlbedoColor = new Color(0.72f, 0.78f, 0.96f),
			EmissionEnabled = true,
			Emission = new Color(0.72f, 0.78f, 0.96f),
			EmissionEnergyMultiplier = 2.2f,
		};
		var disc = new MeshInstance3D
		{
			Name = "Disc",
			Mesh = new SphereMesh { Radius = 16.0f, Height = 16.0f, RadialSegments = 24, Rings = 16 },
			MaterialOverride = discMat,
			CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
		};
		visual.AddChild(disc);

		var haloMat = new StandardMaterial3D
		{
			ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
			AlbedoColor = new Color(0.72f, 0.78f, 0.96f, 0.35f),
			BlendMode = BaseMaterial3D.BlendModeEnum.Add,
			Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
			CullMode = BaseMaterial3D.CullModeEnum.Disabled,
		};
		var halo = new MeshInstance3D
		{
			Name = "Halo",
			Mesh = new SphereMesh { Radius = 30.0f, Height = 30.0f, RadialSegments = 24, Rings = 16 },
			MaterialOverride = haloMat,
			CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
		};
		visual.AddChild(halo);

		// Faint shaft: a cone stretching from the moon towards the scene, additive and subtle.
		var shaftMat = new StandardMaterial3D
		{
			ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
			AlbedoColor = new Color(0.55f, 0.62f, 0.85f, 1.0f),
			BlendMode = BaseMaterial3D.BlendModeEnum.Add,
			Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
			CullMode = BaseMaterial3D.CullModeEnum.Disabled,
		};
		var shaft = new MeshInstance3D
		{
			Name = "Shaft",
			Mesh = new CylinderMesh
			{
				TopRadius = 14.0f,
				BottomRadius = 55.0f,
				Height = 420.0f,
				RadialSegments = 16,
			},
			MaterialOverride = shaftMat,
			Position = new Vector3(0.0f, 0.0f, 210.0f),
			Rotation = new Vector3(Mathf.DegToRad(-90.0f), 0.0f, 0.0f),
			CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
		};
		visual.AddChild(shaft);

		return visual;
	}

	/// <summary>
	/// Fallback for scenes assembled without Main. It builds the *same* environment Main does —
	/// this copy used to omit the glow, so anything running without Main (the headless
	/// atmosphere runner included) verified an image the game never rendered.
	/// </summary>
	private WorldEnvironment CreateEnvironment()
	{
		var node = new WorldEnvironment
		{
			Name = "WorldEnvironment",
			Environment = EnvironmentFactory.CreateIsland(),
		};
		AddChild(node);
		return node;
	}
}