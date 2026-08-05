import { describe, expect, it } from 'vitest'
import type { SceneDocument } from '../src/document.js'
import type { ActionRefResolver } from '../src/index-builder.js'
import { checkIntegrity, errorsOf, formatIntegrityIssues, hasErrors, warningsOf } from '../src/integrity.js'
import { applyMigrationChain } from '../src/migrate.js'
import { createGoldenPathDocument } from '../src/samples.js'
import { validate } from '../src/validate.js'
import goldenPathTwo from './fixtures/v2/golden-path-2.json' with { type: 'json' }

/**
 * T-016 · SCHEMA_SPEC §9. Every check I1–I10 gets a positive case (clean document has
 * no such issue) and a negative case (the specific breakage is caught).
 */

/**
 * Stands in for core's action registry (ECA_SPEC §4.1 `refs`). @w3/schema cannot know
 * what an action's params mean, so the resolver is injected.
 */
const actionRefs: ActionRefResolver = (action) => {
  const p = action.params as Record<string, unknown>
  const out: { kind: string; id: string }[] = []
  const take = (key: string, kind: string) => {
    if (typeof p[key] === 'string') out.push({ kind, id: p[key] as string })
  }
  take('animationId', 'animation')
  take('nodeId', 'node')
  take('materialId', 'material')
  take('hotspotId', 'hotspot')
  take('viewpointId', 'viewpoint')
  take('variableId', 'variable')
  return out
}

function mutated(mutate: (doc: any) => void): SceneDocument {
  const doc = structuredClone(createGoldenPathDocument()) as any
  mutate(doc)
  return doc as SceneDocument
}

const check = (doc: SceneDocument) => checkIntegrity(doc, { actionRefs })
const codes = (doc: SceneDocument) => check(doc).map((i) => i.code)
const has = (doc: SceneDocument, code: string) => codes(doc).includes(code)

describe('checkIntegrity() — clean document', () => {
  it('reports no errors and no warnings on the golden path', () => {
    const issues = check(createGoldenPathDocument())
    expect(errorsOf(issues)).toHaveLength(0)
    expect(warningsOf(issues)).toHaveLength(0)
    expect(hasErrors(issues)).toBe(false)
  })

  it('says so explicitly when no action resolver was supplied, instead of implying a clean check', () => {
    const issues = checkIntegrity(createGoldenPathDocument())
    expect(issues.map((i) => i.code)).toContain('I3-actions-unchecked')
    expect(hasErrors(issues)).toBe(false)
  })
})

describe('I1 · ids unique within each collection', () => {
  it('positive: the clean document has no duplicates', () => {
    expect(has(createGoldenPathDocument(), 'I1')).toBe(false)
  })

  it('negative: a duplicated node id is an error naming the first occurrence', () => {
    const doc = mutated((d) => (d.nodes[1].id = d.nodes[0].id))
    const issue = check(doc).find((i) => i.code === 'I1')
    expect(issue?.level).toBe('error')
    expect(issue?.message).toMatch(/首次出现在 nodes\[0\]/)
  })

  it('negative: duplicated flow step ids are caught too', () => {
    const doc = mutated((d) => {
      d.flows = [
        {
          id: 'flw_a1b2c3d4',
          name: '流程',
          variableId: 'step',
          steps: [
            { id: 'st_a1b2c3d4', name: '一', next: null, onEnter: [] },
            { id: 'st_a1b2c3d4', name: '二', next: null, onEnter: [] },
          ],
        },
      ]
    })
    expect(has(doc, 'I1')).toBe(true)
  })
})

describe('I2 · parent resolves and the chain is acyclic', () => {
  it('positive: the clean hierarchy passes', () => {
    expect(has(createGoldenPathDocument(), 'I2')).toBe(false)
  })

  it('negative: a parent pointing at a missing node', () => {
    const doc = mutated((d) => (d.nodes[1].parent = 'nd_99999999'))
    expect(check(doc).some((i) => i.code === 'I2' && i.level === 'error')).toBe(true)
  })

  it('negative: a self-parent', () => {
    const doc = mutated((d) => (d.nodes[1].parent = d.nodes[1].id))
    expect(check(doc).some((i) => i.code === 'I2' && /自己的父级/.test(i.message))).toBe(true)
  })

  it('negative: a long cycle is reported once, not once per member', () => {
    // 泵组 -> 阀盖 -> 泵组
    const doc = mutated((d) => (d.nodes[0].parent = d.nodes[2].id))
    const cycles = check(doc).filter((i) => i.code === 'I2' && /成环/.test(i.message))
    expect(cycles).toHaveLength(1)
  })
})

describe('I3 · every reference resolves', () => {
  it('positive: the clean document resolves everything', () => {
    expect(has(createGoldenPathDocument(), 'I3')).toBe(false)
  })

  it('negative: a material override pointing at a deleted material', () => {
    const doc = mutated((d) => (d.materials = []))
    expect(check(doc).some((i) => i.code === 'I3' && i.refKind === 'material')).toBe(true)
  })

  it('negative: a hotspot anchored to a deleted node', () => {
    const doc = mutated((d) => (d.hotspots[0].anchor.nodeId = 'nd_99999999'))
    expect(check(doc).some((i) => i.path === 'hotspots[0].anchor.nodeId')).toBe(true)
  })

  it('negative: a rule trigger pointing at a deleted node', () => {
    const doc = mutated((d) => (d.rules[0].when.target.nodeId = 'nd_99999999'))
    expect(check(doc).some((i) => i.path === 'rules[0].when.target.nodeId')).toBe(true)
  })

  it('negative: a dangling id inside an action’s params, found through the injected resolver', () => {
    const doc = mutated((d) => (d.rules[0].then[2].params.hotspotId = 'hs_99999999'))
    const issue = check(doc).find((i) => i.path === 'rules[0].then[2].params')
    expect(issue?.level).toBe('error')
    expect(issue?.refKind).toBe('hotspot')
  })

  // 贴图槽位的资产类型检查在 v2 移到了 I13（更严：只收 texture），见下方 I13 一节。

  it('negative: a flow step pointing at a step that does not exist', () => {
    const doc = mutated((d) => {
      d.flows = [
        {
          id: 'flw_a1b2c3d4',
          name: '流程',
          variableId: 'step',
          steps: [{ id: 'st_a1b2c3d4', name: '一', next: 'st_99999999', onEnter: [] }],
        },
      ]
    })
    expect(check(doc).some((i) => i.refKind === 'step')).toBe(true)
  })
})

describe('I4 · rule variables exist and comparisons are type-compatible', () => {
  it('positive: `step == 1` against a number variable is fine', () => {
    expect(has(createGoldenPathDocument(), 'I4')).toBe(false)
  })

  it('negative: a condition reading an undeclared variable', () => {
    const doc = mutated((d) => (d.rules[0].if[0].left = { var: 'undeclared' }))
    expect(check(doc).some((i) => i.code === 'I4' && i.refKind === 'variable')).toBe(true)
  })

  it('negative: comparing a number variable against a string literal', () => {
    const doc = mutated((d) => (d.rules[0].if[0].right = { const: '1' }))
    const issue = check(doc).find((i) => i.code === 'I4')
    expect(issue?.level).toBe('error')
    expect(issue?.message).toMatch(/不做隐式转换/)
  })

  it('negative: detects the mismatch with the operands the other way round', () => {
    const doc = mutated((d) => {
      d.rules[0].if[0] = { op: 'eq', left: { const: '1' }, right: { var: 'step' } }
    })
    expect(has(doc, 'I4')).toBe(true)
  })

  it('negative: an `in` list carrying the wrong element type', () => {
    const doc = mutated((d) => {
      d.rules[0].if = [{ op: 'in', left: { var: 'step' }, right: [1, 'two', 3] }]
    })
    expect(check(doc).some((i) => i.code === 'I4' && /1 项类型不符/.test(i.message))).toBe(true)
  })

  it('negative: a variableChange trigger on an undeclared variable', () => {
    const doc = mutated((d) => (d.rules[0].when = { event: 'variableChange', variableId: 'ghost' }))
    expect(check(doc).some((i) => i.code === 'I4' && i.path === 'rules[0].when.variableId')).toBe(true)
  })
})

describe('I5 · enum variables', () => {
  it('positive: a well-formed enum variable', () => {
    const doc = mutated((d) => {
      d.variables.push({ id: 'mode', name: '模式', type: 'enum', default: 'a', options: ['a', 'b'], persist: false })
    })
    expect(has(doc, 'I5')).toBe(false)
  })

  it('negative: an enum variable with no options', () => {
    const doc = mutated((d) => {
      d.variables.push({ id: 'mode', name: '模式', type: 'enum', default: 'a', persist: false })
    })
    expect(has(doc, 'I5')).toBe(true)
  })

  it('negative: a default outside the options list', () => {
    const doc = mutated((d) => {
      d.variables.push({ id: 'mode', name: '模式', type: 'enum', default: 'z', options: ['a', 'b'], persist: false })
    })
    expect(check(doc).some((i) => i.code === 'I5' && /不在 options 中/.test(i.message))).toBe(true)
  })

  it('negative: a non-enum variable whose default type does not match', () => {
    const doc = mutated((d) => (d.variables[0].default = 'one'))
    expect(has(doc, 'I5')).toBe(true)
  })
})

describe('I6 · animations', () => {
  it('positive: the tween in the clean document is fine', () => {
    expect(has(createGoldenPathDocument(), 'I6')).toBe(false)
  })

  it('negative: a tween whose target node was deleted', () => {
    const doc = mutated((d) => (d.animations[0].targets[0].nodeId = 'nd_99999999'))
    expect(check(doc).some((i) => i.code === 'I6' && i.path === 'animations[0].targets[0].nodeId')).toBe(true)
  })

  it('negative: an imported animation naming a clip the asset does not contain', () => {
    const doc = mutated((d) => {
      d.animations.push({
        kind: 'imported',
        id: 'anm_11111111',
        name: '拆解',
        assetId: d.assets[0].id,
        clipName: 'NoSuchClip',
        speed: 1,
        loop: false,
        clampWhenFinished: true,
      })
    })
    expect(check(doc).some((i) => i.code === 'I6' && /不存在名为/.test(i.message))).toBe(true)
  })

  it('positive: an imported animation naming a clip the asset does contain', () => {
    const doc = mutated((d) => {
      d.animations.push({
        kind: 'imported',
        id: 'anm_11111111',
        name: '拆解',
        assetId: d.assets[0].id,
        clipName: 'Disassemble',
        speed: 1,
        loop: false,
        clampWhenFinished: true,
      })
    })
    expect(has(doc, 'I6')).toBe(false)
  })
})

describe('I7 · orphaned asset references are a warning, never a deletion', () => {
  it('positive: nothing orphaned in the clean document', () => {
    expect(has(createGoldenPathDocument(), 'I7')).toBe(false)
  })

  it('negative: a missing assetRef warns, keeps the node, and does not block publishing', () => {
    const doc = mutated((d) => (d.nodes[1].assetRef.missing = true))
    const issues = check(doc)
    const orphan = issues.find((i) => i.code === 'I7')
    expect(orphan?.level).toBe('warn')
    expect(orphan?.message).toContain('配置已保留')
    expect(hasErrors(issues)).toBe(false)
    expect(doc.nodes).toHaveLength(3)
  })
})

describe('I8 · an enabled rule pointing at an orphaned node', () => {
  it('positive: no warning while nothing is orphaned', () => {
    expect(has(createGoldenPathDocument(), 'I8')).toBe(false)
  })

  it('negative: warns once the referenced node is marked missing', () => {
    const doc = mutated((d) => (d.nodes[2].assetRef.missing = true))
    const issue = check(doc).find((i) => i.code === 'I8')
    expect(issue?.level).toBe('warn')
    expect(issue?.refId).toBe(doc.nodes[2]!.id)
  })

  it('does not warn for a disabled rule', () => {
    const doc = mutated((d) => {
      d.nodes[2].assetRef.missing = true
      d.rules[0].enabled = false
    })
    expect(has(doc, 'I8')).toBe(false)
  })
})

describe('I9 · animations nothing ever triggers', () => {
  it('positive: the golden path animation is referenced by its rule', () => {
    expect(has(createGoldenPathDocument(), 'I9')).toBe(false)
  })

  it('negative: an unreferenced animation is reported as info, not as a failure', () => {
    const doc = mutated((d) => {
      d.animations.push({
        kind: 'tween',
        id: 'anm_11111111',
        name: '孤立动画',
        duration: 1,
        easing: 'linear',
        loop: false,
        yoyo: false,
        targets: [{ nodeId: d.nodes[1].id, to: { p: [0, 1, 0] } }],
      })
    })
    const issue = check(doc).find((i) => i.code === 'I9')
    expect(issue?.level).toBe('info')
    expect(hasErrors(check(doc))).toBe(false)
  })
})

describe('I10 · unreachable nodes', () => {
  it('positive: every node in the clean document reaches a root', () => {
    expect(has(createGoldenPathDocument(), 'I10')).toBe(false)
  })

  it('negative: nodes stranded behind a cycle never render, and that is an error', () => {
    const doc = mutated((d) => (d.nodes[0].parent = d.nodes[2].id))
    const issue = check(doc).find((i) => i.code === 'I10')
    expect(issue?.level).toBe('error')
  })
})

/* ========================================================================== */
/* v2 增量 · I11 – I15（v0.5 进化规划 §4.2）                                    */
/* ========================================================================== */

/**
 * The v2 fixture, **migrated to v3**, as a mutable plain object.
 *
 * It is the only document with lights, primitives, an environment, textures and media all
 * present at once — which is why the I11–I15 cases are built on it rather than on the
 * golden path.
 *
 * ⚠ **The migration is not optional and T-225 is where that became true.** Before v3 this
 * cast a raw v2 document to `SceneDocument` and it happened to work, because every v2 key
 * was also a v3 key. v3 adds two collections, and `checkIntegrity` walks `ID_COLLECTIONS`
 * — so the raw fixture makes it read `doc.dataSources.map` on `undefined`. Casting a v2
 * document to `SceneDocument` was always a lie; v3 is just the version where the lie
 * stopped being free. The card's own acceptance says every fixture goes
 * `migrate → validate → checkIntegrity`, and this is that.
 */
function v2Doc(mutate: (doc: any) => void = () => undefined): SceneDocument {
  const migrated = applyMigrationChain(structuredClone(goldenPathTwo) as Record<string, unknown>)
  if (!migrated.ok) throw new Error(`v2 fixture failed to migrate: ${JSON.stringify(migrated.error)}`)
  const doc = migrated.value.raw as any
  mutate(doc)
  return doc as SceneDocument
}

const checkV2 = (doc: SceneDocument) => checkIntegrity(doc, { actionRefs })

describe('the v2 fixture is clean to begin with', () => {
  it('reports no errors and no warnings, so every negative case below means something', () => {
    // Without this, an I11–I15 negative case could be "green" because the fixture was
    // already dirty in some other way and the assertion happened to match.
    const issues = checkV2(v2Doc())
    expect(errorsOf(issues), formatIntegrityIssues(issues)).toHaveLength(0)
    expect(warningsOf(issues), formatIntegrityIssues(issues)).toHaveLength(0)
  })
})

describe('I11 · at most one carrier per node', () => {
  it('positive: the v2 fixture has an assetRef node, a primitive node and a light node, each with one', () => {
    const doc = v2Doc()
    expect(doc.nodes.some((n) => n.assetRef !== null)).toBe(true)
    expect(doc.nodes.some((n) => n.primitive !== null)).toBe(true)
    expect(doc.nodes.some((n) => n.light !== null)).toBe(true)
    expect(checkV2(doc).some((i) => i.code === 'I11')).toBe(false)
  })

  it('negative: a node that is both a primitive and a light', () => {
    const doc = v2Doc((d) => {
      d.nodes[0].light = { kind: 'ambient', color: '#ffffff', intensity: 0.6 }
    })
    const issue = checkV2(doc).find((i) => i.code === 'I11')
    expect(issue?.level).toBe('error')
    expect(issue?.path).toBe('nodes[0]')
    expect(issue?.message).toContain('primitive')
    expect(issue?.message).toContain('light')
  })

  it('negative: a node that is both an asset instance and a light', () => {
    const doc = v2Doc((d) => {
      d.nodes[1].light = { kind: 'ambient', color: '#ffffff', intensity: 0.6 }
    })
    expect(checkV2(doc).find((i) => i.code === 'I11')?.refId).toBe(v2Doc().nodes[1]!.id)
  })

  it('positive: three nulls is a grouping node, not a violation', () => {
    const doc = v2Doc((d) => {
      d.nodes[0].primitive = null
    })
    expect(checkV2(doc).some((i) => i.code === 'I11')).toBe(false)
  })
})

describe('I12 · environment reference and the background that depends on it', () => {
  it('positive: the fixture points at a real hdri asset', () => {
    expect(checkV2(v2Doc()).some((i) => i.code === 'I12')).toBe(false)
  })

  it('negative: hdriAssetId points at nothing', () => {
    const doc = v2Doc((d) => (d.meta.environment.hdriAssetId = 'ast_99999999'))
    const issue = checkV2(doc).find((i) => i.code === 'I12')
    expect(issue?.level).toBe('error')
    expect(issue?.path).toBe('meta.environment.hdriAssetId')
  })

  it('negative: hdriAssetId points at an asset that is not an hdri', () => {
    const doc = v2Doc((d) => {
      d.meta.environment.hdriAssetId = d.assets.find((a: any) => a.type === 'texture').id
    })
    const issue = checkV2(doc).find((i) => i.code === 'I12')
    expect(issue?.level).toBe('error')
    expect(issue?.message).toContain('type=texture')
  })

  it('negative: background is hdri while the environment is empty — publishes, then renders black', () => {
    const doc = v2Doc((d) => (d.meta.environment.hdriAssetId = null))
    const issue = checkV2(doc).find((i) => i.code === 'I12')
    expect(issue?.level).toBe('error')
    expect(issue?.path).toBe('meta.background.type')
  })

  it('positive: clearing both together is a legitimate scene', () => {
    const doc = v2Doc((d) => {
      d.meta.environment.hdriAssetId = null
      d.meta.background.type = 'color'
    })
    expect(checkV2(doc).some((i) => i.code === 'I12')).toBe(false)
  })
})

describe('I13 · texture slots point at texture assets', () => {
  it('positive: the fixture maps a real texture asset', () => {
    expect(v2Doc().materials[0]!.params.maps.map).toBeDefined()
    expect(checkV2(v2Doc()).some((i) => i.code === 'I13')).toBe(false)
  })

  it('negative: a slot pointing at the model asset', () => {
    const doc = v2Doc((d) => {
      d.materials[0].params.maps.normalMap = d.assets.find((a: any) => a.type === 'model').id
    })
    const issue = checkV2(doc).find((i) => i.code === 'I13')
    expect(issue?.level).toBe('error')
    expect(issue?.path).toBe('materials[0].params.maps.normalMap')
    expect(issue?.message).toContain('type=model')
  })

  it('negative: an `image` asset is NOT a texture — v0.5 splits the two on purpose', () => {
    // The check this replaced accepted `image` here. A media image and a material texture
    // go through different import paths and get different colour-space handling.
    const doc = v2Doc((d) => {
      d.materials[0].params.maps.map = d.assets.find((a: any) => a.type === 'image').id
    })
    expect(checkV2(doc).find((i) => i.code === 'I13')?.level).toBe('error')
  })

  it('a dangling slot is I3’s error, not a second one from I13', () => {
    const doc = v2Doc((d) => (d.materials[0].params.maps.map = 'ast_99999999'))
    const codes = checkV2(doc).map((i) => i.code)
    expect(codes).toContain('I3')
    expect(codes).not.toContain('I13')
  })
})

describe('I14 · media types line up', () => {
  it('positive: the fixture’s image and audio records match their assets', () => {
    expect(checkV2(v2Doc()).some((i) => i.code === 'I14')).toBe(false)
  })

  it('negative: an audio media record pointing at an image asset', () => {
    const doc = v2Doc((d) => {
      const audio = d.media.find((m: any) => m.type === 'audio')
      audio.assetId = d.assets.find((a: any) => a.type === 'image').id
    })
    const issue = checkV2(doc).find((i) => i.code === 'I14')
    expect(issue?.level).toBe('error')
    expect(issue?.message).toContain('type=image')
  })

  it('negative: a hotspot panel showing an audio media record', () => {
    const doc = v2Doc((d) => {
      d.hotspots[0].content.mediaId = d.media.find((m: any) => m.type === 'audio').id
    })
    const issue = checkV2(doc).find((i) => i.code === 'I14')
    expect(issue?.level).toBe('error')
    expect(issue?.path).toBe('hotspots[0].content.mediaId')
  })

  it('positive: a video media record in a hotspot panel is fine', () => {
    const doc = v2Doc((d) => {
      d.media[0].type = 'video'
      d.assets.find((a: any) => a.type === 'image').type = 'video'
    })
    expect(checkV2(doc).some((i) => i.code === 'I14')).toBe(false)
  })

  it('negative: playMedia pointing at a non-audio media, reported through the resolver’s constraint', () => {
    // The resolver — core's registry in production — is what knows that `playMedia` needs
    // audio. @w3/schema only enforces the constraint it is handed, which is why the action
    // name appears nowhere in integrity.ts.
    const playMediaAware: ActionRefResolver = (action) => {
      if (action.action !== 'playMedia') return actionRefs(action)
      const id = (action.params as Record<string, unknown>).mediaId
      return typeof id === 'string' ? [{ kind: 'media', id, expectType: 'audio' }] : []
    }
    const doc = v2Doc((d) => {
      d.rules[0].then[0].params.mediaId = d.media.find((m: any) => m.type === 'image').id
    })
    const issue = checkIntegrity(doc, { actionRefs: playMediaAware }).find((i) => i.code === 'I14')
    expect(issue?.level).toBe('error')
    expect(issue?.message).toContain('playMedia')
    expect(issue?.message).toContain('audio')
    // …and the unmodified fixture, whose playMedia does point at audio, stays clean.
    expect(checkIntegrity(v2Doc(), { actionRefs: playMediaAware }).some((i) => i.code === 'I14')).toBe(false)
  })

  it('a constraint on an id that does not resolve stays quiet — I3 already said it', () => {
    const strict: ActionRefResolver = () => [{ kind: 'media', id: 'med_99999999', expectType: 'audio' }]
    const codes = checkIntegrity(v2Doc(), { actionRefs: strict }).map((i) => i.code)
    expect(codes).toContain('I3')
    expect(codes).not.toContain('I14')
  })
})

describe('I15 · physical-only parameters on a non-physical material', () => {
  it('positive: the fixture’s standard material declares none of them', () => {
    expect(checkV2(v2Doc()).some((i) => i.code === 'I15')).toBe(false)
  })

  it('negative: transmission and ior on a standard material are warned about, not blocked', () => {
    const doc = v2Doc((d) => {
      d.materials[0].params.transmission = 0.9
      d.materials[0].params.ior = 1.5
    })
    const issues = checkV2(doc)
    const issue = issues.find((i) => i.code === 'I15')
    expect(issue?.level).toBe('warn')
    expect(issue?.message).toContain('transmission')
    expect(issue?.message).toContain('ior')
    // The document still renders, so it must still publish (D8 blocks on errors only).
    expect(hasErrors(issues)).toBe(false)
  })

  it('positive: the same parameters on a physical material are exactly right', () => {
    const doc = v2Doc((d) => {
      d.materials[0].base = 'physical'
      d.materials[0].params.transmission = 0.9
    })
    expect(checkV2(doc).some((i) => i.code === 'I15')).toBe(false)
  })

  it('reports one issue per material, listing every stray parameter', () => {
    const doc = v2Doc((d) => {
      d.materials[0].params.clearcoat = 1
      d.materials[0].params.clearcoatRoughness = 0.2
      d.materials[0].params.thickness = 0.5
    })
    const issues = checkV2(doc).filter((i) => i.code === 'I15')
    expect(issues).toHaveLength(1)
    // Listed in the schema's own order, not the order the user happened to set them —
    // so the message reads the same for the same set of strays.
    expect(issues[0]!.message).toContain('thickness、clearcoat、clearcoatRoughness')
  })
})

describe('report formatting', () => {
  it('renders errors, warnings and info in that order with their check ids', () => {
    const doc = mutated((d) => {
      d.hotspots[0].anchor.nodeId = 'nd_99999999'
      d.nodes[1].assetRef.missing = true
    })
    const text = formatIntegrityIssues(check(doc))
    expect(text).toContain('阻断')
    expect(text).toContain('提示')
    expect(text).toContain('[I3]')
    expect(text.indexOf('阻断')).toBeLessThan(text.indexOf('提示'))
  })

  it('says so plainly when there is nothing to report', () => {
    expect(formatIntegrityIssues([])).toContain('通过')
  })
})

/* ========================================================================== */
/* T-226 · I16 – I45 的其余各条（I21–I28 在 integrity-explode-section.test.ts） */
/* ========================================================================== */

const levelOf = (doc: SceneDocument, code: string) => check(doc).filter((i) => i.code === code).map((x) => x.level)
const msgOf = (doc: SceneDocument, code: string) => check(doc).filter((i) => i.code === code).map((x) => x.message).join(' | ')

/** 造一条规则。golden path 的规则形状照抄，只换动作。 */
function withActions(then: { action: string; params: Record<string, unknown> }[], name = '测试规则') {
  return mutated((d) => {
    d.rules.push({
      id: 'rl_probe001',
      name,
      enabled: true,
      when: { event: 'sceneReady' },
      if: [],
      ifAny: [],
      then,
      mode: 'sequence',
      onError: 'abort',
      reentry: 'restart',
    })
  })
}

describe('I16 · 线性雾的 near / far', () => {
  it('正例：默认文档（雾关着）不报', () => {
    expect(codes(createGoldenPathDocument())).not.toContain('I16')
  })

  it('反例：开着雾且 near >= far → error', () => {
    const doc = mutated((d) => {
      d.meta.fog = { ...d.meta.fog, enabled: true, type: 'linear', near: 100, far: 10 }
    })
    expect(levelOf(doc, 'I16')).toEqual(['error'])
    // 措辞要带上两个数，否则用户还得自己去翻文档
    expect(msgOf(doc, 'I16')).toContain('100')
    expect(msgOf(doc, 'I16')).toContain('10')
  })

  it('三个子句各自都是必要条件 —— 少任何一个都不该报', () => {
    // v0.5 E18 的教训：三个条件写成一个 && 之后，删掉其中一个子句测试照样绿
    const near100far10 = { near: 100, far: 10 }
    expect(codes(mutated((d) => (d.meta.fog = { ...d.meta.fog, enabled: false, type: 'linear', ...near100far10 })))).not.toContain('I16')
    expect(codes(mutated((d) => (d.meta.fog = { ...d.meta.fog, enabled: true, type: 'exp2', ...near100far10 })))).not.toContain('I16')
    expect(codes(mutated((d) => (d.meta.fog = { ...d.meta.fog, enabled: true, type: 'linear', near: 10, far: 100 })))).not.toContain('I16')
  })

  it('near === far 也报 —— 边界是闭的', () => {
    expect(levelOf(mutated((d) => (d.meta.fog = { ...d.meta.fog, enabled: true, type: 'linear', near: 50, far: 50 })), 'I16')).toEqual(['error'])
  })
})

describe('I17 · 雾色与背景色不一致', () => {
  it('正例：雾色等于背景色时不报', () => {
    const doc = mutated((d) => {
      d.meta.fog = { ...d.meta.fog, enabled: true, color: d.meta.background.color }
    })
    expect(codes(doc)).not.toContain('I17')
  })

  it('反例：不同 → info', () => {
    const doc = mutated((d) => {
      d.meta.background = { type: 'color', color: '#000000' }
      d.meta.fog = { ...d.meta.fog, enabled: true, color: '#ffffff' }
    })
    expect(levelOf(doc, 'I17')).toEqual(['info'])
  })

  it('大小写不同不算不一致', () => {
    const doc = mutated((d) => {
      d.meta.background = { type: 'color', color: '#AABBCC' }
      d.meta.fog = { ...d.meta.fog, enabled: true, color: '#aabbcc' }
    })
    expect(codes(doc)).not.toContain('I17')
  })
})

describe('I18 / I19 / I20 · 描边开关与 highlight 预设', () => {
  const highlight = (preset: string) => ({ action: 'highlight', params: { nodeId: createGoldenPathDocument().nodes[1]!.id, preset } })

  /**
   * **黄金路径自带一个 `outline_amber` 的 highlight 动作。**
   *
   * 三条检查数的都是全文档，所以基线不是 0 而是 1。写这几条测试时我先按 0 写，三条
   * 当场红——记在这里而不是把基线偷偷加进期望值里：一个「零基线」的假设错了，
   * 后面每一条边界断言（`>= 3`、`=== 0`）都会跟着错一位。
   */
  const withoutBaseHighlight = (extra: (d: any) => void = () => {}) =>
    mutated((d) => {
      for (const rule of d.rules) rule.then = rule.then.filter((a: any) => a.action !== 'highlight')
      extra(d)
    })

  it('前提：黄金路径确实自带一个 outline_amber', () => {
    const presets = createGoldenPathDocument().rules.flatMap((r) => r.then).filter((a) => a.action === 'highlight')
    expect(presets).toHaveLength(1)
    expect((presets[0]!.params as Record<string, unknown>).preset).toBe('outline_amber')
  })

  it('I18 反例：描边关着但用了 outline_ 预设 → info', () => {
    const doc = withActions([highlight('outline_warn')])
    expect(levelOf(doc, 'I18')).toEqual(['info'])
    expect(msgOf(doc, 'I18')).toContain('outline_warn')
  })

  it('I18 正例：描边开着时不报', () => {
    const doc = mutated((d) => {
      d.meta.effects.outline.enabled = true
      d.rules.push({
        id: 'rl_probe001', name: 'x', enabled: true, when: { event: 'sceneReady' }, if: [], ifAny: [],
        then: [highlight('outline_warn')], mode: 'sequence', onError: 'abort', reentry: 'restart',
      })
    })
    expect(codes(doc)).not.toContain('I18')
  })

  it('I18 不看非描边预设 —— emissive 预设不触发它', () => {
    const doc = withoutBaseHighlight((d) => {
      d.rules.push({
        id: 'rl_probe001', name: 'x', enabled: true, when: { event: 'sceneReady' }, if: [], ifAny: [],
        then: [highlight('emissive_soft')], mode: 'sequence', onError: 'abort', reentry: 'restart',
      })
    })
    expect(codes(doc)).not.toContain('I18')
  })

  it('I19 反例：三种预设 → info', () => {
    const doc = withActions([highlight('outline_a'), highlight('outline_b'), highlight('emissive_c')])
    expect(levelOf(doc, 'I19')).toEqual(['info'])
  })

  it('I19 正例：两种不报 —— 边界是 >= 3', () => {
    // 基线那个 outline_amber 已经去掉了，所以这里恰好是 2 种
    const doc = withoutBaseHighlight((d) => {
      d.rules.push({
        id: 'rl_probe001', name: 'x', enabled: true, when: { event: 'sceneReady' }, if: [], ifAny: [],
        then: [highlight('outline_a'), highlight('outline_b')], mode: 'sequence', onError: 'abort', reentry: 'restart',
      })
    })
    expect(codes(doc)).not.toContain('I19')
  })

  it('I20 反例：描边开着但没有任何 highlight → info', () => {
    const doc = withoutBaseHighlight((d) => (d.meta.effects.outline.enabled = true))
    expect(levelOf(doc, 'I20')).toEqual(['info'])
  })

  it('I20 正例：有 highlight 时不报', () => {
    const doc = mutated((d) => {
      d.meta.effects.outline.enabled = true
      d.rules.push({
        id: 'rl_probe001', name: 'x', enabled: true, when: { event: 'sceneReady' }, if: [], ifAny: [],
        then: [highlight('outline_a')], mode: 'sequence', onError: 'abort', reentry: 'restart',
      })
    })
    expect(codes(doc)).not.toContain('I20')
  })
})

describe('I29 · 热点编号重复', () => {
  it('正例：编号不同不报', () => {
    const doc = mutated((d) => {
      d.hotspots[0].style.label = '1'
      d.hotspots.push({ ...structuredClone(d.hotspots[0]), id: 'hs_second001', style: { ...d.hotspots[0].style, label: '2' } })
    })
    expect(codes(doc)).not.toContain('I29')
  })

  it('反例：两个热点同一个编号 → warn，且指出先来的是谁', () => {
    const doc = mutated((d) => {
      d.hotspots[0].style.label = '7'
      d.hotspots.push({ ...structuredClone(d.hotspots[0]), id: 'hs_second001' })
    })
    expect(levelOf(doc, 'I29')).toEqual(['warn'])
    expect(msgOf(doc, 'I29')).toContain('hotspots[0]')
  })

  it('没有编号的热点不参与去重 —— 两个 undefined 不算撞', () => {
    const doc = mutated((d) => {
      d.hotspots.push({ ...structuredClone(d.hotspots[0]), id: 'hs_second001' })
    })
    expect(codes(doc)).not.toContain('I29')
  })
})

describe('I30 · 视点缩略图', () => {
  it('正例：没有缩略图时不报', () => {
    expect(codes(createGoldenPathDocument())).not.toContain('I30')
  })

  it('反例：指向不存在的资产 → error', () => {
    expect(levelOf(mutated((d) => (d.viewpoints[0].thumbnailAssetId = 'ast_nothere1')), 'I30')).toEqual(['error'])
  })

  it('反例：指向的资产不是 image → error', () => {
    const doc = mutated((d) => (d.viewpoints[0].thumbnailAssetId = d.assets[0].id))
    expect(levelOf(doc, 'I30')).toEqual(['error'])
    expect(msgOf(doc, 'I30')).toContain('model')
  })
})

describe('I31 / I32 / I33 · 资产溯源与动画区间', () => {
  const origin = (over: Record<string, unknown> = {}) => ({
    hash: createGoldenPathDocument().assets[0]!.hash,
    bytes: 1024,
    ...over,
  })

  it('I31 正例：hash 一致、没有 transcode 记录时不报', () => {
    expect(codes(mutated((d) => (d.assets[0].origin = origin())))).not.toContain('I31')
  })

  it('I31 反例：origin.hash 与资产 hash 不同 → error', () => {
    const doc = mutated((d) => (d.assets[0].origin = origin({ hash: 'sha256:' + '9'.repeat(64) })))
    expect(levelOf(doc, 'I31')).toEqual(['error'])
  })

  it('I31 反例：转码记录既没执行也没跳过 → error', () => {
    const doc = mutated((d) => {
      d.assets[0].origin = origin({
        transcode: { profileId: 'p1', toolchain: 'x', finishedAt: '2026-01-01T00:00:00.000Z', ops: [], skipped: [], triangleRatio: 1 },
      })
    })
    expect(levelOf(doc, 'I31')).toEqual(['error'])
  })

  it('I31 正例：跳过非空也算说明了事', () => {
    const doc = mutated((d) => {
      d.assets[0].origin = origin({
        transcode: {
          profileId: 'p1', toolchain: 'x', finishedAt: '2026-01-01T00:00:00.000Z',
          ops: [], skipped: [{ op: 'ktx2', detail: '无贴图' }], triangleRatio: 1,
        },
      })
    })
    expect(codes(doc)).not.toContain('I31')
  })

  it('I32 正例：clipDurations 的键都在 animations 里', () => {
    const doc = mutated((d) => {
      d.assets[0].stats.animations = ['Disassemble']
      d.assets[0].stats.clipDurations = { Disassemble: 2.4 }
    })
    expect(codes(doc)).not.toContain('I32')
  })

  it('I32 反例：多出来的键 → warn', () => {
    const doc = mutated((d) => {
      d.assets[0].stats.animations = ['Disassemble']
      d.assets[0].stats.clipDurations = { Disassemble: 2.4, Ghost: 1 }
    })
    expect(levelOf(doc, 'I32')).toEqual(['warn'])
    expect(msgOf(doc, 'I32')).toContain('Ghost')
  })

  const imported = (over: Record<string, unknown> = {}) => ({
    kind: 'imported', id: 'anm_probe001', name: '探针', assetId: createGoldenPathDocument().assets[0]!.id,
    clipName: 'Disassemble', speed: 1, loop: false, clampWhenFinished: true, startS: 0, endS: null, ...over,
  })

  it('I33 正例：endS 为 null 时不报', () => {
    const doc = mutated((d) => {
      d.assets[0].stats.animations = ['Disassemble']
      d.animations.push(imported())
    })
    expect(codes(doc)).not.toContain('I33')
  })

  it('I33 反例：终点不晚于起点 → error', () => {
    const doc = mutated((d) => {
      d.assets[0].stats.animations = ['Disassemble']
      d.animations.push(imported({ startS: 2, endS: 1 }))
    })
    expect(levelOf(doc, 'I33')).toEqual(['error'])
  })

  it('I33 反例：终点超过片段实际时长 → error', () => {
    const doc = mutated((d) => {
      d.assets[0].stats.animations = ['Disassemble']
      d.assets[0].stats.clipDurations = { Disassemble: 2.4 }
      d.animations.push(imported({ startS: 0, endS: 9 }))
    })
    expect(levelOf(doc, 'I33')).toEqual(['error'])
    expect(msgOf(doc, 'I33')).toContain('2.4')
  })

  it('I33 不知道时长时不猜 —— clipDurations 为空则只查区间自洽', () => {
    const doc = mutated((d) => {
      d.assets[0].stats.animations = ['Disassemble']
      d.animations.push(imported({ startS: 0, endS: 9 }))
    })
    expect(codes(doc)).not.toContain('I33')
  })
})

describe('I35 · overlay 与 step 的 id 全文档唯一', () => {
  const page = (id: string, overlayId: string) => ({
    id, name: '页', overlays: [{ id: overlayId, type: 'text', rect: { x: 0, y: 0, w: 1, h: 1 }, anchor: 'tl',
      props: { text: '', size: 16, color: '#ffffff', align: 'left', flowId: null } }],
  })

  it('正例：两页各有各的 overlay id', () => {
    expect(codes(mutated((d) => (d.pages = [page('pg_00000001', 'ov_00000001'), page('pg_00000002', 'ov_00000002')])))).not.toContain('I35')
  })

  it('反例：两页用了同一个 overlay id → error', () => {
    const doc = mutated((d) => (d.pages = [page('pg_00000001', 'ov_00000001'), page('pg_00000002', 'ov_00000001')]))
    expect(levelOf(doc, 'I35')).toEqual(['error'])
  })

  it('反例：overlay 与 step 撞 id 也报 —— 「全文档」不是「同类之间」', () => {
    const doc = mutated((d) => {
      d.pages = [page('pg_00000001', 'ov_00000001')]
      d.flows = [{ id: 'flw_00000001', name: 'f', variableId: d.variables[0]?.id ?? 'step', startStepId: null,
        steps: [{ id: 'ov_00000001', name: '一', next: null, onEnter: [] }] }]
    })
    expect(levelOf(doc, 'I35')).toEqual(['error'])
  })
})

describe('I36 – I39 · 流程', () => {
  const flow = (over: Record<string, unknown> = {}) => ({
    id: 'flw_00000001', name: '拆装', variableId: 'step_var', startStepId: 'st_00000001',
    steps: [
      { id: 'st_00000001', name: '一', next: 'st_00000002', onEnter: [] },
      { id: 'st_00000002', name: '二', next: null, onEnter: [] },
    ],
    ...over,
  })
  const withFlow = (over: Record<string, unknown> = {}, varType = 'string') =>
    mutated((d) => {
      d.variables.push({ id: 'step_var', name: '当前步骤', type: varType, default: varType === 'string' ? '' : 0, persist: false, scope: 'scene' })
      d.flows = [flow(over)]
    })

  it('I36 正例：string 变量不报', () => {
    expect(codes(withFlow())).not.toContain('I36')
  })

  it('I36 反例：number 变量 → error', () => {
    expect(levelOf(withFlow({}, 'number'), 'I36')).toEqual(['error'])
  })

  it('I37 正例：入口步骤在本流程里', () => {
    expect(codes(withFlow())).not.toContain('I37')
  })

  it('I37 反例：入口步骤不在本流程 → error', () => {
    expect(levelOf(withFlow({ startStepId: 'st_99999999' }), 'I37')).toEqual(['error'])
  })

  it('I38 正例：链能走到终点', () => {
    expect(codes(withFlow())).not.toContain('I38')
  })

  it('I38 反例：两步互指成环 → error', () => {
    const doc = withFlow({
      steps: [
        { id: 'st_00000001', name: '一', next: 'st_00000002', onEnter: [] },
        { id: 'st_00000002', name: '二', next: 'st_00000001', onEnter: [] },
      ],
    })
    expect(levelOf(doc, 'I38')).toEqual(['error'])
  })

  it('I38 自环也算环', () => {
    const doc = withFlow({ steps: [{ id: 'st_00000001', name: '一', next: 'st_00000001', onEnter: [] }] })
    expect(levelOf(doc, 'I38')).toEqual(['error'])
  })

  it('I39 正例：每步至多一个前驱', () => {
    expect(codes(withFlow())).not.toContain('I39')
  })

  it('I39 反例：两步都指向同一步 → error', () => {
    const doc = withFlow({
      steps: [
        { id: 'st_00000001', name: '一', next: 'st_00000003', onEnter: [] },
        { id: 'st_00000002', name: '二', next: 'st_00000003', onEnter: [] },
        { id: 'st_00000003', name: '三', next: null, onEnter: [] },
      ],
    })
    expect(levelOf(doc, 'I39')).toEqual(['error'])
    expect(msgOf(doc, 'I39')).toContain('上一步')
  })
})

describe('I40 / I41 · 覆盖层的引用', () => {
  const withOverlay = (overlay: Record<string, unknown>, extra?: (d: any) => void) =>
    mutated((d) => {
      extra?.(d)
      d.pages = [{ id: 'pg_00000001', name: '页', overlays: [overlay] }]
    })

  const addImage = (d: any) => {
    d.assets.push({ ...structuredClone(d.assets[0]), id: 'ast_img00001', type: 'image', name: '图.png',
      hash: 'sha256:' + '1'.repeat(64), url: 'blob:x', lineageId: 'ast_img00001' })
    d.media.push({ id: 'med_img00001', type: 'image', assetId: 'ast_img00001', name: '图' })
  }
  const addAudio = (d: any) => {
    d.media.push({ id: 'med_aud00001', type: 'audio', assetId: d.assets[0].id, name: '声' })
  }

  const imageOverlay = (mediaId: string | null) => ({
    id: 'ov_00000001', type: 'image', rect: { x: 0, y: 0, w: 1, h: 1 }, anchor: 'tl', props: { mediaId, fit: 'contain' },
  })

  it('I40 正例：image 覆盖层指向 image 媒体', () => {
    expect(codes(withOverlay(imageOverlay('med_img00001'), addImage))).not.toContain('I40')
  })

  it('I40 反例：指向不存在的媒体 → error', () => {
    expect(levelOf(withOverlay(imageOverlay('med_nothere1')), 'I40')).toEqual(['error'])
  })

  it('I40 反例：image 覆盖层指向 audio → error，且说清允许什么', () => {
    const doc = withOverlay(imageOverlay('med_aud00001'), addAudio)
    expect(levelOf(doc, 'I40')).toEqual(['error'])
    expect(msgOf(doc, 'I40')).toContain('image')
  })

  it('I40 · panel 支吃 image 也吃 video，与 I14 对热点面板逐字对齐', () => {
    const panel = (mediaId: string) => ({
      id: 'ov_00000001', type: 'panel', rect: { x: 0, y: 0, w: 1, h: 1 }, anchor: 'tl',
      props: { title: '', text: '', mediaId, flowId: null, progress: false },
    })
    expect(codes(withOverlay(panel('med_img00001'), addImage))).not.toContain('I40')
    expect(levelOf(withOverlay(panel('med_aud00001'), addAudio), 'I40')).toEqual(['error'])
  })

  it('I41 正例：flowId 指向存在的流程', () => {
    const doc = withOverlay(
      { id: 'ov_00000001', type: 'text', rect: { x: 0, y: 0, w: 1, h: 1 }, anchor: 'tl',
        props: { text: '', size: 16, color: '#ffffff', align: 'left', flowId: 'flw_00000001' } },
      (d) => {
        d.variables.push({ id: 'sv', name: 's', type: 'string', default: '', persist: false, scope: 'scene' })
        d.flows = [{ id: 'flw_00000001', name: 'f', variableId: 'sv', startStepId: null, steps: [] }]
      },
    )
    expect(codes(doc)).not.toContain('I41')
  })

  it('I41 反例：flowId 指向不存在的流程 → error', () => {
    const doc = withOverlay({
      id: 'ov_00000001', type: 'text', rect: { x: 0, y: 0, w: 1, h: 1 }, anchor: 'tl',
      props: { text: '', size: 16, color: '#ffffff', align: 'left', flowId: 'flw_nothere1' },
    })
    expect(levelOf(doc, 'I41')).toEqual(['error'])
  })
})

describe('I42 · prefab', () => {
  const prefab = (over: Record<string, unknown> = {}) => ({
    id: 'pfb_00000001', name: '标准泵组', note: '', version: 1, nodes: [], materials: [], ...over,
  })

  it('正例：空 prefab 不报', () => {
    expect(codes(mutated((d) => (d.prefabs = [prefab()])))).not.toContain('I42')
  })

  it('反例：prefabRef 指向不存在的 prefab → error', () => {
    expect(levelOf(mutated((d) => (d.nodes[1].prefabRef = { prefabId: 'pfb_nothere1', overridden: [] })), 'I42')).toEqual(['error'])
  })

  it('反例：prefab 内部 id 与文档主集合撞车 → error', () => {
    const doc = mutated((d) => {
      d.prefabs = [prefab({ nodes: [{ ...structuredClone(d.nodes[1]), parent: null }] })]
    })
    expect(levelOf(doc, 'I42')).toEqual(['error'])
    expect(msgOf(doc, 'I42')).toContain('撞车')
  })

  it('反例：prefab 内部 id 自己重复 → error', () => {
    const doc = mutated((d) => {
      const n = { ...structuredClone(d.nodes[1]), id: 'nd_inpfb0001', parent: null }
      d.prefabs = [prefab({ nodes: [n, { ...n }] })]
    })
    expect(levelOf(doc, 'I42')).toEqual(['error'])
  })
})

describe('I43 / I44 / I45 · openLink', () => {
  const link = (params: Record<string, unknown>) => withActions([{ action: 'openLink', params }])

  it('I43 正例：https 不报', () => {
    expect(codes(link({ url: 'https://example.com/manual', target: '_blank' }))).not.toContain('I43')
  })

  it('I43 正例：相对路径不报', () => {
    expect(codes(link({ url: '/docs/manual.pdf', target: '_blank' }))).not.toContain('I43')
  })

  it('I43 反例：javascript: → error，且点名协议', () => {
    const doc = link({ url: 'javascript:alert(1)', target: '_blank' })
    expect(levelOf(doc, 'I43')).toEqual(['error'])
    expect(msgOf(doc, 'I43')).toContain('javascript')
  })

  it('I43 反例：data: / vbscript: / file: 一并拦', () => {
    for (const url of ['data:text/html,<script>', 'vbscript:msgbox', 'file:///etc/passwd']) {
      expect(levelOf(link({ url, target: '_blank' }), 'I43'), url).toEqual(['error'])
    }
  })

  it('I44 反例：target 是 _self → info', () => {
    expect(levelOf(link({ url: 'https://example.com', target: '_self' }), 'I44')).toEqual(['info'])
  })

  it('I44 正例：_blank 不报', () => {
    expect(codes(link({ url: 'https://example.com', target: '_blank' }))).not.toContain('I44')
  })

  it('I45 反例：外部域名 → info', () => {
    expect(levelOf(link({ url: 'https://example.com/x', target: '_blank' }), 'I45')).toEqual(['info'])
  })

  it('I45 正例：相对路径不报 —— 内网部署打得开', () => {
    expect(codes(link({ url: '/docs/manual.pdf', target: '_blank' }))).not.toContain('I45')
  })

  it('C4 · 一份含 javascript: 的历史文档仍然 migrate + validate 得过', () => {
    // 完整性检查拦得住，**schema 校验不许拦** —— 把它做成 zod 约束会让一份能打开的
    // 文档打不开，那是 C4 的反面。
    const doc = link({ url: 'javascript:alert(1)', target: '_blank' })
    expect(validate(doc).ok, 'schema 校验必须放行').toBe(true)
    expect(hasErrors(check(doc)), '完整性检查必须拦下').toBe(true)
  })
})

describe('T-226 · 两张表同构', () => {
  it('报出来的每一条引用错误都说中文 —— 没有一个英文 kind 泄漏出来', () => {
    // **断的是行为，不是一个导出的常量。**
    //
    // 两张表（中文名 / id 集合）分头维护过一次，症状有两种：缺 label → 报错里蹦出
    // 「引用了不存在的 overlay」这种半英文；缺 set → `sets[kind]?.has` 短路 →
    // **每一条合法引用都被误报**。这条测试造一份「每种引用各坏一条」的文档，
    // 然后要求每条消息都是人话。
    const doc = mutated((d) => {
      d.variables.push({ id: 'sv', name: 's', type: 'string', default: '', persist: false, scope: 'scene' })
      d.pages = [
        { id: 'pg_00000001', name: '页', overlays: [
          { id: 'ov_00000001', type: 'text', rect: { x: 0, y: 0, w: 1, h: 1 }, anchor: 'tl',
            props: { text: '', size: 16, color: '#ffffff', align: 'left', flowId: 'flw_nothere1' } },
        ] },
      ]
      d.flows = [{ id: 'flw_00000001', name: 'f', variableId: 'sv', startStepId: null, steps: [] }]
      d.nodes[1].prefabRef = { prefabId: 'pfb_nothere1', overridden: [] }
      d.viewpoints[0].thumbnailAssetId = 'ast_nothere1'
      d.rules.push(
        { id: 'rl_pg000001', name: 'a', enabled: true, when: { event: 'pageEnter', pageId: 'pg_nothere1' },
          if: [], ifAny: [], then: [], mode: 'sequence', onError: 'abort', reentry: 'restart' },
        { id: 'rl_st000001', name: 'b', enabled: true,
          when: { event: 'flowStepEnter', flowId: 'flw_nothere1', stepId: 'st_nothere1' },
          if: [], ifAny: [], then: [], mode: 'sequence', onError: 'abort', reentry: 'restart' },
        { id: 'rl_ov000001', name: 'c', enabled: true, when: { event: 'overlayClick', overlayId: 'ov_nothere1' },
          if: [], ifAny: [], then: [], mode: 'sequence', onError: 'abort', reentry: 'restart' },
      )
    })

    const refIssues = check(doc).filter((i) => i.refKind !== undefined)
    // 扫描面下限：一条引用错误都没造出来时，下面那个循环恒真
    expect(new Set(refIssues.map((i) => i.refKind)).size, '造出来的引用种类太少，这条断言没什么可查的').toBeGreaterThanOrEqual(6)
    for (const issue of refIssues) {
      expect(issue.message, `${issue.refKind} 的中文名没登记，英文 kind 泄漏进了报错`).not.toContain(`不存在的${issue.refKind}`)
    }
  })

  it('step 引用不再被误报 —— sets 缺 step 的那个缺口', () => {
    const doc = mutated((d) => {
      d.variables.push({ id: 'sv', name: 's', type: 'string', default: '', persist: false, scope: 'scene' })
      d.flows = [{ id: 'flw_00000001', name: 'f', variableId: 'sv', startStepId: 'st_00000001',
        steps: [{ id: 'st_00000001', name: '一', next: null, onEnter: [] }] }]
      d.rules.push({
        id: 'rl_probe001', name: '步骤规则', enabled: true,
        when: { event: 'flowStepEnter', flowId: 'flw_00000001', stepId: 'st_00000001' },
        if: [], ifAny: [], then: [], mode: 'sequence', onError: 'abort', reentry: 'restart',
      })
    })
    // 这条引用是**合法的**。sets['step'] 缺席时它会被报成「引用了不存在的流程步骤」。
    expect(check(doc).filter((i) => i.refKind === 'step')).toEqual([])
  })

  it('三个新事件的引用真的被查 —— 指向不存在的目标必须报出来', () => {
    const bad = (when: Record<string, unknown>) =>
      mutated((d) => {
        d.rules.push({
          id: 'rl_probe001', name: 'x', enabled: true, when, if: [], ifAny: [], then: [],
          mode: 'sequence', onError: 'abort', reentry: 'restart',
        })
      })
    expect(codes(bad({ event: 'pageEnter', pageId: 'pg_nothere1' })), 'pageEnter').toContain('I3')
    expect(codes(bad({ event: 'flowStepEnter', flowId: 'flw_nothere1', stepId: 'st_nothere1' })), 'flowStepEnter').toContain('I3')
    expect(codes(bad({ event: 'overlayClick', overlayId: 'ov_nothere1' })), 'overlayClick').toContain('I3')
  })
})
