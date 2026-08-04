import type { Page, Response } from '@playwright/test'

/**
 * T-218 · what the page actually asked the network for.
 *
 * Two cards need this and they need it to be the same collector: T-218 asserts that a Draco
 * decoder IS fetched, same-origin, when a compressed asset is imported; T-219 asserts that a
 * KTX2 transcoder is NOT fetched when nothing needs it. Two hand-rolled `page.on('request')`
 * blocks would drift the first time one of them started filtering.
 *
 * Attach before navigating — Playwright only reports what happens after the listener lands.
 */
export interface RequestLog {
  /** Every URL requested since `collectRequests` was called, in order. */
  readonly urls: string[]
  /** URLs matching `pattern`. */
  matching(pattern: RegExp): string[]
  /** The response for a matched URL, or null. Awaited responses only. */
  responseFor(url: string): Response | undefined
}

export function collectRequests(page: Page): RequestLog {
  const urls: string[] = []
  const responses = new Map<string, Response>()
  page.on('request', (request) => void urls.push(request.url()))
  page.on('response', (response) => void responses.set(response.url(), response))
  return {
    urls,
    matching: (pattern) => urls.filter((u) => pattern.test(u)),
    responseFor: (url) => responses.get(url),
  }
}

/**
 * Whether a response really carries the bytes it claims to.
 *
 * **`status() === 200` is not usable here and that is measured, not theoretical.** The E2E
 * suite runs against `vite dev`, whose SPA fallback answers *any* unmatched path with 200 and
 * `index.html`: requesting `/vendor/draco/gltf/draco_decoder.wasm` — a path this repository
 * does not serve — returns `200 OK`, `content-type: text/html`, 751 bytes of `<!doctype html>`.
 * A test asserting `status() === 200` on a decoder URL passes when the decoder is missing,
 * which is the exact false green the card warns about, one layer up.
 *
 * So the assertion is on the payload: WASM starts with `\0asm`, and JavaScript is not HTML.
 */
export async function isRealAsset(response: Response): Promise<{ ok: boolean; why: string }> {
  const type = response.headers()['content-type'] ?? ''
  if (type.includes('text/html')) {
    return { ok: false, why: `content-type 是 ${type} —— 这是 dev server 的 SPA 兜底页，不是解码器` }
  }
  const body = await response.body()
  if (body.byteLength < 1024) {
    return { ok: false, why: `响应体只有 ${body.byteLength} 字节，解码器不可能这么小` }
  }
  const isWasm = body[0] === 0x00 && body[1] === 0x61 && body[2] === 0x73 && body[3] === 0x6d
  const isJs = !body.subarray(0, 200).includes(0x3c) || type.includes('javascript')
  if (!isWasm && !isJs) {
    return { ok: false, why: `前四字节 ${[...body.subarray(0, 4)].join(',')} 既不是 \\0asm 也不像 JS` }
  }
  return { ok: true, why: `${isWasm ? 'WASM' : 'JS'} · ${body.byteLength} 字节 · ${type}` }
}
