// Cross-library throughput comparison: qb-json-strict / qb-json-next vs other JavaScript
// JSON parsers and tokenizers, plus native JSON.parse for reference.
//
// The other libraries are NOT dependencies of this package; they are optional here. Install
// whichever you want to compare against, then run:
//
//   npm install --no-save clarinet jsonparse @streamparser/json
//   node export/compare.js [target_mb]      (default 32)
//
// Anything not installed is skipped with a note. A small sample is replicated into a large
// valid JSON array so timings are stable; pass a target size in MB as the first argument.
//
// NOTE: the contenders do different work — qb *tokenizes* (reports token boundaries/validity
// without building a value tree), while JSON.parse and the streaming parsers build values or
// emit events. Read the "kind" column accordingly; it is not a pure apples-to-apples race.

const fs = require('fs')
const path = require('path')
const next = require('qb-json-next')
const strict = require('..')

// optional peers — load if present, otherwise record as missing
function optional (name) { try { return require(name) } catch (e) { return null } }
const sjson = optional('@streamparser/json')
const clarinet = optional('clarinet')
const JSONParse = optional('jsonparse')

// build a large valid JSON buffer: [ sample, sample, ... ]
const sample = fs.readFileSync(path.join(__dirname, 'blockchain-unconfirmed.json'))
const target_mb = Number(process.argv[2]) || 32
const copies = Math.max(1, Math.round(target_mb * 1024 * 1024 / sample.length))
const parts = ['[']
for (let i = 0; i < copies; i++) { parts.push(i ? ',' : '', sample.toString()) }
parts.push(']')
const BUF = Buffer.from(parts.join(''))
const STR = BUF.toString()
if (strict.validate(BUF) !== null) { throw new Error('benchmark buffer is not valid JSON') }

// each contender: [label, kind, fn]. fn returns a value so the work can't be optimized away.
const contenders = [
  ['JSON.parse (native)', 'parse', () => JSON.parse(STR)],
  ['qb-json-next next()', 'tokenize', () => { const ps = next.ps(BUF); while (next(ps)) {} return ps.vcount }],
  ['qb-json-strict next_strict()', 'tok+valid', () => { const ps = next.ps(BUF); while (strict.next_strict(ps)) {} return ps.vcount }],
  ['qb-json-strict validate()', 'validate', () => strict.validate(BUF)]
]
const missing = []
if (sjson) {
  contenders.push(['@streamparser/json Tokenizer', 'tokenize', () => {
    const t = new sjson.Tokenizer(); let n = 0; t.onToken = () => { n++ }; t.write(BUF); return n
  }])
  contenders.push(['@streamparser/json JSONParser', 'parse', () => {
    const p = new sjson.JSONParser(); let n = 0; p.onValue = () => { n++ }; p.write(BUF); return n
  }])
} else { missing.push('@streamparser/json') }
if (clarinet) {
  contenders.push(['clarinet', 'parse', () => {
    const p = clarinet.parser(); let n = 0
    p.onvalue = () => { n++ }; p.onopenobject = () => { n++ }; p.onkey = () => { n++ }
    p.write(STR).close(); return n
  }])
} else { missing.push('clarinet') }
if (JSONParse) {
  contenders.push(['jsonparse', 'parse', () => {
    const p = new JSONParse(); let n = 0; p.onValue = () => { n++ }; p.write(BUF); return n
  }])
} else { missing.push('jsonparse') }

function measure (fn) {
  for (let w = 0; w < 2; w++) { fn() }                 // warmup
  const mb = BUF.length / (1024 * 1024)
  let best = Infinity
  for (let r = 0; r < 5; r++) {
    const t0 = process.hrtime.bigint()
    fn()
    const ms = Number(process.hrtime.bigint() - t0) / 1e6
    if (ms < best) { best = ms }
  }
  return mb / (best / 1000)
}

console.log('buffer: ' + (BUF.length / (1024 * 1024)).toFixed(1) + ' MB replicated JSON, node ' + process.version)
console.log('')

const results = []
for (const [label, kind, fn] of contenders) {
  try { results.push([label, kind, measure(fn)]) } catch (e) {
    console.log(label.padEnd(32) + '  ERROR: ' + e.message.slice(0, 50))
  }
}

const ref = results.find(r => r[0].startsWith('JSON.parse'))
const refmbps = ref ? ref[2] : results[0][2]
console.log('parser'.padEnd(32) + 'kind'.padEnd(11) + 'MB/s'.padStart(8) + 'vs JSON.parse'.padStart(15))
for (const [label, kind, mbps] of results.sort((a, b) => b[2] - a[2])) {
  console.log(label.padEnd(32) + kind.padEnd(11) + mbps.toFixed(0).padStart(8) + (mbps / refmbps).toFixed(2).padStart(13) + 'x')
}

if (missing.length) {
  console.log('\nskipped (not installed): ' + missing.join(', '))
  console.log('  npm install --no-save ' + missing.join(' '))
}
