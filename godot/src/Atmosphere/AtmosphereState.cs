using Godot;

namespace Promptholm.Atmosphere;

/// <summary>
/// Everything the sky, the lights and the post stack need for one moment of the day, as plain
/// data. Pure values, no Godot nodes, so it can be sampled and asserted headlessly.
///
/// The point of bundling it is phase. The old cycle lerped a dozen fields independently off
/// DayFactor, nightBlend and horizonGlow, which meant you could not make dawn cooler without
/// also changing dusk, and the sky could disagree with the fog it was supposed to be lighting.
/// One interpolation factor over one struct keeps the image coherent by construction.
/// </summary>
public readonly record struct AtmosphereState(
	// sun & moon
	Color SunColour, float SunEnergy,
	Color MoonColour, float MoonEnergy,

	// sky gradient
	Color SkyTop, Color SkyHorizon, Color GroundHorizon, Color GroundBottom,
	float SkyEnergy,

	// ambient fill
	Color AmbientColour, float AmbientEnergy,

	// fog
	Color FogColour, float FogDensity, float FogHeightDensity,
	Color VolumetricAlbedo, Color VolumetricEmission,
	float VolumetricDensity, float VolumetricEmissionEnergy,

	// post
	float GlowIntensity, float GlowBloom,

	// driven surfaces
	float WindowGlow, float LampEnergy)
{
	/// <summary>Component-wise interpolation; every field moves on the same t.</summary>
	public static AtmosphereState Lerp(in AtmosphereState a, in AtmosphereState b, float t) => new(
		a.SunColour.Lerp(b.SunColour, t), Mathf.Lerp(a.SunEnergy, b.SunEnergy, t),
		a.MoonColour.Lerp(b.MoonColour, t), Mathf.Lerp(a.MoonEnergy, b.MoonEnergy, t),

		a.SkyTop.Lerp(b.SkyTop, t), a.SkyHorizon.Lerp(b.SkyHorizon, t),
		a.GroundHorizon.Lerp(b.GroundHorizon, t), a.GroundBottom.Lerp(b.GroundBottom, t),
		Mathf.Lerp(a.SkyEnergy, b.SkyEnergy, t),

		a.AmbientColour.Lerp(b.AmbientColour, t), Mathf.Lerp(a.AmbientEnergy, b.AmbientEnergy, t),

		a.FogColour.Lerp(b.FogColour, t),
		Mathf.Lerp(a.FogDensity, b.FogDensity, t),
		Mathf.Lerp(a.FogHeightDensity, b.FogHeightDensity, t),
		a.VolumetricAlbedo.Lerp(b.VolumetricAlbedo, t),
		a.VolumetricEmission.Lerp(b.VolumetricEmission, t),
		Mathf.Lerp(a.VolumetricDensity, b.VolumetricDensity, t),
		Mathf.Lerp(a.VolumetricEmissionEnergy, b.VolumetricEmissionEnergy, t),

		Mathf.Lerp(a.GlowIntensity, b.GlowIntensity, t),
		Mathf.Lerp(a.GlowBloom, b.GlowBloom, t),

		Mathf.Lerp(a.WindowGlow, b.WindowGlow, t),
		Mathf.Lerp(a.LampEnergy, b.LampEnergy, t));
}
