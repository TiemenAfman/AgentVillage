// Stylized 3D water, re-engineered from the gameidea "Creating a Stylized 3D Water
// Shader" tutorial (free/open source). Opaque water: the surface refracts the seabed
// through SCREEN_TEXTURE, fades with Beer–Lambert absorption, lays animated caustics
// on the floor, and drives procedural Voronoi foam from depth + wave crests.
shader_type spatial;

// Godot 4.7 removed the DEPTH_TEXTURE/SCREEN_TEXTURE built-ins; sampling them requires
// declaring uniforms with the corresponding hints, like any other sampler.
uniform sampler2D DEPTH_TEXTURE : hint_depth_texture, filter_linear_mipmap;
uniform sampler2D SCREEN_TEXTURE : hint_screen_texture, filter_linear_mipmap;

// ---- wave parameters ----
uniform float sea_height : hint_range(0.0, 5.0) = 1.1;
uniform float sea_choppy : hint_range(0.0, 10.0) = 2.6;
uniform float sea_speed : hint_range(0.0, 5.0) = 1.5;
uniform float sea_freq : hint_range(0.0, 0.5) = 0.14;
const int ITER_GEOMETRY = 3;
const int ITER_FRAGMENT = 5;
const mat2 octave_m = mat2(vec2(1.6, 1.2), vec2(-1.2, 1.6));

// ---- depth & underwater look ----
uniform float max_depth : hint_range(0.1, 50.0, 0.1) = 12.0;
uniform float water_level : hint_range(-10.0, 10.0, 0.1) = 0.0;
uniform vec3 underwater_fog_color : source_color = vec3(0.02, 0.12, 0.16);
uniform float fade_start_depth : hint_range(0.0, 50.0, 0.1) = 1.2;
uniform vec3 base_tint_color : source_color = vec3(0.30, 0.72, 0.70);
uniform vec3 deep_color : source_color = vec3(0.03, 0.28, 0.34);
uniform vec3 water_absorption : source_color = vec3(0.32, 0.08, 0.02);

// ---- refraction & normals ----
uniform float refraction_strength : hint_range(0.0, 2.0, 0.01) = 1.0;
uniform float refraction_distance_fade : hint_range(0.0, 100.0, 1.0) = 8.0;
uniform float normal_epsilon : hint_range(0.001, 1.0) = 0.04;
uniform float normal_smoothness_dist : hint_range(0.0, 1000.0) = 60.0;
uniform float roughness : hint_range(0.0, 1.0) = 0.10;
uniform float metallic : hint_range(0.0, 1.0) = 0.0;
uniform float specular : hint_range(0.0, 1.0) = 0.9;

// ---- caustics ----
uniform sampler2D caustics_texture : filter_linear_mipmap, repeat_enable;
uniform float caustics_scale : hint_range(0.1, 10.0, 0.1) = 1.6;
uniform float caustics_speed : hint_range(0.0, 1.0, 0.01) = 0.12;
uniform float caustics_intensity : hint_range(0.0, 2.0, 0.1) = 0.55;
uniform float caustics_depth_fade : hint_range(0.0, 1.0, 0.01) = 0.5;

// ---- foam ----
uniform vec3 foam_color : source_color = vec3(0.96, 0.98, 1.0);
uniform float foam_depth_start : hint_range(0.0, 5.0, 0.01) = 1.4;
uniform float foam_depth_end : hint_range(0.0, 5.0, 0.01) = 0.0;
uniform float foam_noise_scale : hint_range(0.0, 10.0, 0.01) = 1.8;
uniform float foam_noise_speed : hint_range(0.0, 2.0, 0.01) = 0.8;
uniform float foam_cutoff : hint_range(0.0, 1.0, 0.01) = 0.65;
uniform float foam_crest_threshold : hint_range(0.0, 1.0, 0.01) = 0.7;
uniform float foam_crest_amount : hint_range(0.0, 10.0, 0.1) = 2.0;
uniform vec3 foam_edge_color : source_color = vec3(0.02, 0.05, 0.10);
uniform vec2 foam_edge_offset = vec2(0.03, 0.03);
uniform float voronoi_scale : hint_range(0.0, 50.0) = 9.0;
uniform float voronoi_strength : hint_range(0.0, 8.0) = 0.8;

// ---- hash / noise helpers ----

float hash12(vec2 p)
{
	uvec2 q = uvec2(ivec2(p)) * uvec2(1597334677u, 3812015801u);
	uint n = (q.x ^ q.y) * 1597334677u;
	return float(n) * (1.0 / 4294967295.0);
}

float noise(in vec2 p)
{
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return -1.0 + 2.0 * mix(
		mix(hash12(i + vec2(0.0, 0.0)), hash12(i + vec2(1.0, 0.0)), u.x),
		mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

float sea_octave(vec2 uv, float choppy)
{
	uv += noise(uv);
	vec2 wv = 1.0 - abs(sin(uv));
	vec2 swv = abs(cos(uv));
	wv = mix(wv, swv, wv);
	return pow(1.0 - pow(wv.x * wv.y, 0.65), choppy);
}

// Signed distance to the sea surface: 0 at the water line, positive above, negative below.
float map(vec3 p, float time)
{
	float freq = sea_freq;
	float amp = sea_height;
	float choppy = sea_choppy;
	vec2 uv = p.xz;
	uv.x *= 0.75;
	float h = 0.0;
	for (int i = 0; i < ITER_GEOMETRY; i++)
	{
		float d = sea_octave((uv + time * sea_speed) * freq, choppy);
		d += sea_octave((uv - time * sea_speed) * freq, choppy);
		h += d * amp;
		uv *= octave_m;
		freq *= 1.9;
		amp *= 0.22;
		choppy = mix(choppy, 1.0, 0.2);
	}
	return p.y - h;
}

float map_detailed(vec3 p, float time)
{
	float freq = sea_freq;
	float amp = sea_height;
	float choppy = sea_choppy;
	vec2 uv = p.xz;
	uv.x *= 0.75;
	float h = 0.0;
	for (int i = 0; i < ITER_FRAGMENT; i++)
	{
		float d = sea_octave((uv + time * sea_speed) * freq, choppy);
		d += sea_octave((uv - time * sea_speed) * freq, choppy);
		h += d * amp;
		uv *= octave_m;
		freq *= 1.9;
		amp *= 0.22;
		choppy = mix(choppy, 1.0, 0.2);
	}
	return p.y - h;
}

vec3 get_normal_detailed(vec3 p, float eps, float time)
{
	vec3 n;
	n.y = map_detailed(p, time);
	n.x = map_detailed(vec3(p.x + eps, p.y, p.z), time) - n.y;
	n.z = map_detailed(vec3(p.x, p.y, p.z + eps), time) - n.y;
	n.y = eps;
	return normalize(n);
}

// ---- vertex: displace the surface and carry world position + coarse normal ----

varying vec3 world_vert;
varying float wave_height;
varying vec3 vertex_normal_world;

void vertex()
{
	vec3 world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wave_height = -map(world_pos, TIME);
	VERTEX.y = wave_height;
	world_vert = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;

	float vertex_eps = 0.1;
	float h_center = wave_height;
	float h_x = -map(world_pos + vec3(vertex_eps, 0.0, 0.0), TIME);
	float h_z = -map(world_pos + vec3(0.0, 0.0, vertex_eps), TIME);
	vec3 n_geom = normalize(vec3(h_center - h_x, vertex_eps, h_center - h_z));
	vertex_normal_world = n_geom;
}

// ---- fragment: depth thickness, refraction, absorption, caustics, foam ----

float get_linear_depth(sampler2D d_tex, vec2 uv, mat4 inv_proj)
{
	float depth = texture(d_tex, uv).x;
	vec3 ndc = vec3(uv * 2.0 - 1.0, depth);
#if CURRENT_RENDERER == RENDERER_COMPATIBILITY
	ndc.z = depth * 2.0 - 1.0;
#endif
	vec4 view = inv_proj * vec4(ndc, 1.0);
	return -view.z / view.w;
}

float hash13(vec3 p)
{
	uvec3 q = uvec3(ivec3(p)) * uvec3(1597334677u, 3812015801u, 2798796415u);
	uint n = (q.x ^ q.y ^ q.z) * 1597334677u;
	return float(n) * (1.0 / 4294967295.0);
}

float hash3d(vec3 p)
{
	return hash13(p);
}

vec2 hash22(vec2 p)
{
	vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.xx + p3.yz) * p3.zy);
}

// 2D voronoi distance field, animated in time: the foam clumps.
float voronoi(vec2 uv)
{
	vec2 n = floor(uv);
	vec2 f = fract(uv);
	float m_dist = 1.0;
	for (int j = -1; j <= 1; j++)
	{
		for (int i = -1; i <= 1; i++)
		{
			vec2 g = vec2(float(i), float(j));
			vec2 o = hash22(n + g);
			o = 0.5 + 0.5 * sin(TIME * foam_noise_speed + 6.2831 * o);
			vec2 r = g - f + o;
			float d = dot(r, r);
			m_dist = min(m_dist, d);
		}
	}
	return m_dist;
}

float noise3d(in vec3 p)
{
	vec3 i = floor(p);
	vec3 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(
			mix(hash3d(i + vec3(0.0, 0.0, 0.0)), hash3d(i + vec3(1.0, 0.0, 0.0)), f.x),
			mix(hash3d(i + vec3(0.0, 1.0, 0.0)), hash3d(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
		mix(
			mix(hash3d(i + vec3(0.0, 0.0, 1.0)), hash3d(i + vec3(1.0, 0.0, 1.0)), f.x),
			mix(hash3d(i + vec3(0.0, 1.0, 1.0)), hash3d(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}

float fbm_voronoi(vec2 uv)
{
	float v = 0.0;
	float a = 0.5;
	vec2 shift = vec2(100.0);
	mat2 rot = mat2(vec2(cos(0.5), sin(0.5)), vec2(-sin(0.5), cos(0.5)));
	for (int i = 0; i < 3; i++)
	{
		float val = 1.0 - voronoi(uv);
		val = pow(val, 2.0);
		v += a * val;
		uv = rot * uv * 2.0 + shift;
		a *= 0.5;
	}
	return v;
}

void fragment()
{
	// world distance to the camera, used to smooth far-away normals (kills shimmer)
	float dist_to_cam = length(VERTEX);

	// detailed normals with an LOD epsilon: farther pixels sample a larger step
	float lod_epsilon = max(normal_epsilon, dist_to_cam * 0.005);
	vec3 detailed_normal = get_normal_detailed(world_vert, lod_epsilon, TIME);
	float smooth_factor = clamp((dist_to_cam - normal_smoothness_dist) / 200.0, 0.0, 1.0);
	vec3 final_normal = mix(detailed_normal, vertex_normal_world, smooth_factor);
	NORMAL = (VIEW_MATRIX * vec4(final_normal, 0.0)).xyz;

	// water thickness = distance from the surface to the opaque scene behind it
	float water_linear_depth = -VERTEX.z;
	float bg_linear_depth = get_linear_depth(DEPTH_TEXTURE, SCREEN_UV, INV_PROJECTION_MATRIX);
	float thickness = max(0.0, bg_linear_depth - water_linear_depth);

	// refraction: distort the screen UV along the normal, scaled by distance + depth
	vec3 view_vertex_normal = (VIEW_MATRIX * vec4(vertex_normal_world, 0.0)).xyz;
	vec2 normal_offset = NORMAL.xy - view_vertex_normal.xy;
	float ref_dist_factor = clamp(refraction_distance_fade / max(0.1, dist_to_cam), 0.0, 1.0);
	float ref_depth_mask = smoothstep(0.0, max_depth, thickness);
	vec2 refraction_offset = normal_offset * refraction_strength * ref_dist_factor * ref_depth_mask * 0.05;

	vec2 distorted_uv = SCREEN_UV + refraction_offset;

	// guard against ghosting right at the water edge: pixels above the line sample straight
	float distorted_bg_depth = get_linear_depth(DEPTH_TEXTURE, distorted_uv, INV_PROJECTION_MATRIX);
	if (distorted_bg_depth < water_linear_depth - 0.001)
	{
		distorted_uv = SCREEN_UV;
		distorted_bg_depth = bg_linear_depth;
	}

	vec3 screen_color = texture(SCREEN_TEXTURE, distorted_uv).rgb;
	thickness = max(0.0, distorted_bg_depth - water_linear_depth);

	float fade_range = max(0.001, max_depth - fade_start_depth);
	float depth_ratio = clamp((thickness - fade_start_depth) / fade_range, 0.0, 1.0);

	// caustics: project an animated pattern onto the seabed position, fading with depth
	vec4 bg_ndc = vec4(distorted_uv * 2.0 - 1.0, texture(DEPTH_TEXTURE, distorted_uv).x, 1.0);
#if CURRENT_RENDERER == RENDERER_COMPATIBILITY
	bg_ndc.z = bg_ndc.z * 2.0 - 1.0;
#endif
	vec4 bg_world = INV_VIEW_MATRIX * INV_PROJECTION_MATRIX * bg_ndc;
	vec3 bg_world_pos = bg_world.xyz / bg_world.w;
	if (thickness > 0.0)
	{
		vec2 caustics_uv1 = bg_world_pos.xz * caustics_scale;
		caustics_uv1.x += TIME * caustics_speed;
		vec2 caustics_uv2 = bg_world_pos.xz * caustics_scale * 0.7;
		caustics_uv2.y -= TIME * caustics_speed * 0.8;
		float caustics_sample1 = texture(caustics_texture, caustics_uv1).r;
		float caustics_sample2 = texture(caustics_texture, caustics_uv2).r;
		float caustics_value = caustics_sample1 * caustics_sample2;
		float caustics_fade = 1.0 - clamp(thickness * caustics_depth_fade, 0.0, 1.0);
		screen_color += caustics_value * caustics_intensity * caustics_fade;
	}

	// Beer–Lambert absorption: red goes first, water shifts blue-green with depth
	vec3 transmittance = exp(-thickness * water_absorption);
	vec3 water_volume_color = mix(base_tint_color, deep_color, depth_ratio);
	vec3 apparent_seabed_color = screen_color * water_volume_color;
	ALBEDO = mix(underwater_fog_color, apparent_seabed_color, transmittance);

	// ---- foam ----
	float foam_mask_primary = 0.0;
	float foam_mask_shadow = 0.0;

	// coastline + crest density: 1.0 at shore/crests, 0.0 in open water
	float depth_foam_factor = smoothstep(foam_depth_start, foam_depth_end, thickness);
	float wave_crest_factor = smoothstep(foam_crest_threshold, foam_crest_threshold - 0.1, final_normal.y);
	wave_crest_factor *= foam_crest_amount;
	float foam_level = clamp(depth_foam_factor + wave_crest_factor, 0.0, 1.0);

	// domain warp gives the foam flowing, current-driven motion
	vec2 flow_uv = world_vert.xz * 0.5 + TIME * 0.05 * foam_noise_speed;
	vec2 warp = vec2(noise(flow_uv), noise(flow_uv + vec2(5.2, 1.3))) * 0.5;

	if (distorted_bg_depth > water_linear_depth)
	{
		vec2 foam_uv = world_vert.xz * foam_noise_scale + warp;

		// 3D noise pulses and clumps the foam instead of covering the shore uniformly
		float emergence_noise = noise3d(vec3(world_vert.xz * 0.5, TIME * 0.2 * foam_noise_speed));
		emergence_noise = smoothstep(0.0, 1.0, emergence_noise * 0.5 + 0.5);
		float effective_emergence = mix(emergence_noise, 1.0, foam_level);

		float foam_noise_val = fbm_voronoi(foam_uv);
		foam_noise_val *= effective_emergence;

		// a second sample slightly offset casts a soft shadow, faking foam thickness
		vec2 foam_uv_shadow = (world_vert.xz + foam_edge_offset) * foam_noise_scale + warp;
		float foam_noise_shadow_val = fbm_voronoi(foam_uv_shadow);
		foam_noise_shadow_val *= effective_emergence;

		float combined_noise = foam_noise_val + foam_level;
		float combined_shadow = foam_noise_shadow_val + foam_level;

		foam_mask_primary = smoothstep(foam_cutoff + 0.5, foam_cutoff + 0.6, combined_noise);
		float shadow_shape = smoothstep(foam_cutoff + 0.5, foam_cutoff + 0.6, combined_shadow);
		foam_mask_shadow = clamp(shadow_shape - foam_mask_primary, 0.0, 1.0);
	}

	// internal voronoi bubbles inside the foam for extra richness
	float voronoi_val = 1.0 - sqrt(voronoi(world_vert.xz * voronoi_scale + warp));
	voronoi_val = smoothstep(0.2, 0.8, voronoi_val);
	float bubble_alpha = 1.0 - clamp((1.0 - voronoi_val) * voronoi_strength, 0.0, 1.0);

	ALBEDO = mix(ALBEDO, foam_edge_color, foam_mask_shadow);
	ALBEDO = mix(ALBEDO, foam_color, foam_mask_primary * bubble_alpha);

	ROUGHNESS = mix(roughness, 0.8, (foam_mask_primary * bubble_alpha) + foam_mask_shadow);
	SPECULAR = specular;
	METALLIC = metallic;
}