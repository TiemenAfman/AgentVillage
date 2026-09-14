// Storybook sea surface (Phase 2 step 12): the colour depth-fades from warm turquoise
// shallows near the coast to deep navy blue offshore, and a steadily pulsing foam line
// hugs every shoreline. Water never writes depth, so the seabed behind it stays readable
// through the alpha; the faint Fresnel fold pushes far water towards the sky tone so the
// horizon melts into the sea.
shader_type spatial;
render_mode blend_mix, depth_draw_never, cull_back, specular_disabled;

uniform sampler2D depth_tex : hint_depth_texture, filter_linear;

uniform vec3 shallow_color : source_color = vec3(0.22, 0.72, 0.68);
uniform vec3 deep_color : source_color = vec3(0.04, 0.12, 0.28);
uniform vec3 foam_color : source_color = vec3(0.96, 0.98, 1.00);
uniform float shallow_alpha : hint_range(0.0, 1.0) = 0.82;
uniform float deep_alpha : hint_range(0.0, 1.0) = 0.95;
uniform float depth_max : hint_range(0.5, 8.0) = 2.6;
uniform float foam_depth : hint_range(0.0, 2.0) = 0.30;
uniform float foam_fade : hint_range(0.05, 1.5) = 0.22;
uniform float foam_pulse_speed : hint_range(0.0, 3.0) = 1.1;
uniform float foam_pulse : hint_range(0.0, 0.5) = 0.05;
uniform float sparkle_strength : hint_range(0.0, 1.0) = 0.12;

// Cheap directional shimmer so the surface reads as moving water without vertex waves.
float glimmer(float seed)
{
	float a = sin(seed * 1.7 + TIME * 0.9);
	float b = sin(seed * 3.1 - TIME * 1.3);
	return (a * b) * 0.5 + 0.5;
}

void fragment()
{
	// Reconstruct the camera-space distance of the opaque scene behind this pixel (the
	// seabed). The water surface itself is at VERTEX.z in view space (negative = in front).
	float raw_depth = texture(depth_tex, SCREEN_UV).r;
	vec3 ndc = vec3(SCREEN_UV * 2.0 - 1.0, raw_depth * 2.0 - 1.0);
	vec4 scene_view = INV_PROJECTION_MATRIX * vec4(ndc, 1.0);
	float scene_dist = -scene_view.z / scene_view.w;
	float surface_dist = -VERTEX.z;

	float water_line = clamp(scene_dist - surface_dist, 0.0, depth_max);
	float t = water_line / depth_max;

	vec3 col = mix(shallow_color, deep_color, t);
	float alpha = mix(shallow_alpha, deep_alpha, t);

	// Shore foam: a tight band on the coast that gently breathes in and out.
	float pulse = 1.0 + foam_pulse * sin(TIME * foam_pulse_speed);
	float foam = 1.0 - smoothstep(foam_depth * pulse, foam_depth * pulse + foam_fade, water_line);
	col = mix(col, foam_color, foam * 0.85);
	alpha = max(alpha, foam * 0.9);

	// Fresnel: water seen at a glancing angle reads as the sky, drawing the horizon together.
	float fresnel = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 3.0);
	col = mix(col, vec3(0.78, 0.88, 0.98), fresnel * 0.35);

	// Subtle sunlit sparkle.
	col += vec3(0.92, 0.97, 1.0) * glimmer(SCREEN_UV.x * 397.0 + SCREEN_UV.y * 241.0) * sparkle_strength;

	ALBEDO = col;
	ALPHA = alpha;
	ROUGHNESS = 0.15;
	METALLIC = 0.0;
}