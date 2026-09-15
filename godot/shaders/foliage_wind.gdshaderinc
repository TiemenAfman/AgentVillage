// Wind, as a pure function of world position and TIME.
//
// Shared by foliage_card.gdshader and foliage_leaf.gdshader, which is the point of the file: the
// grass and the bushes behind it have to bend in the same gust at the same moment, and two copies
// of this maths would drift the first time one of them was tuned.
//
// Two rules it exists to keep.
//
//   **Phase comes from the world, not from the instance.** Terrain3D's own example shader
//   (addons/terrain_3d/extras/particle_example/grass.gdshader) reads INSTANCE_CUSTOM, because it
//   is driven by a GPUParticles process material that writes a wind force per particle. The
//   instancer writes no such thing, and even if it did, a per-instance phase gives every blade its
//   own private breeze - a field of grass twitching rather than a gust crossing it. Keying on
//   dot(world.xz, direction) is what makes the wave travel.
//
//   **TIME and nothing else.** The screenshot harness runs with --fixed-fps 60, so a pure function
//   of TIME renders bit-for-bit identically on two runs of the same code. Anything accumulated per
//   frame would make every before/after comparison meaningless.

uniform vec2 wind_direction = vec2(0.82, 0.57);

// Metres of lateral travel at full bend. Subtle on purpose: grass that visibly walks reads as
// water, and this island is stylised rather than animated.
uniform float wind_strength : hint_range(0.0, 1.0) = 0.15;

uniform float wind_speed : hint_range(0.0, 4.0) = 0.9;

/// Metres between crests of the travelling gust. Roughly the width of a plot, so a gust is a thing
/// that crosses the meadow rather than a shimmer over it.
uniform float wind_wavelength : hint_range(1.0, 80.0) = 13.0;

/// Sideways flutter across the wind, which is what stops a lull from looking like a freeze frame.
uniform float wind_wobble : hint_range(0.0, 1.0) = 0.30;

/// How far a vertex moves, given how far up its own plant it sits.
///
/// `bend` is 0 at the root and 1 at the tip; the caller squares it, so the base is pinned and the
/// top does nearly all of the travelling - the cheap stand-in for a stalk that is stiff at the
/// bottom. The vertical term shortens the plant as it leans, because a blade that bends without
/// getting shorter stretches, and a stretching blade is the tell that there is no pivot.
vec3 pm_wind_offset(vec3 w_vertex, float bend) {
	vec2 dir = normalize(wind_direction);
	float phase = dot(w_vertex.xz, dir) * (6.2831853 / wind_wavelength) + TIME * wind_speed;
	// Two waves that do not divide into each other, so the gust never repeats on a beat.
	float gust = sin(phase) * 0.62 + sin(phase * 0.41 + 1.7) * 0.38;
	float wobble = sin(TIME * 2.1 * wind_speed + w_vertex.x * 0.83 + w_vertex.z * 0.61) * wind_wobble;
	vec2 lateral = dir * gust + vec2(-dir.y, dir.x) * wobble;
	float force = wind_strength * bend;
	return vec3(lateral.x * force, -abs(gust) * force * 0.22, lateral.y * force);
}
