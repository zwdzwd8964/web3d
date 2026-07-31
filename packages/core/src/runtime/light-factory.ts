import type { Light, LightKind, Shadow, ShadowQuality } from '@w3/schema'
import {
  AmbientLight,
  Color,
  DirectionalLight,
  HemisphereLight,
  Object3D,
  PointLight,
  SpotLight,
} from 'three'
import type { LightFactory } from './carrier-types.js'

/**
 * T-131 · the five lights, built from `node.light`.
 *
 * D12 · a light IS a node, so this file only answers one question: what Object3D does this
 * carrier become? The transform, the hierarchy, visibility, undo and incremental patching
 * all come from the node it hangs on, and none of it is written here.
 *
 * Two decisions are worth reading before changing anything:
 *
 * **The target is a child at local -Z (D13).** three's directional and spot lights aim at
 * a separate `target` Object3D, and copying that two-object model into the document would
 * put a second thing in the tree that has to be moved, undone and copied together with
 * the first. Parenting the target under the light instead means three derives the aim from
 * the light's own world matrix every frame, for free: rotate the node and the beam follows,
 * with no per-frame code and nothing extra in the document.
 *
 * **`update` returns false only for a `kind` change.** Everything else — colour, intensity,
 * cone angle, shadow quality — is written onto the existing light, so dragging an intensity
 * slider never replaces an object mid-frame. Swapping a spot for a point light is a
 * different three class and genuinely needs a new object.
 */

/** Shadow map resolution per quality bucket. A rendering decision core owns, not a field. */
const SHADOW_MAP_SIZE: Record<ShadowQuality, number> = { low: 512, medium: 1024, high: 2048 }

/** Local offset of the aim target. Any -Z point works; 1 metre keeps the numbers readable. */
const TARGET_OFFSET = -1

/** three's light classes we build, keyed by the document's `kind`. */
type ThreeLight = AmbientLight | HemisphereLight | DirectionalLight | PointLight | SpotLight

interface ShadowCapableLight {
  castShadow: boolean
  shadow: {
    bias: number
    mapSize: { width: number; height: number; set(x: number, y: number): unknown }
    map: { dispose(): void } | null
    dispose?: () => void
  }
}

const KIND_OF: Record<string, LightKind> = {
  AmbientLight: 'ambient',
  HemisphereLight: 'hemisphere',
  DirectionalLight: 'directional',
  PointLight: 'point',
  SpotLight: 'spot',
}

/** What `kind` an existing Object3D was built for, or null if it is not one of ours. */
function kindOf(object: Object3D): LightKind | null {
  return KIND_OF[object.type] ?? null
}

const degToRad = (deg: number) => (deg * Math.PI) / 180

/**
 * Applies the shadow block.
 *
 * The map is disposed when the resolution changes: three allocates it lazily from
 * `mapSize` and never reallocates on its own, so a "high" setting would keep rendering at
 * 512 with no error anywhere — the classic case of a control that appears to do nothing.
 */
function applyShadow(light: ShadowCapableLight, shadow: Shadow): void {
  light.castShadow = shadow.enabled
  light.shadow.bias = shadow.bias
  const size = SHADOW_MAP_SIZE[shadow.quality]
  if (light.shadow.mapSize.width !== size || light.shadow.mapSize.height !== size) {
    light.shadow.mapSize.set(size, size)
    light.shadow.map?.dispose()
    light.shadow.map = null
  }
}

/** Adds the -Z aim target as a child, once. */
function attachTarget(light: DirectionalLight | SpotLight): void {
  const target = new Object3D()
  target.name = 'w3:light-target'
  target.position.set(0, 0, TARGET_OFFSET)
  light.add(target)
  light.target = target
}

function write(light: ThreeLight, spec: Light): void {
  switch (spec.kind) {
    case 'ambient': {
      const l = light as AmbientLight
      l.color = new Color(spec.color)
      l.intensity = spec.intensity
      return
    }
    case 'hemisphere': {
      const l = light as HemisphereLight
      l.color = new Color(spec.skyColor)
      l.groundColor = new Color(spec.groundColor)
      l.intensity = spec.intensity
      return
    }
    case 'directional': {
      const l = light as DirectionalLight
      l.color = new Color(spec.color)
      l.intensity = spec.intensity
      applyShadow(l as unknown as ShadowCapableLight, spec.shadow)
      return
    }
    case 'point': {
      const l = light as PointLight
      l.color = new Color(spec.color)
      l.intensity = spec.intensity
      // The document says `range`, three says `distance`, and 0 means unlimited in both.
      l.distance = spec.range
      l.decay = spec.decay
      applyShadow(l as unknown as ShadowCapableLight, spec.shadow)
      return
    }
    case 'spot': {
      const l = light as SpotLight
      l.color = new Color(spec.color)
      l.intensity = spec.intensity
      l.distance = spec.range
      l.decay = spec.decay
      // Degrees in the document because that is what the user types (SCHEMA_SPEC §4.4).
      l.angle = degToRad(spec.angleDeg)
      l.penumbra = spec.penumbra
      applyShadow(l as unknown as ShadowCapableLight, spec.shadow)
      return
    }
  }
}

function build(spec: Light): ThreeLight {
  switch (spec.kind) {
    case 'ambient':
      return new AmbientLight()
    case 'hemisphere':
      return new HemisphereLight()
    case 'directional': {
      const light = new DirectionalLight()
      attachTarget(light)
      return light
    }
    case 'point':
      return new PointLight()
    case 'spot': {
      const light = new SpotLight()
      attachTarget(light)
      return light
    }
  }
}

/**
 * The real LightFactory. Installed by SceneRuntime; `carrier-types.ts` holds the
 * placeholder used when a host wants no lights at all.
 */
export const lightFactory: LightFactory = {
  create(spec) {
    const light = build(spec)
    write(light, spec)
    return light
  },

  update(object, spec) {
    // A different `kind` is a different three class — the caller replaces the object.
    if (kindOf(object) !== spec.kind) return false
    write(object as ThreeLight, spec)
    return true
  },

  dispose(object) {
    // Called on every detached subtree, so it has to find the lights rather than assume
    // the root is one. A shadow map is a render target; leaking it leaks VRAM per delete.
    object.traverse((child) => {
      const light = child as unknown as { isLight?: boolean; shadow?: ShadowCapableLight['shadow'] }
      if (light.isLight !== true || !light.shadow) return
      light.shadow.map?.dispose()
      light.shadow.map = null
      light.shadow.dispose?.()
    })
  },
}

/** Exposed for tests and for the benchmark page's shadow-quality sweep (T-174). */
export const shadowMapSizeFor = (quality: ShadowQuality): number => SHADOW_MAP_SIZE[quality]
