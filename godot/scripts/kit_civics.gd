# Civic buildings: town hall, well, market, clock tower, statue, lamp, planter, bench,
# terrace, fountain, tavern, chapel, tables, school, windmill, lighthouse, castle,
# board, issues, office, polder mill.  Receives a PmKitPrimitives reference via _init.
class_name PmKitCivics
extends RefCounted

var kit: PmKitPrimitives

func _init(p_kit: PmKitPrimitives) -> void:
	kit = p_kit

# Two boards stand on the square: the sprint board is cork under a plank roof, the
# island's own board is slate in an iron frame under copper, so they can be told apart
# across the green by every bit of paint they carry.
func _notice_board(spec: Dictionary, opts: Dictionary) -> float:
	var w := 1.7
	var h := 1.0
	var frame_hex := int(opts["frame"])
	var panel_hex := int(opts["panel"])
	var roof_hex := int(opts["roof"])
	var sign_hex := int(opts["sign"])
	var note_hex := int(opts["note"])
	var pins: Array = opts["pins"]
	kit._cyl(0.06, 0.07, 1.05, 6, frame_hex, { "x": -w * 0.5 + 0.08 })
	kit._cyl(0.06, 0.07, 1.05, 6, frame_hex, { "x": w * 0.5 - 0.08 })
	kit._box(w, h, 0.06, panel_hex, { "y": 0.62, "z": 0.02 })
	kit._box(w + 0.1, 0.07, 0.1, frame_hex, { "y": 0.58, "z": 0.02 })
	kit._box(w + 0.1, 0.07, 0.1, frame_hex, { "y": 1.62, "z": 0.02 })
	kit._box(0.07, h + 0.14, 0.1, frame_hex, { "x": -w * 0.5 - 0.02, "y": 0.58, "z": 0.02 })
	kit._box(0.07, h + 0.14, 0.1, frame_hex, { "x": w * 0.5 + 0.02, "y": 0.58, "z": 0.02 })
	kit._gable(w + 0.34, 0.44, 0.22, roof_hex, { "y": 1.69, "z": 0.02 })
	kit._box(0.62, 0.16, 0.03, sign_hex, { "y": 1.72, "z": 0.2 })
	var cards := clampi(int(spec.get("cards", 6)), 1, 12)
	for i in cards:
		var col := i % 4
		var row := i / 4
		var x := -0.6 + col * 0.4
		var y := 1.34 - row * 0.31
		var tilt := ((i * 37) % 13 - 6) * 0.012
		kit._box(0.3, 0.23, 0.012, note_hex, { "x": x, "y": y, "z": 0.06, "rz": tilt })
		kit._box(0.19, 0.018, 0.014, 0xb9b2a4, { "x": x - 0.03, "y": y + 0.06, "z": 0.068, "rz": tilt })
		kit._box(0.13, 0.018, 0.014, 0xb9b2a4, { "x": x - 0.06, "y": y + 0.02, "z": 0.068, "rz": tilt })
		kit._sphere(0.024, int(pins[i % pins.size()]), { "x": x, "y": y + 0.1, "z": 0.078 })
	return 2.1

func build(spec: Dictionary, rng: PmRng) -> Dictionary:
	var t := str(spec.get("civicType", ""))
	var anchors := {}
	match t:
		"townhall":
			kit._box(1.5, 0.75, 1.15, int(kit.C["stone"]))
			kit._box(1.34, 0.5, 1.02, 0xf0e2c8, { "y": 0.75 })
			kit._timber_frame(1.34, 0.5, 1.02, 0x6b4a2f)
			kit._gable(1.55, 1.2, 0.5, int(kit.C["slate"]), { "y": 1.25 })
			for i in 4:
				kit._box(0.14, 0.2, 0.04, int(kit.C["glass"]), { "x": -0.5 + i * 0.34, "y": 0.32, "z": 0.58, "emissive": 1 })
			kit._box(0.3, 0.45, 0.06, 0x5a3a24, { "z": 0.58 })
			for i in 3:
				kit._box(0.5 - i * 0.06, 0.07, 0.14, int(kit.C["stone"]),
					{ "y": -0.21 + i * 0.07, "z": 0.66 + (2 - i) * 0.07 })
			kit._cyl(0.19, 0.21, 1.5, 6, 0xf0e2c8, { "x": -0.52, "y": 1.05, "z": -0.28 })
			kit._pyramid(0.5, 0.5, 0.42, int(kit.C["copper"]), { "x": -0.52, "y": 2.55, "z": -0.28 })
			kit._sphere(0.07, int(kit.C["gold"]), { "x": -0.52, "y": 3.02, "z": -0.28 })
			kit._dome(0.09, 0xcfa14a, { "x": -0.52, "y": 2.5, "z": -0.28, "rx": PI })
			anchors["flag"] = [0.55, 1.9, 0.0]
			kit._box(0.025, 0.62, 0.025, int(kit.C["darkWood"]), { "x": 0.55, "y": 1.28 })
			kit._box(0.34, 0.1, 0.3, int(kit.C["stone"]), { "x": 0.75, "y": -0.24, "z": 0.72 })
			kit._box(0.22, 0.42, 0.13, 0x4a4a52, { "x": 0.75, "y": -0.14, "z": 0.72, "rz": 0.05 })
			kit._box(0.15, 0.16, 0.02, 0xe6e6e0, { "x": 0.75, "y": 0.05, "z": 0.79 })
			return { "anchors": anchors, "height": 3.1 }
		"well":
			kit._cyl(0.3, 0.32, 0.36, 9, int(kit.C["stone"]))
			kit._cyl(0.24, 0.24, 0.06, 9, 0x2a4a5a, { "y": 0.3 + kit.BRIM })
			kit._box(0.04, 0.5, 0.04, int(kit.C["darkWood"]), { "x": -0.24, "y": 0.36 })
			kit._box(0.04, 0.5, 0.04, int(kit.C["darkWood"]), { "x": 0.24, "y": 0.36 })
			kit._gable(0.62, 0.5, 0.2, int(kit.C["plank"]), { "y": 0.86, "ry": PI * 0.5 })
			kit._cyl(0.05, 0.045, 0.09, 7, int(kit.C["wood"]), { "y": 0.62 })
			return { "anchors": anchors, "height": 1.1 }
		"market":
			var cols := [[0xd94f3d, 0xf5efe0], [0x3d7ed9, 0xf5efe0], [0xd9a33d, 0xf5efe0]]
			for s in 3:
				var x := -0.7 + s * 0.7
				for pair in [[-0.26, -0.22], [0.26, -0.22], [-0.26, 0.22], [0.26, 0.22]]:
					kit._box(0.035, 0.42, 0.035, int(kit.C["darkWood"]), { "x": x + pair[0], "z": pair[1] })
				kit._gable(0.62, 0.56, 0.14, int(cols[s][0]), { "x": x, "y": 0.42 })
				kit._box(0.56, 0.05, 0.16, int(kit.C["plank"]), { "x": x, "y": 0.24, "z": 0.16 })
				kit._sphere(0.05, [0xe04a3a, 0xf2c53d, 0x6fb84a][s], { "x": x - 0.1, "y": 0.32, "z": 0.16 })
				kit._sphere(0.05, [0x6fb84a, 0xe04a3a, 0xf2c53d][s], { "x": x + 0.06, "y": 0.32, "z": 0.14 })
			return { "anchors": anchors, "height": 0.6 }
		"clocktower":
			kit._box(0.56, 2.3, 0.56, int(kit.C["stone"]))
			kit._box(0.6, 0.1, 0.6, 0x8f8a80, { "y": 1.5 })
			kit._cyl(0.17, 0.17, 0.04, 14, int(kit.C["white"]), { "y": 1.85, "z": 0.29, "rx": PI * 0.5 })
			kit._pyramid(0.68, 0.68, 0.44, int(kit.C["copper"]), { "y": 2.3 })
			kit._sphere(0.06, int(kit.C["gold"]), { "y": 2.78 })
			for i in 3:
				kit._box(0.1, 0.16, 0.03, int(kit.C["glass"]), { "y": 0.5 + i * 0.45, "z": 0.29, "emissive": 1 })
			return { "anchors": anchors, "height": 2.9 }
		"statue":
			var yy := 0.0
			kit._box(0.52, 0.09, 0.52, int(kit.C["foundation"]), { "y": yy }); yy += 0.09
			kit._box(0.42, 0.1, 0.42, int(kit.C["stone"]), { "y": yy }); yy += 0.1
			kit._box(0.32, 0.46, 0.32, int(kit.C["stone"]), { "y": yy })
			kit._box(0.18, 0.12, 0.02, 0xcfc4a8, { "y": yy + 0.16, "z": 0.161 })
			yy += 0.46
			kit._box(0.38, 0.06, 0.38, int(kit.C["stone"]), { "y": yy }); yy += 0.06
			var bronze := 0x9c7a3c
			kit._box(0.05, 0.16, 0.05, bronze, { "x": -0.045, "y": yy })
			kit._box(0.05, 0.16, 0.05, bronze, { "x": 0.045, "y": yy })
			var hip := yy + 0.14
			kit._box(0.15, 0.26, 0.11, bronze, { "y": hip })
			kit._box(0.19, 0.08, 0.13, bronze, { "y": hip + 0.2 })
			kit._box(0.045, 0.22, 0.045, bronze, { "x": -0.11, "y": hip + 0.06, "rz": 0.55 })
			kit._box(0.045, 0.2, 0.045, bronze, { "x": 0.1, "y": hip + 0.05, "rz": -0.15 })
			kit._sphere(0.072, bronze, { "y": hip + 0.35 })
			kit._cyl(0.016, 0.02, 0.34, 5, bronze, { "x": 0.13, "y": hip - 0.02 })
			return { "anchors": anchors, "height": hip + 0.45 }
		"lamp":
			var l_y := 0.0
			kit._cyl(0.11, 0.14, 0.07, 8, int(kit.C["stone"]), { "y": l_y }); l_y += 0.07
			kit._cyl(0.032, 0.045, 0.78, 6, int(kit.C["iron"]), { "y": l_y }); l_y += 0.78
			kit._box(0.16, 0.02, 0.02, int(kit.C["iron"]), { "y": l_y - 0.14 })
			kit._box(0.02, 0.02, 0.16, int(kit.C["iron"]), { "y": l_y - 0.14 })
			kit._cyl(0.085, 0.06, 0.03, 4, int(kit.C["iron"]), { "y": l_y, "ry": PI * 0.25 }); l_y += 0.03
			kit._box(0.1, 0.14, 0.1, int(kit.C["glass"]), { "y": l_y, "emissive": 1 }); l_y += 0.14
			kit._cone(0.095, 0.1, 4, int(kit.C["iron"]), { "y": l_y, "ry": PI * 0.25 }); l_y += 0.1
			kit._sphere(0.026, int(kit.C["iron"]), { "y": l_y + 0.02 })
			return { "anchors": anchors, "height": l_y + 0.05 }
		"planter":
			var beds := [0xd94f3d, 0xe8a13a, 0xd96fa8, 0xf2e04a, 0x9a6fd9]
			kit._box(0.42, 0.18, 0.28, int(kit.C["stone"]))
			kit._box(0.34, 0.04, 0.2, 0x53402e, { "y": 0.14 + kit.BRIM })
			for i in 5:
				var x := -0.13 + i * 0.065
				var z := rng.rangef(-0.05, 0.05)
				var ph := 0.07 + rng.rangef(0.0, 0.05)
				kit._cyl(0.012, 0.014, ph, 4, int(kit.C["green"]), { "x": x, "y": 0.18, "z": z })
				kit._sphere(0.034, beds[rng.int_n(beds.size())], { "x": x, "y": 0.18 + ph + 0.02, "z": z })
			return { "anchors": anchors, "height": 0.36 }
		"bench":
			kit._bench({})
			return { "anchors": anchors, "height": 0.42 }
		"terrace":
			for pair in [[-0.24, -0.02], [0.26, 0.06]]:
				var tx: float = pair[0]
				var tz: float = pair[1]
				kit._cyl(0.035, 0.045, 0.2, 6, int(kit.C["darkWood"]), { "x": tx, "z": tz })
				kit._cyl(0.13, 0.13, 0.025, 8, int(kit.C["plank"]), { "x": tx, "y": 0.2, "z": tz })
				for cz in [-0.23, 0.23]:
					for leg in [[-0.032, -0.032], [0.032, -0.032], [-0.032, 0.032], [0.032, 0.032]]:
						kit._box(0.014, 0.12, 0.014, int(kit.C["darkWood"]), { "x": tx + leg[0], "z": tz + cz + leg[1] })
					kit._box(0.09, 0.022, 0.09, int(kit.C["plank"]), { "x": tx, "y": 0.12, "z": tz + cz })
					kit._box(0.09, 0.12, 0.018, int(kit.C["darkWood"]),
						{ "x": tx, "y": 0.142, "z": tz + cz + (-0.036 if cz < 0 else 0.036) })
			kit._cyl(0.02, 0.022, 0.62, 6, int(kit.C["darkWood"]), { "x": 0.01, "z": 0.02 })
			kit._cone(0.32, 0.18, 8, int(kit.C["red"]), { "x": 0.01, "y": 0.62, "z": 0.02 })
			kit._sphere(0.03, int(kit.C["gold"]), { "x": 0.01, "y": 0.84, "z": 0.02 })
			return { "anchors": anchors, "height": 0.88 }
		"fountain":
			kit._cyl(0.5, 0.54, 0.1, 8, int(kit.C["foundation"]))
			kit._cyl(0.44, 0.46, 0.28, 8, int(kit.C["stone"]), { "y": 0.1 })
			kit._cyl(0.38, 0.38, 0.16, 8, 0x2f6f8f, { "y": 0.14 + kit.BRIM })
			kit._cyl(0.48, 0.48, 0.05, 8, int(kit.C["stone"]), { "y": 0.36 })
			kit._box(0.26, 0.14, 0.26, int(kit.C["stone"]), { "y": 0.3 })
			kit._cyl(0.09, 0.13, 0.4, 8, int(kit.C["stone"]), { "y": 0.44 })
			kit._cyl(0.26, 0.12, 0.1, 8, int(kit.C["stone"]), { "y": 0.8 })
			kit._cyl(0.22, 0.22, 0.03, 8, 0x2f6f8f, { "y": 0.87 + kit.BRIM })
			kit._cyl(0.05, 0.08, 0.2, 8, int(kit.C["stone"]), { "y": 0.9 })
			kit._sphere(0.07, int(kit.C["copper"]), { "y": 1.15 })
			for jet in [[1, 0, 0.0, -0.95], [-1, 0, 0.0, 0.95], [0, 1, 0.95, 0.0], [0, -1, -0.95, 0.0]]:
				kit._cyl(0.014, 0.022, 0.3, 5, 0x8fc4dc,
					{ "x": jet[0] * 0.11, "y": 0.84, "z": jet[1] * 0.11, "rx": jet[2], "rz": jet[3] })
			return { "anchors": anchors, "height": 1.25 }
		"tavern":
			var f := 0.28
			kit._box(1.3, f, 0.98, int(kit.C["stone"]))
			kit._box(1.22, 0.62, 0.9, 0xe8dcc0, { "y": f })
			for x in [-0.56, -0.19, 0.19, 0.56]:
				kit._box(0.055, 0.62, 0.055, int(kit.C["darkWood"]), { "x": x, "y": f, "z": 0.44 })
			kit._box(1.2, 0.055, 0.055, int(kit.C["darkWood"]), { "y": f + 0.29, "z": 0.44 })
			kit._gable(1.42, 1.06, 0.5, int(kit.C["brick"]), { "y": f + 0.62 })
			kit._box(0.34, 0.5, 0.04, int(kit.C["darkWood"]), { "y": f, "z": -0.46 })
			for x in [-0.42, 0.42]:
				kit._box(0.2, 0.26, 0.03, int(kit.C["glass"]), { "x": x, "y": f + 0.2, "z": 0.46, "emissive": 1 })
			for x in [-0.39, 0.34]:
				kit._box(0.13, 0.17, 0.04, int(kit.C["glass"]), { "x": x, "y": f + 0.225, "z": -0.44, "emissive": 1 })
			kit._box(0.04, 0.04, 0.36, int(kit.C["iron"]), { "x": 0.64, "y": 0.88, "z": -0.6 })
			kit._box(0.02, 0.06, 0.02, int(kit.C["iron"]), { "x": 0.64, "y": 0.88, "z": -0.46 })
			kit._box(0.03, 0.22, 0.28, 0x6b4a2f, { "x": 0.64, "y": 0.67, "z": -0.61 })
			kit._sphere(0.05, int(kit.C["gold"]), { "x": 0.642355, "y": 0.77, "z": -0.6 })
			for bz in [-0.34, -0.06]:
				kit._cyl(0.11, 0.12, 0.24, 8, int(kit.C["wood"]), { "x": -0.68, "z": bz })
				kit._cyl(0.115, 0.115, 0.03, 8, int(kit.C["iron"]), { "x": -0.68, "y": 0.14, "z": bz })
			for x in [0.02, 0.34]:
				kit._box(0.05, 0.17, 0.12, int(kit.C["darkWood"]), { "x": x, "z": -0.64 })
			kit._box(0.44, 0.04, 0.16, int(kit.C["plank"]), { "x": 0.18, "y": 0.17, "z": -0.64 })
			kit._cyl(0.06, 0.06, 0.46, 6, int(kit.C["stone"]), { "x": -0.5, "y": f + 0.62, "z": 0.2 })
			return { "anchors": anchors, "height": 1.5 }
		"chapel":
			var cf := 0.1
			kit._box(0.86, 0.16, 1.24, int(kit.C["foundation"]), { "y": -0.06 })
			kit._box(0.78, 0.76, 1.16, int(kit.C["stone"]), { "y": cf })
			kit._gable(1.28, 0.9, 0.44, int(kit.C["slate"]), { "y": 0.86, "ry": PI * 0.5 })
			kit._cyl(0.36, 0.36, 0.76, 9, int(kit.C["stone"]), { "y": cf, "z": 0.66 })
			kit._dome(0.37, int(kit.C["slate"]), { "y": 0.86, "z": 0.66 })
			kit._cyl(0.14, 0.14, 0.05, 12, int(kit.C["glass"]), { "y": 0.66, "z": -0.62, "rx": PI * 0.5, "emissive": 1 })
			kit._box(0.28, 0.46, 0.04, int(kit.C["darkWood"]), { "y": cf, "z": -0.6 })
			for z in [-0.2, 0.2]:
				for x in [-0.4, 0.4]:
					kit._box(0.03, 0.36, 0.13, int(kit.C["glass"]), { "x": x, "y": cf + 0.24, "z": z, "emissive": 1 })
			var th := 1.5
			kit._box(0.44, th, 0.44, int(kit.C["stone"]), { "y": cf, "z": -0.74 })
			kit._box(0.1, 0.24, 0.05, int(kit.C["glass"]), { "y": cf + 1.0, "z": -0.96, "emissive": 1 })
			kit._box(0.52, 0.07, 0.52, 0x8f8a80, { "y": cf + th, "z": -0.74 })
			kit._cone(0.36, 0.8, 4, int(kit.C["slate"]), { "y": cf + th + 0.07, "z": -0.74, "ry": PI * 0.25 })
			kit._sphere(0.05, int(kit.C["gold"]), { "y": cf + th + 0.92, "z": -0.74 })
			kit._box(0.02, 0.2, 0.02, int(kit.C["gold"]), { "y": cf + th + 0.96, "z": -0.74 })
			kit._box(0.13, 0.02, 0.02, int(kit.C["gold"]), { "y": cf + th + 1.09, "z": -0.74 })
			return { "anchors": anchors, "height": cf + th + 1.2 }
		"tables":
			for pair in [[-0.16, -0.14], [0.2, 0.2]]:
				var tx: float = pair[0]
				var tz: float = pair[1]
				for dx in [-0.16, 0.16]:
					kit._box(0.03, 0.2, 0.03, int(kit.C["darkWood"]), { "x": tx + dx, "z": tz - 0.08 })
					kit._box(0.03, 0.2, 0.03, int(kit.C["darkWood"]), { "x": tx + dx, "z": tz + 0.08 })
				kit._box(0.42, 0.035, 0.24, int(kit.C["plank"]), { "x": tx, "y": 0.2, "z": tz })
				for dz in [-0.17, 0.17]:
					kit._box(0.4, 0.03, 0.08, int(kit.C["plank"]), { "x": tx, "y": 0.11, "z": tz + dz })
					for dx in [-0.14, 0.14]:
						kit._box(0.025, 0.11, 0.025, int(kit.C["darkWood"]), { "x": tx + dx, "z": tz + dz })
			kit._cyl(0.035, 0.045, 0.34, 6, int(kit.C["darkWood"]), { "x": 0.42, "z": -0.36 })
			kit._sphere(0.09, int(kit.C["green"]), { "x": 0.42, "y": 0.41, "z": -0.36 })
			return { "anchors": anchors, "height": 0.52 }
		"school":
			var sf := 0.1
			kit._box(1.44, 0.16, 0.96, int(kit.C["foundation"]), { "y": -0.06 })
			kit._box(1.36, 0.3, 0.88, int(kit.C["brick"]), { "y": sf })
			kit._box(1.3, 0.46, 0.84, 0xf0e2c8, { "y": sf + 0.3 })
			var eaves := sf + 0.76
			kit._gable(1.46, 0.98, 0.42, int(kit.C["slate"]), { "y": eaves })
			for i in 4:
				var x := -0.48 + i * 0.32
				kit._box(0.16, 0.4, 0.03, int(kit.C["glass"]), { "x": x, "y": sf + 0.32, "z": 0.43, "emissive": 1 })
				kit._box(0.19, 0.035, 0.04, int(kit.C["white"]), { "x": x, "y": sf + 0.28, "z": 0.435 })
			kit._box(0.42, 0.56, 0.04, int(kit.C["darkWood"]), { "y": sf, "z": -0.44 })
			kit._box(0.5, 0.05, 0.3, int(kit.C["plank"]), { "y": sf + 0.6, "z": -0.58 })
			for x in [-0.21, 0.21]:
				kit._box(0.04, 0.6, 0.04, int(kit.C["darkWood"]), { "x": x, "y": sf, "z": -0.68 })
			for dx in [-0.53, -0.37]:
				kit._box(0.035, 0.24, 0.035, int(kit.C["white"]), { "x": dx, "y": eaves + 0.42 })
			kit._box(0.24, 0.04, 0.14, int(kit.C["white"]), { "x": -0.45, "y": eaves + 0.66 })
			kit._pyramid(0.3, 0.2, 0.16, int(kit.C["copper"]), { "x": -0.45, "y": eaves + 0.7 })
			kit._dome(0.062, int(kit.C["gold"]), { "x": -0.45, "y": eaves + 0.64, "rx": PI })
			kit._box(0.26, 0.2, 0.025, 0x3a4038, { "x": 0.62, "y": sf, "z": -0.34, "rz": -0.12 })
			anchors["flag"] = [-0.66, sf + 0.8, -0.3]
			kit._box(0.025, 0.7, 0.025, int(kit.C["darkWood"]), { "x": -0.66, "y": sf, "z": -0.3 })
			return { "anchors": anchors, "height": eaves + 0.9 }
		"windmill":
			kit._cyl(0.34, 0.48, 1.5, 9, 0xd9b98c)
			kit._box(0.22, 0.36, 0.05, int(kit.C["darkWood"]), { "y": 0, "z": 0.44 })
			kit._cyl(0.4, 0.4, 0.05, 9, int(kit.C["plank"]), { "y": 1.12 })
			kit._dome(0.38, 0x5a3c28, { "y": 1.5 })
			return { "anchors": anchors, "height": 2.1 }
		"lighthouse":
			for i in 4:
				kit._cyl(0.24 - i * 0.02, 0.3 - i * 0.02, 0.55, 11, int(kit.C["white"]) if i % 2 else int(kit.C["red"]),
					{ "y": i * 0.55 })
			var top := 4 * 0.55
			kit._cyl(0.3, 0.3, 0.06, 12, int(kit.C["iron"]), { "y": top })
			kit._cyl(0.19, 0.19, 0.3, 8, 0xfff2b0, { "y": top + 0.06, "emissive": 1 })
			kit._cone(0.26, 0.28, 8, int(kit.C["red"]), { "y": top + 0.36 })
			return { "anchors": anchors, "height": top + 0.7 }
		"castle":
			kit._box(1.3, 1.5, 1.3, int(kit.C["stone"]))
			for pair in [[-0.72, -0.72], [0.72, -0.72], [-0.72, 0.72], [0.72, 0.72]]:
				kit._cyl(0.22, 0.25, 2.1, 8, int(kit.C["stone"]), { "x": pair[0], "z": pair[1] })
				kit._cone(0.3, 0.4, 8, int(kit.C["slate"]), { "x": pair[0], "y": 2.1, "z": pair[1] })
			for i in 10:
				var ang := i / 10.0 * TAU
				kit._box(0.14, 0.14, 0.14, int(kit.C["stone"]),
					{ "x": cos(ang) * 0.62, "y": 1.5, "z": sin(ang) * 0.62 })
			kit._box(0.4, 0.6, 0.1, 0x3a2a20, { "z": 0.66 })
			anchors["flag"] = [0.72, 2.75, -0.72]
			kit._box(0.025, 0.5, 0.025, int(kit.C["darkWood"]), { "x": 0.72, "y": 2.5, "z": -0.72 })
			return { "anchors": anchors, "height": 2.9 }
		"board":
			var bh := _notice_board(spec, {
				"panel": 0x8a6a44, "frame": int(kit.C["darkWood"]), "roof": int(kit.C["plank"]),
				"sign": int(kit.C["paper"]), "note": int(kit.C["paper"]),
				"pins": [0xd94f3d, 0x3d7ed9, 0xd9a33d, 0x6fb84a, 0x9a6fd9],
			})
			return { "anchors": anchors, "height": bh }
		"issues":
			var ih := _notice_board(spec, {
				"panel": int(kit.C["slate"]), "frame": int(kit.C["iron"]), "roof": int(kit.C["copper"]),
				"sign": int(kit.C["white"]), "note": int(kit.C["white"]),
				"pins": [0xd9a33d, 0xb87333, 0xf5efe0, 0xd9a33d, 0x8a8a8a],
			})
			kit._cyl(0.018, 0.018, 0.16, 4, int(kit.C["iron"]), { "y": 1.95, "z": 0.22 })
			kit._sphere(0.05, int(kit.C["glass"]), { "y": 1.99, "z": 0.22, "emissive": 1 })
			return { "anchors": anchors, "height": ih }
		"office":
			kit._box(0.62, 0.44, 0.5, int(kit.C["brick"]))
			kit._box(0.64, 0.06, 0.52, int(kit.C["stone"]), { "y": 0.44 })
			kit._gable(0.72, 0.6, 0.26, int(kit.C["slate"]), { "y": 0.5 })
			kit._box(0.09, 0.2, 0.03, int(kit.C["darkWood"]), { "z": 0.26 })
			kit._box(0.12, 0.13, 0.03, int(kit.C["glass"]), { "x": -0.17, "y": 0.2, "z": 0.26, "emissive": 1 })
			kit._box(0.12, 0.13, 0.03, int(kit.C["glass"]), { "x": 0.17, "y": 0.2, "z": 0.26, "emissive": 1 })
			kit._cyl(0.02, 0.02, 0.16, 4, int(kit.C["iron"]), { "x": 0.24, "y": 0.3, "z": 0.28 })
			kit._sphere(0.045, int(kit.C["glass"]), { "x": 0.24, "y": 0.44, "z": 0.28, "emissive": 1 })
			kit._box(0.3, 0.16, 0.02, 0x2f3a33, { "x": -0.02, "y": 0.24, "z": 0.28 })
			kit._box(0.2, 0.02, 0.014, int(kit.C["white"]), { "x": -0.05, "y": 0.32, "z": 0.292 })
			kit._box(0.12, 0.02, 0.014, int(kit.C["white"]), { "x": -0.09, "y": 0.28, "z": 0.292 })
			kit._box(0.07, 0.24, 0.07, int(kit.C["brick"]), { "x": 0.2, "y": 0.5, "z": -0.12 })
			anchors["smoke"] = [0.2, 0.78, -0.12]
			return { "anchors": anchors, "height": 0.82 }
		"poldermill":
			kit._cyl(0.3, 0.42, 1.2, 8, 0xd9b98c)
			kit._dome(0.34, 0x5a3c28, { "y": 1.2 })
			return { "anchors": anchors, "height": 1.8 }
	kit._box(0.5, 0.4, 0.5, int(kit.C["stone"]))
	return { "anchors": anchors, "height": 0.5 }
