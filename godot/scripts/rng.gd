# Port of shared/rng.mjs. Same rule as there: integer maths only, no transcendental
# functions, so Godot and Node agree bit for bit. JS numbers are int32 inside the
# bitwise operators while GDScript ints are 64 bits, so every step masks back to
# uint32 by hand -- and Math.imul is split in halves because a full 32x32 product
# overflows int64.
class_name PmRng
extends RefCounted

const U32 := 0xFFFFFFFF

var seed_value: int
var _a: int

func _init(seed_number: int) -> void:
	seed_value = seed_number & U32
	_a = seed_value

static func imul(a: int, b: int) -> int:
	a &= U32
	b &= U32
	var lo := a & 0xFFFF
	var hi := (a >> 16) & 0xFFFF
	return ((lo * b) + (((hi * b) & 0xFFFF) << 16)) & U32

static func hash32(s: String) -> int:
	var h := 0x811c9dc5
	for i in s.length():
		h = (h ^ s.unicode_at(i)) & U32
		h = imul(h, 0x01000193)
	return h & U32

# JS Math.round rounds half towards +infinity; GDScript round() rounds half away from
# zero. Below sea level that is a different number, so the sea floor would hash wrong.
static func js_round(x: float) -> float:
	return floor(x + 0.5)

func next() -> float:
	_a = (_a + 0x6d2b79f5) & U32
	var t := _a
	t = imul(t ^ (t >> 15), t | 1)
	t = t ^ ((t + imul(t ^ (t >> 7), t | 61)) & U32)
	return float((t ^ (t >> 14)) & U32) / 4294967296.0

func int_n(n: int) -> int:
	return int(floor(next() * n))

func rangef(a: float, b: float) -> float:
	return a + next() * (b - a)

func chance(p: float) -> bool:
	return next() < p

func fork(label: String) -> PmRng:
	return PmRng.new(hash32(str(seed_value) + ":" + label))
