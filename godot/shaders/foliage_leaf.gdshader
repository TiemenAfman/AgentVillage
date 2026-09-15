// Ferns and bushes: real geometry rather than a card, and therefore no cut-out.
//
// Same wind, same normal-bending, no texture. That last part is the art direction and not a
// shortcut: a fern frond here is eight triangles with its shape actually in the geometry, so
// there is nothing for an alpha channel to add, and flat colour over faceted geometry is what
// RockMesh already does for stone. The grain that a card gets from its painting, these get from
// the facets catching the light at different angles.

shader_type spatial;
render_mode skip_vertex_transform, cull_disabled, blend_mix;

#include "res://shaders/foliage_wind.gdshaderinc"

/// How far the mesh normal is bent towards straight up; see foliage_card.gdshader.
/// Lower here than on the cards: a bush has a real, readable shape and flattening it away would
/// throw out the one thing that separates it from a green ball.
uniform float normal_up : hint_range(0.0, 1.0) = 0.60;

/// How much darker the underside of a plant is than its crown. Ambient occlusion by assertion -
/// cheaper than the real thing and, at this size, indistinguishable from it.
uniform float root_shade : hint_range(0.0, 1.0) = 0.26;

varying float shade;

/// The per-instance colour; named for the reason foliage_card.gdshader spells out.
varying vec4 instance_tint;

void vertex() {
	instance_tint = COLOR;
	float bend = clamp(1.0 - UV.y, 0.0, 1.0);
	bend *= bend;
	shade = mix(1.0 - root_shade, 1.0, clamp(1.0 - UV.y, 0.0, 1.0));

	vec3 w_vertex = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	w_vertex += pm_wind_offset(w_vertex, bend);
	VERTEX = (VIEW_MATRIX * vec4(w_vertex, 1.0)).xyz;

	vec3 n = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	n = normalize(mix(n, vec3(0.0, 1.0, 0.0), normal_up));
	NORMAL = (VIEW_MATRIX * vec4(n, 0.0)).xyz;
	BINORMAL = MODELVIEW_NORMAL_MATRIX * BINORMAL;
	TANGENT = MODELVIEW_NORMAL_MATRIX * TANGENT;
}

void fragment() {
	ALBEDO = instance_tint.rgb * shade;
	ROUGHNESS = 1.0;
	SPECULAR = 0.0;
	// Tinted by the plant; see foliage_card.gdshader for what grey costs.
	BACKLIGHT = instance_tint.rgb * 0.30;
}
