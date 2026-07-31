import type { Light } from '@w3/schema'
import { Color, Object3D, Vector3 } from 'three'
import type { DirectionalLight, HemisphereLight, PointLight, SpotLight } from 'three'
import { describe, expect, it } from 'vitest'
import { lightFactory, shadowMapSizeFor } from '../../src/runtime/light-factory.js'

/**
 * T-131 · the five lights.
 *
 * three's lights need no GL context — they are Object3Ds carrying numbers until a renderer
 * reads them — so all of this is plain Node (C8). What a renderer would do with the
 * numbers is T-132's problem; what the numbers ARE is this file's.
 */

const shadow = { enabled: true, quality: 'medium' as const, bias: -0.0005 }

const SPECS: Record<string, Light> = {
  ambient: { kind: 'ambient', color: '#ff0000', intensity: 0.4 },
  hemisphere: { kind: 'hemisphere', skyColor: '#0000ff', groundColor: '#00ff00', intensity: 0.7 },
  directional: { kind: 'directional', color: '#ffffff', intensity: 1.5, shadow },
  point: { kind: 'point', color: '#ffff00', intensity: 2, range: 12, decay: 1.5, shadow },
  spot: { kind: 'spot', color: '#ffd9a0', intensity: 3, range: 0, decay: 2, angleDeg: 30, penumbra: 0.2, shadow },
}

/** World-space direction the light actually shines, per three's own aim model. */
function beamDirection(light: Object3D): Vector3 {
  const target = (light as DirectionalLight).target
  light.updateMatrixWorld(true)
  const from = light.getWorldPosition(new Vector3())
  const to = target.getWorldPosition(new Vector3())
  return to.sub(from).normalize()
}

describe('create()', () => {
  it('builds an ambient light with the document’s colour and intensity', () => {
    const light = lightFactory.create(SPECS.ambient!)
    expect(light.type).toBe('AmbientLight')
    expect((light as PointLight).color.getHexString()).toBe('ff0000')
    expect((light as PointLight).intensity).toBe(0.4)
  })

  it('builds a hemisphere light with sky above and ground below', () => {
    const light = lightFactory.create(SPECS.hemisphere!) as HemisphereLight
    expect(light.type).toBe('HemisphereLight')
    expect(light.color.getHexString()).toBe('0000ff')
    expect(light.groundColor.getHexString()).toBe('00ff00')
    expect(light.intensity).toBe(0.7)
  })

  it('builds a directional light with a shadow camera configured from the quality bucket', () => {
    const light = lightFactory.create(SPECS.directional!) as DirectionalLight
    expect(light.type).toBe('DirectionalLight')
    expect(light.castShadow).toBe(true)
    expect(light.shadow.mapSize.width).toBe(1024)
    expect(light.shadow.bias).toBe(-0.0005)
  })

  it('builds a point light, translating `range` to three’s `distance`', () => {
    const light = lightFactory.create(SPECS.point!) as PointLight
    expect(light.type).toBe('PointLight')
    expect(light.distance, 'range 12 must not silently become the default 0 = unlimited').toBe(12)
    expect(light.decay).toBe(1.5)
  })

  it('builds a spot light, converting degrees to radians', () => {
    const light = lightFactory.create(SPECS.spot!) as SpotLight
    expect(light.type).toBe('SpotLight')
    expect(light.angle).toBeCloseTo(Math.PI / 6, 9)
    expect(light.penumbra).toBe(0.2)
    expect(light.distance).toBe(0)
  })

  it('gives every light exactly the parameters its kind declares and no shadow it cannot cast', () => {
    // Ambient and hemisphere have no `shadow` block in the schema; asking three to cast
    // one from them is a no-op that reads as a broken feature.
    expect((lightFactory.create(SPECS.ambient!) as PointLight).castShadow).toBe(false)
    expect((lightFactory.create(SPECS.hemisphere!) as PointLight).castShadow).toBe(false)
  })
})

describe('D13 · directional and spot lights aim along the node’s local -Z', () => {
  it.each(['directional', 'spot'])('%s: an unrotated light shines down -Z', (kind) => {
    const light = lightFactory.create(SPECS[kind]!)
    const direction = beamDirection(light)
    expect(direction.x).toBeCloseTo(0, 9)
    expect(direction.y).toBeCloseTo(0, 9)
    expect(direction.z).toBeCloseTo(-1, 9)
  })

  it.each(['directional', 'spot'])('%s: rotating the node turns the beam with it', (kind) => {
    // The mathematical form of "the gizmo's rotation IS the lighting direction" (D13).
    // 90° about Y takes local -Z to world -X.
    const light = lightFactory.create(SPECS[kind]!)
    light.rotation.set(0, Math.PI / 2, 0)
    const direction = beamDirection(light)
    expect(direction.x).toBeCloseTo(-1, 6)
    expect(direction.y).toBeCloseTo(0, 6)
    expect(direction.z).toBeCloseTo(0, 6)
  })

  it('the target moves with the node, because it is a child of it', () => {
    // If the target were a loose Object3D (three's default), it would sit at the world
    // origin and the beam would swing around as the light moved — the exact bug D13's
    // "no target object in the document" decision avoids.
    const light = lightFactory.create(SPECS.spot!)
    light.position.set(5, 5, 5)
    expect(beamDirection(light).z).toBeCloseTo(-1, 9)
    expect((light as SpotLight).target.parent).toBe(light)
  })

  it('the target is not mistaken for a document node', () => {
    // SceneGraph walks userData for `w3NodeId`; an aim target carrying one would show up
    // in the hierarchy tree and be pickable.
    const light = lightFactory.create(SPECS.directional!)
    expect((light as DirectionalLight).target.userData).toEqual({})
    expect((light as DirectionalLight).target.name).toBe('w3:light-target')
  })

  it('ambient and hemisphere have no target — they have no direction to have one', () => {
    for (const kind of ['ambient', 'hemisphere']) {
      expect(lightFactory.create(SPECS[kind]!).children).toHaveLength(0)
    }
  })
})

describe('update()', () => {
  it.each(Object.keys(SPECS))('%s: rewrites parameters in place rather than rebuilding', (kind) => {
    const light = lightFactory.create(SPECS[kind]!)
    const brighter: Light = { ...SPECS[kind]!, intensity: 9 } as Light
    expect(lightFactory.update(light, brighter)).toBe(true)
    expect((light as PointLight).intensity, 'the slider drag must land on the same object').toBe(9)
  })

  it('updates a spot light’s cone and penumbra', () => {
    const light = lightFactory.create(SPECS.spot!) as SpotLight
    lightFactory.update(light, { ...(SPECS.spot as Extract<Light, { kind: 'spot' }>), angleDeg: 60, penumbra: 0.9 })
    expect(light.angle).toBeCloseTo(Math.PI / 3, 9)
    expect(light.penumbra).toBe(0.9)
  })

  it('updates a hemisphere light’s ground colour, not only its sky', () => {
    const light = lightFactory.create(SPECS.hemisphere!) as HemisphereLight
    lightFactory.update(light, {
      ...(SPECS.hemisphere as Extract<Light, { kind: 'hemisphere' }>),
      groundColor: '#123456',
    })
    expect(light.groundColor.getHexString()).toBe('123456')
  })

  it('reallocates the shadow map when the quality bucket changes', () => {
    // three allocates the map lazily from `mapSize` and never reallocates on its own, so
    // without the dispose a "high" setting keeps rendering at 512 and the control looks
    // like it does nothing.
    const light = lightFactory.create(SPECS.directional!) as DirectionalLight
    let disposed = false
    light.shadow.map = { dispose: () => (disposed = true) } as unknown as DirectionalLight['shadow']['map']

    lightFactory.update(light, {
      ...(SPECS.directional as Extract<Light, { kind: 'directional' }>),
      shadow: { ...shadow, quality: 'high' },
    })

    expect(light.shadow.mapSize.width).toBe(2048)
    expect(disposed, 'the old map must go, or the new resolution never takes effect').toBe(true)
    expect(light.shadow.map).toBeNull()
  })

  it('keeps the existing shadow map when nothing about the resolution changed', () => {
    const light = lightFactory.create(SPECS.spot!) as SpotLight
    const map = { dispose: () => undefined } as unknown as SpotLight['shadow']['map']
    light.shadow.map = map
    lightFactory.update(light, { ...(SPECS.spot as Extract<Light, { kind: 'spot' }>), intensity: 5 })
    expect(light.shadow.map, 'a brightness change must not throw away a render target').toBe(map)
  })

  it('turns a shadow off without discarding anything else', () => {
    const light = lightFactory.create(SPECS.point!) as PointLight
    lightFactory.update(light, {
      ...(SPECS.point as Extract<Light, { kind: 'point' }>),
      shadow: { ...shadow, enabled: false },
    })
    expect(light.castShadow).toBe(false)
    expect(light.distance).toBe(12)
  })

  it('refuses a kind change, which is how the graph knows to replace the object', () => {
    const light = lightFactory.create(SPECS.spot!)
    expect(lightFactory.update(light, SPECS.point!)).toBe(false)
    expect(lightFactory.update(light, SPECS.ambient!)).toBe(false)
    expect(lightFactory.update(light, SPECS.spot!)).toBe(true)
  })

  it('refuses to update something that is not one of its lights', () => {
    expect(lightFactory.update(new Object3D(), SPECS.ambient!)).toBe(false)
  })
})

describe('dispose()', () => {
  it('frees the shadow map of every light in the subtree, not just the root', () => {
    const root = new Object3D()
    const a = lightFactory.create(SPECS.directional!) as DirectionalLight
    const b = lightFactory.create(SPECS.spot!) as SpotLight
    root.add(a, b)
    const freed: string[] = []
    a.shadow.map = { dispose: () => freed.push('a') } as unknown as DirectionalLight['shadow']['map']
    b.shadow.map = { dispose: () => freed.push('b') } as unknown as SpotLight['shadow']['map']

    lightFactory.dispose(root)

    expect(freed.sort()).toEqual(['a', 'b'])
    expect(a.shadow.map).toBeNull()
  })

  it('is harmless on a subtree with no lights in it', () => {
    // The graph calls both factories on every removal, so each has to ignore what is not
    // its own.
    expect(() => lightFactory.dispose(new Object3D())).not.toThrow()
  })
})

describe('shadow quality buckets', () => {
  it('maps low / medium / high to 512 / 1024 / 2048', () => {
    expect(shadowMapSizeFor('low')).toBe(512)
    expect(shadowMapSizeFor('medium')).toBe(1024)
    expect(shadowMapSizeFor('high')).toBe(2048)
  })

  it('a colour is a Color instance, not a string three would silently ignore', () => {
    expect((lightFactory.create(SPECS.ambient!) as PointLight).color).toBeInstanceOf(Color)
  })
})
