// Compile, assemble, and execute the Lecture 14 examples in a temporary folder.
// Usage: node verify.mjs /absolute/path/to/Project3 [wat2wasm]
// The compiler must implement the required features. No compiler is bundled here.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

if (!process.argv[2]) throw new Error('Usage: node verify.mjs /path/to/Project3 [wat2wasm]');
const compiler = resolve(process.argv[2]);
const assembler = process.argv[3] || 'wat2wasm';
const sourceDir = dirname(fileURLToPath(import.meta.url));
const temporaryDir = mkdtempSync(join(tmpdir(), 'lecture14-'));
const cases = {
  'expressions.strix': [
    ['Chain', [], 14], ['Order', [], -3], ['LeftRead', [], 8],
    ['Divide', [], 2], ['Parentheses', [], 1],
    ['Truth', [0.5], 1], ['Truth', [0], 0],
    ['Truth', ['NaN'], 1], ['Truth', ['+Infinity'], 1],
  ],
  'scopes.strix': [
    ['ScopeExample', [], 10], ['ShadowValue', [], 11],
    ['Skipped', [0], 0], ['Skipped', [1], 7], ['Skipped', [0], 0],
    ['ResetLocal', [0], 0], ['ResetLocal', [3], 3], ['ResetLocal', [3], 3],
    ['Nested', [], 33],
  ],
  'gcd.strix': [
    ['GCD', [48,18], 6], ['GCD', [18,48], 6], ['GCD', [7,7], 7],
    ['GCD', [0,5], 5], ['GCD', [5,0], 5], ['GCD', [0,0], 0],
  ],
};
function run(command, args) {
  const result = spawnSync(command, args, {encoding:'utf8', timeout:10000});
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command}: ${result.stderr}`);
  return result;
}
const runtime = `
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
  const {instance} = await WebAssembly.instantiate(fs.readFileSync(process.argv[1]));
  for (const [name, args, expected] of JSON.parse(process.argv[2])) {
    const values = args.map(x => x === 'NaN' ? NaN : x === '+Infinity' ? Infinity : x);
    assert.equal(instance.exports[name](...values), expected, name + '(' + args + ')');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
`;
try {
  let calls = 0;
  for (const [source, expectations] of Object.entries(cases)) {
    const wat = join(temporaryDir, source + '.wat');
    const wasm = join(temporaryDir, source + '.wasm');
    writeFileSync(wat, run(compiler, [join(sourceDir, source)]).stdout);
    run(assembler, [wat, '-o', wasm]);
    run(process.execPath, ['-e', runtime, wasm, JSON.stringify(expectations)]);
    calls += expectations.length;
    console.log(`PASS ${source}: ${expectations.length} runtime calls`);
  }
  for (const [source, errorLine] of [
    ['unknown-after-return.strix', 4], ['chain-comparison.strix', null],
    ['invalid-target.strix', null], ['late-error.strix', 4],
  ]) {
    const result = spawnSync(compiler, [join(sourceDir, source)], {encoding:'utf8', timeout:10000});
    if (result.error) throw result.error;
    assert.equal(result.status, 1, source + ': expected source-error status');
    assert.equal(result.stdout, '', source + ': expected empty stdout');
    assert.match(result.stderr, /ERROR \(line \d+\):/, source);
    assert.doesNotMatch(result.stderr, /TODO|not implemented/i, source);
    if (errorLine) assert.ok(result.stderr.includes(`ERROR (line ${errorLine}):`), source);
    console.log(`PASS ${source}: source diagnostic and empty stdout`);
  }
  const fallback = join(temporaryDir, 'fallback.wasm');
  run(assembler, [join(sourceDir, 'gcd.wat'), '-o', fallback]);
  run(process.execPath, [join(sourceDir, 'run-gcd.mjs'), fallback]);
  console.log(`PASS handwritten GCD fallback: 6 runtime calls`);
  console.log(`All ${calls} compiled-source calls, 4 source errors, and fallback checks passed.`);
} finally {
  rmSync(temporaryDir, {recursive:true, force:true});
}
