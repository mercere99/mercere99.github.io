CSE 450 Lecture 11 — Running WAT in a browser

This example uses the exact generated program from Lecture 10, slide 11.
JavaScript handles the page and calls CalcHypotenuse; Wasm does the arithmetic.

SETUP (from web/project3.md)
Install WABT using the package manager you already use:
  macOS with Homebrew:       brew install wabt
  macOS with MacPorts:       sudo port install wabt
  Ubuntu / Ubuntu in WSL:    sudo apt update
                            sudo apt install wabt
Other systems: use the WABT releases or build instructions at
https://github.com/WebAssembly/wabt
Ensure the directory containing wat2wasm is on PATH; reopen the shell if needed.
Verify with: wat2wasm --version
Python 3 is also needed for the local server: python3 --version

RUN THIS EXAMPLE
In this directory (web/Lectures/hypotenuse):
  wat2wasm hypotenuse.wat -o hypotenuse.wasm
  python3 -m http.server 8000 --bind 127.0.0.1
Open http://localhost:8000/hypotenuse.html
Leave the server running while demonstrating. Stop it with Ctrl-C.
The included hypotenuse.wasm was built from the accompanying WAT source.
After changing the WAT, rerun wat2wasm and reload the page.

TO PRESENT THE LECTURE AND DEMO TOGETHER
From the course's web directory:
  python3 -m http.server 8000 --bind 127.0.0.1
Lecture: http://localhost:8000/slidedown.html?present=Lectures/Lecture11.psl
Demo:    http://localhost:8000/Lectures/hypotenuse/hypotenuse.html

LIVE DEMONSTRATION
1. Ask students to predict CalcHypotenuse(3, 4), then show 5.
2. Try (5, 12) -> 13 and (1.5, 2) -> 2.5. No recompile is needed for new inputs.
3. Show the export name in WAT and the matching JavaScript property.
4. Remove the assignment-result local.get/drop pair, rebuild, and reload.
   The outputs stay the same. This leads into the optimization slides.
5. Restore the original WAT if you want the sample to match the review slide.

COMMON FAILURES
"wat2wasm: command not found": install WABT or correct PATH.
WAT type/stack validation error: fix the WAT before running it.
HTTP 404: serve the folder containing the expected .wasm file.
Fetch failure from file://: use the HTTP URL above.
Missing CalcHypotenuse export: check spelling and rebuild the binary.
Old results after a code edit: rebuild the .wasm and reload the page.
The sample uses arrayBuffer + instantiate, so it does not depend on the
server's application/wasm MIME type required by instantiateStreaming.

REFERENCES
Course setup: ../../project3.md ("Set up the tools to test your compiler")
WABT: https://github.com/WebAssembly/wabt
Homebrew: https://formulae.brew.sh/formula/wabt
JavaScript API:
https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/instantiate_static
