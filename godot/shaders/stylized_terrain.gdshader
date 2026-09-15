// Painterly ground for Promptholm.
//
// The island used to be drawn with vertex colours straight onto a StandardMaterial3D: four
// height bands, two of which were visually identical, and no variation whatsoever inside a
// band. At any distance that reads as a billiard table — a single flat green covering most of
// the frame.
//
// This keeps the vertex colour as the biome the generator decided on, then does three things
// with it that a flat material cannot: breaks it up with multi-scale noise so no two square
// metres match, blends to rock wherever the ground is steep (height alone can never do that —
// a cliff is the same height as the grass beside it), and quantises the lighting into a few
// steps so the shading reads as painted rather than photographic.
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, specular_disabled, diffuse_lambert_wrap;

// ---- palette ----
uniform vec3 rock_colour : source_color = vec3(0.32, 0.30, 0.29);
uniform vec3 dry_colour : source_color = vec3(0.52, 0.48, 0.24);
uniform vec3 lush_colour : source_color = vec3(0.16, 0.42, 0.18);

// ---- biome thresholds ----
// Slope is 1 - normal.y, so 0 is flat and 1 is a vertical face.
uniform float rock_slope_lo : hint_range(0.0, 1.0) = 0.22;
uniform float rock_slope_hi : hint_range(0.0, 1.0) = 0.52;

// Only ground above this height takes the grass treatment; sand and seabed keep their colour.
uniform float land_min = 0.30;

// ---- variation ----
uniform float macro_scale = 0.110;
uniform float detail_scale = 0.900;
uniform float macro_amount : hint_range(0.0, 1.0) = 0.55;
uniform float detail_amount : hint_range(0.0, 0.5) = 0.10;

// ---- painterly shading ----
uniform float band_steps : hint_range(1.0, 16.0) = 5.0;
uniform float band_softness : hint_range(0.0, 1.0) = 0.35;

varying vec3 world_pos;
varying vec3 world_normal;

// Noise comes from FastNoiseLite textures generated in WorldManager rather than from a hash in
// here. A hand-rolled value-noise was tried first and its interpolation collapsed to a constant
// on this input range, which is a slow thing to notice: the ground simply stayed flat and looked
// like the shader was not applied at all. Godot's own noise is reliable and the texture fetch is
// cheaper than four octaves of hashing per pixel.
uniform sampler2D macro_noise : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform sampler2D detail_noise : hint_default_white, filter_linear_mipmap, repeat_enable;

void vertex()
{
	world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	world_normal = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment()
{
	// The generator's own decision, in linear space — sand, meadow, upland, seabed.
	vec3 base = COLOR.rgb;

	float macro = texture(macro_noise, world_pos.xz * macro_scale).r;
	float detail = texture(detail_noise, world_pos.xz * detail_scale).r;
	float slope = clamp(1.0 - world_normal.y, 0.0, 1.0);

	// Grass only. Sand and seabed keep the band colour, or the beaches turn into meadow.
	float is_land = smoothstep(land_min - 0.25, land_min + 0.45, world_pos.y);

	// Two greens mixed on a low-frequency field: the patchiness that stops a lawn reading as
	// one printed colour. The macro field is deliberately large (about 30 m) so it works as
	// terrain character rather than as texture noise. The scale matters more than it looks: at
	// 0.03 the whole 64 m island spans less than one noise cell, so "variation" came out as a
	// single constant and the ground stayed exactly as flat as before.
	vec3 grass = mix(lush_colour, dry_colour, smoothstep(0.35, 0.72, macro));
	vec3 albedo = mix(base, mix(base, grass, macro_amount), is_land);

	// Slope-driven rock. This is what gives the coast and the hillside an edge: a cliff and the
	// grass on top of it sit at the same height, so a height-banded palette can never separate
	// them. Noise on the threshold keeps the rock line from looking drawn with a ruler.
	float rock_bias = (macro - 0.5) * 0.18;
	float rock = smoothstep(rock_slope_lo + rock_bias, rock_slope_hi + rock_bias, slope);
	albedo = mix(albedo, rock_colour, rock * is_land);

	// Fine grain, a few percent, so flat areas still have something to catch the light.
	albedo *= 1.0 + (detail - 0.5) * 2.0 * detail_amount;

	ALBEDO = clamp(albedo, vec3(0.0), vec3(1.0));
	ROUGHNESS = mix(0.92, 0.70, rock);
}

void light()
{
	// Wrapped diffuse, then quantised. Wrapping keeps the terminator soft so the island does not
	// split into a lit half and a black half; the steps are what make the shading read as laid
	// down in passes rather than computed per pixel. band_softness bleeds the step edges just
	// enough that they do not alias on a low-frequency surface.
	float ndotl = dot(NORMAL, LIGHT);
	float wrapped = clamp(ndotl * 0.5 + 0.5, 0.0, 1.0);

	float stepped = floor(wrapped * band_steps) / band_steps;
	float frac_part = fract(wrapped * band_steps);
	stepped += smoothstep(0.5 - band_softness * 0.5, 0.5 + band_softness * 0.5, frac_part) / band_steps;

	DIFFUSE_LIGHT += ALBEDO * LIGHT_COLOR * ATTENUATION * stepped;
}
