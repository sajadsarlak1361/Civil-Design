#!/bin/sh
# Rebuild src/engine/formats/vendor/dwgwrite.js and dwgwrite.wasm.
# Needs emscripten and a LibreDWG checkout configured with USE_WRITE.
# The copy in the repo was built from LibreDWG commit a8ccb1f3 with emcc 3.1.6.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
SRC=${LIBREDWG_SRC:?Set LIBREDWG_SRC to the LibreDWG src directory}
emcc -O2 -I"$SRC/../include" -I"$SRC" \
  -s MODULARIZE=1 -s EXPORT_NAME=createDwgWrite -s ENVIRONMENT=web,worker,node \
  -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=67108864 \
  -s EXPORTED_FUNCTIONS='["_cd_dxf_to_dwg"]' \
  -s EXPORTED_RUNTIME_METHODS='["FS","cwrap"]' \
  -s FORCE_FILESYSTEM=1 -s ERROR_ON_UNDEFINED_SYMBOLS=0 \
  -o "$ROOT/src/engine/formats/vendor/dwgwrite.js" \
  "$SRC/dwg.c" "$SRC/common.c" "$SRC/codepages.c" "$SRC/bits.c" "$SRC/logging.c" \
  "$SRC/decode.c" "$SRC/decode2.c" "$SRC/decode_r11.c" "$SRC/decode_r2007.c" \
  "$SRC/reedsolomon.c" "$SRC/print.c" "$SRC/free.c" "$SRC/hash.c" "$SRC/dynapi.c" \
  "$SRC/classes.c" "$SRC/dwg_api.c" "$SRC/objects.c" "$SRC/geom.c" \
  "$SRC/out_dxf.c" "$SRC/out_dxfb.c" "$SRC/out_json.c" "$SRC/out_geojson.c" \
  "$SRC/encode.c" "$SRC/encode2.c" "$SRC/dxfclasses.c" "$SRC/in_dxf.c" "$SRC/in_json.c" \
  "$ROOT/src/engine/formats/vendor/cd-dxf2dwg.c" -lm
python3 - "$ROOT/src/engine/formats/vendor/dwgwrite.js" << 'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
src = path.read_text()
old = 'var ENVIRONMENT_IS_NODE=typeof process=="object"&&typeof process.versions=="object"&&typeof process.versions.node=="string"'
if old not in src:
    raise SystemExit('node flag missing')
src = src.replace(old, 'var ENVIRONMENT_IS_NODE=false', 1)
footer = """if (typeof exports === 'object' && typeof module === 'object')
  module.exports = createDwgWrite;
else if (typeof define === 'function' && define['amd'])
  define([], function() { return createDwgWrite; });
else if (typeof exports === 'object')
  exports["createDwgWrite"] = createDwgWrite;
"""
if footer not in src:
    raise SystemExit('footer missing')
src = src.replace(footer, 'export default createDwgWrite;\n')
src = src.replace('require("', 'globalThis.__cdRequire__("')
header = '/* LibreDWG write module, GPL-3.0. Built from vendor/cd-dxf2dwg.c. Rebuild with scripts/build-dwg-writer.sh. */\n'
path.write_text(header + src)
PY
echo "Rebuild finished."
