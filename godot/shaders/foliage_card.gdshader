// Texture cards: the ground cover and the grass blades.
//
// Terrain3D generates the geometry (Terrain3DMeshAsset.TYPE_TEXTURE_CARD - two quads in a cross,
// four triangles, base at local y = -0.5) and this decides what it looks like. The silhouette is
// cut rather than blended: a scissor keeps the cards in the opaque pass, so there is no sorting to
// get wrong and a blade still casts a real shadow.
//
// skip_vertex_transform, copied from the addon's own grass shader, because the wind has to be
// applied in world space - a gust travels across the island, and applying it in model space would
// give every instance its own direction. The cost is that VERTEX, NORMAL, BINORMAL and TANGENT all
// have to be carried to view space by hand; forget one and the lighting quietly goes wrong rather
// than failing.

shader_type spatial;
render_mode skip_vertex_transform, cull_disabled, blend_mix;

#include "res://shaders/foliage_wind.gdshaderinc"

/// Deliberately *not* hinted `source_color`, which is the hint a texture carrying a colour wants.
///
/// This one carries a modulation: CardTexture paints values around 1.0 - shaded at the root, lit at
/// the tip - that multiply the instance's tint. `source_color` makes Godot decode the texture from
/// sRGB, which turns an authored 0.55 into 0.26 and an authored 1.0 into 1.0. The plant is then not
/// only darker overall but far more contrasty down its own length than it was painted, so the tips
/// glare white and the roots go to mud - measured on the street shot as grass at RGB 91/129/90
/// against a meadow at 111/174/101. Sampled raw, the numbers mean what CardTexture wrote.
uniform sampler2D card_tex : filter_linear_mipmap, hint_default_transparent;

/// Well below half, and that is the mipmaps' doing: a blade is a few pixels wide, every mip level
/// averages it with the transparent gap beside it, and at 0.5 the grass thins out and then
/// vanishes as it recedes. Low enough to keep the blade, high enough not to grow a halo.
uniform float alpha_cut : hint_range(0.0, 1.0) = 0.33;

/// How far the card's normal is bent towards straight up.
///
/// A quad's own normal points out of its face, so a cross of two quads lights as two flat boards:
/// one bright, one dark, with a hard seam between them, which from a distance reads as flickering
/// litter. Pulling the normal towards up makes a tuft shade like the ground it stands on - the
/// same reason a hedge in a painting is one value and not fifty.
uniform float normal_up : hint_range(0.0, 1.0) = 0.30;

/// The per-instance colour, named rather than read straight out of COLOR in the fragment stage.
///
/// COLOR does carry it - Godot multiplies a MultiMesh's instance colour into COLOR in the vertex
/// stage and it interpolates through - and the first version of this shader read it in fragment
/// and worked. It is spelled out here because it did not look like it worked: the grass came out
/// pale and the obvious suspect was the colour never arriving, when the real cause was the card's
/// near-white tips plus a heavy BACKLIGHT washing the tint out. Naming the value is what let the
/// next question be asked of the right thing.
varying vec4 instance_tint;

void vertex() {
	instance_tint = COLOR;

	// UV.v is 1 at the bottom of the card and 0 at the top, so this is height above the root.
	// Squared: the root is pinned and the tip travels.
	float bend = clamp(1.0 - UV.y, 0.0, 1.0);
	bend *= bend;

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
	vec4 card = texture(card_tex, UV);
	// The card carries no colour of its own - it modulates around 1.0 - and COLOR is what the
	// spawner wrote per instance: the biome's own green from Palette.Terrain, with the accents
	// deviating from it. See CardTexture for why the two are kept apart.
	ALBEDO = card.rgb * instance_tint.rgb;
	ALPHA = card.a;
	ALPHA_SCISSOR_THRESHOLD = alpha_cut;

	ROUGHNESS = 1.0;
	SPECULAR = 0.0;
	// Grass is thin enough to light through, and without this the side away from the sun is a
	// silhouette rather than a colour. Tinted by the plant, not grey - light coming through a
	// leaf is the colour of the leaf. Grey was tried and it is a hue shift in disguise: an equal
	// amount added to all three channels lifts the smallest one furthest, and on a green with
	// very little blue in it that is a slide towards turquoise. Measured on a bush at noon, grey
	// backlight put it at RGB 139/193/150 beside a meadow at 140/189/112 - the same brightness,
	// 38 points more blue, which is exactly what reads as a plastic shrub.
	BACKLIGHT = instance_tint.rgb * 0.34;
}
