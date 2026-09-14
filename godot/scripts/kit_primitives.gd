# Base class for the procedural building kit.  Holds every mesh primitive and the
# colour palette so that module scripts (kit_houses, kit_civics, …) can call them
# through a reference passed in _init.
class_name PmKitPrimitives
extends RefCounted

const PALETTE := {
	"fable": { "wall": 0xcfc4e6, "trim": 0x6e5aa8, "roof": 0xb87333, "accent": 0x7a4fb0, "glow": 0xffd27f },
	"opus": { "wall": 0xa8a59e, "trim": 0x6f6b64, "roof": 0x4c5566, "accent": 0x5a3a24, "glow": 0xffcf7a },
	"sonnet": { "wall": 0xf0e2c8, "trim": 0x6b4a2f, "roof": 0x5c8a4a, "accent": 0x8a4b2a, "glow": 0xffd88a },
	"haiku": { "wall": 0xd9b98c, "trim": 0x7d5a3a, "roof": 0xc9a75c, "accent": 0x5a3c28, "glow": 0xffe0a0 },
	"unknown": { "wall": 0x9a9a9a, "trim": 0x6f6f6f, "roof": 0x6f6f6f, "accent": 0x555555, "glow": 0xffffff },
}

const C := {
	"foundation": 0x8d8577, "wood": 0x8b5e3c, "darkWood": 0x5a3c28, "canvas": 0xe9d8b4,
	"stripe": 0xc86b4a, "anvil": 0x3a3a3f, "copper": 0xb87333, "stone": 0xa8a59e,
	"slate": 0x4c5566, "plank": 0xb07a4a, "blueprint": 0x4d7ec9, "paper": 0xf5efe0,
	"thatch": 0xc9a75c, "brick": 0x9c5a44, "glass": 0xffd27f, "white": 0xf5efe0,
	"green": 0x6fb84a, "red": 0xd94f3d, "blue": 0x3d7ed9, "gold": 0xd9a33d, "iron": 0x3a3a3f,
}

const TIER_INDEX := {
	"tent": 0, "hut": 1, "cottage": 2, "house": 3, "manor": 4, "keep": 5, "shed": -1, "civic": -2,
}

const BRIM := 0.004

var _root: Node3D
var _part_count := 0
var _mesh_cache := {}
var _mat_cache := {}

func _c(hex: int) -> Color:
	return Color8(hex >> 16 & 0xff, hex >> 8 & 0xff, hex & 0xff)

func _material(hex: int, emissive: bool) -> Material:
	var key := "%d:%d" % [hex, 1 if emissive else 0]
	if _mat_cache.has(key):
		return _mat_cache[key]
	var m := StandardMaterial3D.new()
	var col := _c(hex)
	m.albedo_color = col
	m.roughness = 0.85
	if emissive:
		m.emission_enabled = true
		m.emission = col
		m.emission_energy = 1.6
	_mat_cache[key] = m
	return m

# Rotation order matches `place()` in the browser: rotateY, rotateX, rotateZ, with a
# right-handed turn about each axis in turn. Written in Godot's row convention as
# Ry * Rx * Rz, which is what the local-axis sequence comes to.
func _basis(o: Dictionary) -> Basis:
	return Basis(Vector3.UP, float(o.get("ry", 0.0))) \
		* Basis(Vector3.RIGHT, float(o.get("rx", 0.0))) \
		* Basis(Vector3.BACK, float(o.get("rz", 0.0)))

func _emit(mesh: Mesh, hex: int, o: Dictionary, offset: Vector3 = Vector3.ZERO) -> MeshInstance3D:
	var b := _basis(o)
	var n := MeshInstance3D.new()
	n.mesh = mesh
	n.basis = b
	n.position = Vector3(float(o.get("x", 0.0)), float(o.get("y", 0.0)), float(o.get("z", 0.0))) \
		+ b * offset
	n.material_override = _material(hex, bool(o.get("emissive", false)))
	_root.add_child(n)
	_part_count += 1
	return n

func _cached_mesh(key: String, build: Callable) -> Mesh:
	if not _mesh_cache.has(key):
		_mesh_cache[key] = build.call()
	return _mesh_cache[key]

func _box(w: float, h: float, d: float, hex: int, o := {}) -> MeshInstance3D:
	return _emit(_cached_mesh("box:%s" % _f3(w, h, d), func() -> Mesh:
		var m := BoxMesh.new()
		m.size = Vector3(w, h, d)
		return m
	), hex, o, Vector3(0, h * 0.5, 0))

func _cyl(rt: float, rb: float, h: float, seg: int, hex: int, o := {}) -> MeshInstance3D:
	return _emit(_cached_mesh("cyl:%d:%s" % [seg, _f3(rt, rb, h)], func() -> Mesh:
		var m := CylinderMesh.new()
		m.top_radius = rt
		m.bottom_radius = rb
		m.height = h
		m.radial_segments = seg
		return m
	), hex, o, Vector3(0, h * 0.5, 0))

func _cone(r: float, h: float, seg: int, hex: int, o := {}) -> MeshInstance3D:
	return _emit(_cached_mesh("cone:%d:%s" % [seg, _f3(r, 0.0, h)], func() -> Mesh:
		var m := CylinderMesh.new()
		m.top_radius = 0.0
		m.bottom_radius = r
		m.height = h
		m.radial_segments = seg
		return m
	), hex, o, Vector3(0, h * 0.5, 0))

func _dome(r: float, hex: int, o := {}) -> MeshInstance3D:
	return _emit(_cached_mesh("dome:%s" % _f3(r, r, r), func() -> Mesh:
		var m := SphereMesh.new()
		m.radius = r
		m.height = r * 2.0
		m.is_hemisphere = true
		m.radial_segments = 10
		m.rings = 5
		return m
	), hex, o)

func _sphere(r: float, hex: int, o := {}) -> MeshInstance3D:
	return _emit(_cached_mesh("sphere:%s" % _f3(r, r, r), func() -> Mesh:
		var m := SphereMesh.new()
		m.radius = r
		m.height = r * 2.0
		m.radial_segments = 7
		m.rings = 5
		return m
	), hex, o)

func _gable(w: float, d: float, h: float, hex: int, o := {}) -> MeshInstance3D:
	# gable roof: a triangular prism, base at y = 0, ridge running along x.
	return _emit(_cached_mesh("gable:%s" % _f3(w, d, h), func() -> Mesh:
		var hw := w * 0.5
		var hd := d * 0.5
		var v := PackedVector3Array([
			Vector3(-hw, 0, -hd), Vector3(hw, 0, -hd), Vector3(hw, 0, hd), Vector3(-hw, 0, hd),
			Vector3(-hw, h, 0), Vector3(hw, h, 0),
		])
		# Wound to face out, the same winding the browser uses.
		var f := PackedInt32Array([
			0, 5, 1, 0, 4, 5,
			2, 4, 3, 2, 5, 4,
			0, 3, 4, 1, 5, 2,
			0, 2, 3, 0, 1, 2,
		])
		return _tris_mesh(v, f)
	), hex, o)

func _pyramid(w: float, d: float, h: float, hex: int, o := {}) -> MeshInstance3D:
	return _emit(_cached_mesh("pyramid:%s" % _f3(w, d, h), func() -> Mesh:
		var hw := w * 0.5
		var hd := d * 0.5
		var v := PackedVector3Array([
			Vector3(-hw, 0, -hd), Vector3(hw, 0, -hd), Vector3(hw, 0, hd), Vector3(-hw, 0, hd),
			Vector3(0, h, 0),
		])
		var f := PackedInt32Array([
			0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4,  # the four slopes
			0, 2, 1, 0, 3, 2,                      # the underside
		])
		return _tris_mesh(v, f)
	), hex, o)

func _quad(pts: Array, hex: int, o := {}) -> MeshInstance3D:
	# A flat triangle or quad, rendered on both sides like the browser's.
	return _emit(_cached_mesh("quad:%d" % pts.size(), func() -> Mesh:
		var v := PackedVector3Array()
		for p in pts:
			v.append(Vector3(float(p[0]), float(p[1]), float(p[2])))
		var f := PackedInt32Array()
		if pts.size() == 3:
			f = PackedInt32Array([0, 1, 2, 0, 2, 1])
		else:
			f = PackedInt32Array([0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2])
		return _tris_mesh(v, f)
	), hex, o)

# One triangle at a time into a SurfaceTool, so generate_normals() hands each face its
# own flat normal instead of smoothing shared vertices.
func _tris_mesh(v: PackedVector3Array, f: PackedInt32Array) -> Mesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in f.size() / 3:
		st.add_vertex(v[f[i * 3 + 0]])
		st.add_vertex(v[f[i * 3 + 1]])
		st.add_vertex(v[f[i * 3 + 2]])
	st.generate_normals()
	return st.commit()

func _f3(a: float, b: float, c: float) -> String:
	return "%.4f,%.4f,%.4f" % [a, b, c]

# ---------------------------------------------------------------- kit helpers
# How a piece sits inside an assembly: its offsets turn with the assembly, which is what
# lets a bench stand against a wall at an angle without rewriting every number.
func _inside(a: Dictionary, o := {}) -> Dictionary:
	var ry := float(a.get("ry", 0.0))
	var cs := cos(ry)
	var sn := sin(ry)
	var x := float(o.get("x", 0.0))
	var z := float(o.get("z", 0.0))
	var out := {}
	for k in o:
		out[k] = o[k]
	out["x"] = float(a.get("x", 0.0)) + x * cs + z * sn
	out["y"] = float(a.get("y", 0.0)) + float(o.get("y", 0.0))
	out["z"] = float(a.get("z", 0.0)) - x * sn + z * cs
	out["ry"] = float(o.get("ry", 0.0)) + ry
	return out

func _timber_frame(w: float, h: float, d: float, hex: int) -> void:
	var t := 0.035
	for trif in [[0, d * 0.5, 0.0], [0, -d * 0.5, 0.0], [w * 0.5, 0, PI * 0.5], [-w * 0.5, 0, PI * 0.5]]:
		var x: float = trif[0]
		var z: float = trif[1]
		var ry: float = trif[2]
		_box(t, h, t, hex, { "x": x + (-w * 0.3 if ry == 0.0 else 0.0), "y": 0.0, "z": z, "ry": ry })
		_box(t, h, t, hex, { "x": x + (w * 0.3 if ry == 0.0 else 0.0), "y": 0.0, "z": z, "ry": ry })
		_box(w * 0.9, t, t, hex, { "x": x, "y": h - t, "z": z, "ry": ry })

func _window(a := {}) -> void:
	_box(0.13, 0.17, 0.04, int(PALETTE["unknown"]["glow"]), _inside(a, { "emissive": 1 }))

func _door(a := {}) -> void:
	_box(0.16, 0.26, 0.05, int(C["darkWood"]), _inside(a, {}))

func _bench(a := {}) -> void:
	var w := float(a.get("w", 0.46))
	var lx := w * 0.5 - 0.05
	for x in [-lx, lx]:
		_box(0.04, 0.2, 0.04, int(C["iron"]), _inside(a, { "x": x, "z": -0.05 }))
		_box(0.04, 0.2, 0.04, int(C["iron"]), _inside(a, { "x": x, "z": 0.05 }))
	_box(w, 0.035, 0.16, int(a.get("hex", 0xb07a4a)), _inside(a, { "y": 0.2 }))
	_box(w, 0.17, 0.03, int(a.get("hex", 0xb07a4a)), _inside(a, { "y": 0.22, "z": -0.07, "rx": -0.16 }))

func _table(a := {}) -> void:
	var r := float(a.get("r", 0.13))
	var h := float(a.get("h", 0.2))
	_cyl(0.035, 0.045, h, 6, int(C["darkWood"]), _inside(a, {}))
	_cyl(r, r, 0.025, 8, int(a.get("hex", 0xb07a4a)), _inside(a, { "y": h }))

func _chair(a := {}) -> void:
	var w := float(a.get("w", 0.09))
	var h := float(a.get("h", 0.12))
	for leg in [[-0.032, -0.032], [0.032, -0.032], [-0.032, 0.032], [0.032, 0.032]]:
		_box(0.014, h, 0.014, int(C["darkWood"]), _inside(a, { "x": leg[0], "z": leg[1] }))
	_box(w, 0.022, w, int(a.get("hex", 0xb07a4a)), _inside(a, { "y": h }))
	_box(w, 0.12, 0.018, int(C["darkWood"]), _inside(a, { "y": h + 0.022, "z": -0.036 }))
