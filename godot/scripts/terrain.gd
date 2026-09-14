# Port of shared/terrain.mjs. The island is not in village.json: only the seed is, and
# both the Node layout and the browser renderer build the ground from it. Godot has to
# agree with them to the last bit, or a house lands in the sea here and on grass there.
# hash_heights() against island.terrainHash is the check that says whether it does.
class_name PmTerrain
extends RefCounted

const SEA_LEVEL := 0.0
const BEACH_MAX := 0.35
const BUILD_SLOPE_MAX := 0.6
const BUILD_HEIGHT_MAX := 4.2
const POLDER_H := 96.0 / 256.0
const DIKE_H := 224.0 / 256.0

const RIVER_BED := -0.55
const RIVER_RISE := 1.5
const RIVER_W0 := 0.6
const RIVER_W1 := 0.95
const RIVER_PULL := 0.45
const RIVER_WOBBLE := 0.16
const RIVER_CENTRE_KEEP := 11.0
const RIVER_MOUTH_REACH := 2
const RIVER_NEAR := 4
const LAKE_R := 4.0

const DIRS16 := [
	Vector2(1, 0), Vector2(0.9238795325112867, 0.3826834323650898),
	Vector2(0.7071067811865476, 0.7071067811865476), Vector2(0.3826834323650898, 0.9238795325112867),
	Vector2(0, 1), Vector2(-0.3826834323650898, 0.9238795325112867),
	Vector2(-0.7071067811865476, 0.7071067811865476), Vector2(-0.9238795325112867, 0.3826834323650898),
	Vector2(-1, 0), Vector2(-0.9238795325112867, -0.3826834323650898),
	Vector2(-0.7071067811865476, -0.7071067811865476), Vector2(-0.3826834323650898, -0.9238795325112867),
	Vector2(0, -1), Vector2(0.3826834323650898, -0.9238795325112867),
	Vector2(0.7071067811865476, -0.7071067811865476), Vector2(0.9238795325112867, -0.3826834323650898),
]

var size := 64
var N := 65
var half := 32.0
var H := PackedFloat64Array()
var island_seed := 0
var hill_centre := Vector2.ZERO
var lake_centre := Vector2.ZERO
var rivers: Array = []
var river_cells: Array = []
var river_bank_cells: Array = []
var land_cells: Array = []
var beach_cells: Array = []
var coast_cells: Array = []
var _wet := PackedByteArray()
var hash_hex := ""

func _init(seed_number: int, grid_size: int = 64, polders: Array = []) -> void:
	island_seed = seed_number
	size = grid_size
	N = size + 1
	half = size / 2.0
	_build(polders)

func _build(polders: Array) -> void:
	H = PackedFloat64Array()
	H.resize(N * N)
	var n_shape := PmSimplex.new(PmRng.hash32(str(island_seed) + ":shape"))
	var n_coast := PmSimplex.new(PmRng.hash32(str(island_seed) + ":coast"))
	var rng := PmRng.new(island_seed).fork("terrain")

	var k_hill := rng.int_n(16)
	var hill_dist := 11.0 + rng.rangef(0.0, 4.0)
	hill_centre = DIRS16[k_hill] * hill_dist
	var k_sh := (k_hill + (2 if rng.chance(0.5) else 14)) % 16
	var shoulder_centre: Vector2 = DIRS16[k_sh] * (hill_dist - 2.0)
	var k_lake := (k_hill + 7 + rng.int_n(3)) % 16
	var lake_dist := 8.0 + rng.rangef(0.0, 4.0)
	lake_centre = DIRS16[k_lake] * lake_dist
	var coast_scale := half * 0.9375

	for j in N:
		for i in N:
			var x := i - half
			var z := j - half
			var e01 := n_shape.fbm2(x * 0.055, z * 0.055, 4) * 0.5 + 0.5
			var d := sqrt(x * x + z * z) / coast_scale
			var dw := d + 0.18 * n_coast.fbm2(x * 0.03, z * 0.03, 2)
			var fall := 1.0 - PmSimplex.smoothstep_js(0.55, 1.0, dw)
			var h := (0.35 + 0.65 * e01) * fall * 3.2 - 0.6
			h -= 1.9 * PmSimplex.smoothstep_js(0.9, 1.35, dw)
			var th := clampf(1.0 - _dist_to(x, z, hill_centre) / 8.0, 0.0, 1.0)
			h += 4.6 * _bump(th)
			var ts := clampf(1.0 - _dist_to(x, z, shoulder_centre) / 6.0, 0.0, 1.0)
			h += 1.8 * _bump(ts)
			var tl := clampf(1.0 - _dist_to(x, z, lake_centre) / LAKE_R, 0.0, 1.0)
			var sl := _bump(tl)
			if sl > 0.0:
				h = minf(h, lerpf(0.3, -0.9, sl))
			H[i + j * N] = h

	H = _box_blur(_box_blur(H))
	_quantise()

	# Rivers are drawn from a fork of their own: taking these numbers from rng would
	# shift every later draw and move the hill on every island that already exists.
	var rr := PmRng.new(island_seed).fork("rivers")
	var courses: Array = []
	var sides: Array = [1, -1] if rr.chance(0.55) else [1 if rr.chance(0.5) else -1]
	for side: int in sides:
		var k_src := (k_hill + side * (2 + rr.int_n(2)) + 16) % 16
		var k_end := (k_hill + side * (4 + rr.int_n(3)) + 16) % 16
		var start := Vector2i(
			int(PmRng.js_round(hill_centre.x + DIRS16[k_src].x * 3.0 + half - 0.5)),
			int(PmRng.js_round(hill_centre.y + DIRS16[k_src].y * 3.0 + half - 0.5)))
		var mouth: Vector2 = DIRS16[k_end] * (half - 2.0)
		var course := _river_course(start, mouth)
		if course.size() >= 6:
			courses.append(course)
	for course in courses:
		_carve_river(course)
	if courses.size() > 0:
		_quantise()
	rivers = courses

	for p in polders:
		for c in p.get("cells", []):
			_set_cell(int(c[0]), int(c[1]), POLDER_H)
		for c in p.get("dike", []):
			_set_cell(int(c[0]), int(c[1]), DIKE_H)

	_classify()
	hash_hex = hash_heights()

# ---- helpers ----------------------------------------------------------------

static func _dist_to(x: float, z: float, c: Vector2) -> float:
	var dx := x - c.x
	var dz := z - c.y
	return sqrt(dx * dx + dz * dz)

static func _bump(t: float) -> float:
	return t * t * (3.0 - 2.0 * t)

func _box_blur(src: PackedFloat64Array) -> PackedFloat64Array:
	var out := PackedFloat64Array()
	out.resize(N * N)
	for j in N:
		for i in N:
			var sum := 0.0
			var cnt := 0
			for dj in range(-1, 2):
				var jj := j + dj
				if jj < 0 or jj >= N:
					continue
				for di in range(-1, 2):
					var ii := i + di
					if ii < 0 or ii >= N:
						continue
					sum += src[ii + jj * N]
					cnt += 1
			out[i + j * N] = sum / cnt
	return out

func _quantise() -> void:
	for k in H.size():
		H[k] = maxf(-2.5, PmRng.js_round(H[k] * 256.0) / 256.0)

func _set_cell(gx: int, gz: int, v: float) -> void:
	if gx < 0 or gz < 0 or gx >= size or gz >= size:
		return
	H[gx + gz * N] = v
	H[gx + 1 + gz * N] = v
	H[gx + (gz + 1) * N] = v
	H[gx + 1 + (gz + 1) * N] = v

func _cell_h(gx: int, gz: int) -> float:
	return 0.25 * (H[gx + gz * N] + H[gx + 1 + gz * N] + H[gx + (gz + 1) * N] + H[gx + 1 + (gz + 1) * N])

# ---- rivers -----------------------------------------------------------------

func _river_course(start: Vector2i, mouth: Vector2) -> Array:
	var course: Array = []
	var seen := PackedByteArray()
	seen.resize(size * size)
	var cur := start
	if not in_grid(cur.x, cur.y) or _middle(cur.x, cur.y):
		return course
	for step in size * 3:
		course.append(cur)
		seen[cur.x + cur.y * size] = 1
		if _cell_h(cur.x, cur.y) < SEA_LEVEL:
			break
		# Stop where the beach begins and let the sea do the rest, but only where the
		# water is near enough: stopping on a flat that is merely low leaves a pond.
		if _cell_h(cur.x, cur.y) < BEACH_MAX and _sea_within(cur.x, cur.y, RIVER_MOUTH_REACH):
			break
		var d0 := _to_mouth(cur.x, cur.y, mouth)
		var best := Vector2i.ZERO
		var has_best := false
		var best_score := INF
		for dir in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
			var nx: int = cur.x + dir.x
			var nz: int = cur.y + dir.y
			if not in_grid(nx, nz) or seen[nx + nz * size] == 1 or _middle(nx, nz):
				continue
			var wob := (float(PmRng.hash32("river:%d:%d" % [nx, nz]) % 1000) / 1000.0 - 0.5) * 2.0 * RIVER_WOBBLE
			var score := _cell_h(nx, nz) + RIVER_PULL * (_to_mouth(nx, nz, mouth) - d0) + wob
			if score < best_score:
				best_score = score
				best = Vector2i(nx, nz)
				has_best = true
		if not has_best:
			break
		cur = best
	return course

func _to_mouth(gx: int, gz: int, mouth: Vector2) -> float:
	var x := gx - half + 0.5
	var z := gz - half + 0.5
	var dx := x - mouth.x
	var dz := z - mouth.y
	return sqrt(dx * dx + dz * dz)

func _middle(gx: int, gz: int) -> bool:
	var x := gx - half + 0.5
	var z := gz - half + 0.5
	return sqrt(x * x + z * z) < RIVER_CENTRE_KEEP

func _sea_within(gx: int, gz: int, r: int) -> bool:
	for dz in range(-r, r + 1):
		for dx in range(-r, r + 1):
			var nx := gx + dx
			var nz := gz + dz
			if not in_grid(nx, nz) or _cell_h(nx, nz) < SEA_LEVEL:
				return true
	return false

func _carve_river(course: Array) -> void:
	var n := course.size()
	var reach := int(ceil(RIVER_W1 - RIVER_BED / RIVER_RISE)) + 2
	for s in n:
		var c: Vector2i = course[s]
		var w := RIVER_W0 + (RIVER_W1 - RIVER_W0) * (float(s) / (n - 1) if n > 1 else 1.0)
		var cx := c.x + 0.5
		var cz := c.y + 0.5
		for j in range(maxi(0, c.y - reach), mini(size, c.y + reach) + 1):
			for i in range(maxi(0, c.x - reach), mini(size, c.x + reach) + 1):
				var dx := i - cx
				var dz := j - cz
				var t := RIVER_BED + RIVER_RISE * maxf(0.0, sqrt(dx * dx + dz * dz) - w)
				var k := i + j * N
				if t < H[k]:
					H[k] = t

# ---- classification ---------------------------------------------------------

# Which cells the rivers actually made wet, and which ended up as their banks. Derived
# from is_water() rather than from the course, so what is drawn and what a bridge may be
# thrown over can never disagree with what the layout calls water.
func _classify() -> void:
	_wet = PackedByteArray()
	_wet.resize(size * size)
	river_cells = []
	river_bank_cells = []
	land_cells = []
	beach_cells = []
	coast_cells = []

	var near_river := PackedByteArray()
	near_river.resize(size * size)
	for course in rivers:
		for c in course:
			for dz in range(-RIVER_NEAR, RIVER_NEAR + 1):
				for dx in range(-RIVER_NEAR, RIVER_NEAR + 1):
					var nx: int = c.x + dx
					var nz: int = c.y + dz
					if in_grid(nx, nz):
						near_river[nx + nz * size] = 1

	for gz in size:
		for gx in size:
			if near_river[gx + gz * size] == 0 or not is_water(gx, gz):
				continue
			_wet[gx + gz * size] = 1
			river_cells.append(Vector2i(gx, gz))

	for gz in size:
		for gx in size:
			var k := gx + gz * size
			if near_river[k] == 0 or _wet[k] == 1:
				continue
			var touches := gx + 1 < size and _wet[gx + 1 + gz * size] == 1
			if not touches and gx > 0:
				touches = _wet[gx - 1 + gz * size] == 1
			if not touches and gz + 1 < size:
				touches = _wet[gx + (gz + 1) * size] == 1
			if not touches and gz > 0:
				touches = _wet[gx + (gz - 1) * size] == 1
			if touches:
				river_bank_cells.append(Vector2i(gx, gz))

	for gz in size:
		for gx in size:
			if not is_land(gx, gz):
				continue
			land_cells.append(Vector2i(gx, gz))
			if is_beach(gx, gz):
				beach_cells.append(Vector2i(gx, gz))
			if is_water(gx + 1, gz) or is_water(gx - 1, gz) or is_water(gx, gz + 1) or is_water(gx, gz - 1):
				coast_cells.append(Vector2i(gx, gz))

# ---- queries ----------------------------------------------------------------

func in_grid(gx: int, gz: int) -> bool:
	return gx >= 0 and gz >= 0 and gx < size and gz < size

func corner(i: int, j: int) -> float:
	return H[clampi(i, 0, size) + clampi(j, 0, size) * N]

func corners_of(gx: int, gz: int) -> Array:
	return [corner(gx, gz), corner(gx + 1, gz), corner(gx, gz + 1), corner(gx + 1, gz + 1)]

func height_at(gx: int, gz: int) -> float:
	var c := corners_of(gx, gz)
	return (c[0] + c[1] + c[2] + c[3]) * 0.25

func slope(gx: int, gz: int) -> float:
	var c := corners_of(gx, gz)
	return maxf(maxf(c[0], c[1]), maxf(c[2], c[3])) - minf(minf(c[0], c[1]), minf(c[2], c[3]))

func is_land(gx: int, gz: int) -> bool:
	if not in_grid(gx, gz):
		return false
	var c := corners_of(gx, gz)
	return c[0] >= SEA_LEVEL and c[1] >= SEA_LEVEL and c[2] >= SEA_LEVEL and c[3] >= SEA_LEVEL

func is_water(gx: int, gz: int) -> bool:
	return not in_grid(gx, gz) or height_at(gx, gz) < SEA_LEVEL

func is_beach(gx: int, gz: int) -> bool:
	if not is_land(gx, gz):
		return false
	var c := corners_of(gx, gz)
	return c[0] < BEACH_MAX and c[1] < BEACH_MAX and c[2] < BEACH_MAX and c[3] < BEACH_MAX

func is_buildable(gx: int, gz: int) -> bool:
	if not is_land(gx, gz) or is_beach(gx, gz):
		return false
	return slope(gx, gz) < BUILD_SLOPE_MAX and height_at(gx, gz) < BUILD_HEIGHT_MAX

func is_river(gx: int, gz: int) -> bool:
	return in_grid(gx, gz) and _wet[gx + gz * size] == 1

# Bilinear height at a world position; used to stand figures and props on the ground.
func world_height(x: float, z: float) -> float:
	var fx := clampf(x + half, 0.0, size - 1e-6)
	var fz := clampf(z + half, 0.0, size - 1e-6)
	var i := int(floor(fx))
	var j := int(floor(fz))
	var u := fx - i
	var v := fz - j
	var h00 := corner(i, j)
	var h10 := corner(i + 1, j)
	var h01 := corner(i, j + 1)
	var h11 := corner(i + 1, j + 1)
	return lerpf(lerpf(h00, h10, u), lerpf(h01, h11, u), v)

func cell_world(gx: int, gz: int) -> Vector2:
	return Vector2(gx - half + 0.5, gz - half + 0.5)

func hash_heights() -> String:
	var h := 0x811c9dc5
	for k in H.size():
		var v := int(PmRng.js_round(H[k] * 256.0)) & PmRng.U32
		h = (h ^ (v & 0xff)) & PmRng.U32
		h = PmRng.imul(h, 0x01000193)
		h = (h ^ ((v >> 8) & 0xff)) & PmRng.U32
		h = PmRng.imul(h, 0x01000193)
	return "%08x" % (h & PmRng.U32)
