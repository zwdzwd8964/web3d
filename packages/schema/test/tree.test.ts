import { describe, expect, it } from 'vitest'
import { createGoldenPathDocument } from '../src/samples.js'
import {
  ancestorsOf,
  childrenOf,
  descendantsOf,
  displayPathOf,
  findNode,
  rootNodes,
  subtreeIds,
  walkTree,
  wouldCreateCycle,
} from '../src/tree.js'

const doc = createGoldenPathDocument()
const byName = (name: string) => doc.nodes.find((n) => n.name === name)!

describe('tree helpers', () => {
  it('finds roots and children in document order', () => {
    expect(rootNodes(doc).map((n) => n.name)).toEqual(['泵组'])
    expect(childrenOf(doc, byName('泵组').id).map((n) => n.name)).toEqual(['泵体', '阀盖', '密封垫'])
    expect(childrenOf(doc, byName('阀盖').id).map((n) => n.name)).toEqual(['固定螺栓'])
  })

  it('collects descendants depth-first', () => {
    expect(descendantsOf(doc, byName('泵组').id).map((n) => n.name)).toEqual(['泵体', '阀盖', '固定螺栓', '密封垫'])
    expect(descendantsOf(doc, byName('固定螺栓').id)).toEqual([])
  })

  it('collects ancestors nearest-first', () => {
    expect(ancestorsOf(doc, byName('固定螺栓').id).map((n) => n.name)).toEqual(['阀盖', '泵组'])
    expect(ancestorsOf(doc, byName('泵组').id)).toEqual([])
  })

  it('builds a display path from names — display only, never a key', () => {
    expect(displayPathOf(doc, byName('固定螺栓').id)).toBe('泵组/阀盖/固定螺栓')
    expect(displayPathOf(doc, 'nd_999999')).toBe('')
  })

  it('walks the whole tree with depths', () => {
    const seen: [string, number][] = []
    walkTree(doc, (n, d) => seen.push([n.name, d]))
    expect(seen).toEqual([
      ['泵组', 0],
      ['泵体', 1],
      ['阀盖', 1],
      ['固定螺栓', 2],
      ['密封垫', 1],
    ])
  })

  it('refuses the drag-and-drop moves that would create a cycle', () => {
    const pump = byName('泵组').id
    const cover = byName('阀盖').id
    const bolt = byName('固定螺栓').id
    expect(wouldCreateCycle(doc, pump, cover)).toBe(true) // onto a descendant
    expect(wouldCreateCycle(doc, pump, bolt)).toBe(true) // onto a deeper descendant
    expect(wouldCreateCycle(doc, cover, cover)).toBe(true) // onto itself
    expect(wouldCreateCycle(doc, cover, null)).toBe(false) // to root
    expect(wouldCreateCycle(doc, byName('泵体').id, cover)).toBe(false) // onto a sibling
  })

  it('subtreeIds includes the node itself', () => {
    expect(subtreeIds(doc, byName('阀盖').id)).toEqual([byName('阀盖').id, byName('固定螺栓').id])
  })

  it('tolerates a corrupted parent chain without hanging', () => {
    const broken = structuredClone(doc)
    broken.nodes[0]!.parent = broken.nodes[2]!.id // 泵组 -> 阀盖, a cycle
    expect(() => ancestorsOf(broken, broken.nodes[3]!.id)).not.toThrow()
    expect(ancestorsOf(broken, broken.nodes[3]!.id).length).toBeLessThan(10)
  })

  it('findNode returns undefined rather than throwing', () => {
    expect(findNode(doc, 'nd_999999')).toBeUndefined()
  })
})
