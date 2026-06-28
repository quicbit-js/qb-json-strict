# qb-json-strict

Opt-in **RFC 8259 content validation** layered over
[qb-json-next](https://github.com/quicbit-js/qb-json-next).

`qb-json-next` is a very fast incremental JSON **tokenizer**. It validates JSON *structure*
rigorously (nesting, commas, colons, key/value placement, bracket/quote boundaries) but, to
stay fast, deliberately does **not** validate the internal *content* of two token types:

- **numbers** — it greedily consumes any run of `[-+0-9.eE]`, so `01`, `1.2.3`, `1e`, `1.`
  pass through as a single decimal token.
- **strings** — it only scans for the closing unescaped quote, so it accepts raw control
  chars, bad escapes (`\x`), and never checks UTF-8.

`qb-json-strict` adds that missing layer as a thin wrapper, so full RFC 8259 conformance is
opt-in. Code that wants raw scan speed keeps using `qb-json-next` directly and pays nothing.

## How it compares

**The fastest, smallest validating JSON tokenizer for JavaScript — and unlike `JSON.parse`,
it streams.** Native `JSON.parse` is all-or-nothing: it needs the *whole* document up front and
a *single* invalid byte throws a `SyntaxError`, so you lose everything. Streaming tokenizers
read incrementally (partial buffers, network chunks) and pinpoint *exactly where* a problem is
— handing back everything parsed up to that point instead of failing the entire document.
Among them, qb is by far the fastest and the smallest to ship.

| library | role | MB/s | minified | gzip | streaming | on malformed JSON |
|---|---|--:|--:|--:|:--:|---|
| `JSON.parse` (native, C++) | parse → value tree | ~700 | 0 (built-in) | — | ✗ | throws — **entire document lost** |
| qb-json-next | tokenizer (structure) | 640 | 5.2 KB | 2.0 KB | ✓ | exact byte offset; tokens before it kept |
| **qb-json-strict** | **validating tokenizer** | **420** | **8.0 KB** | **3.0 KB** | ✓ | exact offset **+ reason**; tokens before it kept |
| clarinet | SAX parser | 135 | 161.9 KB | 51.4 KB | ✓ | error event with position |
| jsonparse | streaming parser | 98 | 35.6 KB | 10.7 KB | ✓ | error with position |
| @streamparser/json | tokenizer / parser | 84 / 70 | 23.9 KB | 5.6 KB | ✓ | error with position |

<sub>Sorted fastest → slowest. 64 MB of representative JSON, Apple M2 Pro / Node 22. **Minified**
is the JavaScript that ships to a browser and gets parsed and run — what actually costs you;
gzip is only the network-transfer cost. qb has no dependencies or polyfills (just
its own minified code); jsonparse and clarinet declare zero deps but assume Node's `Buffer`/`Stream`,
so the polyfills they need in a browser are included. See [Performance](#performance) to reproduce.</sub>

Among pure-JavaScript libraries qb-json-strict does the **most** work (full RFC 8259 content
validation) yet runs **~3–5× faster** than the other streaming parsers at just **~8 KB
minified** — ~20× smaller than clarinet, ~4× smaller than jsonparse. Reach for `JSON.parse` when you
have a complete, well-formed document and just want a value (it's faster and free); reach for qb
when you need streaming, partial-buffer, or fault-tolerant parsing — with strict validation.

## Install

```
npm install qb-json-strict
```

## Usage

### Validate a whole document (one-shot)

```js
const { validate } = require('qb-json-strict')

validate('{"a":[1,-2.5e3],"b":"café 😀"}')   // -> null  (valid)
validate('{"a":01}')                          // -> 'number: leading zero at 6..8'
validate('"bad \\x escape"')                  // -> 'string: bad escape at ...'
validate('[1,2')                              // -> 'unclosed container at ...'
```

`validate(src)` accepts a `Buffer` or string and returns `null` when `src` is a single,
complete, conformant JSON document, otherwise a short error message. On top of per-token
content checking it also enforces the document-level rules that `qb-json-next`'s lenient
*streaming* tokenizer relaxes: exactly one top-level value, no stray/unbalanced closing
brackets, and only space/tab/LF/CR as whitespace (the tokenizer also tolerates `\b` and `\f`).

### Incremental, drop-in for next()

```js
const strict = require('qb-json-strict')

const ps = strict.ps(Buffer.from('{"a": "value", "b": 1.5}'))
while (strict.next_strict(ps)) {
  // same ps, same offsets, same tokens as qb-json-next's next()...
  // but number/string/key content is additionally validated to RFC 8259.
}
```

`next_strict(ps, opt)` is a drop-in for `next(ps, opt)`: same parse-state object, same
offsets, same token codes. It additionally validates the *content* of number tokens, string
tokens, and object keys (which are strings). On non-conformant content it follows the same
error convention as `next()`: it sets `ps.tok = 0` and `ps.ecode = BAD_VALUE` (sticky), then
calls `opt.err(ps)` if provided, else throws an `Error` carrying `.parse_state`.

Note: `next_strict` is the per-token content layer only. Document-level strictness (single
top-level value, balanced brackets, legal whitespace) lives in `validate()`, because the
underlying tokenizer is intentionally a lenient multi-value stream tokenizer.

## API

- `validate(src)` → `null` if valid, else an error message string. `src` is a `Buffer` or string.
- `next_strict(ps, opt)` → drop-in for `next()` that additionally content-validates d/s tokens and keys.
- `check_number(src, off, lim)` → `null` if `src[off..lim]` is a strict RFC 8259 number, else a message.
- `check_string(src, off, lim)` → `null` if `src[off..lim]` (quotes included) is a strict RFC 8259 string, else a message.
- Re-exports from `qb-json-next`: `ps`, `next`, `tokstr`, `TOK`, `ECODE`, `POS`.

### Number grammar (check_number)

```
number = [ "-" ] int [ frac ] [ exp ]
int    = "0" / ( digit1-9 *DIGIT )      ; no leading zeros
frac   = "." 1*DIGIT
exp    = ("e" / "E") [ "+" / "-" ] 1*DIGIT
```

Rejects `01`, `1.`, `.5`, `+5`, `1e`, `1e+`, `--5`, `1.2.3`. Accepts `0`, `-0`, `123`,
`1.5`, `-1.5e10`, `1E-9`, `0.0`. Numeric *magnitude/precision* is not range-checked — that is
the consumer's concern; `check_number` validates grammar only.

### String rules (check_string)

Offsets **include the surrounding quotes** (qb-json-next convention), so the interior bytes
are `off+1 .. lim-2`.

- Rejects raw control chars `0x00`–`0x1F` (must be escaped). `0x7F` (DEL) is allowed per RFC.
- `\` must be followed by one of `" \ / b f n r t u`; `\u` must be followed by exactly 4 hex digits.
- Validates UTF-8 well-formedness: rejects overlong encodings, lone/raw surrogates
  (`U+D800`–`U+DFFF`), bytes `> U+10FFFF`, stray continuation bytes, and truncated sequences.

## Conformance

Tested against the [JSONTestSuite](https://github.com/nst/JSONTestSuite) `test_parsing`
corpus: **95/95** `y_` (must-accept) and **188/188** `n_` (must-reject) pass.

Implementation-defined (`i_`) choices:

- **Number magnitude/precision** (huge exponents, overflow, underflow) → **accepted** (grammar only).
- **Lone/invalid surrogates inside `\u` escapes** (e.g. `"\uD800"`) → **accepted** (grammar-valid hex).
- **Raw UTF-8 surrogates, overlong sequences, out-of-range bytes** → **rejected** (strict UTF-8).
- **UTF-16 / byte-order marks** → **rejected** (input must be UTF-8).
- **Deeply nested structures** (e.g. 500 levels) → **accepted** (no depth limit).

## Performance

Run `npm run perf` (replicates a sample into a large buffer and tokenizes it five ways).
On an Apple M2 Pro (node 22), tokenizing 64 MB of representative JSON:

| mode                          | MB/s | vs raw |
|-------------------------------|-----:|-------:|
| bare byte scan (ceiling)      | 1095 |   162% |
| `qb-json-next` `next()` (raw) |  675 |   100% |
| `next_strict()` (validating)  |  420 |    62% |
| `validate()` (one-shot)       |  414 |    61% |
| `JSON.parse` (reference)      |  652 |    97% |

**The strictness layer costs ~38% throughput** (~675 → ~420 MB/s). The cost is roughly
"scan every value byte a second time": isolating each checker on type-homogeneous data,
number validation costs ~44% and string validation ~46% — about the same, since both are a
second per-token pass on top of the tokenizer's own scan. This is exactly why it is opt-in:
search/scan use cases that don't need content validation keep the full raw speed.

### Compared to other JS libraries

See [How it compares](#how-it-compares) at the top for the speed + bundle-size table.

On footprint: beware "zero dependencies". clarinet and jsonparse declare none, but they assume
Node's built-in `Buffer`/`Stream`, which a browser must polyfill — and the Stream polyfill
(`readable-stream` & friends) is large, which is why clarinet really costs **~162 KB minified**
(~51 KB gzipped). qb and `@streamparser/json` use no Node APIs, so what you see is what you ship.

Reproduce (the tooling and compared libraries are optional, not dependencies):

```
npm install --no-save clarinet jsonparse @streamparser/json
npm run compare       # throughput
npm install --no-save esbuild esbuild-plugin-polyfill-node clarinet jsonparse @streamparser/json
npm run size          # browser bundle footprint
```

## Tests

```
npm test          # unit tables (self-contained)
npm run test:suite  # JSONTestSuite corpus (see below)
npm run test:all  # both
```

The corpus is not vendored. Fetch it once:

```
git clone --depth 1 https://github.com/nst/JSONTestSuite.git
```

`test-suite.js` finds it at `./JSONTestSuite`, `../JSONTestSuite`, or `$JSONTESTSUITE_DIR`.

## License

ISC
