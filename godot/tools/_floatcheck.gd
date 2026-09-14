extends SceneTree

func _init() -> void:
    var d := { "length": 3 }
    print('num: ', float(d.get('length', 1.5)))
    var d2 := { "rot": null }
    print('null-default: ', float(d2.get('rot', 0.0)))
    print('string: ', float('2.5'))
    print('int: ', float(3))
    print('bool: ', float(true))
    quit(0)
