# qb-json-strict — design brief / handoff

> Handoff from a Claude Code session in `../qb-json-next`. Read this first, then see
> `index.js` (draft) and `test.js` (skeleton). Working dir for this package is
> `/Users/dad/ghub/qb-json-strict`.

## STATUS — implemented (2026-06-27)

The brief below is realized. Current state:

- `index.js`: `next_strict` wrapper, `check_number`, `check_string` (full UTF-8 validation —
  overlong, surrogates, out-of-range, truncated), and a one-shot `validate(src)` document API.
- Error model: matches `next()` — sets sticky `ps.ecode = BAD_VALUE`, then `opt.err(ps)` if
  given else throws with `.parse_state` (open question 2 resolved).
- Keys are string-validated (open question 3 resolved — done in the wrapper).
- Package name kept as `qb-json-strict` (open question 1 resolved).
- Tests: `npm test` (96 self-contained table assertions) and `npm run test:suite`
  (JSONTestSuite). **Conformance: 95/95 y_, 188/188 n_.** See `readme.md` for i_ choices.

Key discovery during implementation: `qb-json-next` is a *lenient streaming* tokenizer — it
permits multiple top-level values, stray closing brackets, leading/trailing commas, and
treats `\b`/`\f` as whitespace. So "structure is already conformant" (below) holds for the
*token stream* but NOT for single-document strictness. That document-level tightening lives in
`validate()`, not in the per-token `next_strict()`, keeping the incremental fast path clean.

## Purpose

`qb-json-next` is a very fast (~560 MB/sec measured, ~82% of a bare byte-scan loop)
incremental JSON **tokenizer**. It validates JSON **structure** rigorously — nesting,
commas, colons, key/value placement, bracket/quote boundaries — and reports the exact
byte offset of any structural error.

To stay that fast, it deliberately does **not** validate the internal *content* of two
token types:

- **numbers** (`tok === 100`, `'d'`): it greedily consumes any run of `[-+0-9.eE]`, so
  non-conformant values pass through as a single decimal token: `01`, `1.2.3`, `1e`,
  `1.`, `--5`.
- **strings** (`tok === 115`, `'s'`): it only scans for the closing unescaped quote, so
  it accepts raw control chars (e.g. a literal TAB), bad escapes (`\x`), and never checks
  UTF-8.

`qb-json-strict` adds that missing layer **as a thin wrapper** so RFC 8259 conformance is
opt-in. People who want raw scan speed keep using `qb-json-next` directly and pay nothing.

## The cut line (what this layer does / doesn't do)

- Structural tokens (`[ ] { }`, `,`, `:`, `true`/`false`/`null`) are **already
  conformant** from the tokenizer — this layer ignores them.
- This layer only inspects `src[voff..vlim]` for `d` and `s` tokens.
- No re-parsing of structure, no second state machine for nesting. Pure per-value check.

## Design: wrap, don't fork

Do **not** modify `qb-json-next`. Keep it zero-dependency and small. This package
`require('qb-json-next')` and exposes a drop-in:

```js
const next = require('qb-json-next')

function next_strict (ps, opt) {
  const t = next(ps, opt)
  if (t === 100) check_number(ps.src, ps.voff, ps.vlim)   // 'd' decimal
  else if (t === 115) check_string(ps.src, ps.voff, ps.vlim) // 's' string
  return t
}
```

Same `ps` object, same loop, same offsets — callers swap `next` for `next_strict`.

### check_number — strict RFC 8259 number grammar

`src[voff..vlim]` is the number's bytes (no surrounding quotes). Grammar:

```
number = [ "-" ] int [ frac ] [ exp ]
int    = "0" / ( digit1-9 *DIGIT )      ; no leading zeros
frac   = "." 1*DIGIT
exp    = ("e" / "E") [ "+" / "-" ] 1*DIGIT
```

Must REJECT: `01`, `1.`, `.5`, `+5`, `1e`, `1e+`, `--5`, `1.2.3`, `0x1`, trailing junk.
Must ACCEPT: `0`, `-0`, `123`, `-123`, `1.5`, `-1.5e10`, `1E-9`, `0.0`.

### check_string — escapes, control chars, UTF-8

NOTE: offsets in qb-json-next **include the surrounding quotes** (see qb-json-next readme
"string offsets include the quotes (ascii 34)"). So `src[voff] === 34` and
`src[vlim-1] === 34`; validate the interior bytes `voff+1 .. vlim-2`.

Rules (RFC 8259 §7):
- Reject raw control chars `0x00`–`0x1F` (must be escaped).
- Backslash `\` (0x5C) must be followed by one of: `" \ / b f n r t u`.
  - `\u` must be followed by exactly 4 hex digits.
- Validate UTF-8 well-formedness for multibyte sequences (the src is UTF-8 bytes, not
  UTF-16). Reject overlong encodings, lone surrogates, truncated sequences.

## Cost note (why this is opt-in, not built in)

The two halves have very different cost:
- **Numbers** are nearly free — short, a handful of bytes, tiny state machine. Could
  almost be validated unconditionally.
- **Strings** are the expensive half. The tokenizer's `skip_str` already touches every
  string byte (cheaply, just hunting the close quote); strict checking means a second,
  heavier pass (escape + UTF-8 decode) over those same bytes. Strings are usually the
  bulk of real JSON, so this is where most of the tokenizer's speed would go. That's the
  whole reason it's a separate opt-in package: skipping string validation is *precisely*
  the fast path for search/scan use cases.

## Tests

Use the standard conformance corpus: **JSONTestSuite** (github.com/nst/JSONTestSuite),
the `test_parsing/` fixtures:
- `y_*` — must accept
- `n_*` — must reject
- `i_*` — implementation-defined (document our choice per case)

Plus targeted tables (test-kit `table_assert`, same style as qb-json-next/test.js) for
the number/string edge cases listed above. Mirror qb-json-next's data-driven test style.

## Dev setup

`package.json` currently depends on the published `qb-json-next@^2.1.3`. For developing
against the local copy next door instead, either:
- `npm install ../qb-json-next` (adds a `file:` dependency), or
- `npm link` in `../qb-json-next` then `npm link qb-json-next` here.

## Open questions to decide in the new session

1. Package name: `qb-json-strict` vs `qb-json-conform` vs `qb-json-validate`.
2. Error model: throw (like qb-json-next default) vs return an ecode-style marker vs
   support the same `opt.err` callback override that `next()` uses. Recommend matching
   `next()`'s `opt.err` convention for consistency.
3. Should keys (`koff..klim`) be string-validated too? Keys are strings — yes, they
   should go through `check_string`. The wrapper above only checks values; add key
   checking when `ps.klim > ps.koff`.
