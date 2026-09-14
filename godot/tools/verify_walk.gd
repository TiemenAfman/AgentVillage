# Smoke test for walk mode. The editor is the only place the walker is normally
# steered, so everything here is driven by hand: enter, step the simulation, read the
# result back. Checks the pieces the user actually moves -- terrain below the feet,
# buildings in the way, a bridge deck you step up onto, camera behind you, and the
# E-prompt appearing next to the town hall.
extends SceneTree

var fails := 0

func _initialize() -> void:
	var main = load("res://scenes/main.tscn").instantiate()
	root.add_child(main)
	await process_frame

	main.village = _village()
	main.props_data = []
	main._rebuild()
	main._walk_refresh()

	# --- spawn on the ground, camera behind you, town hall within reach ---
	main._set_mode(main.MODE_WALK)
	var spawn: Vector2 = main._walk_spawn()
	var p: Vector3 = main.walk.pos
	_ok(p.x >= -32.0 and p.x <= 32.0 and p.z >= -32.0 and p.z <= 32.0,
		"spawn inside the grid (%s)" % spawn)
	_ok(absf(p.y - main._render_height(p.x, p.z)) < 0.01,
		"feet on the ground (y=%.3f)" % p.y)

	main.walk.update(1.0 / 60.0)
	var cam: Vector3 = main.camera.position
	# cam_yaw == 0 and cam_pitch > 0 put the camera south (lower z) and higher than the
	# player, offset by the dist we chose.
	_ok(cam.z < p.z and cam.y > p.y and cam.y - p.y > main.walk.CAM_UP * 0.5,
		"camera behind & above (cam %.1f, %.1f, %.1f)" % [cam.x, cam.y, cam.z])

	main.walk.update(1.0 / 60.0)
	var near: Dictionary = main.walk.near
	_ok(not near.is_empty() and near.kind == "civic", "town hall within reach at spawn")

	# --- walking tracks terrain height ---
	_step(main, KEY_W, 60)
	var h: float = main.walk.pos.y
	_ok(absf(h - main._render_height(main.walk.pos.x, main.walk.pos.z)) < 0.05,
		"terrain underfoot while walking (y=%.2f)" % h)

	# --- a building is a wall ---
	# House plot (40,26) 2x2: centre (9,-4.5), half width 0.72. Its west face is at
	# x = 8.28, so the walker stops at 8.28 - BODY_R = 8.12. Stand west of it, walk +x.
	_reset(main, Vector2(7.5, -4.5))
	_step(main, KEY_A, 300)          # with cam_yaw==0, A strides toward +x
	var px: float = main.walk.pos.x
	_ok(px > 8.02 and px < 8.22, "stops at the wall (x=%.3f, face at 8.12)" % px)

	# --- a bridge deck keeps the feet above the river ---
	# Bridge cells (39..41,52) stretch over the river. Start on cell 39 (world x 7.5);
	# twenty steps should leave the feet at deck height, not sink into the river below.
	var on_bridge := Vector2(7.5, 20.5)
	_reset(main, on_bridge)
	_step(main, KEY_A, 22)           # ~1.2 units east, still on cell 40
	var on_deck_y: float = main.walk.pos.y
	_ok(main.walk.pos.x > 8.0 and main.walk.pos.x < 9.2, "walked onto the bridge (x=%.2f)" % main.walk.pos.x)
	_ok(absf(on_deck_y - _deck_y(main)) < 0.05,
		"feet at deck height (y=%.3f deck=%.3f)" % [on_deck_y, _deck_y(main)])

	# --- nothing within reach out on the open ground ---
	_reset(main, Vector2(0.0, 0.0))
	main.walk.update(1.0 / 60.0)
	_ok(main.walk.near.is_empty(), "nothing within reach out on the open ground")

	# --- orbit mode still flies without the walker ---
	main._set_mode(main.MODE_ORBIT)
	_ok(main.mode == main.MODE_ORBIT and not main.avatar.visible,
		"orbit mode hides the avatar")

	print("")
	print("PASS/FAIL : %d failure(s)" % fails)
	quit(0 if fails == 0 else 1)

# Step `frames` simulation frames with one move key held.
func _step(main, key: Key, frames: int) -> void:
	main.walk._keys[key] = true
	for i in frames:
		main.walk.update(1.0 / 60.0)
	main.walk._keys.erase(key)

func _reset(main, at: Vector2) -> void:
	main.walk.enter(at, Vector2.ZERO)
	main.walk.update(0.0)

func _deck_y(main) -> float:
	var levels: Dictionary = main.walk.levels
	var arr = levels[39 + 52 * 64]
	return arr[0]

func _ok(good: bool, what: String) -> void:
	if not good:
		fails += 1
	print("%s : %s" % ["ok" if good else "FAIL", what])

# A village with the pieces the walker needs: a town hall to spawn by and greet, a
# house solid enough to walk into, and a bridge crossing the river. terrainHash is the
# seed-1337 island from verify_terrain.
func _village() -> Dictionary:
	return {
		"island": { "name": "Test", "seed": 1337, "terrainHash": "f7ec71ac" },
		"grid": { "size": 64 },
		"cleared": [], "paths": [], "districts": [], "polders": [], "active": [],
		"buildings": [
			{ "id": "civic:townhall", "kind": "civic", "tier": "civic", "label": "Town Hall",
			  "plot": { "gx": 31, "gz": 26, "w": 3, "d": 3, "rot": 2 } },
			{ "id": "house:one", "kind": "house", "tier": "house", "label": "One",
			  "plot": { "gx": 40, "gz": 26, "w": 2, "d": 2, "rot": 0 } },
		],
		"bridges": [{ "id": "bridge:test", "axis": "x", "cells": [[39, 52], [40, 52], [41, 52]] }],
	}