# Placeholder settler avatar built from primitives: a body, a head, and a wide hat.
# Ported from the shape of playerGeometry() in web/js/walk.js. The mesh is a child
# of the scene and positioned/rotated by PmWalkMode each frame.
class_name PmPlayerAvatar
extends Node3D

const BODY_COLOR := Color8(0x8a, 0x6a, 0x46)    # brown tunic
const HEAD_COLOR := Color8(0xe8, 0xc9, 0xa0)    # skin
const HAT_COLOR := Color8(0xc9, 0xa7, 0x5c)     # straw
const SATCHEL_COLOR := Color8(0x8a, 0x5a, 0x34) # leather

var body_mesh: MeshInstance3D
var head_mesh: MeshInstance3D
var hat_brim: MeshInstance3D
var hat_top: MeshInstance3D
var satchel: MeshInstance3D

func _init() -> void:
	# Body: cylinder, 0.22 wide, 0.55 tall (WALK_CLEARANCE)
	body_mesh = _cylinder(0.11, 0.11, 0.55, BODY_COLOR)
	body_mesh.position = Vector3(0, 0.275, 0)
	add_child(body_mesh)

	# Head: sphere on top
	head_mesh = _sphere(0.1, HEAD_COLOR)
	head_mesh.position = Vector3(0, 0.65, 0)
	add_child(head_mesh)

	# Hat brim: flat wide cylinder
	hat_brim = _cylinder(0.18, 0.18, 0.02, HAT_COLOR)
	hat_brim.position = Vector3(0, 0.76, 0)
	add_child(hat_brim)

	# Hat top: dome
	hat_top = _sphere(0.08, HAT_COLOR)
	hat_top.position = Vector3(0, 0.78, 0)
	add_child(hat_top)

	# Satchel: small box on the side
	satchel = _box(Vector3(0.14, 0.11, 0.06), SATCHEL_COLOR)
	satchel.position = Vector3(0.12, 0.35, -0.03)
	satchel.rotation.y = 0.3
	add_child(satchel)

	# Cast shadows on all parts
	for c in get_children():
		if c is MeshInstance3D:
			c.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON

func _cylinder(r_top: float, r_bot: float, h: float, col: Color) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var m := CylinderMesh.new()
	m.top_radius = r_top
	m.bottom_radius = r_bot
	m.height = h
	mi.mesh = m
	mi.material_override = _mat(col)
	return mi

func _sphere(r: float, col: Color) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var m := SphereMesh.new()
	m.radius = r
	m.height = r * 2.0
	mi.mesh = m
	mi.material_override = _mat(col)
	return mi

func _box(size: Vector3, col: Color) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var m := BoxMesh.new()
	m.size = size
	mi.mesh = m
	mi.material_override = _mat(col)
	return mi

func _mat(col: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = col
	m.roughness = 0.92
	return m
