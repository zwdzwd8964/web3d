#!/usr/bin/env node
/**
 * Static host for the Railway test instance (ADR-0019).
 *
 * One origin, two already-built SPAs:
 *   /         -> editor  (packages/editor/dist)
 *   /player/  -> player  (packages/player/dist, built with --base=/player/)
 *
 * Deliberately zero-dependency: the runtime image ships nothing the workspace does
 * not already pin (CLAUDE.md stop-rule #3), and C6 stays trivially auditable —
 * this file serves bytes from its own disk and never fetches anything.
 *
 * Run: node deploy/server.mjs
 *   PORT        listen port (Railway injects this; default 8080)
 *   HOST        bind address (default 0.0.0.0)
 *   EDITOR_DIR  editor dist directory (default ./editor next to this file)
 *   PLAYER_DIR  player dist directory (default ./player next to this file)
 */
import { createReadStream, existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGzip } from 'node:zlib'

const HERE = dirname(fileURLToPath(import.meta.url))
const EDITOR_DIR = resolve(process.env.EDITOR_DIR ?? join(HERE, 'editor'))
const PLAYER_DIR = resolve(process.env.PLAYER_DIR ?? join(HERE, 'player'))
const PORT = Number.parseInt(process.env.PORT ?? '8080', 10)
const HOST = process.env.HOST ?? '0.0.0.0'

/** Everything either app can legitimately serve, including published-package media. */
const MIME = new Map(
  Object.entries({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.bin': 'application/octet-stream',
    '.ktx2': 'image/ktx2',
    '.hdr': 'application/octet-stream',
    '.w3p': 'application/octet-stream',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }),
)

const COMPRESSIBLE = new Set([
  '.html', '.js', '.mjs', '.css', '.map', '.json', '.txt', '.svg', '.gltf', '.wasm',
])

/** Resolve a URL path inside a root, refusing anything that escapes it. */
function safeJoin(root, urlPath) {
  const abs = resolve(root, '.' + urlPath)
  if (abs !== root && !abs.startsWith(root + sep)) return null
  return abs
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...headers })
  res.end(body)
}

async function sendFile(req, res, filePath) {
  const info = await stat(filePath).catch(() => null)
  if (!info || !info.isFile()) return false

  const ext = extname(filePath).toLowerCase()
  const headers = {
    'content-type': MIME.get(ext) ?? 'application/octet-stream',
    'x-content-type-options': 'nosniff',
    // Test instance: hashed build assets are immutable, everything else is
    // revalidated so a redeploy is visible on plain reload.
    'cache-control': filePath.includes(`${sep}assets${sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  }

  const gzip = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')
  if (gzip) {
    headers['content-encoding'] = 'gzip'
    headers['vary'] = 'accept-encoding'
  } else {
    headers['content-length'] = String(info.size)
  }

  res.writeHead(200, headers)
  if (req.method === 'HEAD') {
    res.end()
    return true
  }

  const stream = createReadStream(filePath)
  stream.on('error', () => res.destroy())
  if (gzip) {
    const gz = createGzip()
    gz.on('error', () => res.destroy())
    stream.pipe(gz).pipe(res)
  } else {
    stream.pipe(res)
  }
  return true
}

async function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'method not allowed', { allow: 'GET, HEAD' })
  }

  let pathname
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
  } catch {
    return send(res, 400, 'bad request')
  }
  if (pathname.includes('\0')) return send(res, 400, 'bad request')

  if (pathname === '/healthz') return send(res, 200, 'ok', { 'cache-control': 'no-store' })
  if (pathname === '/player') {
    return send(res, 301, '', { location: '/player/' })
  }

  const inPlayer = pathname.startsWith('/player/')
  const root = inPlayer ? PLAYER_DIR : EDITOR_DIR
  let rel = inPlayer ? pathname.slice('/player'.length) : pathname
  if (rel.endsWith('/')) rel += 'index.html'

  const filePath = safeJoin(root, rel)
  if (!filePath) return send(res, 404, 'not found')

  if (await sendFile(req, res, filePath)) return

  // SPA fallback: extensionless paths get the app shell; asset misses stay honest 404s.
  if (extname(rel) === '') {
    if (await sendFile(req, res, join(root, 'index.html'))) return
  }
  send(res, 404, 'not found')
}

for (const [label, dir] of [['editor', EDITOR_DIR], ['player', PLAYER_DIR]]) {
  if (!existsSync(join(dir, 'index.html'))) {
    console.error(`[serve] missing ${label} build: ${join(dir, 'index.html')} not found`)
    process.exit(1)
  }
}

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error('[serve] unhandled error', error)
    if (!res.headersSent) send(res, 500, 'internal error')
    else res.destroy()
  })
})

server.listen(PORT, HOST, () => {
  console.log(`[serve] editor  ${EDITOR_DIR}`)
  console.log(`[serve] player  ${PLAYER_DIR}`)
  console.log(`[serve] listening on http://${HOST}:${PORT}  (/ -> editor, /player/ -> player)`)
})

// Railway sends SIGTERM on redeploy; close the listener, then let in-flight streams drain.
process.on('SIGTERM', () => {
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 5000).unref()
})
