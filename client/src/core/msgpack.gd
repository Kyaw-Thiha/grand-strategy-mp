class_name MsgPack
## Minimal msgpack encoder/decoder for the Colyseus WebSocket protocol.
## Handles all types Colyseus uses: nil, bool, int, float, string, array, map.
## Decode returns [value, new_offset]. Encode returns a PackedByteArray.


# ── Decode ───────────────────────────────────────────────────────────────────

## Decodes one msgpack value from bytes starting at offset.
## Returns [decoded_value: Variant, new_offset: int].
static func decode(bytes: PackedByteArray, offset: int) -> Array:
	var b: int = bytes[offset]
	offset += 1

	# Positive fixint  0x00–0x7f
	if b <= 0x7f:
		return [b, offset]

	# Fixmap  0x80–0x8f
	if b <= 0x8f:
		return _decode_map(bytes, offset, b & 0x0f)

	# Fixarray  0x90–0x9f
	if b <= 0x9f:
		return _decode_array(bytes, offset, b & 0x0f)

	# Fixstr  0xa0–0xbf
	if b <= 0xbf:
		return _decode_string(bytes, offset, b & 0x1f)

	match b:
		0xc0: return [null, offset]                   # nil
		0xc2: return [false, offset]                  # false
		0xc3: return [true, offset]                   # true

		# float32 — skip 4 bytes (not used in Phase 3 payloads)
		0xca: return [0.0, offset + 4]

		# float64
		0xcb:
			var f_bytes := PackedByteArray()
			for i in range(7, -1, -1):               # BE → LE
				f_bytes.append(bytes[offset + i])
			return [f_bytes.decode_double(0), offset + 8]

		0xcc: return [bytes[offset], offset + 1]       # uint8
		0xcd:                                          # uint16
			return [_read_u16(bytes, offset), offset + 2]
		0xce:                                          # uint32
			return [_read_u32(bytes, offset), offset + 4]
		0xcf:                                          # uint64
			var v: int = 0
			for i in range(8):
				v = (v << 8) | bytes[offset + i]
			return [v, offset + 8]

		0xd0:                                          # int8
			var v: int = bytes[offset]
			return [v - 256 if v >= 128 else v, offset + 1]
		0xd1:                                          # int16
			var v: int = _read_u16(bytes, offset)
			return [v - 65536 if v >= 32768 else v, offset + 2]
		0xd2:                                          # int32
			var v: int = _read_u32(bytes, offset)
			return [v - 4294967296 if v >= 2147483648 else v, offset + 4]
		0xd3:                                          # int64
			var v: int = 0
			for i in range(8):
				v = (v << 8) | bytes[offset + i]
			return [v, offset + 8]

		0xd9:                                          # str8
			var length: int = bytes[offset]
			return _decode_string(bytes, offset + 1, length)
		0xda:                                          # str16
			return _decode_string(bytes, offset + 2, _read_u16(bytes, offset))
		0xdb:                                          # str32
			return _decode_string(bytes, offset + 4, _read_u32(bytes, offset))

		0xdc:                                          # array16
			return _decode_array(bytes, offset + 2, _read_u16(bytes, offset))
		0xdd:                                          # array32
			return _decode_array(bytes, offset + 4, _read_u32(bytes, offset))

		0xde:                                          # map16
			return _decode_map(bytes, offset + 2, _read_u16(bytes, offset))
		0xdf:                                          # map32
			return _decode_map(bytes, offset + 4, _read_u32(bytes, offset))

	# Negative fixint  0xe0–0xff
	if b >= 0xe0:
		return [b - 256, offset]

	return [null, offset]


static func _decode_string(bytes: PackedByteArray, offset: int, length: int) -> Array:
	return [bytes.slice(offset, offset + length).get_string_from_utf8(), offset + length]


static func _decode_array(bytes: PackedByteArray, offset: int, count: int) -> Array:
	var arr: Array = []
	for _i in range(count):
		var r: Array = decode(bytes, offset)
		arr.append(r[0])
		offset = r[1]
	return [arr, offset]


static func _decode_map(bytes: PackedByteArray, offset: int, count: int) -> Array:
	var dict: Dictionary = {}
	for _i in range(count):
		var k: Array = decode(bytes, offset)
		offset = k[1]
		var v: Array = decode(bytes, offset)
		offset = v[1]
		dict[k[0]] = v[0]
	return [dict, offset]


static func _read_u16(bytes: PackedByteArray, offset: int) -> int:
	return (bytes[offset] << 8) | bytes[offset + 1]


static func _read_u32(bytes: PackedByteArray, offset: int) -> int:
	return (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]


# ── Encode ───────────────────────────────────────────────────────────────────

## Encodes value to a msgpack PackedByteArray.
## Supports: null, bool, int, float, String, Dictionary, Array.
static func encode(value: Variant) -> PackedByteArray:
	var buf := PackedByteArray()
	_enc(value, buf)
	return buf


static func _enc(value: Variant, buf: PackedByteArray) -> void:
	match typeof(value):
		TYPE_NIL:
			buf.append(0xc0)
		TYPE_BOOL:
			buf.append(0xc3 if value else 0xc2)
		TYPE_INT:
			_enc_int(value, buf)
		TYPE_FLOAT:
			_enc_float(value, buf)
		TYPE_STRING:
			_enc_string(value, buf)
		TYPE_DICTIONARY:
			_enc_dict(value, buf)
		TYPE_ARRAY:
			_enc_array(value, buf)
		_:
			buf.append(0xc0)  # unknown types → nil


static func _enc_int(value: int, buf: PackedByteArray) -> void:
	if value >= 0:
		if value <= 0x7f:
			buf.append(value)
		elif value <= 0xff:
			buf.append(0xcc); buf.append(value)
		elif value <= 0xffff:
			buf.append(0xcd); buf.append(value >> 8); buf.append(value & 0xff)
		elif value <= 0xffffffff:
			buf.append(0xce)
			buf.append((value >> 24) & 0xff); buf.append((value >> 16) & 0xff)
			buf.append((value >> 8) & 0xff);  buf.append(value & 0xff)
		else:
			buf.append(0xcf)
			for i in range(7, -1, -1):
				buf.append((value >> (8 * i)) & 0xff)
	else:
		if value >= -32:
			buf.append(value & 0xff)                           # negative fixint
		elif value >= -128:
			buf.append(0xd0); buf.append(value & 0xff)
		elif value >= -32768:
			buf.append(0xd1); buf.append((value >> 8) & 0xff); buf.append(value & 0xff)
		elif value >= -2147483648:
			buf.append(0xd2)
			buf.append((value >> 24) & 0xff); buf.append((value >> 16) & 0xff)
			buf.append((value >> 8) & 0xff);  buf.append(value & 0xff)
		else:
			buf.append(0xd3)
			for i in range(7, -1, -1):
				buf.append((value >> (8 * i)) & 0xff)


static func _enc_float(value: float, buf: PackedByteArray) -> void:
	buf.append(0xcb)
	var raw: PackedByteArray = PackedFloat64Array([value]).to_byte_array()  # LE
	for i in range(raw.size() - 1, -1, -1):                                # LE → BE
		buf.append(raw[i])


static func _enc_string(value: String, buf: PackedByteArray) -> void:
	var utf8: PackedByteArray = value.to_utf8_buffer()
	var length: int = utf8.size()
	if length <= 31:
		buf.append(0xa0 | length)
	elif length <= 255:
		buf.append(0xd9); buf.append(length)
	else:
		buf.append(0xda); buf.append(length >> 8); buf.append(length & 0xff)
	buf.append_array(utf8)


static func _enc_dict(value: Dictionary, buf: PackedByteArray) -> void:
	var count: int = value.size()
	if count <= 15:
		buf.append(0x80 | count)
	else:
		buf.append(0xde); buf.append(count >> 8); buf.append(count & 0xff)
	for key: Variant in value:
		_enc(key, buf)
		_enc(value[key], buf)


static func _enc_array(value: Array, buf: PackedByteArray) -> void:
	var count: int = value.size()
	if count <= 15:
		buf.append(0x90 | count)
	else:
		buf.append(0xdc); buf.append(count >> 8); buf.append(count & 0xff)
	for item: Variant in value:
		_enc(item, buf)
