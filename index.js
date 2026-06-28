// qb-json-strict — opt-in RFC 8259 content validation over qb-json-next.
//
// qb-json-next validates JSON *structure* very fast, but deliberately skips the *content*
// of number and string tokens (it greedily consumes decimal bytes, and only hunts for the
// closing quote of a string). This package adds that missing layer as a thin wrapper:
// number bytes are checked against the strict RFC 8259 number grammar, and string bytes
// are checked for legal escapes, no raw control characters, and well-formed UTF-8
// (rejecting overlong encodings, lone surrogates, and truncated multibyte sequences).
//
// See NOTES.md for the design and "the cut line".

const next = require('qb-json-next')

const TOK_DEC = 100   // 'd'  number token
const TOK_STR = 115   // 's'  string token
const BAD_VALUE = next.ECODE.BAD_VALUE   // 66 'B' — reuse the tokenizer's bad-value ecode

// Drop-in replacement for next(): same ps/opt, same offsets, but additionally validates the
// *content* of number and string tokens (and object keys, which are strings) to RFC 8259.
//
// On non-conformant content it follows the same error convention as next(): ps.tok is set
// to 0 and ps.ecode to BAD_VALUE (sticky — halts further progress). If opt.err is a
// function it is invoked and 0 is returned; otherwise an Error (with .parse_state) is thrown.
function next_strict (ps, opt) {
  const t = next(ps, opt)
  if (t) {
    // object keys are strings too — validate when present (ps.klim > ps.koff)
    if (ps.klim > ps.koff) {
      const m = check_string(ps.src, ps.koff, ps.klim)
      if (m) { return fail(m, ps, opt, ps.koff, ps.klim) }
    }
    if (t === TOK_DEC) {
      const m = check_number(ps.src, ps.voff, ps.vlim)
      if (m) { return fail(m, ps, opt, ps.voff, ps.vlim) }
    } else if (t === TOK_STR) {
      const m = check_string(ps.src, ps.voff, ps.vlim)
      if (m) { return fail(m, ps, opt, ps.voff, ps.vlim) }
    }
  }
  return t
}

// Validate src[off..lim] as a strict RFC 8259 number. Returns null when valid, else a short
// error message. src[off..lim] is the raw number (no surrounding quotes).
//   number = [ "-" ] int [ frac ] [ exp ]
//   int    = "0" / ( digit1-9 *DIGIT )      ; no leading zeros
//   frac   = "." 1*DIGIT
//   exp    = ("e"/"E") [ "+"/"-" ] 1*DIGIT
function check_number (src, off, lim) {
  let i = off
  if (src[i] === 45) { i++ }                                  // optional '-'
  if (i >= lim) { return 'number: empty' }
  if (src[i] === 48) {                                        // leading 0 -> must be alone
    i++
    if (i < lim && src[i] >= 48 && src[i] <= 57) { return 'number: leading zero' }
  } else if (src[i] >= 49 && src[i] <= 57) {                  // 1-9
    i++
    while (i < lim && src[i] >= 48 && src[i] <= 57) { i++ }
  } else {
    return 'number: bad int'
  }
  if (i < lim && src[i] === 46) {                             // frac
    i++
    if (i >= lim || src[i] < 48 || src[i] > 57) { return 'number: bad frac' }
    while (i < lim && src[i] >= 48 && src[i] <= 57) { i++ }
  }
  if (i < lim && (src[i] === 101 || src[i] === 69)) {         // exp e/E
    i++
    if (i < lim && (src[i] === 43 || src[i] === 45)) { i++ }  // optional sign
    if (i >= lim || src[i] < 48 || src[i] > 57) { return 'number: bad exp' }
    while (i < lim && src[i] >= 48 && src[i] <= 57) { i++ }
  }
  if (i !== lim) { return 'number: trailing bytes' }
  return null
}

const ESCAPES = { 0x22: 1, 0x5C: 1, 0x2F: 1, 0x62: 1, 0x66: 1, 0x6E: 1, 0x72: 1, 0x74: 1 } // " \ / b f n r t

// Validate src[off..lim] as a strict RFC 8259 string. Returns null when valid, else a short
// error message. Offsets INCLUDE the surrounding quotes (qb-json-next convention), so the
// interior bytes are off+1 .. lim-2 and src[lim-1] is the (unescaped) closing quote.
function check_string (src, off, lim) {
  let i = off + 1
  const end = lim - 1                                         // index of the closing quote
  while (i < end) {
    const c = src[i]
    if (c === 0x5C) {                                         // backslash escape
      i++
      const e = src[i]
      if (e === 0x75) {                                       // \u XXXX — exactly 4 hex digits
        if (!is_hex(src[i + 1]) || !is_hex(src[i + 2]) || !is_hex(src[i + 3]) || !is_hex(src[i + 4])) {
          return 'string: bad \\u escape'
        }
        i += 5
      } else if (ESCAPES[e]) {
        i++
      } else {
        return 'string: bad escape'
      }
    } else if (c < 0x80) {                                    // ascii
      if (c <= 0x1F) { return 'string: raw control char' }   // 0x00-0x1F must be escaped
      i++
    } else {
      // multibyte UTF-8. Determine the expected length and the legal range of the *first*
      // continuation byte (the special-cased ranges reject overlong encodings and surrogates).
      let n, lo, hi
      if (c >= 0xC2 && c <= 0xDF) { n = 1; lo = 0x80; hi = 0xBF }       // 2-byte
      else if (c === 0xE0) { n = 2; lo = 0xA0; hi = 0xBF }             // 3-byte, no overlong
      else if (c >= 0xE1 && c <= 0xEC) { n = 2; lo = 0x80; hi = 0xBF }
      else if (c === 0xED) { n = 2; lo = 0x80; hi = 0x9F }             // exclude surrogates
      else if (c >= 0xEE && c <= 0xEF) { n = 2; lo = 0x80; hi = 0xBF }
      else if (c === 0xF0) { n = 3; lo = 0x90; hi = 0xBF }             // 4-byte, no overlong
      else if (c >= 0xF1 && c <= 0xF3) { n = 3; lo = 0x80; hi = 0xBF }
      else if (c === 0xF4) { n = 3; lo = 0x80; hi = 0x8F }             // <= U+10FFFF
      else { return 'string: bad utf8' }                              // 0x80-0xC1 stray/overlong, 0xF5-0xFF
      if (i + n >= end) { return 'string: truncated utf8' }           // continuations must be interior
      const b1 = src[i + 1]
      if (b1 < lo || b1 > hi) { return 'string: bad utf8' }
      for (let k = 2; k <= n; k++) {
        const b = src[i + k]
        if (b < 0x80 || b > 0xBF) { return 'string: bad utf8' }
      }
      i += n + 1
    }
  }
  return null
}

function is_hex (c) {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)
}

// One-shot, whole-document validator. Returns null if `src` is a single complete RFC 8259
// JSON document, else a short error message describing the first problem. `src` may be a
// Buffer or a string (UTF-8 encoded).
//
// This is the strict convenience entry point on top of the incremental next_strict(). Beyond
// per-token content checking it also enforces the document-level rules that qb-json-next
// deliberately relaxes (it is a lenient *streaming* tokenizer):
//   - exactly one top-level value (no multiple/comma-separated top-level values),
//   - no stray or unbalanced close brackets,
//   - only space/tab/LF/CR as whitespace (the tokenizer also skips \b and \f),
//   - and it finalizes the end-of-input cases the incremental API must leave open
//     (a top-level number running exactly to EOF, unclosed containers, empty input).
function validate (src) {
  const buf = Buffer.isBuffer(src) ? src : Buffer.from(src)
  const ps = next.ps(buf)
  let depth = 0
  try {
    let t
    while ((t = next_strict(ps))) {
      if (t === 91 || t === 123) { depth++ }                            // [ {
      else if (t === 93 || t === 125) {                                 // ] }
        if (depth === 0) { return 'unexpected close at ' + ps.voff }    // stray close
        depth--
      }
    }
  } catch (e) {
    return e.message
  }

  // A committed top-level value leaves the tokenizer in the "after value" position; a
  // top-level number that ran exactly to EOF was never committed, so its position is still
  // "before first value" and its content has not yet been checked.
  let has_value = ps.vcount > 0
  let goodpos = next.POS.A_AV
  if (ps.ecode === next.ECODE.TRUNC_DEC) {
    const m = check_number(ps.src, ps.voff, ps.vlim)
    if (m) { return m + ' at ' + ps.voff + '..' + ps.vlim }
    has_value = true
    goodpos = next.POS.A_BF
  } else if (ps.ecode) {
    return 'incomplete input (' + String.fromCharCode(ps.ecode) + ') at ' + ps.voff + '..' + ps.vlim
  }

  if (depth !== 0) { return 'unclosed container at ' + ps.vlim }
  if (!has_value) { return 'no JSON value' }
  // RFC 8259 whitespace is only space/tab/LF/CR. The tokenizer also skips \b (0x08) and
  // \f (0x0C); any still present here is inter-token whitespace (in-token occurrences were
  // already rejected by check_string), so the document is non-conformant.
  if (buf.indexOf(0x08) !== -1 || buf.indexOf(0x0C) !== -1) { return 'invalid whitespace' }
  // Anything other than the expected end position means trailing content or a stray separator
  // (e.g. a leading/trailing comma) that the streaming position map otherwise tolerates.
  if (ps.pos !== goodpos) { return 'trailing content at ' + ps.vlim }
  return null
}

// Apply the error policy for non-conformant content. Mirrors qb-json-next: mark the parse
// state (sticky ecode halts further next() calls), then route through opt.err if provided,
// else throw an Error carrying parse_state.
function fail (msg, ps, opt, off, lim) {
  ps.tok = 0
  ps.ecode = BAD_VALUE
  if (opt && typeof opt.err === 'function') {
    opt.err(ps)
    return ps.tok
  }
  const e = new Error(msg + ' at ' + off + '..' + lim)
  e.parse_state = ps
  throw e
}

next_strict.next_strict = next_strict
next_strict.validate = validate
next_strict.check_number = check_number
next_strict.check_string = check_string
// re-export the underlying tokenizer (and its ps/tokstr helpers) for convenience
next_strict.next = next
next_strict.ps = next.ps
next_strict.tokstr = next.tokstr
next_strict.TOK = next.TOK
next_strict.ECODE = next.ECODE
next_strict.POS = next.POS

module.exports = next_strict
