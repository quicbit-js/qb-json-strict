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
