# Props: trees, bushes, rocks, cairns, bridges, fences, benches, lamps, signposts,
# wells, statues, campfires, flags, panels, desk displays.  Receives a PmKitPrimitives
# reference via _init.
class_name PmKitProps
extends RefCounted

var kit: PmKitPrimitives

func _init(p_kit: PmKitPrimitives) -> void:
	kit = p_kit

const PROPS := {
	"tree": { "r": 0.42, "run": 0.0 }, "pine": { "r": 0.4, "run": 0.0 },
	"bush": { "r": 0.3, "run": 0.0 }, "rock": { "r": 0.36, "run": 0.0 },
	"cairn": { "r": 0.3, "run": 0.0 }, "bridge": { "r": 0.0, "run": 0.75 },
	"fence": { "r": 0.0, "run": 0.22, "wall": true }, "bench": { "r": 0.45, "run": 0.0 },
	"lamp": { "r": 0.2, "run": 0.0 }, "signpost": { "r": 0.2, "run": 0.0 },
	"deskdisplay": { "r": 0.55, "run": 0.0 }, "well": { "r": 0.7, "run": 0.0 },
	"statue": { "r": 0.55, "run": 0.0 }, "campfire": { "r": 0.45, "run": 0.0 },
	"flag": { "r": 0.22, "run": 0.0 }, "panel": { "r": 0.0, "run": 0.14, "wall": true },
}

func prop_rad(kind: String) -> float:
	var s: Dictionary = PROPS.get(kind, PROPS["cairn"])
	return float(s["r"])

func prop_wall_len(kind: String, p: Dictionary) -> float:
	var s: Dictionary = PROPS.get(kind, PROPS["cairn"])
	if str(kind) == "panel":
		return panel_w(p)
	return maxf(1, float(p.get("length", 4)))

func panel_w(p: Dictionary) -> float:
	return clampf(float(p.get("length", 1.5)), 0.6, 8.0)

func build(p: Dictionary, root: Node3D) -> void:
	kit._root = root
	var kind := str(p.get("kind", "cairn"))
	match kind:
		"tree":
			kit._cyl(0.09, 0.13, 0.62, 6, 0x6b4a2f)
			kit._sphere(0.52, 0x5c9a3f, { "y": 1.02 })
			kit._sphere(0.34, 0x6aa84a, { "x": 0.26, "y": 0.82 })
			kit._sphere(0.3, 0x4f8a37, { "x": -0.24, "y": 0.9, "z": 0.16 })
		"pine":
			kit._cyl(0.07, 0.11, 0.5, 5, 0x6b4a2f)
			kit._cone(0.46, 0.85, 7, 0x3f7d47, { "y": 0.35 })
			kit._cone(0.34, 0.72, 7, 0x478950, { "y": 0.85 })
			kit._cone(0.22, 0.55, 7, 0x51955a, { "y": 1.32 })
		"bush":
			kit._sphere(0.3, 0x4f8a3f, { "y": 0.24 })
			kit._sphere(0.22, 0x5fa04a, { "x": 0.24, "y": 0.18 })
			kit._sphere(0.2, 0x467d38, { "x": -0.2, "y": 0.2, "z": 0.14 })
		"rock":
			kit._sphere(0.34, 0x8f8a80, { "y": 0.2 })
			kit._sphere(0.2, 0x7a756d, { "x": 0.26, "y": 0.11, "z": 0.1 })
			kit._sphere(0.15, 0x99938a, { "x": -0.18, "y": 0.13, "z": -0.14 })
		"cairn":
			kit._sphere(0.26, 0x8f8a80, { "y": 0.16 })
			kit._sphere(0.2, 0x7a756d, { "y": 0.42 })
			kit._sphere(0.14, 0x99938a, { "y": 0.62 })
			kit._sphere(0.09, 0xa8a29a, { "y": 0.75 })
			kit._cyl(0.025, 0.03, 0.9, 5, 0x6b4a2f, { "x": 0.3 })
			kit._box(0.3, 0.16, 0.03, 0xa9855a, { "x": 0.3, "y": 0.72 })
			if p.get("label", null) != null:
				kit._box(0.22, 0.04, 0.035, 0x50463a, { "x": 0.3, "y": 0.79 })
		"bridge":
			_bridge(p)
		"fence":
			_fence(p)
		"bench":
			kit._box(0.12, 0.34, 0.12, 0x6b4a2f, { "x": -0.5 })
			kit._box(0.12, 0.34, 0.12, 0x6b4a2f, { "x": 0.5 })
			kit._box(1.3, 0.07, 0.42, 0xa9855a, { "y": 0.34 })
			kit._box(1.3, 0.32, 0.07, 0xa9855a, { "y": 0.41, "z": -0.18 })
		"lamp":
			kit._cyl(0.11, 0.15, 0.14, 8, 0x8f8a80)
			kit._cyl(0.045, 0.06, 1.5, 6, 0x4a4640, { "y": 0.12 })
			kit._box(0.22, 0.26, 0.22, 0x4a4640, { "y": 1.6 })
			kit._box(0.16, 0.2, 0.16, 0xffd489, { "y": 1.63, "emissive": 1 })
			kit._cone(0.19, 0.13, 4, 0x4a4640, { "y": 1.86 })
			kit._sphere(0.035, 0x4a4640, { "y": 1.99 })
		"signpost":
			kit._cyl(0.05, 0.07, 1.25, 6, 0x6b4a2f)
			kit._box(0.78, 0.26, 0.05, 0xa9855a, { "y": 0.9, "z": 0.03 })
			kit._box(0.62, 0.04, 0.06, 0x50463a, { "y": 1.0, "z": 0.04 })
			kit._box(0.44, 0.04, 0.06, 0x50463a, { "y": 0.94, "z": 0.04 })
			kit._cone(0.09, 0.12, 5, 0x8a6a44, { "y": 1.25 })
		"well":
			kit._cyl(0.58, 0.62, 0.52, 12, 0x8f8a80)
			kit._cyl(0.5, 0.5, 0.06, 12, 0x2c3f52, { "y": 0.46 })
			kit._box(0.09, 0.95, 0.09, 0x6b4a2f, { "x": -0.5, "y": 0.5 })
			kit._box(0.09, 0.95, 0.09, 0x6b4a2f, { "x": 0.5, "y": 0.5 })
			kit._cyl(0.07, 0.07, 1.0, 7, 0x6b4a2f, { "y": 1.35, "x": 0.5, "rz": PI * 0.5 })
			kit._gable(1.5, 1.0, 0.42, 0xa8503c, { "y": 1.42 })
			kit._box(0.24, 0.2, 0.2, 0x8a6a44, { "y": 1.0 })
		"statue":
			kit._box(0.9, 0.18, 0.9, 0x8f8a80)
			kit._box(0.72, 0.16, 0.72, 0x9c968c, { "y": 0.18 })
			kit._box(0.56, 0.5, 0.56, 0x8f8a80, { "y": 0.34 })
			kit._cyl(0.17, 0.23, 0.52, 7, 0xb0aaa0, { "y": 0.84 })
			kit._sphere(0.16, 0xb8b2a8, { "y": 1.5 })
			kit._cyl(0.24, 0.24, 0.03, 9, 0xb0aaa0, { "y": 1.56 })
			kit._box(0.1, 0.34, 0.1, 0xa8a29a, { "x": 0.2, "y": 1.02, "rz": -0.4 })
		"campfire":
			kit._cyl(0.42, 0.44, 0.09, 10, 0x8f8a80)
			kit._box(0.7, 0.11, 0.11, 0x6b4a2f, { "y": 0.09, "ry": 0.4 })
			kit._box(0.7, 0.11, 0.11, 0x6b4a2f, { "y": 0.09, "ry": -0.5 })
			kit._box(0.7, 0.11, 0.11, 0x6b4a2f, { "y": 0.2, "ry": 1.3 })
			kit._cone(0.2, 0.46, 6, 0xff9a3c, { "y": 0.18, "emissive": 1 })
			kit._cone(0.11, 0.28, 6, 0xffe07a, { "y": 0.26, "emissive": 1 })
		"flag":
			kit._cyl(0.16, 0.2, 0.12, 8, 0x8f8a80)
			kit._cyl(0.035, 0.05, 2.1, 6, 0xa9855a, { "y": 0.1 })
			kit._box(0.7, 0.42, 0.03, 0xd94f3d, { "x": 0.37, "y": 1.62 })
			kit._box(0.7, 0.1, 0.035, 0xe8b45c, { "x": 0.37, "y": 1.72 })
			kit._sphere(0.055, 0xe8b45c, { "y": 2.2 })
		"panel":
			_panel(p)
		"deskdisplay":
			kit._box(1.2, 0.07, 0.34, 0x8a6a44)
			kit._box(1.12, 0.6, 0.26, 0x6b4a2f, { "y": 0.07 })
			kit._box(1.14, 0.04, 0.29, 0xa9855a, { "y": 0.63 })
			kit._box(1.06, 0.54, 0.03, 0xa9855a, { "y": 0.1, "z": 0.12 })
			kit._box(0.98, 0.5, 0.012, 0x0c0c10, { "y": 0.12, "z": 0.135 })
			kit._sphere(0.016, 0x6fb84a, { "x": 0.47, "y": 0.155, "z": 0.15, "emissive": 1 })
			kit._cyl(0.03, 0.03, 0.12, 6, 0x4a4640, { "y": 0.3, "z": -0.19, "rx": PI * 0.5 })
		_:
			_cairn(p)

func _bridge(p: Dictionary) -> void:
	var len := maxf(2, float(p.get("length", 6)))
	var half := len * 0.5
	kit._box(1.5, 0.09, len, 0x8a6a44, { "y": -0.09 })
	var step := 0.34
	var tt := -half + step * 0.5
	while tt < half:
		kit._box(1.44, 0.045, step * 0.72, 0xa9855a, { "y": 0, "z": tt })
		tt += step
	for side in [-0.72, 0.72]:
		kit._box(0.07, 0.09, len, 0x8a6a44, { "x": side, "y": 0.48 })
		var t2 := -half + 0.5
		while t2 <= half - 0.4:
			kit._box(0.07, 0.5, 0.07, 0x6b4a2f, { "x": side, "y": 0.02, "z": t2 })
			t2 += 1.1
	for pair in [[-0.6, -half + 0.3], [0.6, -half + 0.3], [-0.6, half - 0.3], [0.6, half - 0.3]]:
		kit._box(0.16, 0.6, 0.16, 0x6b4a2f, { "x": pair[0], "y": -0.68, "z": pair[1] })

func _fence(p: Dictionary) -> void:
	var len := maxf(1, float(p.get("length", 4)))
	var half := len * 0.5
	var t := -half
	while t <= half + 0.01:
		kit._box(0.09, 0.72, 0.09, 0x6b4a2f, { "z": t })
		t += 1
	kit._box(0.05, 0.08, len, 0xa9855a, { "y": 0.5 })
	kit._box(0.05, 0.08, len, 0xa9855a, { "y": 0.24 })

func _cairn(p: Dictionary) -> void:
	kit._sphere(0.26, 0x8f8a80, { "y": 0.16 })
	kit._sphere(0.2, 0x7a756d, { "y": 0.42 })
	kit._sphere(0.14, 0x99938a, { "y": 0.62 })
	kit._sphere(0.09, 0xa8a29a, { "y": 0.75 })
	kit._cyl(0.025, 0.03, 0.9, 5, 0x6b4a2f, { "x": 0.3 })
	kit._box(0.3, 0.16, 0.03, 0xa9855a, { "x": 0.3, "y": 0.72 })

func _panel(p: Dictionary) -> void:
	var w := clampf(float(p.get("length", 1.5)), 0.6, 8.0)
	var h := w * 0.625
	var lift := 0.62
	var post := maxf(0.1, w * 0.5 - 0.12)
	var frame_w := w + 0.07 * 2
	kit._box(0.12, lift + 0.14, 0.12, 0x6b4a2f, { "x": -post })
	kit._box(0.12, lift + 0.14, 0.12, 0x6b4a2f, { "x": post })
	kit._box(w, h, 0.06, 0x1b1712, { "y": lift })
	kit._box(frame_w, 0.07, 0.09, 0xa9855a, { "y": lift + h })
	kit._box(frame_w, 0.07, 0.09, 0xa9855a, { "y": lift - 0.07 })
	kit._box(0.07, h + 0.14, 0.09, 0x8a6a44, { "x": -(w + 0.07) * 0.5, "y": lift - 0.07 })
	kit._box(0.07, h + 0.14, 0.09, 0x8a6a44, { "x": (w + 0.07) * 0.5, "y": lift - 0.07 })
