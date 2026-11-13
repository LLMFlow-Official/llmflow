// Serves the static export with the headers from netlify.toml (used by the browser tests).
// Usage: node scripts/serve-static.mjs <outDir> <netlify.toml> <port>
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const [outArg, tomlPath, port] = process.argv.slice(2)
const outDir = path.resolve(outArg)
const toml = fs.readFileSync(tomlPath, 'utf8')
// Each [[headers]] block: `for = "<path>"` followed by `Name = "value"` lines.
const blocks = toml.split('[[headers]]').slice(1).map(block => {
  const path = /for\s*=\s*"([^"]+)"/.exec(block)?.[1] || '/*'
  const values = {}
  for (const m of block.matchAll(/^\s*([A-Za-z-]+)\s*=\s*"(.*)"\s*$/gm)) if (m[1] !== 'for') values[m[1]] = m[2]
  return { path, values }
})
const headersFor = (urlPath) => Object.assign({}, ...blocks.filter(b => b.path === '/*' || b.path === urlPath).map(b => b.values))
const headers = headersFor('/*')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.json': 'application/json', '.txt': 'text/plain' }
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let file = path.join(outDir, p)
  if (!file.startsWith(path.resolve(outDir))) { res.writeHead(403); return res.end() }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html'
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found') }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', ...headersFor(p) })
  fs.createReadStream(file).pipe(res)
}).listen(Number(port), () => console.log('serving', Object.keys(headers)))
