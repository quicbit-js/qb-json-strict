// qb-json-strict tests — SKELETON. Mirrors the data-driven style of qb-json-next/test.js.
// Fill in / expand, then wire up JSONTestSuite fixtures (see NOTES.md "Tests").

const test = require('test-kit').tape()
const strict = require('.')

// run a whole source through next_strict; return 'ok' or the thrown error message
function validate (src) {
  const ps = { src: Buffer.from(src) }
  try {
    while (strict.next_strict(ps)) {}
    return 'ok'
  } catch (e) {
    return 'ERR: ' + e.message.replace(/ at \d+\.\.\d+$/, '')
  }
}

test('numbers - accept', function (t) {
  t.table_assert([
    [ 'src',        'exp' ],
    [ '0',          'ok' ],
    [ '-0',         'ok' ],
    [ '123',        'ok' ],
    [ '-123',       'ok' ],
    [ '1.5',        'ok' ],
    [ '-1.5e10',    'ok' ],
    [ '1E-9',       'ok' ],
    [ '0.0',        'ok' ],
  ], validate)
})

test('numbers - reject', function (t) {
  t.table_assert([
    [ 'src',        'exp' ],
    [ '01',         'ERR: number: bad int' ],     // adjust expected msg to taste
    [ '1.',         'ERR: number: bad frac' ],
    [ '.5',         'ok' ],                        // NOTE: '.5' is a tokenizer BAD_VALUE (B), not a 'd' token — confirm behavior
    [ '1e',         'ERR: number: bad exp' ],
    [ '1.2.3',      'ERR: number: trailing bytes' ],
  ], validate)
})

test('strings - accept', function (t) {
  t.table_assert([
    [ 'src',           'exp' ],
    [ '"abc"',         'ok' ],
    [ '"a\\nb"',       'ok' ],
    [ '"\\u00e9"',     'ok' ],
    [ '"\\\\"',        'ok' ],
  ], validate)
})

test('strings - reject', function (t) {
  t.table_assert([
    [ 'src',           'exp' ],
    [ '"a\\xb"',       'ERR: string: bad escape' ],
    [ '"\\u00zz"',     'ERR: string: bad \\u escape' ],
  ], validate)
})

// TODO: raw control char case (literal 0x09 inside quotes) — build the buffer directly,
// not via a JS string literal, to be sure the raw byte lands in src.
// TODO: UTF-8 cases once check_string UTF-8 validation is implemented.
// TODO: JSONTestSuite y_/n_/i_ corpus loop.
