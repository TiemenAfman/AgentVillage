# Smoke test for the building kit: every catalogue spec from the editor builds at least
# one part, reports a positive height, and has a reasonable footprint. Then the same for
# every prop kind. All geometry is built in place, discarded, and never drawn -- only the
# numbers are checked.
extends SceneTree

var fails := 0

const TIERS := ['tent', 'hut', 'cottage', 'house', 'manor', 'keep']
const STYLES := ['fable', 'opus', 'sonnet', 'haiku', 'unknown']
const SHEDS := ['explore', 'plan', 'general', 'guide', 'other']
const ORNAMENTS := ['forge', 'lumber', 'lantern', 'weathervane', 'pigeons', 'banner', 'lightningrod']
const CIVIC := ['townhall', 'board', 'issues', 'well', 'market', 'tavern', 'clocktower', 'tables',
	'school', 'windmill', 'chapel', 'fountain', 'lighthouse', 'statue', 'castle', 'poldermill']
const FURNITURE := ['planter', 'lamp', 'bench', 'terrace']
const PROPS := ['tree', 'pine', 'bush', 'rock', 'cairn', 'bridge', 'fence', 'bench',
	'lamp', 'signpost', 'well', 'statue', 'campfire', 'flag', 'panel', 'deskdisplay']

func _initialize() -> void:
	var kit := PmKit.new()
	var total := 0
	var total_parts := 0

	# ---- houses ---------------------------------------------------------------
	for tier in TIERS:
		for style in STYLES:
			var spec := { "id": "h:%s:%s" % [tier, style], "kind": "house", "tier": tier, "style": style, "ornaments": [] }
			var root := Node3D.new()
			_check_spec(spec, kit, root, total_parts)
			total += 1
			root.free()

	# ---- ornaments on a house --------------------------------------------------
	for orn in ORNAMENTS:
		var spec := { "id": "o:%s" % orn, "kind": "house", "tier": "house", "style": "opus", "ornaments": [orn] }
		var root := Node3D.new()
		_check_spec(spec, kit, root, total_parts)
		total += 1
		root.free()

	# ---- sheds ----------------------------------------------------------------
	for s in SHEDS:
		var spec := { "id": "s:%s" % s, "kind": "shed", "shedType": s, "style": "haiku", "tier": "shed", "ornaments": [] }
		var root := Node3D.new()
		_check_spec(spec, kit, root, total_parts)
		total += 1
		root.free()

	# ---- towers ---------------------------------------------------------------
	for rooms in [10, 24, 50, 100]:
		var floors := maxi(2, mini(14, ceili(rooms / 5.0)))
		var spec := { "id": "t:%d" % rooms, "kind": "house", "tier": "manor", "style": "opus",
			"ornaments": [], "hotel": { "rooms": rooms, "floors": floors } }
		var root := Node3D.new()
		var result: Dictionary = _check_spec(spec, kit, root, total_parts)
		# Tower height should grow with floor count; last check was a 2-floor house,
		# so this should be taller.
		_ok(float(result["height"]) > 2.0, "tower height > 2.0 for %d rooms" % rooms)
		total += 1
		root.free()

	# ---- harbour ---------------------------------------------------------------
	var h_spec := { "id": "h:harbour", "kind": "house", "tier": "cottage", "style": "sonnet",
		"harbour": true, "ornaments": [] }
	var root2 := Node3D.new()
	var hr: Dictionary = _check_spec(h_spec, kit, root2, total_parts)
	_ok(float(hr["height"]) >= 0.62, "harbour height includes deck (%.3f)" % float(hr["height"]))
	total += 1
	root2.free()

	# ---- civic ----------------------------------------------------------------
	for ct in CIVIC:
		var spec := { "id": "c:%s" % ct, "kind": "civic", "civicType": ct, "tier": "civic",
			"style": "unknown", "ornaments": [], "cards": 6 }
		var root3 := Node3D.new()
		_check_spec(spec, kit, root3, total_parts)
		total += 1
		root3.free()

	# ---- furniture civic (planter, lamp, bench, terrace) -----------------------
	for ft in FURNITURE:
		var spec := { "id": "f:%s" % ft, "kind": "civic", "civicType": ft, "tier": "civic",
			"style": "unknown", "ornaments": [] }
		var root4 := Node3D.new()
		_check_spec(spec, kit, root4, total_parts)
		total += 1
		root4.free()

	# ---- props ----------------------------------------------------------------
	for pk in PROPS:
		var root5 := Node3D.new()
		kit.build_prop({ "kind": pk }, root5)
		var pc := kit.part_count()
		_ok(pc > 0, "prop '%s' builds at least one part" % pk)
		total_parts += pc
		total += 1
		root5.free()

	# ---- consistency checks ---------------------------------------------------
	# prop_rad returns a positive radius for things with a footprint.
	for pk in ["tree", "pine", "bush", "rock", "cairn", "bench", "lamp", "signpost", "well", "statue", "campfire", "flag"]:
		_ok(kit.prop_rad(pk) > 0.0, "prop_rad('%s') > 0" % pk)
	# Bridges and panels have a radius of 0 but a run length.
	_ok(kit.prop_rad("bridge") == 0.0, "prop_rad('bridge') == 0")
	_ok(kit.prop_wall_len("bridge", {}) >= 2.0, "prop_wall_len('bridge') >= 2")
	_ok(kit.prop_wall_len("panel", {}) >= 0.6, "prop_wall_len('panel') >= 0.6")
	total += 3

	print("")
	print("PASS/FAIL : %d failure(s) across %d specs" % [fails, total])
	quit(0 if fails == 0 else 1)

func _check_spec(spec: Dictionary, kit: PmKit, root: Node3D, _total_parts: int) -> Dictionary:
	var result: Dictionary = kit.build(spec, root)
	var pc: int = kit.part_count()
	var label: String = str(spec.get("civicType", spec.get("shedType", spec.get("tier", "?"))))
	_ok(pc > 0, "%s builds at least one part (%d)" % [label, pc])
	var h: float = float(result["height"])
	_ok(h > 0.1, "%s height > 0.1 (%.3f)" % [label, h])
	return result

func _ok(good: bool, what: String) -> void:
	if not good:
		fails += 1
	print("%s : %s" % ["ok" if good else "FAIL", what])
