class_name KeybindPresets

## Metadata for every remappable action and the left-handed preset overrides.
## Order determines display order in the keybind settings UI.

const ACTIONS: Array = [
	# --- Camera & Zoom ---
	{"action": "cam_pan_up",         "display": "Pan Up",                 "category": "Camera"},
	{"action": "cam_pan_down",        "display": "Pan Down",               "category": "Camera"},
	{"action": "cam_pan_left",        "display": "Pan Left",               "category": "Camera"},
	{"action": "cam_pan_right",       "display": "Pan Right",              "category": "Camera"},
	{"action": "cam_zoom_in",         "display": "Zoom In",                "category": "Camera"},
	{"action": "cam_zoom_out",        "display": "Zoom Out",               "category": "Camera"},
	{"action": "cam_bookmark_jump_1", "display": "Jump to Bookmark 1",     "category": "Camera"},
	{"action": "cam_bookmark_jump_2", "display": "Jump to Bookmark 2",     "category": "Camera"},
	{"action": "cam_bookmark_jump_3", "display": "Jump to Bookmark 3",     "category": "Camera"},
	{"action": "cam_bookmark_jump_4", "display": "Jump to Bookmark 4",     "category": "Camera"},
	{"action": "cam_bookmark_jump_5", "display": "Jump to Bookmark 5",     "category": "Camera"},
	{"action": "cam_bookmark_jump_6", "display": "Jump to Bookmark 6",     "category": "Camera"},
	{"action": "cam_bookmark_jump_7", "display": "Jump to Bookmark 7",     "category": "Camera"},
	{"action": "cam_bookmark_jump_8", "display": "Jump to Bookmark 8",     "category": "Camera"},
	{"action": "cam_bookmark_set_1",  "display": "Set Bookmark 1",         "category": "Camera"},
	{"action": "cam_bookmark_set_2",  "display": "Set Bookmark 2",         "category": "Camera"},
	{"action": "cam_bookmark_set_3",  "display": "Set Bookmark 3",         "category": "Camera"},
	{"action": "cam_bookmark_set_4",  "display": "Set Bookmark 4",         "category": "Camera"},
	{"action": "cam_bookmark_set_5",  "display": "Set Bookmark 5",         "category": "Camera"},
	{"action": "cam_bookmark_set_6",  "display": "Set Bookmark 6",         "category": "Camera"},
	{"action": "cam_bookmark_set_7",  "display": "Set Bookmark 7",         "category": "Camera"},
	{"action": "cam_bookmark_set_8",  "display": "Set Bookmark 8",         "category": "Camera"},
	# --- Unit Orders ---
	{"action": "unit_move",           "display": "Move",                   "category": "Unit Orders"},
	{"action": "unit_hold",           "display": "Hold Position",          "category": "Unit Orders"},
	{"action": "unit_retreat",        "display": "Retreat",                "category": "Unit Orders"},
	{"action": "unit_reposition",     "display": "Reposition",             "category": "Unit Orders"},
	{"action": "unit_cancel",         "display": "Cancel Orders",          "category": "Unit Orders"},
	{"action": "unit_idle_select",    "display": "Select Idle Divisions",  "category": "Unit Orders", "reserved": true},
	{"action": "unit_cycle_engaged",  "display": "Cycle Engaged Divisions","category": "Unit Orders", "reserved": true},
	# --- Control Groups ---
	{"action": "group_select_0",      "display": "Select Group 0",         "category": "Control Groups"},
	{"action": "group_select_1",      "display": "Select Group 1",         "category": "Control Groups"},
	{"action": "group_select_2",      "display": "Select Group 2",         "category": "Control Groups"},
	{"action": "group_select_3",      "display": "Select Group 3",         "category": "Control Groups"},
	{"action": "group_select_4",      "display": "Select Group 4",         "category": "Control Groups"},
	{"action": "group_select_5",      "display": "Select Group 5",         "category": "Control Groups"},
	{"action": "group_select_6",      "display": "Select Group 6",         "category": "Control Groups"},
	{"action": "group_select_7",      "display": "Select Group 7",         "category": "Control Groups"},
	{"action": "group_select_8",      "display": "Select Group 8",         "category": "Control Groups"},
	{"action": "group_select_9",      "display": "Select Group 9",         "category": "Control Groups"},
	{"action": "group_assign_0",      "display": "Assign to Group 0",      "category": "Control Groups"},
	{"action": "group_assign_1",      "display": "Assign to Group 1",      "category": "Control Groups"},
	{"action": "group_assign_2",      "display": "Assign to Group 2",      "category": "Control Groups"},
	{"action": "group_assign_3",      "display": "Assign to Group 3",      "category": "Control Groups"},
	{"action": "group_assign_4",      "display": "Assign to Group 4",      "category": "Control Groups"},
	{"action": "group_assign_5",      "display": "Assign to Group 5",      "category": "Control Groups"},
	{"action": "group_assign_6",      "display": "Assign to Group 6",      "category": "Control Groups"},
	{"action": "group_assign_7",      "display": "Assign to Group 7",      "category": "Control Groups"},
	{"action": "group_assign_8",      "display": "Assign to Group 8",      "category": "Control Groups"},
	{"action": "group_assign_9",      "display": "Assign to Group 9",      "category": "Control Groups"},
	{"action": "group_add_0",         "display": "Add to Group 0",         "category": "Control Groups"},
	{"action": "group_add_1",         "display": "Add to Group 1",         "category": "Control Groups"},
	{"action": "group_add_2",         "display": "Add to Group 2",         "category": "Control Groups"},
	{"action": "group_add_3",         "display": "Add to Group 3",         "category": "Control Groups"},
	{"action": "group_add_4",         "display": "Add to Group 4",         "category": "Control Groups"},
	{"action": "group_add_5",         "display": "Add to Group 5",         "category": "Control Groups"},
	{"action": "group_add_6",         "display": "Add to Group 6",         "category": "Control Groups"},
	{"action": "group_add_7",         "display": "Add to Group 7",         "category": "Control Groups"},
	{"action": "group_add_8",         "display": "Add to Group 8",         "category": "Control Groups"},
	{"action": "group_add_9",         "display": "Add to Group 9",         "category": "Control Groups"},
	# --- Map & Navigation ---
	{"action": "map_mode_forward",    "display": "Map Mode Forward",       "category": "Map"},
	{"action": "map_mode_backward",   "display": "Map Mode Backward",      "category": "Map"},
	{"action": "map_relation_ring",   "display": "Show Relation Ring (hold)","category": "Map"},
	# --- Chat ---
	{"action": "chat_team",           "display": "Open Chat",              "category": "Chat"},
	{"action": "chat_all",            "display": "Chat (All)",             "category": "Chat"},
]

## Left-handed preset — only actions that differ from the right-handed defaults.
## Camera moves to arrow keys; unit orders shift to the right-hand home row.
## Dict: action_name → { "physical_keycode": KEY_*, "shift": bool, "ctrl": bool, "alt": bool }
const LEFT_HANDED: Dictionary = {
	"cam_pan_up":        {"physical_keycode": KEY_UP},
	"cam_pan_down":      {"physical_keycode": KEY_DOWN},
	"cam_pan_left":      {"physical_keycode": KEY_LEFT},
	"cam_pan_right":     {"physical_keycode": KEY_RIGHT},
	"unit_hold":         {"physical_keycode": KEY_K},
	"unit_retreat":      {"physical_keycode": KEY_L},
	"unit_reposition":   {"physical_keycode": KEY_F},
	"unit_cancel":       {"physical_keycode": KEY_SEMICOLON},
	"map_mode_forward":  {"physical_keycode": KEY_APOSTROPHE},
	"map_mode_backward": {"physical_keycode": KEY_APOSTROPHE, "shift": true},
}
