# Orchestrator for the procedural building kit.  Owns one PmKitPrimitives base and a
# module per category, then delegates: civic -> PmKitCivics, shed -> PmKitSheds,
# hotel/tower -> PmKitTowers, house -> PmKitHouses; props go to PmKitProps.  Harbour
# decks lift the house and its anchors itself, the same way the old single script did.
class_name PmKit
extends PmKitPrimitives

var _houses: PmKitHouses
var _civics: PmKitCivics
var _sheds: PmKitSheds
var _towers: PmKitTowers
var _props: PmKitProps

func _init() -> void:
	_houses = PmKitHouses.new(self)
	_civics = PmKitCivics.new(self)
	_sheds = PmKitSheds.new(self)
	_towers = PmKitTowers.new(self)
	_props = PmKitProps.new(self)

# ---------------------------------------------------------------- entry point
func build(spec: Dictionary, root: Node3D) -> Dictionary:
	_root = root
	_part_count = 0
	var style := str(spec.get("style", "unknown"))
	var pal: Dictionary = PALETTE.get(style, PALETTE["unknown"])
	var rng := PmRng.new(PmRng.hash32(str(spec.get("id", spec.get("label", "?")))))
	var kind := str(spec.get("kind", "house"))
	var result := { "anchors": {}, "height": 1.0, "w": 0.9 }

	if kind == "civic":
		result = _civics.build(spec, rng)
	elif kind == "shed":
		result = _sheds.build(spec, pal)
	elif bool(spec.get("harbour", false)):
		var deck := 0.62
		for pair in [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]]:
			_cyl(0.05, 0.055, deck + 0.7, 6, int(C["darkWood"]), { "x": pair[0], "y": -0.7, "z": pair[1] })
		_box(1.0, 0.08, 1.0, int(C["plank"]), { "y": deck - 0.08 })
		var house_spec: Dictionary = spec.duplicate()
		if str(house_spec.get("tier", "house")) == "tent":
			house_spec["tier"] = "hut"
		var inner := Node3D.new()
		inner.position = Vector3(0, deck, 0)
		_root.add_child(inner)
		var saved := _root
		_root = inner
		var r := _houses.build(house_spec, pal)
		_root = saved
		_cyl(0.05, 0.05, 0.36, 6, int(C["darkWood"]), { "x": 0.44, "y": deck, "z": 0.44 })
		_box(0.1, 0.12, 0.1, 0xffb347, { "x": 0.44, "y": deck + 0.36, "z": 0.44, "emissive": 1 })
		result = r
		result["height"] = deck + float(result["height"])
		result["w"] = float(r["w"])
		var anchors: Dictionary = result["anchors"]
		for k in anchors:
			var v: Array = anchors[k]
			anchors[k] = [v[0], v[1] + deck, v[2]]
		for o in spec.get("ornaments", []):
			_houses.ornament(str(o), pal, { "w": r["w"], "height": result["height"],
				"tier": int(TIER_INDEX.get(str(house_spec.get("tier", "house")), 1)) }, result["anchors"])
	elif spec.get("hotel", null) != null:
		result = _towers.build(spec, pal)
		for o in spec.get("ornaments", []):
			_houses.ornament(str(o), pal, { "w": result["w"], "height": result["height"],
				"tier": int(TIER_INDEX.get(str(spec.get("tier", "house")), 1)) }, result["anchors"])
	else:
		result = _houses.build(spec, pal)
		for o in spec.get("ornaments", []):
			_houses.ornament(str(o), pal, { "w": result["w"], "height": result["height"],
				"tier": int(TIER_INDEX.get(str(spec.get("tier", "house")), 1)) }, result["anchors"])
	result["parts"] = _part_count
	return result

func part_count() -> int:
	return _part_count

# ---------------------------------------------------------------- props
func build_prop(p: Dictionary, root: Node3D) -> void:
	_props.build(p, root)

func prop_rad(kind: String) -> float:
	return _props.prop_rad(kind)

func prop_wall_len(kind: String, p: Dictionary) -> float:
	return _props.prop_wall_len(kind, p)

func panel_w(p: Dictionary) -> float:
	return _props.panel_w(p)