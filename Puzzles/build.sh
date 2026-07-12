#!/usr/bin/env bash
# Build the sudoku engine to WebAssembly and splice it into the HTML shell.
# Requires Emscripten (emcc). On macOS: brew install emscripten
set -euo pipefail

emcc -O2 -std=c++2b sudoku.cpp -o sudoku_wasm.js \
     -sMODULARIZE=1 -sEXPORT_NAME=createSudokuModule -sSINGLE_FILE=1 \
     -sEXPORTED_FUNCTIONS=_generate,_generate_level,_profile_board,_hint \
     -sEXPORTED_RUNTIME_METHODS=ccall,cwrap \
     -sENVIRONMENT=web,node -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=1

# Splice the (wasm-embedding) JS into the template at /*__WASM_JS__*/
python3 - << 'PY'
tpl = open('sudoku_template.html').read()
wasm = open('sudoku_wasm.js').read()
open('sudoku.html', 'w').write(tpl.replace('/*__WASM_JS__*/', wasm))
print('sudoku.html rebuilt')
PY

# Native test build (technique soundness fuzz + level stats):
#   g++ -O2 -std=c++23 -DNATIVE_TEST sudoku.cpp -o sudoku_test && ./sudoku_test
