extends Node3D

const SERVER := "http://localhost:4747"
const CELL := 1.0
const WALK_SPEED := 8.0
const LOOK_SPEED := 0.006
const FIELD_Y := 0.0

var camera: Camera3D
var player := Vector3(0.0, 16.0, 24.0)
var yaw := 0.0
var pitch := -0.55
var dragging := false

var root: Node3D
var status: Label
var requests_left := 0
var village := {}
var props_data := []

var mats := {}

func _ready() -> void:
	_build_shell()
	_make_materials()
	_fetch_world()
	_update_camera()

func _process(delta: float) -> void:
	var input := Vector2.ZERO
	if Input.is_key_pressed(KEY_W): input.y -= 1.0
	if Input.is_key_pressed(KEY_S): input.y += 1.0
	if Input.is_key_pressed(KEY_A): input.x -= 1.0
	if Input.is_key_pressed(KEY_D): input.x += 1.0
	if Input.is_key_pressed(KEY_Q): player.y += WALK_SPEED * delta
	if Input.is_key_pressed(KEY_E): player.y -= WALK_SPEED * delta
	if input.length() > 1.0: input = input.normalized()

	var forward := Vector3(sin(yaw), 0.0, -cos(yaw))
	var right := Vector3(cos(yaw), 0.0, sin(yaw))
	player += (right * input.x + forward * -input.y) * WALK_SPEED * delta
	player.y = max(player.y, 2.0)
	_update_camera()

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_RIGHT:
		dragging = event.pressed
		return
	if event is InputEventMouseMotion and dragging:
		yaw -= event.relative.x * LOOK_SPEED
		pitch = clamp(pitch - event.relative.y * LOOK_SPEED, -1.25, 0.1)
		_update_camera()

func _build_shell() -> void:
	root = Node3D.new()
	root.name = "Island"
	add_child(root)

	camera = Camera3D.new()
	camera.fov = 58.0
	add_child(camera)

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50, -35, 0)
	sun.light_energy = 2.3
	add_child(sun)

	var canvas := CanvasLayer.new()
	add_child(canvas)
	status = Label.new()
	status.position = Vector2(18, 16)
	status.text = "Loading Promptholm..."
	status.add_theme_font_size_override("font_size", 22)
	status.add_theme_color_override("font_color", Color(0.92, 0.98, 0.93))
	canvas.add_child(status)

func _make_materials() -> void:
	mats.land = _mat(Color(0.13, 0.36, 0.25))
	mats.water = _mat(Color(0.08, 0.24, 0.34))
	mats.path = _mat(Color(0.62, 0.54, 0.40))
	mats.town = _mat(Color(0.46, 0.43, 0.36))
	mats.house = _mat(Color(0.76, 0.49, 0.28))
	mats.civic = _mat(Color(0.86, 0.70, 0.36))
	mats.shed = _mat(Color(0.46, 0.57, 0.72))
	mats.district = _mat(Color(0.26, 0.74, 0.70))
	mats.tree = _mat(Color(0.12, 0.45, 0.20))
	mats.panel = _mat(Color(0.84, 0.88, 0.82))
	mats.lamp = _mat(Color(1.0, 0.82, 0.34))
	mats.dark = _mat(Color(0.18, 0.12, 0.08))

func _mat(color: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	return m

func _fetch_world() -> void:
	requests_left = 2
	_http(SERVER + "/village.json?ts=" + str(Time.get_ticks_msec()), _on_village)
	_http(SERVER + "/api/props", _on_props)

func _http(url: String, callback: Callable) -> void:
	var req := HTTPRequest.new()
	add_child(req)
	req.request_completed.connect(callback.bind(req))
	var err := req.request(url)
	if err != OK:
		callback.call(0, 0, PackedStringArray(), PackedByteArray(), req)

func _on_village(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray, req: HTTPRequest) -> void:
	if code == 200:
		var parsed = JSON.parse_string(body.get_string_from_utf8())
		if typeof(parsed) == TYPE_DICTIONARY:
			village = parsed
	req.queue_free()
	_done_request()

func _on_props(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray, req: HTTPRequest) -> void:
	if code == 200:
		var parsed = JSON.parse_string(body.get_string_from_utf8())
		if typeof(parsed) == TYPE_DICTIONARY and parsed.has("props") and typeof(parsed.props) == TYPE_ARRAY:
			props_data = parsed.props
	req.queue_free()
	_done_request()

func _done_request() -> void:
	requests_left -= 1
	if requests_left > 0:
		return
	if village.is_empty():
		village = _sample_village()
		props_data = []
		status.text = "Sample island - start the Node server for live data"
	else:
		status.text = "%s - %d buildings, %d props" % [village.get("island", {}).get("name", "Promptholm"), village.get("buildings", []).size(), props_data.size()]
	_draw_island()

func _draw_island() -> void:
	for child in root.get_children():
		child.queue_free()

	var size := int(village.get("grid", {}).get("size", 64))
	_draw_base(size)
	_draw_cells(village.get("cleared", []), mats.town, 0.015, Vector2(0.92, 0.92))
	for p in village.get("paths", []):
		_draw_cells(p.get("cells", []), mats.path, 0.035, Vector2(0.74, 0.74))
	_draw_districts(village.get("districts", []))
	_draw_buildings(village.get("buildings", []))
	_draw_props(props_data)

func _draw_base(size: int) -> void:
	var sea := MeshInstance3D.new()
	var sea_mesh := PlaneMesh.new()
	sea_mesh.size = Vector2(size + 10, size + 10)
	sea.mesh = sea_mesh
	sea.position = Vector3(0, -0.04, 0)
	sea.material_override = mats.water
	root.add_child(sea)

	var land := MeshInstance3D.new()
	var land_mesh := PlaneMesh.new()
	land_mesh.size = Vector2(size, size)
	land.mesh = land_mesh
	land.position = Vector3(0, 0, 0)
	land.material_override = mats.land
	root.add_child(land)

func _draw_cells(cells: Array, mat: Material, y: float, footprint: Vector2) -> void:
	for cell in cells:
		if typeof(cell) != TYPE_ARRAY or cell.size() < 2:
			continue
		_add_box(_cell_to_world(cell[0], cell[1], y), Vector3(footprint.x, 0.035, footprint.y), mat)

func _draw_districts(districts: Array) -> void:
	for d in districts:
		var c = d.get("center", null)
		if typeof(c) != TYPE_ARRAY or c.size() < 2:
			continue
		var pos := _cell_to_world(c[0], c[1], 0.08)
		_add_cylinder(pos, 0.45, 0.12, mats.district)
		_add_label(String(d.get("name", "district")), pos + Vector3(0, 0.7, 0))

func _draw_buildings(buildings: Array) -> void:
	for b in buildings:
		var plot = b.get("plot", null)
		if typeof(plot) != TYPE_DICTIONARY:
			continue
		var gx := float(plot.get("gx", 32))
		var gz := float(plot.get("gz", 32))
		var w := float(plot.get("w", 1))
		var dep := float(plot.get("d", 1))
		var pos := _cell_to_world(gx + w * 0.5 - 0.5, gz + dep * 0.5 - 0.5, 0.35)
		var kind := String(b.get("kind", "house"))
		var mat = mats.civic if kind == "civic" else (mats.shed if kind == "shed" else mats.house)
		_add_box(pos, Vector3(max(0.6, w * 0.76), 0.7, max(0.6, dep * 0.76)), mat)
		_add_label(String(b.get("name", b.get("label", kind))), pos + Vector3(0, 0.75, 0))

func _draw_props(props: Array) -> void:
	for p in props:
		var x := float(p.get("x", 0.0))
		var z := float(p.get("z", 0.0))
		var kind := String(p.get("kind", "prop"))
		var pos := Vector3(x, 0.25, z)
		match kind:
			"tree", "pine":
				_add_cylinder(pos + Vector3(0, 0.25, 0), 0.28, 0.9, mats.tree)
			"lamp":
				_add_cylinder(pos + Vector3(0, 0.35, 0), 0.08, 0.7, mats.dark)
				_add_sphere(pos + Vector3(0, 0.8, 0), 0.18, mats.lamp)
			"panel":
				_add_box(pos + Vector3(0, 0.65, 0), Vector3(float(p.get("length", 1.5) if p.get("length", null) != null else 1.5), 1.0, 0.08), mats.panel)
				_add_label(String(p.get("label", p.get("face", "panel"))), pos + Vector3(0, 1.35, 0))
			_:
				_add_box(pos, Vector3(0.35, 0.35, 0.35), mats.civic)

func _cell_to_world(gx, gz, y: float) -> Vector3:
	var size := float(village.get("grid", {}).get("size", 64))
	return Vector3((float(gx) + 0.5) - size * 0.5, y, (float(gz) + 0.5) - size * 0.5)

func _add_box(pos: Vector3, size: Vector3, mat: Material) -> MeshInstance3D:
	var n := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = size
	n.mesh = mesh
	n.position = pos
	n.material_override = mat
	root.add_child(n)
	return n

func _add_cylinder(pos: Vector3, radius: float, height: float, mat: Material) -> MeshInstance3D:
	var n := MeshInstance3D.new()
	var mesh := CylinderMesh.new()
	mesh.top_radius = radius
	mesh.bottom_radius = radius
	mesh.height = height
	n.mesh = mesh
	n.position = pos
	n.material_override = mat
	root.add_child(n)
	return n

func _add_sphere(pos: Vector3, radius: float, mat: Material) -> MeshInstance3D:
	var n := MeshInstance3D.new()
	var mesh := SphereMesh.new()
	mesh.radius = radius
	mesh.height = radius * 2.0
	n.mesh = mesh
	n.position = pos
	n.material_override = mat
	root.add_child(n)
	return n

func _add_label(text: String, pos: Vector3) -> void:
	var label := Label3D.new()
	label.text = text
	label.font_size = 28
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.outline_size = 8
	label.modulate = Color(0.95, 0.97, 0.90)
	label.position = pos
	root.add_child(label)

func _update_camera() -> void:
	camera.position = player
	camera.rotation = Vector3(pitch, yaw, 0.0)

func _sample_village() -> Dictionary:
	return {
		"grid": { "size": 24 },
		"island": { "name": "Sample Promptholm" },
		"cleared": [[11,11], [12,11], [11,12], [12,12]],
		"paths": [{ "cells": [[12,12], [12,13], [12,14], [12,15]] }],
		"districts": [{ "name": "Sample", "center": [10, 10] }],
		"buildings": [
			{ "kind": "house", "name": "First house", "plot": { "gx": 10, "gz": 10, "w": 2, "d": 2 } },
			{ "kind": "civic", "name": "Board", "plot": { "gx": 13, "gz": 12, "w": 1, "d": 1 } }
		]
	}
