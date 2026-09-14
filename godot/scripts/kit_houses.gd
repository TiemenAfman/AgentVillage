# House-building logic: roof styles per tier, foundation, timber frames, windows,
# and ornaments.  Receives a PmKitPrimitives reference via _init.
class_name PmKitHouses
extends RefCounted

var kit: PmKitPrimitives

func _init(p_kit: PmKitPrimitives) -> void:
	kit = p_kit

# ---------------------------------------------------------------- windows & structure
func _windows_on(pal: Dictionary, w: float, y0: float, count: int) -> void:
	var hw := w * 0.5 + 0.005
	var spots := [
		{ "x": -w * 0.22, "z": hw, "ry": 0.0 }, { "x": w * 0.22, "z": hw, "ry": 0.0 },
		{ "x": hw, "z": 0.0, "ry": PI * 0.5 }, { "x": -hw, "z": 0.0, "ry": PI * 0.5 },
		{ "x": -w * 0.22, "z": -hw, "ry": 0.0 }, { "x": w * 0.22, "z": -hw, "ry": 0.0 },
	]
	for i in mini(count, spots.size()):
		var s: Dictionary = spots[i]
		kit._box(0.13, 0.17, 0.04, int(pal.get("glow", 0xffffff)),
			{ "x": s.x, "y": y0, "z": s.z, "ry": s.ry, "emissive": 1 })

func _foundation(w: float, d: float) -> void:
	kit._box(w + 0.12, 0.34, d + 0.12, int(kit.C["foundation"]), { "y": -0.3 })

# ---------------------------------------------------------------- house body
func build(spec: Dictionary, pal: Dictionary) -> Dictionary:
	var tier := int(kit.TIER_INDEX.get(str(spec.get("tier", "house")), 1))
	var style := str(spec.get("style", "unknown"))
	var anchors := {}
	var roof_hex := int(pal.get("roof", 0x6f6f6f))
	var wall_hex := int(pal.get("wall", 0x9a9a9a))
	var trim_hex := int(pal.get("trim", 0x6f6f6f))
	var glow_hex := int(pal.get("glow", 0xffffff))
	var accent_hex := int(pal.get("accent", 0x555555))

	if tier == 0:   # tent
		kit._gable(0.8, 0.86, 0.58, int(kit.C["canvas"]))
		kit._box(0.045, 0.64, 0.045, int(kit.C["darkWood"]), { "z": -0.41 })
		kit._box(0.3, 0.025, 0.035, trim_hex, { "y": 0.24, "z": 0.44 })
		return { "anchors": anchors, "height": 0.62, "w": 0.84 }

	var dims: Dictionary = {
		1: { "w": 0.88, "h": 0.56, "roof": 0.4, "win": 2 },
		2: { "w": 1.0, "h": 0.68, "roof": 0.46, "win": 3 },
		3: { "w": 1.08, "h": 0.98, "roof": 0.5, "win": 4 },
		4: { "w": 1.14, "h": 1.12, "roof": 0.52, "win": 5 },
		5: { "w": 1.18, "h": 1.42, "roof": 0.44, "win": 6 },
	}[maxi(tier, 1)]
	var w: float = dims["w"]
	var h: float = dims["h"]
	var roof_h: float = dims["roof"]

	kit._box(w, h, w, wall_hex)
	_foundation(w, w)
	kit._box(0.16, 0.26, 0.05, accent_hex, { "z": w * 0.5 + 0.01 })
	_windows_on(pal, w, h * 0.42, int(dims["win"]))
	if tier >= 3:
		_windows_on(pal, w, h * 0.12, 2)

	var top := h
	if style == "opus":
		kit._box(w + 0.06, 0.13, w + 0.06, int(kit.C["stone"]))
		kit._pyramid(w + 0.14, w + 0.14, roof_h + 0.06, roof_hex, { "y": top })
		top += roof_h + 0.06
	elif style == "haiku":
		kit._cone(w * 0.82, roof_h + 0.16, 8, roof_hex, { "y": top - 0.02 })
		top += roof_h + 0.14
	elif style == "sonnet":
		kit._timber_frame(w, h, w, trim_hex)
		kit._gable(w + 0.14, w + 0.14, roof_h, roof_hex, { "y": top })
		top += roof_h
	else:
		kit._gable(w + 0.12, w + 0.12, roof_h, roof_hex, { "y": top })
		top += roof_h

	if tier >= 2:
		kit._box(0.12, 0.3, 0.12, int(kit.C["brick"]), { "x": w * 0.3, "y": h, "z": -w * 0.3 })
	if tier == 3:    # dormer
		kit._box(0.24, 0.2, 0.22, wall_hex, { "y": h + 0.04, "z": w * 0.25 })
		kit._gable(0.28, 0.26, 0.14, roof_hex, { "y": h + 0.24, "z": w * 0.25 })
		kit._box(0.1, 0.1, 0.03, glow_hex, { "y": h + 0.1, "z": w * 0.25 + 0.12, "emissive": 1 })
	if tier >= 4:    # wing and its garden fence
		kit._box(0.44, h * 0.72, 0.5, wall_hex, { "x": w * 0.62, "z": -0.1 })
		kit._gable(0.52, 0.58, 0.28, roof_hex, { "x": w * 0.62, "y": h * 0.72, "z": -0.1, "ry": PI * 0.5 })
		for i in 4:
			kit._box(0.04, 0.18, 0.04, int(kit.C["darkWood"]), { "x": -0.42 + i * 0.28, "z": 0.62 })
		kit._box(0.92, 0.03, 0.03, int(kit.C["darkWood"]), { "x": -0.28, "y": 0.13, "z": 0.62 })
	if tier == 5:    # keep: a corner tower and battlements
		kit._cyl(0.2, 0.22, h + 0.4, 8, wall_hex, { "x": -w * 0.42, "z": -w * 0.42 })
		kit._cone(0.26, 0.32, 8, roof_hex, { "x": -w * 0.42, "y": h + 0.4, "z": -w * 0.42 })
		for i in 8:
			var ang := i / 8.0 * TAU
			kit._box(0.1, 0.1, 0.1, wall_hex,
				{ "x": cos(ang) * w * 0.42, "y": h, "z": sin(ang) * w * 0.42 })
		anchors["flag"] = [0.0, top + 0.34, 0.0]
		kit._box(0.025, 0.4, 0.025, int(kit.C["darkWood"]), { "y": top })

	# Fable builds upward: an observatory tower with a copper dome and a telescope.
	if style == "fable" and tier >= 2:
		var tx := -w * 0.36
		var tz := -w * 0.36
		var th := h + 0.45 + tier * 0.06
		kit._cyl(0.21, 0.23, th, 9, wall_hex, { "x": tx, "z": tz })
		kit._dome(0.25, accent_hex, { "x": tx, "y": th, "z": tz })
		kit._cone(0.05, 0.24, 6, int(kit.C["copper"]), { "x": tx, "y": th + 0.2, "z": tz })
		kit._box(0.09, 0.12, 0.03, glow_hex, { "x": tx, "y": th - 0.28, "z": tz + 0.22, "emissive": 1 })
		kit._cyl(0.028, 0.04, 0.3, 6, int(kit.C["copper"]), { "rz": -0.6, "x": tx + 0.2, "y": th + 0.12, "z": tz + 0.06 })
		top = maxf(top, th + 0.42)
	return { "anchors": anchors, "height": top, "w": w }

# ---------------------------------------------------------------- ornaments
func ornament(name: String, pal: Dictionary, dims: Dictionary, anchors: Dictionary) -> void:
	var w := float(dims.get("w", 1.0))
	var height := float(dims.get("height", 1.0))
	var tent := int(dims.get("tier", 0)) == 0
	match name:
		"forge":
			if tent:
				kit._cyl(0.1, 0.13, 0.14, 7, int(kit.C["brick"]), { "x": -0.46, "z": -0.4 })
				kit._cyl(0.09, 0.09, 0.03, 7, 0x3a2a22, { "x": -0.46, "y": 0.14, "z": -0.4 })
				anchors["smoke"] = [-0.46, 0.2, -0.4]
			else:
				kit._box(0.15, 0.5, 0.15, int(kit.C["brick"]), { "x": -w * 0.34, "y": height * 0.55, "z": -w * 0.34 })
				anchors["smoke"] = [-w * 0.34, height * 0.55 + 0.5, -w * 0.34]
		"lumber":
			var s := 0.72 if tent else 1.0
			for i in 3:
				kit._box(0.3 * s, 0.055, 0.1 * s, int(kit.C["plank"]),
					{ "x": 0.44, "y": 0.02 + i * 0.06, "z": 0.42 - i * 0.02, "ry": 0.2 })
			kit._box(0.028, 0.17, 0.028, int(kit.C["darkWood"]), { "x": 0.34, "z": 0.62, "rz": 0.32 })
			kit._box(0.028, 0.17, 0.028, int(kit.C["darkWood"]), { "x": 0.55, "z": 0.62, "rz": -0.32 })
			kit._box(0.24, 0.025, 0.025, int(kit.C["darkWood"]), { "x": 0.445, "y": 0.16, "z": 0.62 })
		"lantern":
			kit._cyl(0.02, 0.025, 0.5, 5, int(kit.C["darkWood"]), { "x": -0.46, "z": 0.46 })
			kit._box(0.1, 0.12, 0.1, 0xffb347, { "x": -0.46, "y": 0.5, "z": 0.46, "emissive": 1 })
			kit._box(0.13, 0.02, 0.13, int(kit.C["iron"]), { "x": -0.46, "y": 0.62, "z": 0.46 })
		"weathervane":
			if tent:
				kit._quad([[0.0, 0.5, -0.34], [0.0, 0.62, -0.34], [0.26, 0.55, -0.34]], int(pal.get("trim", 0x6f6f6f)))
			else:
				var y := height + 0.04
				kit._cyl(0.012, 0.012, 0.26, 4, int(kit.C["iron"]), { "y": y })
				kit._box(0.2, 0.02, 0.02, int(kit.C["iron"]), { "y": y + 0.24 })
				kit._quad([[0.02, y + 0.16, 0], [0.02, y + 0.31, 0], [0.13, y + 0.235, 0]], int(kit.C["copper"]))
		"pigeons":
			var base := 0.0 if tent else height - 0.05
			var px := 0.46 if tent else w * 0.26
			var pz := 0.3 if tent else w * 0.2
			kit._cyl(0.02, 0.024, 0.6 if tent else 0.3, 4, int(kit.C["darkWood"]), { "x": px, "y": base, "z": pz })
			var loft_y := base + (0.6 if tent else 0.3)
			kit._box(0.19, 0.15, 0.15, int(kit.C["wood"]), { "x": px, "y": loft_y, "z": pz })
			kit._box(0.05, 0.05, 0.02, 0x2b2b2b, { "x": px, "y": loft_y + 0.05, "z": pz + 0.08 })
			kit._sphere(0.035, 0xf4f4f4, { "x": px + 0.11, "y": loft_y + 0.19, "z": pz })
		"banner":
			var y := 0.42 if tent else height - 0.04
			kit._box(0.022, 0.34, 0.022, int(kit.C["darkWood"]), { "x": w * 0.36, "y": y, "z": w * 0.3 })
			anchors["flag"] = [w * 0.36, y + 0.34, w * 0.3]
		"lightningrod":
			var y := 0.4 if tent else height
			kit._cyl(0.012, 0.012, 0.42, 4, int(kit.C["iron"]), { "x": -w * 0.3, "y": y })
			kit._sphere(0.028, int(kit.C["copper"]), { "x": -w * 0.3, "y": y + 0.44 })
