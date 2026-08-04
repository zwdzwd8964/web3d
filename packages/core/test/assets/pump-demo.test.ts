import { describe, expect, it } from 'vitest'
import { auditGlb } from '../../src/assets/audit.js'
import { AssetLoader } from '../../src/runtime/loader.js'
import { PUMP_DEMO_CLIP, PUMP_DEMO_OBJECTS, buildPumpDemoGlb } from '../../src/assets/pump-demo.js'
import { SAMPLE_OBJECT_PATHS, buildSamplePumpGlb } from '../../src/assets/sample.js'

/** Parses GLB bytes through the production loader — the same path an import takes. */
async function loadGlb(bytes: ArrayBuffer) {
  return new AssetLoader({ resolver: { resolve: async () => bytes } }).parse('ast_pumpdemo', bytes)
}

/**
 * T-222 · 泵组资产生成器与对象路径契约。
 *
 * The claim this file has to make true is 「这个引擎处理过一个像泵一样的装配体」. Everything
 * before it — two boxes in the sample, one triangle in the E2E fixture — meant that a green
 * suite said nothing about deep hierarchies, materials shared across ten meshes, cylinders,
 * or imported animation.
 */

describe('对象路径三方相等', () => {
  /**
   * Three-way, not two-way.
   *
   * `PUMP_DEMO_OBJECTS` and the generator live in the same file, so comparing them to each
   * other agrees by construction. The third party is what the LOADER actually produces from
   * the bytes — which is the only one the document's `assetRef.objectPath`s are resolved
   * against at run time.
   */
  it('matches what the loader finds in the bytes', async () => {
    const loaded = await loadGlb(await buildPumpDemoGlb())
    expect([...loaded.objects.keys()].sort()).toEqual([...PUMP_DEMO_OBJECTS].sort())
  })

  it('has no duplicate and no orphaned path', () => {
    expect(new Set(PUMP_DEMO_OBJECTS).size).toBe(PUMP_DEMO_OBJECTS.length)
    for (const path of PUMP_DEMO_OBJECTS) {
      // `> 0`, not `!== -1`: `'Root'.lastIndexOf('/')` is -1 and `slice(0, -1)` silently
      // yields `'Roo'` — a parent that looks plausible and does not exist.
      const cut = path.lastIndexOf('/')
      if (cut > 0) expect(PUMP_DEMO_OBJECTS).toContain(path.slice(0, cut))
    }
  })

  it('is an assembly, not a bag: sixteen objects, four levels deep', () => {
    expect(PUMP_DEMO_OBJECTS).toHaveLength(16)
    expect(Math.max(...PUMP_DEMO_OBJECTS.map((p) => p.split('/').length))).toBe(4)
  })
})

describe('材质共享 · 铁律 9 的前提', () => {
  it('backs at least ten meshes with one steel material', async () => {
    const loaded = await loadGlb(await buildPumpDemoGlb())
    // Traversed ONCE from the scene root. Walking `loaded.objects.values()` visits every
    // nested object again for each of its ancestors, which multiplies the counts by the tree
    // depth — measured: it made the assertion pass with only nine steel meshes, and moving
    // two parts off steel still left it green.
    const users = new Map<unknown, Set<unknown>>()
    loaded.scene.traverse((child) => {
      const material = (child as { material?: unknown }).material
      if (!material) return
      const meshes = users.get(material) ?? new Set()
      meshes.add(child)
      users.set(material, meshes)
    })
    // The most-shared material, not "some material is shared": the number is what makes
    // clone-on-write interesting rather than merely correct.
    expect(Math.max(...[...users.values()].map((s) => s.size))).toBeGreaterThanOrEqual(10)
  })
})

describe('可复现性', () => {
  it('produces byte-identical output on every call', async () => {
    const [a, b] = [await buildPumpDemoGlb(), await buildPumpDemoGlb()]
    expect(a.byteLength).toBe(b.byteLength)
    // Byte equality, not length equality: a generator that stamped a timestamp would keep
    // the same length and break every content-addressed asset key.
    expect(new Uint8Array(a)).toEqual(new Uint8Array(b))
  })
})

describe('导入动画真的在文件里', () => {
  /**
   * The whole reason this card exists in the demo's critical path.
   *
   * The sample asset record hand-writes `stats.animations: ['Disassemble']` while its GLB
   * contains no animation channel at all, so the measured stats overwrite it with `[]` and
   * the demo has never had an importable clip. `stats.animations` is measured from the file,
   * so this assertion cannot be satisfied by a hand-written record.
   */
  it('reports the clip in the measured stats', async () => {
    const bytes = await buildPumpDemoGlb()
    const result = await auditGlb(bytes)
    expect(result.stats.animations).toEqual([PUMP_DEMO_CLIP.name])
  })

  it('gives the clip the length the demo document promises', async () => {
    const loaded = await loadGlb(await buildPumpDemoGlb())
    const clip = loaded.clips.find((c) => c.name === PUMP_DEMO_CLIP.name)
    // Shape first — `not.toBeNull()` is also true of `undefined`, which is how three of
    // v0.5's E18 mutations survived.
    expect(clip?.name).toBe(PUMP_DEMO_CLIP.name)
    expect(clip?.duration).toBeCloseTo(PUMP_DEMO_CLIP.seconds, 3)
  })

  /**
   * ⚠ **`stats.clipDurations` is NOT asserted here, and that is a card-face correction.**
   *
   * The card's acceptance says `stats.clipDurations['拆装'] ≈ 2.0`. That field does not exist
   * yet: `AssetStatsSchema` is `.strict()` and has seven keys, none of them `clipDurations`.
   * It arrives with schema v3 (T-225, a single-card wave that has not started) and is
   * measured by T-234. This card is in W0 with no dependencies, so the assertion cannot be
   * written here without either failing or being a lie.
   *
   * What it would have proven is proven above from `AnimationClip.duration` — the same number,
   * read from the loader instead of from a field that does not exist. **T-234 owns moving it.**
   */
  it('carries the duration in a place that exists today', async () => {
    const loaded = await loadGlb(await buildPumpDemoGlb())
    expect(loaded.clips.map((c) => c.name)).toEqual([PUMP_DEMO_CLIP.name])
  })
})

describe('SAMPLE_OBJECT_PATHS · 第三次同形零调用者', () => {
  /**
   * The old sample's path list has never been asserted against anything.
   *
   * It is the third export in this repository to be written, exported and never referenced
   * (`docs/DEAD_EXPORTS_ALLOWLIST.md` carries it with `owner: T-222`). A constant that
   * nothing checks is a constant that can be wrong — and this one is the contract between
   * `buildSamplePumpGlb` and every `assetRef.objectPath` in the golden-path document.
   */
  it('matches what the loader finds in the sample bytes', async () => {
    const loaded = await loadGlb(await buildSamplePumpGlb())
    expect([...loaded.objects.keys()].sort()).toEqual([...SAMPLE_OBJECT_PATHS].sort())
  })
})
