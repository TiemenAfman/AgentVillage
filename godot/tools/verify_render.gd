# Smoke test for the parts live data does not reach yet. The island has no bridges on it
# at the moment, so the only way to know the deck is built at the right height -- and that
# a change in the data is noticed at all -- is to hand the viewer a village of our own.
extends SceneTree

func _initialize() -> void:
	var main = load("res://scenes/main.tscn").instantiate()
	root.add_child(main)
	# _ready() does not run until the tree has ticked once.
	await process_frame

	var base := _village(false)
	main.village = base
	main.props_data = []
	main._rebuild()
	var without: int = main.objects_root.get_child_count()
	print("terrain      : %s" % main.terrain.hash_hex)
	print("no bridge    : %d objects" % without)

	var with_bridge := _village(true)
	main.village = with_bridge
	main._rebuild()
	var with_count: int = main.objects_root.get_child_count()
	print("with bridge  : %d objects (+%d)" % [with_count, with_count - without])

	# A three cell deck is three slabs and six rails.
	var added: int = with_count - without
	print("deck parts   : %s" % ("ok" if added == 9 else "WRONG, expected 9"))

	# And the poll has to notice that the two are not the same village, or a bridge built
	# while the viewer is open would never appear.
	main.village = base
	var sig_a: String = main._signature()
	main.village = with_bridge
	var sig_b: String = main._signature()
	print("change seen  : %s" % ("ok" if sig_a != sig_b else "NO - signature did not move"))
	quit(0)

func _village(with_bridge: bool) -> Dictionary:
	var v := {
		"island": { "name": "Test", "seed": 1337, "terrainHash": "f7ec71ac" },
		"grid": { "size": 64 },
		"cleared": [], "paths": [], "districts": [], "polders": [], "active": [],
		"buildings": [
			{ "id": "civic:townhall", "kind": "civic", "tier": "civic", "label": "Town Hall",
			  "plot": { "gx": 31, "gz": 26, "w": 3, "d": 3, "rot": 2 } },
		],
		"bridges": [],
	}
	if with_bridge:
		# Straight across the river mouth on the seed-1337 island.
		v["bridges"] = [{ "id": "bridge:test", "axis": "x", "cells": [[39, 52], [40, 52], [41, 52]] }]
	return v
