import { createGoldenPathDocument } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { SceneRuntime, buildSamplePumpGlb, createMemoryResolver, registerBuiltinActions } from '@w3/core'
import type { ExecResult } from '@w3/core'
import { PreviewController, createPreviewStore } from '@w3/editor'
import { createPlayerSession } from '@w3/player'
import { packScene, unpackScene } from '@w3/storage'
import { beforeAll, describe, expect, it } from 'vitest'
import script from './event-script.json' with { type: 'json' }

/**
 * T-103 · G0-4 · the constitution C3 gate.
 *
 * "编辑器里是这样、发布出来不一样" (技术方案 §1.1) is the acceptance disaster this whole
 * architecture exists to prevent, and this file is its only automated defence. ECA_SPEC
 * §9.3 is blunt about the consequence of it failing: **停下来修架构，不要继续加功能.**
 *
 * ── Why this is not self-proving ──────────────────────────────────────────────
 *
 * Both sides do end up inside `createPlaybackSession` — that is the point of T-102. If
 * this test called that function twice it would prove nothing but its own determinism. So
 * each side is driven through its REAL entry point, and the two paths differ in every way
 * a real deployment differs:
 *
 *   editor side   PreviewController.enter()  · document object held in memory
 *                                            · assets from the session's resolver
 *   player side   createPlayerSession()      · document round-tripped through a .w3p
 *                                              (JSON serialise -> zip -> unzip -> parse)
 *                                            · assets from createPackageResolver
 *                                            · assertCompatible + its own registration
 *
 * What is being asserted is that none of those differences reaches behaviour. A divergence
 * anywhere in packing, unpacking, resolution, registration or wiring order shows up here
 * as a mismatched ExecResult and nowhere else until a customer finds it.
 *
 * ── What this does NOT cover ──────────────────────────────────────────────────
 *
 * The layer above: how each host turns a pointer event into a call on its side. The
 * editor's viewport used to translate a hotspot click into a SELECTION while the player
 * fired the rule — a genuine C3 divergence that this file could never have seen, because
 * both sides here are driven through the controller/session API directly.
 *
 * That layer belongs to the browser E2E, and the split is deliberate: parity is the
 * head-less gate that can run on every commit, and dragging a DOM into it would cost that.
 * Nobody should read a green parity run as "the two hosts behave identically" — it means
 * "given the same input at the session boundary, the two behave identically".
 */

type ScriptStep = {
  atMs: number
  note: string
  event:
    | { kind: 'click'; nodeId: string }
    | { kind: 'hotspotClick'; hotspotId: string }
    | { kind: 'pointerOver'; nodeId: string | null }
    | { kind: 'setVar'; variableId: string; value: number }
    | { kind: 'idle' }
}

const STEPS = (script as { steps: ScriptStep[] }).steps

/** Frame quantum for the fake clock. Small enough that a 1.2 s tween gets ~72 samples. */
const FRAME_MS = 16

let glb: ArrayBuffer

beforeAll(async () => {
  registerBuiltinActions()
  glb = await buildSamplePumpGlb()
})

/**
 * Runs the script against one side and returns its execution trace.
 *
 * `advance` is shared so both sides are ticked identically: same frame quantum, same
 * instants, same number of ticks. Anything else would make timestamp comparison
 * meaningless and would hide a real divergence behind a scheduling one.
 */
async function replay(
  side: 'editor' | 'player',
  doc: SceneDocument,
): Promise<{ results: ExecResult[]; variables: Record<string, unknown> }> {
  const results: ExecResult[] = []
  let clock = 0
  const now = () => clock

  let runtime: SceneRuntime
  let dispatchClick: (nodeId: string) => void
  let dispatchHotspot: (hotspotId: string) => void
  let dispatchHover: (nodeId: string | null) => void
  let tick: () => void
  let stop: () => void

  if (side === 'editor') {
    // The editor's real path: a runtime it owns, driven by PreviewController.
    runtime = new SceneRuntime(doc, {
      resolver: createMemoryResolver(new Map([[doc.assets[0]!.url, glb]])),
      mode: 'edit',
      now,
    })
    const store = createPreviewStore()
    const controller = new PreviewController(runtime, store)
    store.subscribe(() => {
      // The controller pushes results into the store; read them from there rather than
      // from the engine, because that is the path the debug panel uses too.
    })
    // `append` is what the controller calls; wrap it to capture in order.
    const original = store.getState().append
    store.setState({
      append: (result: ExecResult) => {
        results.push(result)
        original(result)
      },
    })

    await controller.enter(doc)
    // Each side through its OWN entry point. Routing both through `runtime.emit` would
    // have hidden the real divergence the reviewer found: the editor's viewport used to
    // turn a hotspot click into a selection while the player fired the rule.
    dispatchClick = (nodeId) => controller.dispatchClick(nodeId)
    dispatchHotspot = (hotspotId) => controller.dispatchHotspotClick(hotspotId)
    dispatchHover = (nodeId) => controller.dispatchPointerOver(nodeId)
    tick = () => runtime.tick()
    stop = () => controller.exit()
  } else {
    // The player's real path: the document has been through a .w3p round trip.
    const packed = packScene({
      document: doc,
      snapshotId: 'snp_parity01',
      publishedAt: '2026-07-31T00:00:00.000Z',
      coreVersion: '0.0.0',
      blobs: new Map([[doc.assets[0]!.hash, new Uint8Array(glb)]]),
    })
    const pkg = unpackScene(packed)

    const created = createPlayerSession({ pkg, now, onResult: (r) => results.push(r) })
    runtime = created.runtime
    await created.session.start()
    dispatchClick = (nodeId) => created.session.click(nodeId)
    dispatchHotspot = (hotspotId) => created.session.hotspotClick(hotspotId)
    dispatchHover = (nodeId) => created.session.pointerOver(nodeId)
    tick = () => created.session.tick()
    stop = () => created.session.dispose()
  }

  // Replay. The clock only ever moves forward in FRAME_MS steps, and every event fires at
  // the exact instant the script names.
  for (const step of STEPS) {
    while (clock < step.atMs) {
      clock = Math.min(step.atMs, clock + FRAME_MS)
      tick()
      await settle()
    }
    switch (step.event.kind) {
      case 'click':
        dispatchClick(step.event.nodeId)
        break
      case 'hotspotClick':
        dispatchHotspot(step.event.hotspotId)
        break
      case 'pointerOver':
        dispatchHover(step.event.nodeId)
        break
      case 'setVar':
        runtime.setVar(step.event.variableId, step.event.value)
        break
      case 'idle':
        break
    }
    await settle()
  }

  const variables: Record<string, unknown> = {}
  for (const variable of doc.variables) variables[variable.id] = runtime.getVar(variable.id)

  stop()
  return { results, variables }
}

/** Lets the executor's promise chain run to quiescence between ticks. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

describe('G0-4 · 编辑器预览与播放器的执行轨迹逐项相等', () => {
  it('runs the same script on both sides and gets identical ExecResult sequences', async () => {
    const doc = createGoldenPathDocument()

    const editor = await replay('editor', doc)
    const player = await replay('player', doc)

    // Fail loudly and legibly. A bare toEqual on two arrays of nested objects produces a
    // diff nobody can read, and this is the one test whose failure has to be actionable.
    expect(summarise(player.results), formatMismatch(editor.results, player.results)).toEqual(
      summarise(editor.results),
    )

    // The full structure, once the summary matches — this catches step-level differences
    // the summary flattens away.
    expect(player.results).toEqual(editor.results)

    // Variable state is the other half of "逐项一致": two runs can produce the same rule
    // log and still end with different state if an action wrote different values.
    expect(player.variables).toEqual(editor.variables)
  })

  it('actually exercised the interesting cases, rather than trivially matching nothing', async () => {
    const doc = createGoldenPathDocument()
    const { results } = await replay('editor', doc)

    // A parity test that compares two empty arrays passes and proves nothing. These
    // assertions are about the SCRIPT, not the code: they fail if the fixture drifts into
    // being vacuous.
    expect(results.length, '事件脚本没有触发任何规则，这样的 parity 通过是假的').toBeGreaterThan(2)
    const statuses = new Set(results.map((r) => r.status))
    expect(statuses.has('completed'), '脚本从未让任何规则完整跑完').toBe(true)
    expect(
      statuses.has('skipped-condition') || statuses.has('skipped-reentry'),
      '脚本从未触发条件不满足或重入跳过，这两条正是最容易两侧不一致的路径',
    ).toBe(true)

    const kinds = new Set(STEPS.map((s) => s.event.kind))
    // hover and hotspotClick are the two input paths that HAVE diverged between the two
    // sides in this repo. A script without them stays green while the divergence lives on,
    // so their presence is asserted rather than assumed.
    expect(kinds.has('pointerOver'), '事件脚本必须包含 hover，那是曾经全仓无发射点的一条路径').toBe(true)
    expect(kinds.has('hotspotClick'), '事件脚本必须包含热点点击，那是曾经两侧含义不同的一条路径').toBe(true)
  })

  it('the document survives the .w3p round trip byte-for-byte', async () => {
    const doc = createGoldenPathDocument()
    const packed = packScene({
      document: doc,
      snapshotId: 'snp_parity01',
      publishedAt: '2026-07-31T00:00:00.000Z',
      coreVersion: '0.0.0',
      blobs: new Map([[doc.assets[0]!.hash, new Uint8Array(glb)]]),
    })
    const pkg = unpackScene(packed)

    // If this drifts, every parity assertion above is comparing two different documents
    // and the whole suite becomes meaningless without failing.
    expect(pkg.document).toEqual(doc)
    expect(pkg.manifest.schemaVersion).toBe(doc.schemaVersion)
    expect(pkg.blobs.get(doc.assets[0]!.hash)?.byteLength).toBe(glb.byteLength)
  })
})

/** ruleId + status + step statuses — the shape a human can actually diff. */
const summarise = (results: readonly ExecResult[]) =>
  results.map((r) => `${r.ruleId} ${r.status} [${r.steps.map((s) => `${s.action}:${s.status}`).join(',')}]`)

function formatMismatch(editor: readonly ExecResult[], player: readonly ExecResult[]): string {
  const a = summarise(editor)
  const b = summarise(player)
  const lines = ['编辑器预览与播放器的执行轨迹不一致（宪法 C3 被违反）：', '']
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i++) {
    const same = a[i] === b[i]
    lines.push(`${same ? '  ' : '✗ '}[${i}] 编辑器: ${a[i] ?? '（无）'}`)
    lines.push(`${same ? '  ' : '✗ '}[${i}] 播放器: ${b[i] ?? '（无）'}`)
  }
  lines.push('', 'ECA_SPEC §9.3：这条不过说明架构分叉了，停下来修架构，不要继续加功能。')
  return lines.join('\n')
}
