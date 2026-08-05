import { buildIndex, createGoldenPathDocument } from '@w3/schema'
import { createActionRefResolver } from '@w3/core'
import type { Media, SceneDocument } from '@w3/schema'
import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { deleteWarning, formatBytes, formatDuration, mediaRows, removeMedia, renameMedia } from '../src/lib/media-edit.js'

/**
 * T-161 · the media panel's decisions.
 *
 * The load-bearing one is the delete confirmation: 「确认删除？」 with no detail is a dialog
 * people learn to click through, so the sentence has to name what actually points at it.
 */

const MEDIA: Media = { id: 'med_00000001', type: 'audio', assetId: 'ast_med00001', name: '讲解.mp3', durationS: 12.5 }

/** The golden path plus one audio asset and its media record. */
function withMedia(): SceneDocument {
  const base = createGoldenPathDocument()
  return {
    ...base,
    assets: [
      ...base.assets,
      {
        ...base.assets[0]!,
        id: 'ast_med00001',
        type: 'audio',
        name: '讲解.mp3',
        stats: { ...base.assets[0]!.stats, bytes: 2 * 1024 * 1024 },
      },
    ],
    media: [MEDIA],
  } as SceneDocument
}

describe('what the list shows', () => {
  it('reads the size from the asset the media points at', () => {
    const [row] = mediaRows(withMedia())
    expect(row!.bytes).toBe(2 * 1024 * 1024)
    expect(formatBytes(row!.bytes)).toBe('2.0 MB')
  })

  it('keeps the decimal under a minute and switches to m:ss above it', () => {
    // 「0:12」 loses the tenth of a second, and a tenth is the difference between a
    // narration that fits a step and one that runs past it.
    expect(formatDuration(12.5)).toBe('12.5 秒')
    expect(formatDuration(75)).toBe('1:15')
    expect(formatDuration(600)).toBe('10:00')
  })

  it('says so when the duration is unknown, rather than showing 0', () => {
    // 0 is a claim about the file. Absent means the browser would not say, and `playMedia`
    // resolves immediately (D19) — two very different things for the user to plan around.
    expect(formatDuration(undefined)).toBe('时长未知')
  })
})

describe('references, from the document index', () => {
  /** The golden path's hotspot, pointed at the media record. */
  const referenced = () =>
    produce(withMedia(), (draft) => {
      draft.hotspots[0]!.content.mediaId = MEDIA.id
    })

  it('counts nothing for a media record nobody uses', () => {
    const [row] = mediaRows(withMedia())
    expect(row!.refCount).toBe(0)
    expect(deleteWarning(withMedia(), MEDIA.id), '没人引用就不该问').toBeNull()
  })

  /**
   * T-227 · **被引用数与摘要必须来自同一次统计。**
   *
   * 原来 `refCount` 数全部引用，而 `refSummary` 只认 hotspot 与 rule 两种 from.kind。
   * v3 给覆盖层加上「引用媒体」这条出边之后，一份只被覆盖层用到的媒体会显示
   * 「被 1 处引用」而摘要是空串——删除确认框问了一句它自己答不上来的话。
   *
   * 这条测试的样本文档必须**含 pages**：本文件其余用例都不含，所以那个缺陷在它们
   * 眼皮底下全程是绿的。
   */
  it('只被覆盖层引用的媒体，摘要说得出是谁 —— 不是空串', () => {
    const doc = produce(withMedia(), (draft) => {
      draft.pages = [
        {
          id: 'pg_00000001',
          name: '第一页',
          overlays: [
            {
              id: 'ov_00000001',
              type: 'panel',
              rect: { x: 0, y: 0, w: 0.3, h: 0.2 },
              anchor: 'tl',
              props: { title: '说明', text: '', mediaId: MEDIA.id, flowId: null, progress: false },
            },
          ],
        },
      ]
    })

    const [row] = mediaRows(doc)
    expect(row!.refCount, '覆盖层的引用没进索引').toBe(1)
    expect(row!.refSummary, '数得出却说不出是谁').toBe('1 个覆盖层')
    expect(deleteWarning(doc, MEDIA.id)!).toContain('1 个覆盖层')
  })

  it('names what points at it, so the confirmation is worth reading', () => {
    const doc = referenced()
    const [row] = mediaRows(doc)
    expect(row!.refCount).toBe(1)
    expect(row!.refSummary).toBe('1 个热点')

    const warning = deleteWarning(doc, MEDIA.id)!
    expect(warning).toContain('讲解.mp3')
    expect(warning).toContain('1 个热点')
  })

  it('asks the ACTION registry too, not just the document shape', () => {
    // `playMedia` keeps its media id inside a rule action's parameters, which `buildIndex`
    // can only see through the action-ref resolver. Without it the panel would say
    // 「被 1 个热点引用」 for a clip a rule also plays, and deleting it would break the rule
    // silently. The index says so itself via `actionRefsResolved`.
    const resolved = buildIndex(referenced(), { actionRefs: createActionRefResolver() })
    expect(resolved.actionRefsResolved, '没有解析器就等于没查规则动作').toBe(true)
    expect(buildIndex(referenced()).actionRefsResolved).toBe(false)

    // …and `mediaRows` really forwards one. A stand-in resolver that claims every action
    // parameter points at the media record: with the resolver wired the count goes up, and
    // without it the rule stays invisible. `playMedia` itself lands in T-163 — this asserts
    // the wiring now, so it cannot be quietly dropped in between.
    const doc = produce(referenced(), (draft) => {
      draft.rules.push({
        id: 'rl_media0001',
        name: '播讲解',
        enabled: true,
        when: { event: 'hotspotClick', hotspotId: draft.hotspots[0]!.id },
        if: [],
        ifAny: [],
        then: [{ type: 'playMedia', params: { mediaId: MEDIA.id } }],
      } as never)
    })
    // Only for the action under test: the golden path has other rules, and a resolver that
    // claimed everything referenced the clip would make the assertion meaningless.
    const pretendResolver = (action: { type: string }) =>
      action.type === 'playMedia' ? [{ kind: 'media', id: MEDIA.id }] : []

    expect(mediaRows(doc, { actionRefs: pretendResolver as never })[0]!.refCount).toBe(2)
    expect(deleteWarning(doc, MEDIA.id, { actionRefs: pretendResolver as never })).toContain('规则')
  })
})

describe('renaming and deleting', () => {
  it('renames the RECORD, never the file', () => {
    // The asset's name is the bytes' identity and shows in the asset panel; the media name
    // is what the user picks from. Renaming one must not touch the other.
    const after = produce(withMedia(), (draft) => renameMedia(draft, MEDIA.id, '开机讲解'))
    expect(after.media[0]!.name).toBe('开机讲解')
    expect(after.assets.find((a) => a.id === 'ast_med00001')!.name).toBe('讲解.mp3')
  })

  it('refuses a blank name', () => {
    // A blank row is one the user cannot click accurately, and there is no undo affordance
    // for "I pressed enter on an empty box".
    const after = produce(withMedia(), (draft) => renameMedia(draft, MEDIA.id, '   '))
    expect(after.media[0]!.name).toBe('讲解.mp3')
  })

  it('deletes the record and LEAVES the asset', () => {
    // Bytes are content-addressed and shared: another media entry may point at the same
    // file, and collecting orphaned blobs is a publish-time decision, not a list row's.
    const after = produce(withMedia(), (draft) => removeMedia(draft, MEDIA.id))
    expect(after.media).toHaveLength(0)
    expect(after.assets.some((a) => a.id === 'ast_med00001'), '字节还在').toBe(true)
  })
})
