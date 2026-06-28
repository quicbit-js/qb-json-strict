// Measure the real BROWSER bundle footprint (minified + gzipped) of qb-json-strict /
// qb-json-next and other JS JSON parsers — including the Node polyfills (Buffer, Stream)
// and all their transitive dependencies that a bundler must inject for browser use.
//
// This is the honest "total KB to ship to a browser". Libraries that declare zero npm
// dependencies can still be large in a browser if they assume Node built-ins: clarinet and
// jsonparse use the Buffer global / require('stream'), so a bundler substitutes polyfills.
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

const bufferGlobal = () => polyfillNode({ globals: { buffer: true, process: false, navigator: false }, polyfills: { buffer: true } })
const bufferStream = () => polyfillNode({ globals: { buffer: true, process: false, navigator: false }, polyfills: { buffer: true, stream: true, string_decoder: true, events: true } })

// [label, entryCode, plugins, note]. qb-json-strict is bundled from this repo's index.js.
const targets = [
  ['qb-json-strict', `import m from ${JSON.stringify(repoIndex)}; export default m`, [], 'no node APIs (incl. qb-json-next)'],
  ['qb-json-next', "import m from 'qb-json-next'; export default m", [], 'no node APIs'],
  ['@streamparser/json', "import * as m from '@streamparser/json'; export default m", [], 'uses TextDecoder (browser global)'],
  ['jsonparse', "import m from 'jsonparse'; export default m", [bufferGlobal()], '+ Buffer polyfill'],
  ['clarinet', "import m from 'clarinet'; export default m", [bufferStream()], '+ Buffer + Stream polyfills']
]

function resolvable (label) {
  if (label === 'qb-json-strict') return true
  try { require.resolve(label); return true } catch (e) { return false }
}

console.log('browser bundle (esbuild --minify, platform=browser), node ' + process.version + '\n')
console.log('library'.padEnd(22) + 'min'.padStart(9) + 'min+gzip'.padStart(11) + '   includes')
const skipped = []
for (const [label, entry, plugins, note] of targets) {
  if (!resolvable(label)) { skipped.push(label); continue }
  try {
    const res = await esbuild.build({
      stdin: { contents: entry, resolveDir: here, loader: 'js' },
      bundle: true, minify: true, format: 'esm', platform: 'browser', write: false, logLevel: 'silent', plugins
    })
    const out = res.outputFiles[0].contents
    const gz = zlib.gzipSync(Buffer.from(out), { level: 9 }).length
    console.log(label.padEnd(22) + (out.length / 1024).toFixed(1).padStart(7) + 'KB' + (gz / 1024).toFixed(1).padStart(8) + 'KB   ' + note)
  } catch (e) {
    console.log(label.padEnd(22) + '  ERROR ' + String(e.message || e).slice(0, 50))
  }
}
if (skipped.length) {
  console.log('\nskipped (not installed): ' + skipped.join(', '))
  console.log('  npm install --no-save ' + skipped.join(' '))
}
