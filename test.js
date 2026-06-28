// qb-json-strict tests. Data-driven in the style of qb-json-next/test.js.
//
// Each row runs a source through next_strict and reports 'ok' (fully conformant) or
// 'ERR: <reason>' where <reason> is the message up to ' at <off>..<lim>'. Strict-layer
// rejections read like 'number: bad int' / 'string: bad utf8'; structural rejections from
// the underlying tokenizer read like 'bad value' / 'unexpected token'.

const test = require('test-kit').tape()
const strict = require('.')

// Run a whole buffer through next_strict. Returns 'ok' or a normalized 'ERR: <reason>'.
function run (buf) {
  const ps = strict.ps(buf)
  try {
    while (strict.next_strict(ps)) {}
  } catch (e) {
    return 'ERR: ' + e.message.split(' at ')[0]
  }
  if (ps.ecode) { return 'ERR: ecode ' + String.fromCharCode(ps.ecode) }
  return 'ok'
}

// Numbers at the very end of a buffer report TRUNC_DEC (possibly-unfinished), so append a
// trailing space to force the tokenizer to emit a complete decimal token we can validate.
function vnum (s) { return run(Buffer.from(s + ' ')) }
// Strings self-delimit on the closing quote, so they can be validated standalone.
function vstr (s) { return run(Buffer.from(s)) }

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
    [ '1e+9',       'ok' ],
    [ '0.0',        'ok' ],
    [ '0e0',        'ok' ],
    [ '-0.0e-0',    'ok' ],
    [ '1234567890', 'ok' ],
  ], vnum)
})

test('numbers - reject (strict layer)', function (t) {
  t.table_assert([
    [ 'src',        'exp' ],
    [ '01',         'ERR: number: leading zero' ],
    [ '00',         'ERR: number: leading zero' ],
    [ '-01',        'ERR: number: leading zero' ],
    [ '1.',         'ERR: number: bad frac' ],       // empty frac
    [ '1.e5',       'ERR: number: bad frac' ],
    [ '1e',         'ERR: number: bad exp' ],         // empty exp
    [ '1e+',        'ERR: number: bad exp' ],
    [ '1E-',        'ERR: number: bad exp' ],
    [ '1.2.3',      'ERR: number: trailing bytes' ],
    [ '1.5e3.2',    'ERR: number: trailing bytes' ],
    [ '--5',        'ERR: number: bad int' ],        // '-' consumed, second '-' is not a digit
    [ '-',          'ERR: number: empty' ],
  ], vnum)
})

test('numbers - reject (tokenizer / structural)', function (t) {
  // These never reach the strict number checker: the tokenizer rejects the leading byte or
  // construct first. They are still correctly rejected as invalid JSON.
  t.table_assert([
    [ 'src',        'exp' ],
    [ '.5',         'ERR: bad value' ],        // leading '.' is not a value start
    [ '+5',         'ERR: bad value' ],        // leading '+' is not a value start
    [ '0x1',        'ERR: bad value' ],        // '0' then non-decimal 'x' is a bad value
  ], vnum)
})

test('strings - accept', function (t) {
  t.table_assert([
    [ 'src',                'exp' ],
    [ '"abc"',              'ok' ],
    [ '""',                 'ok' ],
    [ '"a\\nb"',            'ok' ],   // \n
    [ '"\\u00e9"',          'ok' ],   // \u escape
    [ '"\\""',              'ok' ],   // escaped quote
    [ '"\\\\"',             'ok' ],   // escaped backslash
    [ '"\\/\\b\\f\\r\\t"',  'ok' ],   // all simple escapes
    [ '"\\uD834\\uDD1E"',   'ok' ],   // valid surrogate pair (G clef)
    [ '"\\uD800"',          'ok' ],   // lone surrogate escape: implementation-defined, accepted
  ], vstr)
})

test('strings - reject escapes', function (t) {
  t.table_assert([
    [ 'src',           'exp' ],
    [ '"a\\xb"',       'ERR: string: bad escape' ],
    [ '"\\u00zz"',     'ERR: string: bad \\u escape' ],
    [ '"\\u12"',       'ERR: string: bad \\u escape' ],   // too few hex digits
  ], vstr)
})

// Raw-byte cases: build buffers directly so the exact bytes land in src.
const Q = 0x22, BS = 0x5C
function buf (bytes) { return Buffer.from(bytes) }

test('strings - raw control chars', function (t) {
  t.table_assert([
    [ 'bytes',                          'exp' ],
    [ [Q, 0x09, Q],                     'ERR: string: raw control char' ],  // literal TAB
    [ [Q, 0x0A, Q],                     'ERR: string: raw control char' ],  // literal LF
    [ [Q, 0x00, Q],                     'ERR: string: raw control char' ],  // literal NUL
    [ [Q, 0x1F, Q],                     'ERR: string: raw control char' ],  // unit separator
    [ [Q, 0x20, Q],                     'ok' ],                             // space is fine
    [ [Q, 0x7F, Q],                     'ok' ],                             // DEL is allowed by RFC
  ], function (bytes) { return run(buf(bytes)) })
})

test('strings - utf8', function (t) {
  t.table_assert([
    [ 'bytes',                          'exp' ],
    [ [Q, 0xC3, 0xA9, Q],               'ok' ],                       // é  (U+00E9, 2-byte)
    [ [Q, 0xE2, 0x82, 0xAC, Q],         'ok' ],                       // €  (U+20AC, 3-byte)
    [ [Q, 0xEE, 0x80, 0x80, Q],         'ok' ],                       // U+E000 (3-byte, 0xEE lead)
    [ [Q, 0xF0, 0x9F, 0x98, 0x80, Q],   'ok' ],                       // 😀 (U+1F600, 4-byte)
    [ [Q, 0xF1, 0x80, 0x80, 0x80, Q],   'ok' ],                       // U+40000 (4-byte, 0xF1 lead)
    [ [Q, 0xE2, 0x82, 0x28, Q],         'ERR: string: bad utf8' ],      // bad 2nd continuation byte
    [ [Q, 0x80, Q],                     'ERR: string: bad utf8' ],      // stray continuation
    [ [Q, 0xC0, 0xAF, Q],               'ERR: string: bad utf8' ],      // overlong '/'
    [ [Q, 0xC1, 0xBF, Q],               'ERR: string: bad utf8' ],      // overlong
    [ [Q, 0xE0, 0x80, 0xAF, Q],         'ERR: string: bad utf8' ],      // overlong 3-byte
    [ [Q, 0xED, 0xA0, 0x80, Q],         'ERR: string: bad utf8' ],      // lone surrogate U+D800
    [ [Q, 0xF4, 0x90, 0x80, 0x80, Q],   'ERR: string: bad utf8' ],      // > U+10FFFF
    [ [Q, 0xF5, 0x80, 0x80, 0x80, Q],   'ERR: string: bad utf8' ],      // invalid lead byte
    [ [Q, 0xC3, Q],                     'ERR: string: truncated utf8' ], // truncated 2-byte
    [ [Q, 0xE2, 0x82, Q],               'ERR: string: truncated utf8' ], // truncated 3-byte
    [ [Q, 0xC3, 0x28, Q],               'ERR: string: bad utf8' ],      // bad continuation
  ], function (bytes) { return run(buf(bytes)) })
})

test('documents - whole values', function (t) {
  t.table_assert([
    [ 'src',                        'exp' ],
    [ '{"a":1,"b":"x"}',            'ok' ],
    [ '[1,2,3]',                    'ok' ],
    [ '{"n":-1.5e3,"s":"\\u0041"}', 'ok' ],
    [ '[true,false,null]',          'ok' ],
    [ '{"k":01}',                   'ERR: number: leading zero' ],  // bad value content
    [ '[1,2,3.]',                   'ERR: number: bad frac' ],
    [ '{"a":"a\\xb"}',              'ERR: string: bad escape' ],    // bad value string
  ], function (src) { return run(Buffer.from(src)) })
})

test('next_strict - opt.err override', function (t) {
  // On non-conformant content, next_strict routes through opt.err (like next()) instead of
  // throwing: ps is marked (tok 0, sticky ecode BAD_VALUE) and the token returned is 0.
  let calls = 0
  let seen_ecode = -1
  const opt = { err: function (ps) { calls++; seen_ecode = ps.ecode } }

  const ps = strict.ps(Buffer.from('[01]'))   // leading-zero number content
  t.same(strict.next_strict(ps, opt), 91, 'array-start token returns normally')
  t.same(strict.next_strict(ps, opt), 0, 'bad number content returns 0 (no throw)')
  t.same(calls, 1, 'opt.err invoked exactly once')
  t.same(seen_ecode, strict.ECODE.BAD_VALUE, 'ecode set to BAD_VALUE')
  t.same(ps.tok, 0, 'ps.tok cleared')
  t.same(strict.next_strict(ps, opt), 0, 'ecode is sticky — no further progress')
  t.same(calls, 1, 'opt.err not called again while ecode sticky')
  t.end()
})

// validate(): the one-shot whole-document API. Returns null for valid, else a message.
function vdoc (src) {
  const m = strict.validate(src)
  return m === null ? 'ok' : 'ERR: ' + m.split(' at ')[0]
}

test('validate - accept', function (t) {
  t.table_assert([
    [ 'src',                  'exp' ],
    [ '{"a":1,"b":"x"}',      'ok' ],
    [ '[1,2,3]',              'ok' ],
    [ '42',                   'ok' ],     // bare top-level number (ends exactly at EOF)
    [ '-1.5e10',              'ok' ],
    [ '"hello"',              'ok' ],
    [ 'true',                 'ok' ],
    [ 'null',                 'ok' ],
    [ '[]',                   'ok' ],
    [ '{}',                   'ok' ],
    [ '[{"a":[1,2]},{}]',     'ok' ],
    [ '  [1]  ',              'ok' ],     // surrounding legal whitespace
  ], vdoc)
})

test('validate - reject (structural strictness)', function (t) {
  // These are the document-level rules qb-json-next's lenient streaming tokenizer relaxes.
  t.table_assert([
    [ 'src',          'exp' ],
    [ '',             'ERR: no JSON value' ],
    [ '   ',          'ERR: no JSON value' ],
    [ '1 2',          'ERR: unexpected token' ],     // multiple top-level (tokenizer)
    [ '[""],',        'ERR: trailing content' ],     // trailing comma at top level
    [ '["x"]]',       'ERR: unexpected close' ],     // extra close
    [ '[1]]',         'ERR: unexpected close' ],
    [ '1]',           'ERR: unexpected close' ],
    [ ']',            'ERR: unexpected close' ],
    [ '[1,2',         'ERR: unclosed container' ],
    [ '{"a":1',       'ERR: unclosed container' ],
    [ '"abc',         'ERR: incomplete input (T)' ], // truncated string
  ], vdoc)
})

test('validate - reject (content)', function (t) {
  t.table_assert([
    [ 'src',          'exp' ],
    [ '[01]',         'ERR: number: leading zero' ],
    [ '[1.]',         'ERR: number: bad frac' ],
    [ '{"a":"\\x"}',  'ERR: string: bad escape' ],
    [ '00',           'ERR: number: leading zero' ],   // bare number at EOF (TRUNC_DEC finalize)
    [ '1.2.3',        'ERR: number: trailing bytes' ], // bare number at EOF
  ], vdoc)
})

test('validate - reject invalid whitespace', function (t) {
  // RFC 8259 whitespace is only space/tab/LF/CR; \b and \f are not valid JSON whitespace.
  t.table_assert([
    [ 'bytes',                    'exp' ],
    [ [0x5B, 0x0C, 0x5D],         'ERR: invalid whitespace' ],   // [<FF>]
    [ [0x5B, 0x08, 0x5D],         'ERR: invalid whitespace' ],   // [<BS>]
    [ [0x5B, 0x20, 0x09, 0x5D],   'ok' ],                        // [ <TAB>] legal ws
  ], function (bytes) { return vdoc(Buffer.from(bytes)) })
})

test('documents - key validation', function (t) {
  // Object keys are strings and must also be conformant.
  t.table_assert([
    [ 'bytes',                                              'exp' ],
    [ [0x7B, Q, 0x61, Q, 0x3A, 0x31, 0x7D],                'ok' ],                            // {"a":1}
    [ [0x7B, Q, 0x09, Q, 0x3A, 0x31, 0x7D],                'ERR: string: raw control char' ], // {"<TAB>":1}
    [ [0x7B, Q, 0xC3, Q, 0x3A, 0x31, 0x7D],                'ERR: string: truncated utf8' ],   // bad key utf8
  ], function (bytes) { return run(buf(bytes)) })
})
