extends Node

signal types_changed()

var _types: Array = []


func _ready() -> void:
	_load_presets()


func _load_presets() -> void:
	_types = [
		{ "aircraft_type": "fighter",          "name": "Fighter" },
		{ "aircraft_type": "heavy_fighter",    "name": "Heavy Fighter" },
		{ "aircraft_type": "cas_plane",        "name": "CAS Plane" },
		{ "aircraft_type": "dive_bomber",      "name": "Dive Bomber" },
		{ "aircraft_type": "tactical_bomber",  "name": "Tactical Bomber" },
		{ "aircraft_type": "strategic_bomber", "name": "Strategic Bomber" },
		{ "aircraft_type": "naval_bomber",     "name": "Naval Bomber" },
		{ "aircraft_type": "recon_plane",      "name": "Recon Plane" },
	]


func get_types() -> Array:
	return _types.duplicate()
