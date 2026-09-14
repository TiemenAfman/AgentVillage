# Third-person walk mode, ported from web/js/walk.js. Handles camera, movement relative
# to camera direction, gravity, terrain following, building/prop collision, multi-floor
# levels (bridges, roofs), and interactable proximity detection. Feeds off the same
# _render_height() and village data that main.gd already builds.
class_name PmWalkMode
extends RefCounted

# ---- constants (from walk.js) ------------------------------------------------
const WALK_SPEED := 3.4
const RUN_SPEED := 6.6
const TURN_LERP := 0.18
const CAM_BACK := 2.7
const CAM_UP := 1.6
const EYE := 0.9
const JUMP_V := 3.1
const GRAVITY := 12.5
const SWIM_SPEED := 1.9
const SWIM_REACH := 2.0
const WATER_Y := 0.0
const SWIM_SINK := 0.07
const BODY_R := 0.16
const HEAD := 0.55
const STEP_UP := 0.45
const MOUSE_SENS := 0.0042
const PITCH_SENS := 0.0032
const PITCH_MIN := -0.25
const PITCH_MAX := 0.95
const ZOOM_FACTOR := 0.0016
const ZOOM_MIN := 0.35
const ZOOM_MAX := 2.2

# 8 probe directions for shore-reach check
var _probes: Array[Vector2] = []

func _init() -> void:
	for i in 8:
		var a := float(i) / 8.0 * PI * 2.0
		_probes.append(Vector2(cos(a) * SWIM_REACH, sin(a) * SWIM_REACH))

# ---- state -------------------------------------------------------------------
var active := false
var pos := Vector3.ZERO
var yaw := 0.0
var cam_yaw := 0.0
var cam_pitch := 0.28
var bob := 0.0
var vy := 0.0
var grounded := true
var floor_y := 0.0
var swimming := false
var moving := false
var running := false
var paused := false

# Blockers: axis-aligned rects {x, z, hx, hz} grown by BODY_R. Kept untyped arrays: the
# dictionaries come from main.gd as Variant values, and a typed Array[Dictionary] would
# reject a plain Variant Array at assignment time.
var blockers: Array = []
# Peer blockers: circles {x, z, r} grown by BODY_R (for multiplayer later)
var peer_blockers: Array = []
# Interactables: {id, kind, x, z, r, label}
var interactables: Array = []
var near: Dictionary = {}

# Camera zoom
var cam_back := CAM_BACK

# Multi-floor levels: Dictionary mapping cell_index (gx + gz * grid_size) -> Array[float]
var levels: Dictionary = {}
var grid_size := 64
var grid_half := 32.0

# References set by main.gd
var camera: Camera3D = null
var terrain: PmTerrain = null
var render_height_func: Callable = Callable()  # (x: float, z: float) -> float

# Callbacks
var on_interact: Callable = Callable()  # (near: Dictionary) -> void

# ---- input state -------------------------------------------------------------
var _keys := {}
var _dragging := false
var _mouse_delta := Vector2.ZERO

# ---- levels ------------------------------------------------------------------

func set_levels(map: Dictionary) -> void:
	levels = map

func set_blockers(list: Array) -> void:
	blockers = list

func set_interactables(list: Array) -> void:
	interactables = list

func _levels_at(x: float, z: float) -> Array:
	var gx := int(round(x + grid_half - 0.5))
	var gz := int(round(z + grid_half - 0.5))
	var key := gx + gz * grid_size
	if levels.has(key):
		return levels[key]
	return []

func ground_at(x: float, z: float, from: float = INF) -> float:
	var best := _render_h(x, z)
	var above := _levels_at(x, z)
	if above.is_empty():
		return best
	var reach := from + STEP_UP
	for y in above:
		if y <= reach and y > best:
			best = y
	return best

func ceiling_at(x: float, z: float, from: float) -> float:
	var above := _levels_at(x, z)
	if above.is_empty():
		return INF
	var best := INF
	var reach := from + STEP_UP
	for y in above:
		if y > reach and y < best:
			best = y
	return best

func _render_h(x: float, z: float) -> float:
	if render_height_func.is_valid():
		return render_height_func.call(x, z)
	if terrain != null:
		return terrain.world_height(x, z)
	return 0.0

# ---- shore check -------------------------------------------------------------

func shore_within_reach(x: float, z: float, from: float) -> bool:
	for p in _probes:
		if ground_at(x + p.x, z + p.y, from) >= 0.06:
			return true
	return false

# ---- collision --------------------------------------------------------------

func blocked(x: float, z: float, from: float = INF) -> bool:
	var g := ground_at(x, z, from)
	if g < 0.06 and not shore_within_reach(x, z, from):
		return true
	for b in blockers:
		if absf(x - b.x) < b.hx + BODY_R and absf(z - b.z) < b.hz + BODY_R:
			return true
	for b in peer_blockers:
		var dx: float = x - b.x
		var dz: float = z - b.z
		if dx * dx + dz * dz < (b.r + BODY_R) * (b.r + BODY_R):
			return true
	return false

# ---- enter / exit ------------------------------------------------------------

func enter(at: Vector2, facing: Vector2 = Vector2.ZERO) -> void:
	var x := at.x
	var z := at.y
	# step back until standing somewhere legal
	for i in 40:
		if not blocked(x, z):
			break
		x += 0.4
		z += 0.25
	pos = Vector3(x, ground_at(x, z), z)
	floor_y = pos.y
	vy = 0.0
	grounded = true
	swimming = false
	if facing != Vector2.ZERO:
		yaw = atan2(facing.x - x, facing.y - z)
		cam_yaw = yaw
	else:
		yaw = 0.0
		cam_yaw = 0.0
	cam_pitch = 0.44
	active = true
	paused = false
	_keys.clear()

func exit() -> void:
	active = false
	_keys.clear()

# ---- input (called from main.gd _unhandled_input) ---------------------------

func handle_input(event: InputEvent) -> void:
	if not active or paused:
		return
	if event is InputEventKey:
		_handle_key(event)
	elif event is InputEventMouseButton:
		_handle_mouse_button(event)
	elif event is InputEventMouseMotion:
		_handle_mouse_motion(event)

func _handle_key(event: InputEventKey) -> void:
	var k := event.keycode
	if event.ctrl_pressed or event.meta_pressed or event.alt_pressed:
		return
	if event.pressed:
		_keys[k] = true
		match k:
			KEY_SPACE:
				_jump()
			KEY_C:
				# crouch placeholder — not implemented yet
				pass
			KEY_E:
				if not near.is_empty():
					if on_interact.is_valid():
						on_interact.call(near)
			KEY_ESCAPE:
				exit()
	else:
		_keys.erase(k)

func _handle_mouse_button(event: InputEventMouseButton) -> void:
	if event.button_index == MOUSE_BUTTON_RIGHT:
		_dragging = event.pressed
	elif event.button_index == MOUSE_BUTTON_WHEEL_UP:
		cam_back = clampf(cam_back * exp(clampf(event.factor, 0.01, 3.0) * ZOOM_FACTOR * 200.0), CAM_BACK * ZOOM_MIN, CAM_BACK * ZOOM_MAX)
	elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
		cam_back = clampf(cam_back * exp(-clampf(event.factor, 0.01, 3.0) * ZOOM_FACTOR * 200.0), CAM_BACK * ZOOM_MIN, CAM_BACK * ZOOM_MAX)

func _handle_mouse_motion(event: InputEventMouseMotion) -> void:
	if _dragging:
		cam_yaw -= event.relative.x * MOUSE_SENS
		cam_pitch = clampf(cam_pitch + event.relative.y * PITCH_SENS, PITCH_MIN, PITCH_MAX)

# ---- physics -----------------------------------------------------------------

func _jump() -> void:
	if grounded and not swimming:
		vy = JUMP_V
		grounded = false

func update(delta: float) -> Dictionary:
	if not active:
		return {}
	if paused:
		return { "near": near, "pos": pos, "distance": 0.0 }

	# ---- movement input ----
	var ix := 0.0
	var iz := 0.0
	if _keys.has(KEY_W) or _keys.has(KEY_UP): iz += 1.0
	if _keys.has(KEY_S) or _keys.has(KEY_DOWN): iz -= 1.0
	if _keys.has(KEY_A) or _keys.has(KEY_LEFT): ix -= 1.0
	if _keys.has(KEY_D) or _keys.has(KEY_RIGHT): ix += 1.0

	var run := _keys.has(KEY_SHIFT) and not swimming
	var push := minf(1.0, sqrt(ix * ix + iz * iz))
	var speed := (SWIM_SPEED if swimming else RUN_SPEED if run else WALK_SPEED) * push * delta
	moving = push > 0.02
	running = run and moving

	if moving:
		var len := sqrt(ix * ix + iz * iz)
		ix /= len
		iz /= len
		# camera-relative directions
		var forward := Vector3(sin(cam_yaw), 0.0, cos(cam_yaw))
		var right := Vector3(-cos(cam_yaw), 0.0, sin(cam_yaw))
		var vx := forward.x * iz + right.x * ix
		var vz := forward.z * iz + right.z * ix
		# try full step, then each axis for wall sliding
		var nx := pos.x + vx * speed
		var nz := pos.z + vz * speed
		if not blocked(nx, nz):
			pos.x = nx
			pos.z = nz
		elif not blocked(nx, pos.z):
			pos.x = nx
		elif not blocked(pos.x, nz):
			pos.z = nz
		# smooth turn toward movement direction
		yaw = _lerp_angle(yaw, atan2(vx, vz), TURN_LERP)
		bob += delta * (13.0 if run else 9.0)
	else:
		bob += delta * 1.5

	# ---- gravity & terrain following ----
	var gnd_y := ground_at(pos.x, pos.z, pos.y if grounded else floor_y)
	if grounded:
		floor_y = gnd_y
	var in_water := gnd_y < 0.0
	var underfoot := WATER_Y - SWIM_SINK if in_water else gnd_y

	if grounded:
		pos.y = underfoot
	else:
		vy -= GRAVITY * delta
		pos.y += vy * delta
		# ceiling check (prevents jumping through bridges)
		if vy > 0.0:
			var lid := ceiling_at(pos.x, pos.z, floor_y)
			if pos.y + HEAD > lid:
				pos.y = lid - HEAD
				vy = 0.0
		if pos.y <= underfoot:
			pos.y = underfoot
			vy = 0.0
			grounded = true
	swimming = grounded and in_water

	# ---- camera ----
	var dist := cam_back
	var cx := pos.x - sin(cam_yaw) * dist * cos(cam_pitch)
	var cz := pos.z - cos(cam_yaw) * dist * cos(cam_pitch)
	var cy := pos.y + CAM_UP + sin(cam_pitch) * dist
	var cam_floor := ground_at(cx, cz, cy)
	camera.position = Vector3(cx, maxf(cy, cam_floor + 0.55), cz)
	camera.look_at(Vector3(pos.x, pos.y + EYE, pos.z))

	# ---- interactable proximity ----
	near = {}
	var best_d := INF
	for it in interactables:
		var dx: float = it.x - pos.x
		var dz: float = it.z - pos.z
		var d := sqrt(dx * dx + dz * dz)
		var reach: float = it.get("r", 2.6)
		if d < reach and d < best_d:
			best_d = d
			near = it

	return { "near": near, "pos": pos, "distance": best_d }

# ---- helpers -----------------------------------------------------------------

static func _lerp_angle(a: float, b: float, t: float) -> float:
	var d := b - a
	while d > PI:
		d -= TAU
	while d < -PI:
		d += TAU
	return a + d * clampf(t, 0.0, 1.0)
