// Measure the real BROWSER code footprint (minified) of qb-json-strict / qb-json-next and
// other JS JSON parsers — the minified JavaScript that actually ships, gets decompressed,
// parsed, and run. Gzip (in parens) is only the network-transfer cost.
//
// "Minified" here is the minified source of every module that must ship to run in a browser:
//   - qb-json-strict / qb-json-next have no dependencies and use no Node APIs, so it is just
//     their own index.js file(s) minified — no bundler wrapper.
//   - clarinet and jsonparse declare zero npm deps but assume Node's built-in Buffer / Stream,
//     which a browser must polyfill; those polyfills are bundled in (that is real shipped code).
//
// The tooling and the compared libraries are not dependencies of this package. Run:
//
//   npm install --no-save esbuild esbuild-plugin-polyfill-node clarinet jsonparse @streamparser/json
//   node export/bundle-size.mjs
//
// Anything not installed is skipped.

import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'
import zlib from 'zlib'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const repoIndex = path.join(here, '..', 'index.js')

let esbuild, polyfillNode
try {
  esbuild = (await import('esbuild')).default
  polyfillNode = (await import('esbuild-plugin-polyfill-node')).polyfillNode
} catch (e) {
  console.log('SKIP: needs esbuild + esbuild-plugin-polyfill-node')
  console.log('  npm install --no-save esbuild esbuild-plugin-polyfill-node clarinet jsonparse @streamparser/json')
  process.exit(0)
}

const KB = (n) => (n / 1024).toFixed(1) + ' KB'
function report (label, bytes, code, note) {
  const gz = zlib.gzipSync(Buffer.from(code), { level: 9 }).length
  console.log(label.padEnd(22) + KB(bytes).padStart(11) + ('(' + KB(gz) + ')').padStart(12) + '   ' + note)
}

// minify each given source file on its own (no bundle wrapper); sum bytes, concat for gzip.
// Uses build(bundle:false) rather than transform() so top-level identifiers are mangled
// (transform() leaves them, since standalone it can't prove they're module-private).
async function minifyFiles (paths) {
  let bytes = 0
  const chunks = []
  for (const p of paths) {
    const r = await esbuild.build({ entryPoints: [p], minify: true, bundle: false, format: 'esm', write: false, logLevel: 'silent' })
    const code = r.outputFiles[0].text
    bytes += Buffer.byteLength(code)
    chunks.push(code)
  }
  return { bytes, code: chunks.join('\n') }
}

// bundle (to pull in deps + injected Node polyfills) and minify — for multi-module libraries
async function bundleMinify (entry, plugins) {
  const res = await esbuild.build({
    stdin: { contents: entry, resolveDir: here, loader: 'js' },
    bundle: true, minify: true, format: 'esm', platform: 'browser', write: false, logLevel: 'silent', plugins
  })
  const code = res.outputFiles[0].text
  return { bytes: Buffer.byteLength(code), code }
}

const bufferGlobal = polyfillNode({ globals: { buffer: true, process: false, navigator: false }, polyfills: { buffer: true } })
const bufferStream = polyfillNode({ globals: { buffer: true, process: false, navigator: false }, polyfills: { buffer: true, stream: true, string_decoder: true, events: true } })

function resolve (name) { try { return require.resolve(name) } catch (e) { return null } }

console.log('minified JS shipped to a browser (gzip in parens), esbuild, node ' + process.version + '\n')
console.log('library'.padEnd(22) + 'minified'.padStart(11) + '(gzip)'.padStart(12) + '   includes')

const skipped = []

// qb-json-strict: own index.js + qb-json-next index.js (no deps beyond that, no polyfills)
{
  const next = resolve('qb-json-next')
  if (next) { const r = await minifyFiles([repoIndex, next]); report('qb-json-strict', r.bytes, r.code, 'own code + qb-json-next, no polyfills') }
  else { skipped.push('qb-json-next (needed by qb-json-strict)') }
}
// qb-json-next: just its index.js
{
  const next = resolve('qb-json-next')
  if (next) { const r = await minifyFiles([next]); report('qb-json-next', r.bytes, r.code, 'single file, no deps/polyfills') }
}
// @streamparser/json: multi-file ESM, no Node polyfills
if (resolve('@streamparser/json')) {
  const r = await bundleMinify("import * as m from '@streamparser/json'; export default m", [])
  report('@streamparser/json', r.bytes, r.code, 'no polyfills (TextDecoder)')
} else { skipped.push('@streamparser/json') }
// jsonparse: own code + Buffer polyfill
if (resolve('jsonparse')) {
  const r = await bundleMinify("import m from 'jsonparse'; export default m", [bufferGlobal])
  report('jsonparse', r.bytes, r.code, '+ Buffer polyfill')
} else { skipped.push('jsonparse') }
// clarinet: own code + Buffer + Stream polyfills
if (resolve('clarinet')) {
  const r = await bundleMinify("import m from 'clarinet'; export default m", [bufferStream])
  report('clarinet', r.bytes, r.code, '+ Buffer + Stream polyfills')
} else { skipped.push('clarinet') }

if (skipped.length) {
  console.log('\nskipped (not installed): ' + skipped.join(', '))
  console.log('  npm install --no-save esbuild esbuild-plugin-polyfill-node clarinet jsonparse @streamparser/json')
}
