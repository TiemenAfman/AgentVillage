# Hotel/tower building: multi-floor tower with rooms, terrace, parapet, and spire.
# Receives a PmKitPrimitives reference via _init.
class_name PmKitTowers
extends RefCounted

var kit: PmKitPrimitives

func _init(p_kit: PmKitPrimitives) -> void:
	kit = p_kit

# A session that ran apprentices builds upward instead of filling its yard with sheds:
# one window per room, lit while the apprentice worked, and the session on the top
# floor, set back from the parapet with a chair and a table on the terrace.
func build(spec: Dictionary, pal: Dictionary) -> Dictionary:
	var hspec: Dictionary = spec.get("hotel", { "rooms": 10, "floors": 2, "busy": 0 })
	var floors := clampi(int(hspec.get("floors", 2)), 2, 14)
	var floor := 0.42
	var w := 1.06
	var wall_hex := int(pal["wall"])
	var trim_hex := int(pal["trim"])
	var roof_hex := int(pal["roof"])
	var rooms := int(hspec.get("rooms", 10))

	kit._box(w + 0.16, 0.14, w + 0.16, int(kit.C["foundation"]))
	kit._box(w + 0.06, 0.2, w + 0.06, int(kit.C["stone"]), { "y": 0.14 })
	kit._box(0.3, 0.34, 0.04, int(kit.C["darkWood"]), { "y": 0.34, "z": w * 0.5 + 0.04 })
	var room := 0
	for fi in floors:
		var y := 0.34 + fi * floor
		kit._box(w, floor - 0.04, w, wall_hex, { "y": y })
		kit._box(w + 0.04, 0.045, w + 0.04, trim_hex, { "y": y + floor - 0.045 })
		for face in [[0, w * 0.5, 0.0], [0, -w * 0.5, 0.0], [w * 0.5, 0, 1], [-w * 0.5, 0, 1]]:
			if room >= rooms:
				continue
			room += 1
			var ry: float = face[2]
			var ww := 0.03 if ry else 0.26
			var dd := 0.26 if ry else 0.03
			kit._box(ww, 0.2, dd, int(kit.C["glass"]),
				{ "x": face[0] * 1.02, "y": y + 0.09, "z": face[1] * 1.02, "emissive": 1 })
	var top := 0.34 + floors * floor
	kit._box(w + 0.1, 0.07, w + 0.1, trim_hex, { "y": top })
	for pair in [[0, 1], [0, -1], [1, 0], [-1, 0]]:
		kit._box((0.05 if pair[0] else w), 0.1, (0.05 if pair[1] else w), trim_hex,
			{ "x": pair[0] * w * 0.5, "y": top + 0.07, "z": pair[1] * w * 0.5 })
	var pw := w - 0.34
	kit._box(pw, 0.34, pw, wall_hex, { "y": top + 0.07 })
	for face in [[0, 1, 0], [1, 0, 1], [-1, 0, 1]]:
		var ry: float = face[2]
		kit._box((0.03 if ry else pw - 0.12), 0.19, (pw - 0.12 if ry else 0.03), int(kit.C["glass"]),
			{ "x": face[0] * pw * 0.5, "y": top + 0.14, "z": face[1] * pw * 0.5, "emissive": 1 })
	kit._pyramid(pw + 0.22, pw + 0.22, 0.24, roof_hex, { "y": top + 0.41 })
	kit._cyl(0.02, 0.02, 0.34, 5, int(kit.C["iron"]), { "y": top + 0.65 })
	kit._sphere(0.05, int(kit.C["gold"]), { "y": top + 1.02 })
	kit._cyl(0.02, 0.026, 0.1, 6, int(kit.C["darkWood"]), { "x": 0.3, "y": top + 0.07, "z": 0.28 })
	kit._cyl(0.08, 0.08, 0.02, 8, int(kit.C["plank"]), { "x": 0.3, "y": top + 0.17, "z": 0.28 })
	return { "anchors": {}, "height": top + 1.0, "w": w }
