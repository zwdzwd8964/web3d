import type { AssetAudit, AssetStats } from '@w3/schema'
import { describe, expect, it } from 'vitest'
import { regrade } from '../../src/assets/audit.js'
import { DEFAULT_POLICY } from '../../src/assets/policy.js'

/**
 * T-261 · 重新体检，只读。
 *
 * ## 两条纪律，各由一半的测试压着
 *
 * 1. **不重读字节。** 资产的字节可能已经不在本地——用户换了台机器、清了缓存、或者这份
 *    文档是别人发来的。一个需要原文件才能跑的「重新体检」，在最需要它的时候恰好用不了。
 * 2. **不写文档。** 它是一个视图，不是一次编辑。存着的那份结论是**收检当天的事实**，
 *    是合同口径的一部分；今天的阈值变严了不能倒过来改写历史。
 *
 * 卡面把第二条写成了「提交后 `doc.assets[i].audit` 逐字节未变（快照断言）」，下面用
 * `JSON.stringify` 的前后比对来落地——比逐字段断言更难被绕过。
 */

const STATS: AssetStats = {
  tris: 120_000,
  materials: 8,
  textures: 6,
  bytes: 20 * 1024 * 1024,
  textureBytes: 40 * 1024 * 1024,
  nodes: 120,
  animations: ['Disassemble'],
  clipDurations: { Disassemble: 4 },
}

/** 一份「收检时全部通过」的存档结论。 */
function storedAudit(): AssetAudit {
  return {
    checkedAt: '2026-03-01T08:00:00.000Z',
    policyId: 'default-v1',
    findings: [
      { metric: 'bytes', value: STATS.bytes, limit: 60 * 1024 * 1024, level: 'pass', advice: '' },
      { metric: 'tris', value: STATS.tris, limit: 1_500_000, level: 'pass', advice: '' },
      { metric: 'materials', value: STATS.materials, limit: 60, level: 'pass', advice: '' },
    ],
  }
}

/** 把 `maxTriangles` 收紧到一定会让这份 stats 超标的值。 */
const strictPolicy = () => ({ ...DEFAULT_POLICY, id: 'strict', maxTriangles: 1000 })

describe('T-261 · regrade', () => {
  it('收检时的结论原样返回，重算的结论跟着新阈值变', () => {
    const stored = storedAudit()
    const result = regrade(STATS, stored, { policy: strictPolicy(), now: () => '2026-08-05T00:00:00.000Z' })

    // 卡面点名的那一对：一个不变，一个变。
    expect(result.stored, '收检时的那份是历史事实，不许被重算').toBe(stored)
    expect(result.current.verdict, '120,000 面对上限 1,000 必然超标').toBe('fail')
    expect(result.changed).toBe(true)
  })

  it('**逐字节未变**：调用前后把存档序列化一遍，两次相同', () => {
    const stored = storedAudit()
    const before = JSON.stringify(stored)
    regrade(STATS, stored, { policy: strictPolicy() })
    // 逐字段断言可以被一个「只改了 findings[2]」的实现绕过；序列化比对不能。
    expect(JSON.stringify(stored)).toBe(before)
  })

  it('阈值没变时两次结论一致，`changed` 为 false', () => {
    // 这一条防的是把 `changed` 写成恒真——那样每一份资产打开都在喊「阈值变了」。
    const result = regrade(STATS, storedAudit(), { policy: DEFAULT_POLICY })
    expect(result.current.verdict).toBe('pass')
    expect(result.changed).toBe(false)
  })

  it('两句话：一句说收检时，一句说按当前阈值重算', () => {
    const result = regrade(STATS, storedAudit(), { policy: strictPolicy() })
    expect(result.notes).toHaveLength(2)
    expect(result.notes[0]).toContain('收检时')
    // 日期要露出来：用户判断「这份结论有多旧」全靠它。
    expect(result.notes[0]).toContain('2026-03-01')
    expect(result.notes[0]).toContain('体检通过')

    expect(result.notes[1]).toContain('按当前阈值')
    expect(result.notes[1]).toContain('体检未通过')
    // **不许写成「重新体检」**——那暗示重新测量了，而它只是重判阈值。
    expect(result.notes[1]).not.toContain('重新体检')
  })

  it('收检时就超标的，第一句如实说超标', () => {
    const stored = storedAudit()
    const failed: AssetAudit = {
      ...stored,
      findings: stored.findings.map((f) => (f.metric === 'tris' ? { ...f, level: 'fail' as const } : f)),
    }
    const result = regrade(STATS, failed, { policy: DEFAULT_POLICY })
    expect(result.notes[0]).toContain('体检未通过')
    // 收检时 fail、今天 pass —— 阈值放宽了，也算「变了」。
    expect(result.current.verdict).toBe('pass')
    expect(result.changed).toBe(true)
  })

  it('老资产缺失的维度按 0 处理，而不是按上限', () => {
    // v0.5 之后新增的指标在老 stats 里没有。补上限会让它显示「刚好卡线通过」，
    // 那比「0」更容易被当成真的测过了。
    const old = { ...STATS, textureBytes: 0 }
    const result = regrade(old, storedAudit(), { policy: DEFAULT_POLICY })
    const texture = result.current.audit.findings.find((f) => f.metric === 'textureBytes')
    expect(texture?.value).toBe(0)
    expect(texture?.level).toBe('pass')
  })

  it('policyId 出现在两句话里 —— 「哪套阈值」和「什么结论」一样重要', () => {
    const result = regrade(STATS, storedAudit(), { policy: strictPolicy() })
    expect(result.notes[0]).toContain('default-v1')
    expect(result.notes[1]).toContain('strict')
  })
})
