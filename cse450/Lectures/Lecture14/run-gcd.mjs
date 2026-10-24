// Invoke a compiled GCD export. Works with handwritten or compiler-generated Wasm.
// Usage: node run-gcd.mjs /path/to/gcd.wasm
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

if (!process.argv[2]) throw new Error('Usage: node run-gcd.mjs file.wasm');
const { instance } = await WebAssembly.instantiate(await readFile(process.argv[2]));
for (const [a, b, expected] of [
  [48, 18, 6], [18, 48, 6], [7, 7, 7],
  [0, 5, 5], [5, 0, 5], [0, 0, 0],
]) {
  const actual = instance.exports.GCD(a, b);
  assert.equal(actual, expected, `GCD(${a}, ${b})`);
  console.log(`GCD(${a}, ${b}) = ${actual}`);
}
