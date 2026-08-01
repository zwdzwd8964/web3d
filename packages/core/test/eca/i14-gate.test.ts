import { checkIntegrity, createGoldenPathDocument } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { beforeAll, describe, expect, it } from 'vitest'
import { ActionRegistry, createActionRefResolver, registerBuiltinActions } from '../../src/eca/actions/index.js'

/**
 * T-176 · I14 第三条子句：`playMedia` 只接受 audio 媒体。
 *
 * 进化规划 §1.3 的灰区裁决写着「视频进 ECA 动作 —— 不做：`playMedia` 只接受
 * `type: 'audio'` 的媒体（完整性检查 I14 挡住）」。那道闸门**在生产路径上从来不存在**：
 * schema 侧的 `requireType` 只在 `RefTarget.expectType` 出现时才动作，而生产解析器
 * （core 的注册表）从不产出这个字段——唯一设过它的是 schema 测试里手写的一个假解析器。
 *
 * 所以这个文件测的是**生产解析器**，不是任何替身。这正是 T-176 审查里那条 blocker
 * 三个独立视角都没能证伪的原因：假绿的不是断言，是它连接的那一端。
 */

let registry: ActionRegistry

beforeAll(() => {
  registry = registerBuiltinActions(new ActionRegistry())
})

/** The golden path plus one media record of the given type, played by a rule. */
function docWithMedia(type: 'audio' | 'video' | 'image'): SceneDocument {
  const base = createGoldenPathDocument()
  return {
    ...base,
    assets: [...base.assets, { ...base.assets[0]!, id: 'ast_med00001', type, name: `讲解.${type}` }],
    media: [{ id: 'med_00000001', type, assetId: 'ast_med00001', name: '讲解' }],
    rules: [
      ...base.rules,
      {
        id: 'rl_media0001',
        name: '播媒体',
        enabled: true,
        when: { event: 'click', target: { nodeId: 'nd_v7w9x2z4' } },
        if: [],
        ifAny: [],
        mode: 'sequence',
        reentry: 'restart',
        onError: 'abort',
        then: [{ action: 'playMedia', params: { mediaId: 'med_00000001', await: false, loop: false, volume: 1 } }],
      },
    ],
  } as SceneDocument
}

const i14 = (doc: SceneDocument) =>
  checkIntegrity(doc, { actionRefs: createActionRefResolver(registry) }).filter((f) => f.code === 'I14')

describe('the production resolver, not a stand-in', () => {
  it('declares the audio constraint at all', () => {
    // The field had no producer: `ActionDefinition.refs` did not even admit it, so nothing
    // outside a test could ever set one.
    const refs = registry.get('playMedia')!.refs({ mediaId: 'med_00000001' } as never)
    expect(refs[0]).toMatchObject({ kind: 'media', id: 'med_00000001', expectType: 'audio' })
  })

  it('lets an audio clip through', () => {
    expect(i14(docWithMedia('audio'))).toEqual([])
  })

  it('BLOCKS a video clip — the gray-zone ruling depends on exactly this', () => {
    // Reachable through the ordinary UI: an .mp4 import creates a `type: 'video'` media
    // record, and the picker lists every media record because `refKind` has no sub-type.
    // Before this gate it published fine and failed at play time with a diagnosis
    // (「浏览器不允许自动播放」) that had nothing to do with the cause.
    const issues = i14(docWithMedia('video'))
    expect(issues.length, 'video 必须被挡住').toBeGreaterThan(0)
    expect(issues[0]!.level, 'I14 是 error 级：发布前一条都不许有').toBe('error')
  })

  it('BLOCKS an image clip too', () => {
    expect(i14(docWithMedia('image')).length).toBeGreaterThan(0)
  })

  it('stopMedia is NOT constrained — it stops whatever is playing', () => {
    const refs = registry.get('stopMedia')!.refs({ mediaId: 'med_00000001' } as never)
    expect(refs[0]).not.toHaveProperty('expectType')
  })
})
