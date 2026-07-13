#!/usr/bin/env bash
# Build all three puzzle engines to WebAssembly and splice each into its HTML
# shell. Requires Emscripten (emcc). On macOS: brew install emscripten
set -euo pipefail

build() {  # build <cpp> <out_js> <export_name> <exported_functions>
  emcc -O2 -std=c++23 "$1" -o "$2" \
       -sMODULARIZE=1 -sEXPORT_NAME="$3" -sSINGLE_FILE=1 \
       -sEXPORTED_FUNCTIONS="$4" \
       -sEXPORTED_RUNTIME_METHODS=ccall,cwrap \
       -sENVIRONMENT=web,node -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=1
}

build sudoku.cpp      sudoku_wasm.js      createSudokuModule \
      _generate,_generate_level,_profile_board,_hint,_evaluate,_set_symbols
build kakuro.cpp      kakuro_wasm.js      createKakuroModule \
      _generate_kakuro,_kakuro_hint,_evaluate_kakuro
build slitherlink.cpp slitherlink_wasm.js createSlitherModule \
      _generate_slither,_slither_hint,_evaluate_slither

python3 - << 'PY'
for name, wasm in [('sudoku','sudoku_wasm.js'),
                   ('kakuro','kakuro_wasm.js'),
                   ('slitherlink','slitherlink_wasm.js')]:
    tpl = open(f'{name}_template.html').read()
    open(f'{name}.html','w').write(tpl.replace('/*__WASM_JS__*/', open(wasm).read()))
    print(f'{name}.html rebuilt')
PY

# Native test builds (soundness fuzz + generation/level stats per engine):
#   g++ -O2 -std=c++23 -DNATIVE_TEST sudoku.cpp      -o sudoku_test  && ./sudoku_test
#   g++ -O2 -std=c++23 -DNATIVE_TEST kakuro.cpp      -o kakuro_test  && ./kakuro_test
#   g++ -O2 -std=c++23 -DNATIVE_TEST slitherlink.cpp -o slither_test && ./slither_test
#
# Public evaluation API (for external generation research), one per engine:
#   sudoku:      evaluate_puzzle(std::array<int,81>)      -> Expected<Profile, EvalError>
#   kakuro:      evaluate_puzzle(const Layout&)           -> Expected<Profile, EvalError>
#   slitherlink: evaluate_puzzle(const Clues&)            -> Expected<Profile, EvalError>
# EvalError: NoSolution | MultipleSolutions | SearchLimitExceeded (| InvalidInstance
# for kakuro/slitherlink). Expected == std::expected under C++23 toolchains; an
# API-compatible shim is used only where <expected> is unavailable (emscripten 3.1.6).
