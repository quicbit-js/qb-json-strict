// Conformance run against the standard JSONTestSuite corpus
// (github.com/nst/JSONTestSuite, the test_parsing/ fixtures):
//   y_*  must be accepted
//   n_*  must be rejected
//   i_*  implementation-defined (we just report our choice)
//
// The corpus is not vendored. Provide it via (in order):
//   - env JSONTESTSUITE_DIR  (path to a dir containing test_parsing/, or to test_parsing/)
//   - ./JSONTestSuite/test_parsing
//   - ../JSONTestSuite/test_parsing
// To fetch it:  git clone --depth 1 https://github.com/nst/JSONTestSuite.git
//
// Run:  node test-suite.js     (exits non-zero if any y_/n_ case is misclassified)

const fs = require('fs')
const path = require('path')
const strict = require('.')

function find_corpus () {
  const candidates = []
  if (process.env.JSONTESTSUITE_DIR) {
    candidates.push(process.env.JSONTESTSUITE_DIR)
    candidates.push(path.join(process.env.JSONTESTSUITE_DIR, 'test_parsing'))
  }
  candidates.push(path.join(__dirname, 'JSONTestSuite', 'test_parsing'))
  candidates.push(path.join(__dirname, '..', 'JSONTestSuite', 'test_parsing'))
  for (const c of candidates) {
    try { if (fs.statSync(c).isDirectory()) { return c } } catch (e) { /* keep looking */ }
  }
  return null
}

const dir = find_corpus()
if (!dir) {
  console.log('SKIP: JSONTestSuite corpus not found.')
  console.log('  git clone --depth 1 https://github.com/nst/JSONTestSuite.git')
  console.log('  (or set JSONTESTSUITE_DIR to its location)')
  process.exit(0)
}

const files = fs.readdirSync(dir).filter(function (f) { return f.endsWith('.json') }).sort()
let yPass = 0
let nPass = 0
const yFail = []
const nFail = []
const iAcc = []
const iRej = []

for (const f of files) {
  const buf = fs.readFileSync(path.join(dir, f))
  let res
  try { res = strict.validate(buf) } catch (e) { res = 'THREW: ' + e.message }
  const valid = res === null
  switch (f[0]) {
    case 'y': valid ? yPass++ : yFail.push(f + '  => ' + res); break
    case 'n': valid ? nFail.push(f) : nPass++; break
    default:  valid ? iAcc.push(f) : iRej.push(f)
  }
}

console.log('corpus: ' + dir)
console.log('y_ (must accept):  ' + yPass + ' pass, ' + yFail.length + ' fail')
yFail.forEach(function (x) { console.log('   FAIL (rejected valid)  ' + x) })
console.log('n_ (must reject):  ' + nPass + ' pass, ' + nFail.length + ' fail')
nFail.forEach(function (x) { console.log('   FAIL (accepted invalid) ' + x) })
console.log('i_ (impl-defined): ' + iAcc.length + ' accepted, ' + iRej.length + ' rejected')

const failed = yFail.length + nFail.length
console.log(failed === 0 ? '\nOK — full RFC 8259 conformance on determinate cases' : '\n' + failed + ' FAILURES')
process.exit(failed === 0 ? 0 : 1)
