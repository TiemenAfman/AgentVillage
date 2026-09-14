# Shed types: explore, plan, general, guide, and fallback.  Receives a PmKitPrimitives
# reference via _init.
class_name PmKitSheds
extends RefCounted

var kit: PmKitPrimitives

func _init(p_kit: PmKitPrimitives) -> void:
	kit = p_kit

func build(spec: Dictionary, pal: Dictionary) -> Dictionary:
	var t := str(spec.get("shedType", "other"))
	var anchors := {}
	match t:
		"explore":
			kit._cone(0.3, 0.5, 6, int(kit.C["canvas"]))
			kit._box(0.03, 0.3, 0.03, int(kit.C["darkWood"]), { "x": 0.24, "z": 0.1, "rz": 0.28 })
			kit._box(0.03, 0.3, 0.03, int(kit.C["darkWood"]), { "x": 0.32, "z": -0.06, "rz": -0.18 })
			kit._cyl(0.028, 0.042, 0.28, 6, int(kit.C["copper"]), { "rz": -0.55, "x": 0.3, "y": 0.34, "z": 0.02 })
			return { "anchors": anchors, "height": 0.55 }
		"plan":
			kit._box(0.44, 0.3, 0.42, int(pal["wall"]))
			kit._box(0.1, 0.2, 0.03, int(pal["accent"]), { "y": 0.0, "z": 0.21 })
			kit._gable(0.54, 0.5, 0.22, int(pal["roof"]), { "y": 0.3 })
			kit._box(0.5, 0.03, 0.03, int(pal["trim"]), { "y": 0.3, "z": 0.24 })
			kit._box(0.34, 0.32, 0.025, int(kit.C["blueprint"]), { "x": 0.28, "y": 0.02, "z": 0.1, "ry": PI * 0.5 })
			kit._box(0.02, 0.02, 0.22, int(kit.C["paper"]), { "x": 0.295, "y": 0.24, "z": 0.1 })
			kit._box(0.02, 0.02, 0.15, int(kit.C["paper"]), { "x": 0.295, "y": 0.18, "z": 0.13 })
			kit._box(0.02, 0.02, 0.19, int(kit.C["paper"]), { "x": 0.295, "y": 0.12, "z": 0.09 })
			return { "anchors": anchors, "height": 0.54 }
		"general":
			kit._box(0.46, 0.32, 0.46, int(pal["wall"]))
			kit._gable(0.54, 0.54, 0.2, int(pal["roof"]), { "y": 0.32 })
			kit._box(0.09, 0.1, 0.09, int(kit.C["brick"]), { "x": -0.15, "y": 0.32, "z": -0.15 })
			kit._cyl(0.07, 0.08, 0.12, 7, int(kit.C["darkWood"]), { "x": 0.3, "z": 0.22 })
			kit._box(0.17, 0.055, 0.07, int(kit.C["anvil"]), { "x": 0.3, "y": 0.12, "z": 0.22 })
			return { "anchors": anchors, "height": 0.52 }
		"guide":
			kit._box(0.44, 0.3, 0.4, int(pal["wall"]))
			kit._box(0.44, 0.05, 0.1, int(kit.C["wood"]), { "y": 0.3, "z": 0.2 })
			kit._box(0.5, 0.04, 0.3, int(kit.C["stripe"]), { "y": 0.32, "z": 0.28, "rx": -0.3 })
			kit._box(0.11, 0.03, 0.08, int(kit.C["red"]), { "y": 0.32, "z": 0.16 })
			kit._box(0.11, 0.03, 0.08, int(kit.C["blue"]), { "y": 0.355, "z": 0.14 })
			kit._box(0.11, 0.03, 0.08, int(kit.C["gold"]), { "y": 0.39, "z": 0.17 })
			return { "anchors": anchors, "height": 0.44 }
	kit._box(0.42, 0.3, 0.42, int(kit.C["wood"]))
	kit._gable(0.5, 0.5, 0.18, int(kit.C["darkWood"]), { "y": 0.3 })
	return { "anchors": anchors, "height": 0.48 }
