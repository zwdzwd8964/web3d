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
   * three's WebGL extension registry. **`KTX2Loader.detectSupport` is the only reader.**
   *
   * Adding a member here is a decision, not a formality (see the note at the top), and this
   * one is forced: `detectSupport` probes seven compressed-texture extensions by name
   * (`KTX2Loader.js:246-256`) to pick a transcode target. Without it on `RendererLike`, a
   * hand-written stub throws `Cannot read properties of undefined (reading 'has')` the moment
   * KTX2 is wired — which is not a test failure anyone can read.
   *
   * Shaped verbatim like `@types/three`'s `WebGLExtensions` so `createWebGLRenderer`'s return
   * value still assigns to `RendererLike` with zero casts.
   */
  extensions: { has(name: string): boolean; get(name: string): unknown }
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
  /**
   * 输出色彩空间。**`OutputPass` 是唯一的读者**（`OutputPass.js:97`）。
   *
   * 加这一条是被 T-236 逼出来的，而「加成员是决定不是形式」这句话在本文件顶上：
   * 它意味着仓库里每一个手写的渲染器桩都要能伪造它。之所以还是加，是因为没有它
   * 「后处理链有没有把色彩空间还原回 sRGB」这件事**在 Node 里根本测不了**——
   * 而那正是 v0.5 那次 `toneMapping` 假绿（M8）会以另一种形式重演的地方：
   * 画面整体偏亮/偏灰，所有单测全绿。
   *
   * 类型写成 `string` 而不是 three 的 `ColorSpace`：桩不必 import three 的枚举，
   * 而生产侧赋值仍然零 cast。
   */
  outputColorSpace: string
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
