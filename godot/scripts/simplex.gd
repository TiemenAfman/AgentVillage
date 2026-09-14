# Port of makeSimplex2D/fbm2 from shared/rng.mjs: 2D simplex noise (Gustavson) with the
# permutation shuffled by the seed. Pure float maths, so a straight transcription.
class_name PmSimplex
extends RefCounted

const GRAD2X := [1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0]
const GRAD2Y := [1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1]
const F2 := 0.3660254037844386
const G2 := 0.21132486540518713

var _perm := PackedInt32Array()
var _perm_mod12 := PackedInt32Array()

func _init(seed_number: int) -> void:
	var rand := PmRng.new(seed_number)
	var p := PackedInt32Array()
	p.resize(256)
	for i in 256:
		p[i] = i
	for i in range(255, 0, -1):
		var j := int(floor(rand.next() * (i + 1)))
		var t := p[i]
		p[i] = p[j]
		p[j] = t
	_perm.resize(512)
	_perm_mod12.resize(512)
	for i in 512:
		_perm[i] = p[i & 255]
		_perm_mod12[i] = _perm[i] % 12

func noise2(xin: float, yin: float) -> float:
	var n0 := 0.0
	var n1 := 0.0
	var n2 := 0.0
	var s := (xin + yin) * F2
	var i := int(floor(xin + s))
	var j := int(floor(yin + s))
	var t := (i + j) * G2
	var x0 := xin - (i - t)
	var y0 := yin - (j - t)
	var i1 := 1 if x0 > y0 else 0
	var j1 := 0 if x0 > y0 else 1
	var x1 := x0 - i1 + G2
	var y1 := y0 - j1 + G2
	var x2 := x0 - 1.0 + 2.0 * G2
	var y2 := y0 - 1.0 + 2.0 * G2
	var ii := i & 255
	var jj := j & 255
	var gi0 := _perm_mod12[ii + _perm[jj]]
	var gi1 := _perm_mod12[ii + i1 + _perm[jj + j1]]
	var gi2 := _perm_mod12[ii + 1 + _perm[jj + 1]]
	var t0 := 0.5 - x0 * x0 - y0 * y0
	if t0 >= 0.0:
		t0 *= t0
		n0 = t0 * t0 * (GRAD2X[gi0] * x0 + GRAD2Y[gi0] * y0)
	var t1 := 0.5 - x1 * x1 - y1 * y1
	if t1 >= 0.0:
		t1 *= t1
		n1 = t1 * t1 * (GRAD2X[gi1] * x1 + GRAD2Y[gi1] * y1)
	var t2 := 0.5 - x2 * x2 - y2 * y2
	if t2 >= 0.0:
		t2 *= t2
		n2 = t2 * t2 * (GRAD2X[gi2] * x2 + GRAD2Y[gi2] * y2)
	return 70.0 * (n0 + n1 + n2)

func fbm2(x: float, y: float, octaves: int = 4, lacunarity: float = 2.0, gain: float = 0.5) -> float:
	var amp := 1.0
	var freq := 1.0
	var sum := 0.0
	var norm := 0.0
	for o in octaves:
		sum += amp * noise2(x * freq, y * freq)
		norm += amp
		amp *= gain
		freq *= lacunarity
	return sum / norm

static func smoothstep_js(a: float, b: float, x: float) -> float:
	var t := clampf((x - a) / (b - a), 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)
