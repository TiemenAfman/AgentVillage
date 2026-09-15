using System;
using Godot;

namespace Promptholm.Atmosphere;

/// <summary>
/// The island's day as a small set of authored moments, interpolated.
///
/// It replaces a set of independent lerps whose shape was wrong in two ways that the
/// screenshots made obvious. Dusk lasted about forty minutes — <c>DayFactor = clamp(el/10)</c>
/// meant anything below the horizon was full night, so 18:20 rendered pitch black — and night
/// itself was a flat black plate: sky top 0.02 times a 0.20 energy multiplier, no gradient, no
/// horizon, therefore no silhouettes.
/// </summary>
public static class AtmospherePalette
{
	/// <summary>
	/// Peak sun elevation. The old curve was <c>asin(sin(hourAngle))</c>, which puts the sun in
	/// the zenith at noon — the flattest light there is, and the reason midday had no modelling
	/// at all. A shallower arc keeps a usable shadow direction all day.
	/// </summary>
	public const float MaxSunElevationDeg = 58.0f;

	/// <summary>Azimuth at sunrise; the sun sweeps to <see cref="AzimuthSetDeg"/> by sunset.</summary>
	public const float AzimuthRiseDeg = 95.0f;

	public const float AzimuthSetDeg = 265.0f;

	/// <summary>
	/// Fog densities in the table below are tuned for the island as it is now: 64 m across, so
	/// the far side of town sits about 60 m from the camera. They are a distance-per-metre
	/// figure, so if the world scale changes they have to move with it — at 3 m per cell the
	/// same look needs roughly three times these numbers.
	/// </summary>
	public const float TunedForIslandMetres = 64.0f;

	// Key hours are placed on the actual solar arc, not on round numbers. With a 58-degree peak
	// the sun crosses the horizon at 06:00 and 18:00, so "golden hour" has to sit at 17.2 (sun
	// at 12 degrees) — authoring it at 18.2, as the first pass did, put a 1.25-energy sun three
	// degrees *below* the horizon: full warm light and no shadows at all.

	private static readonly (float Hour, AtmosphereState State)[] _keys =
	[
		(0.0f, new AtmosphereState(
			SunColour: new Color(0.16f, 0.22f, 0.42f), SunEnergy: 0.02f,
			MoonColour: new Color(0.60f, 0.72f, 1.00f), MoonEnergy: 0.55f,
			SkyTop: new Color(0.020f, 0.030f, 0.075f),
			SkyHorizon: new Color(0.055f, 0.075f, 0.150f),
			GroundHorizon: new Color(0.030f, 0.045f, 0.080f),
			GroundBottom: new Color(0.010f, 0.015f, 0.030f),
			SkyEnergy: 0.55f,
			AmbientColour: new Color(0.30f, 0.42f, 0.78f), AmbientEnergy: 0.30f,
			FogColour: new Color(0.09f, 0.13f, 0.24f), FogDensity: 0.0026f, FogHeightDensity: 0.05f,
			VolumetricAlbedo: new Color(0.55f, 0.62f, 0.80f),
			VolumetricEmission: new Color(0.16f, 0.22f, 0.42f),
			VolumetricDensity: 0.0067f, VolumetricEmissionEnergy: 0.6f,
			GlowIntensity: 1.10f, GlowBloom: 0.20f,
			WindowGlow: 1.0f, LampEnergy: 1.0f)),

		(4.6f, new AtmosphereState(
			SunColour: new Color(0.35f, 0.32f, 0.50f), SunEnergy: 0.10f,
			MoonColour: new Color(0.62f, 0.72f, 0.98f), MoonEnergy: 0.35f,
			SkyTop: new Color(0.045f, 0.065f, 0.140f),
			SkyHorizon: new Color(0.180f, 0.150f, 0.225f),
			GroundHorizon: new Color(0.070f, 0.075f, 0.110f),
			GroundBottom: new Color(0.018f, 0.024f, 0.045f),
			SkyEnergy: 0.70f,
			AmbientColour: new Color(0.38f, 0.44f, 0.72f), AmbientEnergy: 0.32f,
			FogColour: new Color(0.16f, 0.16f, 0.27f), FogDensity: 0.0034f, FogHeightDensity: 0.10f,
			VolumetricAlbedo: new Color(0.62f, 0.64f, 0.78f),
			VolumetricEmission: new Color(0.20f, 0.18f, 0.30f),
			VolumetricDensity: 0.0093f, VolumetricEmissionEnergy: 0.35f,
			GlowIntensity: 1.00f, GlowBloom: 0.16f,
			WindowGlow: 0.9f, LampEnergy: 0.9f)),

		(6.4f, new AtmosphereState(
			SunColour: new Color(1.00f, 0.52f, 0.26f), SunEnergy: 0.75f,
			MoonColour: new Color(0.66f, 0.74f, 0.96f), MoonEnergy: 0.05f,
			SkyTop: new Color(0.130f, 0.230f, 0.430f),
			SkyHorizon: new Color(0.980f, 0.520f, 0.300f),
			GroundHorizon: new Color(0.320f, 0.250f, 0.230f),
			GroundBottom: new Color(0.050f, 0.055f, 0.080f),
			SkyEnergy: 0.90f,
			AmbientColour: new Color(0.86f, 0.66f, 0.58f), AmbientEnergy: 0.45f,
			FogColour: new Color(0.72f, 0.52f, 0.46f), FogDensity: 0.0042f, FogHeightDensity: 0.16f,
			VolumetricAlbedo: new Color(0.85f, 0.78f, 0.72f),
			VolumetricEmission: new Color(0.45f, 0.24f, 0.12f),
			VolumetricDensity: 0.0107f, VolumetricEmissionEnergy: 0.25f,
			GlowIntensity: 0.95f, GlowBloom: 0.14f,
			WindowGlow: 0.35f, LampEnergy: 0.35f)),

		(9.0f, new AtmosphereState(
			SunColour: new Color(1.00f, 0.93f, 0.82f), SunEnergy: 1.55f,
			MoonColour: EnvironmentFactory.MoonColour, MoonEnergy: 0.0f,
			SkyTop: new Color(0.230f, 0.470f, 0.860f),
			SkyHorizon: new Color(0.850f, 0.800f, 0.720f),
			GroundHorizon: new Color(0.480f, 0.520f, 0.580f),
			GroundBottom: new Color(0.060f, 0.090f, 0.140f),
			SkyEnergy: 1.0f,
			AmbientColour: new Color(0.82f, 0.88f, 1.00f), AmbientEnergy: 0.42f,
			FogColour: new Color(0.62f, 0.70f, 0.80f), FogDensity: 0.0018f, FogHeightDensity: 0.05f,
			VolumetricAlbedo: new Color(0.90f, 0.93f, 1.00f),
			VolumetricEmission: new Color(0.0f, 0.0f, 0.0f),
			VolumetricDensity: 0.0040f, VolumetricEmissionEnergy: 0.0f,
			GlowIntensity: 0.70f, GlowBloom: 0.10f,
			WindowGlow: 0.0f, LampEnergy: 0.0f)),

		(12.5f, new AtmosphereState(
			SunColour: new Color(1.00f, 0.97f, 0.92f), SunEnergy: 1.85f,
			MoonColour: EnvironmentFactory.MoonColour, MoonEnergy: 0.0f,
			SkyTop: new Color(0.200f, 0.430f, 0.880f),
			SkyHorizon: new Color(0.760f, 0.820f, 0.880f),
			GroundHorizon: new Color(0.520f, 0.560f, 0.620f),
			GroundBottom: new Color(0.060f, 0.090f, 0.140f),
			SkyEnergy: 1.0f,
			AmbientColour: new Color(0.86f, 0.91f, 1.00f), AmbientEnergy: 0.38f,
			FogColour: new Color(0.60f, 0.72f, 0.86f), FogDensity: 0.0011f, FogHeightDensity: 0.03f,
			VolumetricAlbedo: new Color(0.92f, 0.95f, 1.00f),
			VolumetricEmission: new Color(0.0f, 0.0f, 0.0f),
			VolumetricDensity: 0.0027f, VolumetricEmissionEnergy: 0.0f,
			GlowIntensity: 0.60f, GlowBloom: 0.08f,
			WindowGlow: 0.0f, LampEnergy: 0.0f)),

		(17.2f, new AtmosphereState(
			SunColour: new Color(1.00f, 0.66f, 0.34f), SunEnergy: 1.25f,
			MoonColour: EnvironmentFactory.MoonColour, MoonEnergy: 0.0f,
			SkyTop: new Color(0.180f, 0.330f, 0.640f),
			SkyHorizon: new Color(1.000f, 0.600f, 0.300f),
			GroundHorizon: new Color(0.420f, 0.330f, 0.300f),
			GroundBottom: new Color(0.050f, 0.060f, 0.090f),
			SkyEnergy: 0.95f,
			AmbientColour: new Color(1.00f, 0.82f, 0.68f), AmbientEnergy: 0.42f,
			FogColour: new Color(0.85f, 0.58f, 0.42f), FogDensity: 0.0027f, FogHeightDensity: 0.14f,
			VolumetricAlbedo: new Color(0.92f, 0.86f, 0.78f),
			VolumetricEmission: new Color(0.50f, 0.28f, 0.12f),
			VolumetricDensity: 0.0073f, VolumetricEmissionEnergy: 0.30f,
			GlowIntensity: 1.00f, GlowBloom: 0.16f,
			WindowGlow: 0.15f, LampEnergy: 0.10f)),

		(18.8f, new AtmosphereState(
			SunColour: new Color(0.60f, 0.35f, 0.42f), SunEnergy: 0.25f,
			MoonColour: new Color(0.62f, 0.73f, 0.99f), MoonEnergy: 0.25f,
			SkyTop: new Color(0.070f, 0.110f, 0.290f),
			SkyHorizon: new Color(0.520f, 0.260f, 0.330f),
			GroundHorizon: new Color(0.150f, 0.120f, 0.160f),
			GroundBottom: new Color(0.020f, 0.028f, 0.055f),
			SkyEnergy: 0.75f,
			AmbientColour: new Color(0.52f, 0.50f, 0.74f), AmbientEnergy: 0.34f,
			FogColour: new Color(0.34f, 0.26f, 0.38f), FogDensity: 0.0033f, FogHeightDensity: 0.16f,
			VolumetricAlbedo: new Color(0.72f, 0.70f, 0.82f),
			VolumetricEmission: new Color(0.28f, 0.20f, 0.30f),
			VolumetricDensity: 0.0093f, VolumetricEmissionEnergy: 0.45f,
			GlowIntensity: 1.20f, GlowBloom: 0.20f,
			WindowGlow: 0.85f, LampEnergy: 0.80f)),

		(21.0f, new AtmosphereState(
			SunColour: new Color(0.20f, 0.26f, 0.46f), SunEnergy: 0.05f,
			MoonColour: new Color(0.60f, 0.72f, 1.00f), MoonEnergy: 0.50f,
			SkyTop: new Color(0.028f, 0.042f, 0.095f),
			SkyHorizon: new Color(0.080f, 0.095f, 0.180f),
			GroundHorizon: new Color(0.035f, 0.050f, 0.090f),
			GroundBottom: new Color(0.012f, 0.018f, 0.035f),
			SkyEnergy: 0.60f,
			AmbientColour: new Color(0.32f, 0.44f, 0.80f), AmbientEnergy: 0.31f,
			FogColour: new Color(0.11f, 0.15f, 0.26f), FogDensity: 0.0027f, FogHeightDensity: 0.07f,
			VolumetricAlbedo: new Color(0.58f, 0.64f, 0.82f),
			VolumetricEmission: new Color(0.18f, 0.24f, 0.44f),
			VolumetricDensity: 0.0073f, VolumetricEmissionEnergy: 0.55f,
			GlowIntensity: 1.12f, GlowBloom: 0.20f,
			WindowGlow: 1.0f, LampEnergy: 1.0f)),
	];

	public static int KeyCount => _keys.Length;

	public static float KeyHour(int index) => _keys[index].Hour;

	/// <summary>
	/// The authored state for an hour, wrapping past the last key back to the first. Smoothstep
	/// between keys so the transitions ease instead of changing slope at every keyframe.
	/// </summary>
	public static AtmosphereState Sample(float hour)
	{
		hour = Mathf.PosMod(hour, 24.0f);

		int last = _keys.Length - 1;
		for (int i = 0; i < last; i++)
		{
			if (hour >= _keys[i].Hour && hour < _keys[i + 1].Hour)
			{
				float span = _keys[i + 1].Hour - _keys[i].Hour;
				float t = Mathf.SmoothStep(0.0f, 1.0f, (hour - _keys[i].Hour) / span);
				return AtmosphereState.Lerp(_keys[i].State, _keys[i + 1].State, t);
			}
		}

		// Past the final key: wrap around midnight to the first.
		float wrapSpan = 24.0f - _keys[last].Hour + _keys[0].Hour;
		float wrapPos = hour >= _keys[last].Hour ? hour - _keys[last].Hour : hour + 24.0f - _keys[last].Hour;
		float wt = Mathf.SmoothStep(0.0f, 1.0f, wrapPos / wrapSpan);
		return AtmosphereState.Lerp(_keys[last].State, _keys[0].State, wt);
	}

	/// <summary>
	/// Sun elevation in degrees: a shallow arc peaking at <see cref="MaxSunElevationDeg"/> rather
	/// than the zenith, so midday keeps a shadow direction.
	/// </summary>
	public static float SunElevationDeg(float hour)
		=> MaxSunElevationDeg * MathF.Sin(Mathf.Tau * (Mathf.PosMod(hour, 24.0f) - 6.0f) / 24.0f);

	/// <summary>
	/// Sun azimuth in degrees, sweeping east to west across the day. The old cycle pinned this
	/// at 50 degrees around the clock, so shadows only ever grew and shrank — they never moved,
	/// which is most of why the light read as static.
	/// </summary>
	public static float SunAzimuthDeg(float hour)
		=> AzimuthRiseDeg + (AzimuthSetDeg - AzimuthRiseDeg) * (Mathf.PosMod(hour, 24.0f) - 6.0f) / 12.0f;

	/// <summary>True once the sun is low enough that lamps and windows should be lit.</summary>
	public static bool IsDuskOrNight(float hour) => SunElevationDeg(hour) < 3.0f;

	public static bool IsNight(float hour) => SunElevationDeg(hour) < 0.0f;
}
