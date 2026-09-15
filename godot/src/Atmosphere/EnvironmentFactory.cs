using Godot;

namespace Promptholm.Atmosphere;

/// <summary>
/// The one place that builds the island's environment, sky and celestial lights.
///
/// There used to be three copies — Main.EnsureLighting, DayNightCycle.CreateEnvironment and
/// ModelSheetShowroom — and they disagreed: only Main's had glow. DayNightCycle adopts an
/// upstream WorldEnvironment if it finds one and otherwise builds its own, so any scene
/// assembled without Main silently rendered the glow-less variant. That included the headless
/// atmosphere runner, which therefore verified an image the game never showed.
/// </summary>
public static class EnvironmentFactory
{
	// ---- daylight defaults, shared by every consumer ----

	public static readonly Color SkyTopDay = new(0.32f, 0.60f, 0.95f);
	public static readonly Color SkyHorizonDay = new(0.95f, 0.86f, 0.72f);
	public static readonly Color GroundBottomDay = new(0.06f, 0.09f, 0.14f);
	public static readonly Color GroundHorizonDay = new(0.55f, 0.60f, 0.68f);

	public static readonly Color SunColourDay = new(1.0f, 0.96f, 0.88f);
	public static readonly Color MoonColour = new(0.72f, 0.78f, 0.96f);

	/// <summary>Sky material carrying the daylight gradient; DayNightCycle animates it.</summary>
	public static ProceduralSkyMaterial CreateSkyMaterial() => new()
	{
		SkyTopColor = SkyTopDay,
		SkyHorizonColor = SkyHorizonDay,
		GroundBottomColor = GroundBottomDay,
		GroundHorizonColor = GroundHorizonDay,
		SunAngleMax = 15.0f,
	};

	/// <summary>The island environment: sky-lit ambient, filmic tonemap and a soft bloom.</summary>
	public static Godot.Environment CreateIsland()
	{
		var environment = new Godot.Environment
		{
			BackgroundMode = Godot.Environment.BGMode.Sky,
			Sky = new Sky { SkyMaterial = CreateSkyMaterial() },
			AmbientLightSource = Godot.Environment.AmbientSource.Sky,
			AmbientLightSkyContribution = 0.4f,
			AmbientLightEnergy = 0.6f,
			TonemapMode = Godot.Environment.ToneMapper.Filmic,
			GlowEnabled = true,
			GlowIntensity = 0.7f,
			GlowBloom = 0.1f,
			GlowHdrThreshold = 1.0f,
		};

		// Sky-coloured bounce. This is what puts a different *hue* in shadow than in light
		// rather than just a darker version of the same colour, and it follows the cycle.
		// Cascade count stays at the default; the 0.25 m root cell is what matters at this
		// scale, and the island is only 64 m across.
		environment.SdfgiEnabled = true;
		environment.SdfgiMinCellSize = 0.25f;
		environment.SdfgiUseOcclusion = true;
		environment.SdfgiBounceFeedback = 0.5f;
		environment.SdfgiEnergy = 1.0f;

		// Contact darkening only — not grime. SSAO fills the centimetre scale that SDFGI's
		// cells cannot: under eaves, at foundations, where props meet the ground.
		environment.SsaoEnabled = true;
		environment.SsaoRadius = 0.8f;
		environment.SsaoIntensity = 1.4f;
		environment.SsaoPower = 1.5f;
		environment.SsaoLightAffect = 0.0f;

		// SSIL costs about another SSAO to add screen-space colour bleed that SDFGI already
		// provides at a larger scale, and being view-dependent it flickers on camera pans and
		// makes screenshot comparison unreliable.
		environment.SsilEnabled = false;

		return environment;
	}

	/// <summary>
	/// Neutral studio environment for the model sheet: no bloom, slightly more sky ambient, and
	/// deliberately not part of the day/night cycle — a showroom is lit, not weathered.
	/// </summary>
	public static Godot.Environment CreateShowroom() => new()
	{
		BackgroundMode = Godot.Environment.BGMode.Sky,
		Sky = new Sky { SkyMaterial = CreateSkyMaterial() },
		AmbientLightSource = Godot.Environment.AmbientSource.Sky,
		AmbientLightSkyContribution = 0.5f,
		AmbientLightEnergy = 0.6f,
		TonemapMode = Godot.Environment.ToneMapper.Filmic,
	};

	/// <summary>
	/// Writes one <see cref="AtmosphereState"/> onto the live environment, sky and lights. This
	/// is the only place any of those fields are assigned, so the sky can never disagree with
	/// the fog it is supposed to be lighting.
	/// </summary>
	public static void Apply(
		Godot.Environment environment, ProceduralSkyMaterial? sky,
		DirectionalLight3D? sun, DirectionalLight3D? moon,
		in AtmosphereState state, float hour)
	{
		float elevation = AtmospherePalette.SunElevationDeg(hour);
		float azimuth = AtmospherePalette.SunAzimuthDeg(hour);

		if (sun is not null)
		{
			sun.Rotation = new Vector3(Mathf.DegToRad(-elevation), Mathf.DegToRad(azimuth), 0.0f);
			sun.LightColor = state.SunColour;
			sun.LightEnergy = state.SunEnergy;
			sun.ShadowEnabled = elevation > 0.0f;
		}

		if (moon is not null)
		{
			// Opposite the sun, so it is above the horizon exactly when the sun is not.
			moon.Rotation = new Vector3(Mathf.DegToRad(elevation), Mathf.DegToRad(azimuth + 180.0f), 0.0f);
			moon.LightColor = state.MoonColour;
			moon.LightEnergy = state.MoonEnergy;
			moon.ShadowEnabled = state.MoonEnergy > 0.05f && elevation <= 0.0f;
			// Wide and soft: moonlight through air is never a crisp edge.
			moon.LightAngularDistance = 1.5f;
			moon.ShadowBlur = 2.0f;
		}

		environment.AmbientLightColor = state.AmbientColour;
		environment.AmbientLightEnergy = state.AmbientEnergy;
		environment.GlowIntensity = state.GlowIntensity;
		environment.GlowBloom = state.GlowBloom;

		if (sky is not null)
		{
			sky.SkyTopColor = state.SkyTop;
			sky.SkyHorizonColor = state.SkyHorizon;
			sky.GroundHorizonColor = state.GroundHorizon;
			sky.GroundBottomColor = state.GroundBottom;
			sky.EnergyMultiplier = state.SkyEnergy;
		}

		ApplyFog(environment, state);
	}

	/// <summary>
	/// Depth fog sorts silhouettes; volumetric fog makes the light itself visible. They do
	/// different jobs and the combination is what reads as painted depth rather than haze.
	/// </summary>
	private static void ApplyFog(Godot.Environment environment, in AtmosphereState state)
	{
		environment.FogEnabled = true;
		environment.FogMode = Godot.Environment.FogModeEnum.Depth;
		environment.FogLightColor = state.FogColour;
		environment.FogLightEnergy = 1.0f;
		environment.FogSunScatter = 0.32f;
		environment.FogDensity = state.FogDensity;

		// The one setting that produces layered silhouettes: a ridge at 200 m takes most of its
		// colour from the sky behind it, one at 80 m only half, so two ridges become two tones
		// of the same shape instead of one flat mass.
		environment.FogAerialPerspective = 0.65f;
		// High enough that the sky and the fogged sea meet at the horizon. At 0.15 the sea was
		// full of night fog while the sky above it stayed untouched, which drew a hard line
		// straight across the frame.
		environment.FogSkyAffect = 0.70f;

		// Low-lying, so roofs and trees stand out above it.
		environment.FogHeight = 1.5f;
		environment.FogHeightDensity = state.FogHeightDensity;

		// Foreground stays crisp; without this the whole frame turns to soup and there is no
		// near/middle/far to read.
		environment.FogDepthBegin = 40.0f;
		environment.FogDepthEnd = 600.0f;
		environment.FogDepthCurve = 1.6f;

		environment.VolumetricFogEnabled = true;
		environment.VolumetricFogDensity = state.VolumetricDensity;
		environment.VolumetricFogAlbedo = state.VolumetricAlbedo;
		environment.VolumetricFogEmission = state.VolumetricEmission;
		environment.VolumetricFogEmissionEnergy = state.VolumetricEmissionEnergy;
		environment.VolumetricFogAnisotropy = 0.38f;
		environment.VolumetricFogLength = 256.0f;
		environment.VolumetricFogDetailSpread = 2.0f;
		environment.VolumetricFogAmbientInject = 0.30f;
		environment.VolumetricFogSkyAffect = 0.0f;
		environment.VolumetricFogTemporalReprojectionEnabled = true;
		environment.VolumetricFogTemporalReprojectionAmount = 0.9f;
	}

	/// <summary>Warm mid-afternoon sun; DayNightCycle overwrites rotation, colour and energy.</summary>
	public static DirectionalLight3D CreateSun() => new()
	{
		Name = "Sun",
		LightColor = SunColourDay,
		LightEnergy = 1.2f,
		ShadowEnabled = true,
		ShadowBias = 0.03f,
		// A real angular size for the sun. With soft shadow filtering this gives a penumbra
		// that widens with distance from the caster, which is the difference between a shadow
		// that reads as drawn and one that reads as a stencil.
		LightAngularDistance = 1.2f,

		// Bounded deliberately. The rendered ground now reaches 1300 m so the sea has a floor,
		// and on Godot's defaults the cascades stretched across all of it: long smeared streaks
		// over the seabed and a hard line in the water where the last split ended. The island is
		// 64 m, so 220 m covers it and a generous margin of sea at full resolution.
		DirectionalShadowMaxDistance = 220.0f,
		DirectionalShadowMode = DirectionalLight3D.ShadowMode.Parallel4Splits,
		DirectionalShadowSplit1 = 0.06f,
		DirectionalShadowSplit2 = 0.16f,
		DirectionalShadowSplit3 = 0.40f,
		DirectionalShadowBlendSplits = true,
		DirectionalShadowFadeStart = 0.9f,
		ShadowNormalBias = 1.2f,

		Rotation = new Vector3(Mathf.DegToRad(-42.0f), Mathf.DegToRad(50.0f), 0.0f),
	};

	/// <summary>
	/// Cool counter-light that takes over once the sun is below the horizon. DayNightCycle
	/// overwrites rotation, colour, energy and shadow toggle every frame; ShadowBias is
	/// deliberately left at Godot's default, because it is the one field the cycle does not
	/// touch and changing it here would quietly alter every night shadow on the island.
	/// </summary>
	public static DirectionalLight3D CreateMoon() => new()
	{
		Name = "Moon",
		LightColor = MoonColour,
		LightEnergy = 0.0f,
	};
}
