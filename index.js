// qb-json-strict — opt-in RFC 8259 content validation over qb-json-next.
//
// DRAFT starting point for the new session. The wrapper is wired up; check_number is a
// reasonable first implementation, check_string is partial (escapes + control chars done,
// UTF-8 validation is a TODO). Verify everything against test.js / JSONTestSuite before
// trusting it. See NOTES.md for the full design and the cut line.

const next = require('qb-json-next')

const TOK_DEC = 100   // 'd'  number token
const TOK_STR = 115   // 's'  string token

// Drop-in replacement for next(): same ps/opt, but additionally validates the *content*
// of number and string tokens to RFC 8259. Throws on non-conformant content (or routes
// through opt.err if provided — see TODO in error model).
function next_strict (ps, opt) {
  const t = next(ps, opt)
  // keys are strings too — validate them when present (ps.klim > ps.koff)
  if (ps.klim > ps.koff) { check_string(ps.src, ps.koff, ps.klim, ps) }
  if (t === TOK_DEC) { check_number(ps.src, ps.voff, ps.vlim, ps) }
  else if (t === TOK_STR) { check_string(ps.src, ps.voff, ps.vlim, ps) }
  return t
}

// Validate src[off..lim] as a strict RFC 8259 number.
//   number = [ "-" ] int [ frac ] [ exp ]
//   int    = "0" / ( digit1-9 *DIGIT )
//   frac   = "." 1*DIGIT
//   exp    = ("e"/"E") [ "+"/"-" ] 1*DIGIT
function check_number (src, off, lim, ps) {
  let i = off
  if (src[i] === 45) { i++ }                                  // optional '-'
  if (i >= lim) { return bad('number: empty', src, off, lim, ps) }
  if (src[i] === 48) {                                        // leading 0 -> must be alone
    i++
  } else if (src[i] >= 49 && src[i] <= 57) {                  // 1-9
    i++
    while (i < lim && src[i] >= 48 && src[i] <= 57) { i++ }
  } else {
    return bad('number: bad int', src, off, lim, ps)
  }
  if (i < lim && src[i] === 46) {                             // frac
    i++
    if (i >= lim || src[i] < 48 || src[i] > 57) { return bad('number: bad frac', src, off, lim, ps) }
    while (i < lim && src[i] >= 48 && src[i] <= 57) { i++ }
  }
  if (i < lim && (src[i] === 101 || src[i] === 69)) {         // exp e/E
    i++
    if (i < lim && (src[i] === 43 || src[i] === 45)) { i++ }  // optional sign
    if (i >= lim || src[i] < 48 || src[i] > 57) { return bad('number: bad exp', src, off, lim, ps) }
    while (i < lim && src[i] >= 48 && src[i] <= 57) { i++ }
  }
  if (i !== lim) { return bad('number: trailing bytes', src, off, lim, ps) }
}

const ESCAPES = { 0x22:1, 0x5C:1, 0x2F:1, 0x62:1, 0x66:1, 0x6E:1, 0x72:1, 0x74:1 } // " \ / b f n r t

// Validate src[off..lim] as a strict RFC 8259 string. Offsets INCLUDE the surrounding
// quotes (qb-json-next convention), so interior bytes are off+1 .. lim-2.
function check_string (src, off, lim, ps) {
  let i = off + 1
  const end = lim - 1
  while (i < end) {
    const c = src[i]
    if (c === 0x5C) {                                         // backslash escape
      i++
      const e = src[i]
      if (e === 0x75) {                                      // \u XXXX
        for (let k = 1; k <= 4; k++) {
          if (!is_hex(src[i + k])) { return bad('string: bad \\u escape', src, off, lim, ps) }
        }
        i += 5
      } else if (ESCAPES[e]) {
        i++
      } else {
        return bad('string: bad escape', src, off, lim, ps)
      }
    } else if (c <= 0x1F) {                                   // raw control char
      return bad('string: raw control char', src, off, lim, ps)
    } else {
      // TODO: UTF-8 well-formedness for c >= 0x80 (reject overlong, lone surrogate,
      // truncated multibyte). For now ASCII passes; multibyte is accepted unchecked.
      i++
    }
  }
}

function is_hex (c) {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)
}

// TODO error model: decide throw vs opt.err vs ecode marker (see NOTES.md open questions).
function bad (msg, src, off, lim, ps) {
  const e = new Error(msg + ' at ' + off + '..' + lim)
  e.parse_state = ps
  throw e
}

next_strict.next_strict = next_strict
next_strict.check_number = check_number
next_strict.check_string = check_string
// re-export the underlying tokenizer for convenience
next_strict.next = next

module.exports = next_strict
