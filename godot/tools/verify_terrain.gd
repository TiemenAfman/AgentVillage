# Headless check that the GDScript terrain matches the JS one bit for bit. Run it with:
#   Godot..._console.exe --headless --path <godot dir> --script res://tools/verify_terrain.gd
# The expected hash is island.terrainHash from village.json; anything else means the
# island Godot draws is not the island the server laid its houses out on.
extends SceneTree

const SEED := 1337
const SIZE := 64
const EXPECT := "f7ec71ac"

func _initialize() -> void:
	var t0 := Time.get_ticks_msec()
	var terrain := PmTerrain.new(SEED, SIZE, [])
	var ms := Time.get_ticks_msec() - t0

	print("seed        : %d  size %d" % [SEED, SIZE])
	print("hash        : %s   expected %s" % [terrain.hash_hex, EXPECT])
	print("built in    : %d ms" % ms)
	print("hill/lake   : %v / %v" % [terrain.hill_centre, terrain.lake_centre])
	print("rivers      : %d" % terrain.rivers.size())
	for c in terrain.rivers:
		print("  course of %d cells, %v -> %v" % [c.size(), c[0], c[c.size() - 1]])
	print("land cells  : %d" % terrain.land_cells.size())
	print("beach cells : %d" % terrain.beach_cells.size())
	print("coast cells : %d" % terrain.coast_cells.size())
	print("river cells : %d  banks %d" % [terrain.river_cells.size(), terrain.river_bank_cells.size()])

	if terrain.hash_hex == EXPECT:
		print("OK - identical to the JS terrain")
		quit(0)
	else:
		printerr("MISMATCH - the GDScript port does not agree with shared/terrain.mjs")
		quit(1)
