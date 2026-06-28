// Performance comparison for qb-json-strict, in the style of qb-json-next/export/perf.js.
//
// Measures the cost of the RFC 8259 content/strictness layer by tokenizing the SAME buffer
// five ways and reporting MB/second for each:
//
//   max        bare byte-scan loop (theoretical ceiling, no parsing)
//   jnext      qb-json-next next()        — structure only, no content validation
//   strict     qb-json-strict next_strict() — + number/string/key content validation
//   validate   qb-json-strict validate()  — one-shot whole-document strict validation
//   JSON.parse the platform parser (builds a value tree), for reference
//
// A small sample is replicated into a large valid JSON array so timings are stable. Pass a
// JSON file as the first argument to measure your own data; pass a target size in MB as the
// second (default 64).
//
//   node export/perf.js [file.json] [target_mb]

const fs = require('fs')
const path = require('path')
const next = require('qb-json-next')
const strict = require('..')

// Build a large valid JSON buffer: [ sample, sample, ... ] up to ~target_mb megabytes.
function big_buffer (sample, target_mb) {
  const target = target_mb * 1024 * 1024
  const copies = Math.max(1, Math.round(target / sample.length))
  const parts = ['[']
  for (let i = 0; i < copies; i++) { parts.push(i ? ',' : '', sample.toString()) }
  parts.push(']')
  return Buffer.from(parts.join(''))
}

function bytescan (buf) {
  const len = buf.length
  let acc = 0
  for (let i = 0; i < len; i++) { acc += buf[i] }
  return acc                                   // returned so the loop can't be optimized away
}

function run_jnext (buf) { const ps = next.ps(buf); while (next(ps)) {} return ps.vcount }
function run_strict (buf) { const ps = next.ps(buf); while (strict.next_strict(ps)) {} return ps.vcount }
function run_validate (buf) { return strict.validate(buf) }
function run_jsonparse (buf) { return JSON.parse(buf) }

// time a function over `iter` iterations (after `warmup` untimed runs); return MB/second
function measure (label, fn, buf, iter, warmup) {
  for (let i = 0; i < warmup; i++) { fn(buf) }
  const mb = buf.length / (1024 * 1024)
  let total_ms = 0
  let best = Infinity
  for (let i = 0; i < iter; i++) {
    const t0 = process.hrtime.bigint()
    fn(buf)
    const ms = Number(process.hrtime.bigint() - t0) / 1e6
    total_ms += ms
    if (ms < best) { best = ms }
  }
  const avg_mbps = iter * mb / (total_ms / 1000)
  const best_mbps = mb / (best / 1000)
  return { label: label, avg: avg_mbps, best: best_mbps }
}

const fname = process.argv[2] || path.join(__dirname, 'blockchain-unconfirmed.json')
const target_mb = Number(process.argv[3]) || 64
const sample = fs.readFileSync(fname)
const buf = big_buffer(sample, target_mb)

// sanity: the synthetic buffer must be valid JSON and pass strict validation
const verr = strict.validate(buf)
if (verr) { throw new Error('benchmark buffer is not valid JSON: ' + verr) }

console.log('qb-json-strict performance')
console.log('sample:', fname, '(' + (sample.length / 1024).toFixed(1) + ' KB)')
console.log('buffer:', (buf.length / (1024 * 1024)).toFixed(1), 'MB of replicated JSON')
console.log('')

const iter = 7
const warmup = 3
const results = [
  measure('max (byte scan)', bytescan, buf, iter, warmup),
  measure('jnext  next()', run_jnext, buf, iter, warmup),
  measure('strict next_strict()', run_strict, buf, iter, warmup),
  measure('strict validate()', run_validate, buf, iter, warmup),
  measure('JSON.parse', run_jsonparse, buf, iter, warmup)
]

const base = results[1].best        // qb-json-next raw tokenizer is the comparison baseline
console.log('                        avg MB/s   best MB/s   vs jnext')
for (const r of results) {
  const rel = (r.best / base * 100).toFixed(1) + '%'
  console.log(
    r.label.padEnd(22) +
    r.avg.toFixed(0).padStart(9) +
    r.best.toFixed(0).padStart(12) +
    rel.padStart(11)
  )
}

const strictRes = results[2]
const cost = (1 - strictRes.best / base) * 100
console.log('')
console.log('strictness cost vs raw qb-json-next: ' + cost.toFixed(1) + '% slower' +
  ' (' + base.toFixed(0) + ' -> ' + strictRes.best.toFixed(0) + ' MB/s)')

/*
Result on Apple M2 Pro (arm native), node v22.11.0, 2026-06-27:
64 MB of replicated blockchain-unconfirmed.json (string-heavy: hex hashes + numbers)

                        avg MB/s   best MB/s   vs jnext
max (byte scan)            1083        1095     162.3%
jnext  next()               671         675     100.0%
strict next_strict()        416         420      62.2%
strict validate()           411         414      61.3%
JSON.parse                  584         652      96.5%

strictness cost vs raw qb-json-next: ~38% slower (675 -> 420 MB/s)

Stable across 64/128 MB. Isolating each content checker on type-homogeneous arrays
(~same machine):

  numbers-only array:  raw 724 -> strict 404 MB/s   (~44% cost)
  strings-only array:  raw 659 -> strict 354 MB/s   (~46% cost)

Note: this revises NOTES.md, which expected number validation to be "nearly free".
In practice both checkers cost about the same per token, because each is a full
*second* pass over the token's bytes plus per-token call overhead on top of the
tokenizer's own scan. On mixed real-world JSON the blended cost lands around ~38%.
*/
