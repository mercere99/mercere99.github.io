#!/usr/bin/env bash
# Build all four puzzle engines to WebAssembly and splice each into its HTML
# shell. Requires Emscripten (emcc). On macOS: brew install emscripten
set -euo pipefail

build() {  # build <cpp> <out_js> <export_name> <exported_functions>
  emcc -O2 -std=c++2b "$1" -o "$2" \
       -sMODULARIZE=1 -sEXPORT_NAME="$3" -sSINGLE_FILE=1 \
       -sEXPORTED_FUNCTIONS="$4" \
       -sEXPORTED_RUNTIME_METHODS=ccall,cwrap \
       -sENVIRONMENT=web,node -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=1
}

build sudoku.cpp       sudoku_wasm.js       createSudokuModule \
      _generate,_generate_level,_profile_board,_hint,_evaluate,_set_symbols
build kakuro.cpp       kakuro_wasm.js       createKakuroModule \
      _generate_kakuro,_kakuro_hint,_evaluate_kakuro
build slitherlink.cpp  slitherlink_wasm.js  createSlitherModule \
      _generate_slither,_slither_hint,_evaluate_slither
build shepherdlink.cpp shepherdlink_wasm.js createShepherdModule \
      _generate_shepherd,_shepherd_hint,_evaluate_shepherd

python3 - << 'PY'
for name, wasm in [('sudoku','sudoku_wasm.js'),
                   ('kakuro','kakuro_wasm.js'),
                   ('slitherlink','slitherlink_wasm.js'),
                   ('shepherdlink','shepherdlink_wasm.js')]:
    tpl = open(f'{name}_template.html').read()
    open(f'{name}.html','w').write(tpl.replace('/*__WASM_JS__*/', open(wasm).read()))
    print(f'{name}.html rebuilt')
PY

# Native test builds (soundness fuzz + generation/level stats per engine):
#   g++ -O2 -std=c++23 -DNATIVE_TEST sudoku.cpp       -o sudoku_test   && ./sudoku_test
#   g++ -O2 -std=c++23 -DNATIVE_TEST kakuro.cpp       -o kakuro_test   && ./kakuro_test
#   g++ -O2 -std=c++23 -DNATIVE_TEST slitherlink.cpp  -o slither_test  && ./slither_test
#   g++ -O2 -std=c++23 -DNATIVE_TEST shepherdlink.cpp -o shepherd_test && ./shepherd_test
#
# Public evaluation API (for external generation research), one per engine.
# Each returns Expected<Profile, EvalError>; feed it a candidate instance and
# it gives the full solving profile or the reason it is unusable:
#   sudoku:       evaluate_puzzle(std::array<int,81>)
#   kakuro:       evaluate_puzzle(const Layout&)      // set_board_size() first
#   slitherlink:  evaluate_puzzle(const Clues&)       // set_dims() first
#   shepherdlink: evaluate_puzzle(const Clues&)       // set_dims() first;
#                   clue codes -1 none, 0..3 numbers, 4 sheep, 5 wolf
# EvalError: NoSolution | MultipleSolutions | SearchLimitExceeded
#            (| InvalidInstance for kakuro/slitherlink/shepherdlink).
# Expected == std::expected on C++23 toolchains; an API-compatible shim is used
# only where <expected> is unavailable (emscripten 3.1.6).
