import { MAX_PIXEL_RATIO, NullHotspotRenderer, SceneRuntime, captureDevicePixels, createMemoryResolver, maxCaptureScale } from '@w3/core'
import type { CaptureLimits, RendererLike } from '@w3/core'
import { createGoldenPathDocument } from '@w3/schema'
import { describe, expect, it } from 'vitest'

/**
 * T-214 · the device pixel ratio, and the capture clamp that has to agree with it.
 *
 * `setPixelRatio` was called nowhere in this repository before this card. The visible
 * symptom was 「描边看起来毛糙」 on every retina screen — the canvas rendered at 1× and the
 * browser upscaled it. The invisible one is worse and is the reason the capture half is in
 * the same file: an export is requested in CSS pixels and allocated in DEVICE pixels, so
 * the moment this card lands, a 2× screen turns a 4× export into 8× — and `planCapture`'s
 * unit tests inject a stub `limits`, so they stay green while a real machine loses its
 * WebGL context and shows a white page.
 */

/**
 * Enough of a renderer to record what the runtime asked for. Zero GL calls.
 *
 * Annotated `RendererLike` with no cast, per T-200: if a member is missing the file does
 * not compile, rather than throwing `undefined is not a function` from whichever line
 * reaches it first — which is exactly how the first draft of this test failed.
 */
function recordingRenderer(): RendererLike & { ratios: number[]; sizes: [number, number, boolean | undefined][] } {
  const canvas = { clientWidth: 800, clientHeight: 600 } as HTMLCanvasElement
  let ratio = 1
  const ratios: number[] = []
  const sizes: [number, number, boolean | undefined][] = []
  const renderer: RendererLike = {
    render: () => {},
    setSize: (w, h, updateStyle) => void sizes.push([w, h, updateStyle]),
    setPixelRatio: (value) => {
      ratio = value
      ratios.push(value)
    },
    getPixelRatio: () => ratio,
    setClearColor: () => {},
    setClearAlpha: () => {},
    clippingPlanes: [],
    localClippingEnabled: false,
    getContext: () => {
      throw new Error('桩渲染器没有 GL 上下文')
    },
    capabilities: { maxTextureSize: 8192 },
    extensions: { has: () => false, get: () => null },
    info: { memory: { geometries: 0, textures: 0 }, render: { triangles: 0, calls: 0 }, programs: null },
    shadowMap: { enabled: false, type: 0 },
    toneMapping: 0,
    toneMappingExposure: 1,
    // T-236 · OutputPass.js:97 是唯一读者
    outputColorSpace: 'srgb',
    setRenderTarget: () => {},
    domElement: canvas,
    dispose: () => {},
  }
  return Object.assign(renderer, { ratios, sizes })
}

function runtimeWith(dpr: number, injected = true) {
  const renderer = recordingRenderer()
  const runtime = new SceneRuntime(createGoldenPathDocument(), {
    resolver: createMemoryResolver(new Map()),
    mode: 'play',
    hotspotRenderer: new NullHotspotRenderer(),
    now: () => 0,
    ...(injected ? { devicePixelRatio: () => dpr } : {}),
  })
  runtime.attachRenderer(renderer)
  return { renderer, runtime }
}

describe('T-214 · 设备像素比封顶', () => {
  // Both directions. Only checking that 3 becomes 2 cannot tell a cap of 2 from a cap of 1;
  // only checking that 2 stays 2 cannot tell a cap of 2 from no cap at all.
  it.each([
    [1, 1],
    [2, 2],
    [3, 2],
  ])('dpr %i renders at %i', (dpr, expected) => {
    const { renderer } = runtimeWith(dpr)
    expect(renderer.getPixelRatio()).toBe(expected)
  })

  it('never renders below 1× — a browser at 50% zoom reports 0.5', () => {
    const { renderer } = runtimeWith(0.5)
    expect(renderer.getPixelRatio()).toBe(1)
  })

  it('re-applies the ratio on resize, because moving to another monitor fires only that', () => {
    const { renderer, runtime } = runtimeWith(3)
    const before = renderer.ratios.length
    runtime.resize(1024, 768)
    expect(renderer.ratios.length).toBeGreaterThan(before)
    expect(renderer.ratios.at(-1)).toBe(MAX_PIXEL_RATIO)
  })

  it('keeps setSize(w, h, false) — three must not write the device size into the CSS size', () => {
    const { renderer, runtime } = runtimeWith(2)
    runtime.resize(1024, 768)
    expect(renderer.sizes.at(-1)).toEqual([1024, 768, false])
    // The CSS size is the container's, and nothing here touched it.
    expect(renderer.domElement.clientWidth).toBe(800)
    expect(renderer.domElement.clientHeight).toBe(600)
  })

  it('falls back to globalThis.devicePixelRatio when nothing is injected', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio')
    Object.defineProperty(globalThis, 'devicePixelRatio', { value: 3, configurable: true })
    try {
      const { renderer } = runtimeWith(0, false)
      expect(renderer.getPixelRatio()).toBe(2)
    } finally {
      if (original) Object.defineProperty(globalThis, 'devicePixelRatio', original)
      else delete (globalThis as { devicePixelRatio?: number }).devicePixelRatio
    }
  })

  it('leaves the renderer installed and drawable', () => {
    const { runtime, renderer } = runtimeWith(2)
    expect(runtime.activeRenderer).toBe(renderer)
    runtime.tick()
    runtime.dispose()
  })
})

describe('T-214 · CaptureLimits.pixelRatio 进钳位公式', () => {
  const at = (pixelRatio: number, maxTextureSize = 16384): CaptureLimits => ({ pixelRatio, maxTextureSize })

  it('a capture is allocated in device pixels, not CSS pixels', () => {
    // The dialog says "1920 × 2 = 3840". On a 2× screen the GPU is asked for 7680.
    expect(captureDevicePixels(1920, 2, at(1))).toBe(3840)
    expect(captureDevicePixels(1920, 2, at(2))).toBe(7680)
  })

  it('rounds to whole pixels and never returns zero', () => {
    // Rounded, not truncated: 1.5 device pixels is a real half-pixel row on a 1.5× screen.
    expect(captureDevicePixels(101, 1.5, at(1))).toBe(152)
    expect(captureDevicePixels(0, 1, at(1))).toBe(1)
  })

  it('the ceiling on scale drops as the pixel ratio rises', () => {
    // 1920 CSS px against an 8192 texture limit: 4× fits at 1×, only 2× fits at 2×.
    expect(maxCaptureScale(1920, at(1, 8192), 4)).toBe(4)
    expect(maxCaptureScale(1920, at(2, 8192), 4)).toBe(2)
  })

  it('an unknown texture limit does not clamp to 1× — unknown is not zero', () => {
    // maxTextureSize === 0 is what an older probe reports for a perfectly capable GPU.
    // Treating it as a hard limit would cap every export on those machines at 1×.
    expect(maxCaptureScale(1920, at(2, 0), 4)).toBe(4)
  })

  it('never returns a scale below 1, however small the limit', () => {
    expect(maxCaptureScale(4000, at(2, 512), 4)).toBe(1)
  })
})
