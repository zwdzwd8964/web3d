import type { Camera, ColorRepresentation, Object3D, Plane, ShadowMapType, Texture, WebGLRenderTarget } from 'three'
import { WebGLRenderer } from 'three'

/**
 * T-200 · the renderer injection seam.
 *
 * Everything in `packages/core/src/runtime` except the WebGL calls themselves runs in plain
 * Node (C8). Until this file existed there was no way to say so in the type system:
 * `SceneRuntime` held a `WebGLRenderer`, built one internally from a canvas, and the only
 * way a test could supply a stand-in was `as unknown as WebGLRenderer` — a cast that hides
 * every member the stub forgot.
 *
 * `RendererLike` lists **only the members this repository actually touches**, so a stub can
 * be written by hand with zero GL and the compiler will say which parts are missing. It is
 * deliberately NOT `WebGLRenderer`'s full structural type: that type has ~60 members, and a
 * seam nobody can implement is not a seam.
 *
 * Five domains' "testable without a GPU" claims rest on this file: the section layer asserts
 * `renderer.clippingPlanes`, image export asserts the capture surface, the post-processing
 * pipeline asserts `composer.passes`, the KTX2 decoder asserts `attachRenderer(stub)`, and
 * the asset pipeline asserts `loader.parse` before/after. None of them can be written
 * against a private field and a private constructor call.
 *
 * **Adding a member here is a decision, not a formality**: it is a new thing every stub in
 * the repository has to be able to fake. Add one only when production code needs it.
 */
export interface RendererLike {
  /** Draws one frame. The only member the render loop strictly requires. */
  render(scene: Object3D, camera: Camera): void
  /**
   * Drawing-buffer size. `updateStyle: false` throughout this repo — the canvas' CSS size is
   * owned by the layout, and letting three write it fights the editor's flex panes.
   */
  setSize(width: number, height: number, updateStyle?: boolean): void
  setPixelRatio(value: number): void
  getPixelRatio(): number
  setClearColor(color: ColorRepresentation, alpha?: number): void
  setClearAlpha(alpha: number): void
  /** Global clipping planes. T-243's section layer writes this and asserts on it. */
  clippingPlanes: Plane[]
  localClippingEnabled: boolean
  getContext(): WebGLRenderingContext | WebGL2RenderingContext
  /** Narrowed to the one field consumed (T-262's capture clamp); not three's whole class. */
  capabilities: { readonly maxTextureSize: number }
  /**
   * Counters. `render.*` is reset by three at the start of every frame, so it has to be read
   * AFTER a tick — the single most common way to misread this API.
   */
  info: {
    memory: { geometries: number; textures: number }
    render: { triangles: number; calls: number }
    programs?: { length: number } | null
  }
  shadowMap: { enabled: boolean; type: ShadowMapType }
  /**
   * Tone mapping lives on the renderer, not the scene, so `EnvironmentController` writes it.
   * Listed here because production code touches it — see the cast at its call site in
   * `scene-runtime.ts`.
   */
  toneMapping: number
  toneMappingExposure: number
  setRenderTarget(renderTarget: WebGLRenderTarget | WebGLRenderTarget<Texture[]> | null): void
  readonly domElement: HTMLCanvasElement
  dispose(): void
}

/** What `createWebGLRenderer` accepts. `preserveDrawingBuffer` is not negotiable — see below. */
export interface WebGLRendererOptions {
  readonly canvas: HTMLCanvasElement
  /** Transparent clear colour. The viewport wants it; a thumbnail on a solid plate does not. */
  readonly alpha?: boolean
  readonly antialias?: boolean
}

/**
 * The one place in `@w3/core` that constructs a real `WebGLRenderer`.
 *
 * There used to be two — the runtime's and the thumbnail renderer's — with independently
 * chosen constructor flags. `preserveDrawingBuffer: true` is the flag that matters: without
 * it the drawing buffer is undefined by the time `toDataURL` / `toBlob` runs, so thumbnails
 * (T-053) and image export (v1.0's T-266) both come back blank, intermittently, on some
 * drivers only. Two construction sites means that guarantee can be lost in one of them and
 * hold in the other, which is exactly the kind of difference nobody reproduces.
 *
 * Returns the concrete `WebGLRenderer` rather than `RendererLike`: the caller that needs
 * `forceContextLoss()` is real-browser-only anyway, and narrowing here would push a cast
 * onto it. Assignability to `RendererLike` is proven by the default factory in
 * `scene-runtime.ts`, which is typed as returning `RendererLike`.
 */
export function createWebGLRenderer(options: WebGLRendererOptions): WebGLRenderer {
  return new WebGLRenderer(webGLRendererParams(options))
}

/**
 * The exact parameter object `createWebGLRenderer` hands to three.
 *
 * Split out because it is the only part of renderer construction that can be asserted
 * outside a browser, and it is the part that matters. `preserveDrawingBuffer` has never once
 * been verified by a test in this repository: the E2E suite reads pixels with
 * `drawImage + getImageData` rather than `toDataURL`, which works whether or not the flag is
 * set. So the flag that image export depends on is, today, protected by nothing — and
 * turning it off breaks a feature that has not been written yet, which is the worst possible
 * time to find out. T-295 carries the browser-side half; this is the Node-side half.
 */
export function webGLRendererParams(options: WebGLRendererOptions): {
  canvas: HTMLCanvasElement
  antialias: boolean
  alpha: boolean
  preserveDrawingBuffer: true
} {
  return {
    canvas: options.canvas,
    antialias: options.antialias ?? true,
    alpha: options.alpha ?? true,
    // Required for T-053's thumbnail and v1.0's image export (T-266): without it the drawing
    // buffer is undefined by the time `toBlob` / `toDataURL` runs, and the failure is
    // driver-dependent — blank images on some machines, correct on the author's.
    preserveDrawingBuffer: true,
  }
}
