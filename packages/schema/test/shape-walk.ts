/**
 * T-225 · walk a zod schema into a flat set of field paths.
 *
 * This exists for exactly one consumer: the reverse comparison in `freeze-table.test.ts`,
 * which needs to ask 「v3 比 v2 多了哪些字段」 as a set operation rather than as a number
 * somebody typed twice.
 *
 * **It lives in `test/`, not `src/`.** Nothing shipped needs to introspect the schema, and
 * putting a reflection helper on the public API would invite runtime consumers to branch on
 * shape — which is how a schema stops being the single source of truth.
 *
 * Path convention matches the first column of `docs/SCHEMA_V3_FREEZE.md` verbatim:
 * `meta.fog` · `nodes[].section` · `hotspots[].style.label` · `rules[].when` — arrays
 * collapse to `[]` because the table describes shapes, not instances.
 */

/** zod 4 internals. Untyped by design — `_zod.def` is not part of zod's public surface. */
type ZodLike = { _zod?: { def?: Record<string, unknown> } }

const def = (s: unknown): Record<string, unknown> | null => (s as ZodLike)?._zod?.def ?? null

/**
 * Wrappers to see through. Each maps a def key to "the schema underneath".
 *
 * `default` / `nullable` / `optional` / `catch` / `readonly` / `pipe` all carry `innerType`;
 * `array` carries `element`. Missing one of these silently truncates the walk at that field,
 * so the floor assertion in the test is not decoration.
 */
const UNWRAP = ['innerType', 'element', 'in', 'out', 'valueType'] as const

/**
 * @param schema  any zod schema
 * @param prefix  path prefix for the current position (`''` at the root)
 * @param out     accumulator
 * @param seen    cycle guard — `nodes[].children` is self-referential in spirit even when
 *                the current encoding is flat, and `prefabs[].nodes[]` genuinely re-enters
 *                `NodeSchema`. Without this the walk does not terminate.
 * @returns the set of dotted field paths reachable from `schema`
 */
export function walkShape(schema: unknown, prefix = '', out = new Set<string>(), seen = new Set<unknown>()): Set<string> {
  const d = def(schema)
  if (!d) return out

  const type = d.type as string

  if (type === 'object' || type === 'interface') {
    if (seen.has(schema)) return out
    seen.add(schema)
    const shape = (d.shape ?? {}) as Record<string, unknown>
    for (const [key, child] of Object.entries(shape)) {
      const path = prefix ? `${prefix}.${key}` : key
      out.add(path)
      walkShape(child, path, out, seen)
    }
    seen.delete(schema)
    return out
  }

  if (type === 'array') {
    walkShape(d.element, `${prefix}[]`, out, seen)
    return out
  }

  if (type === 'union') {
    // Discriminated unions included. Every branch contributes its own keys at the SAME path —
    // `rules[].when.pageId` and `rules[].when.nodeId` are both real, they just never co-occur.
    for (const opt of (d.options ?? []) as unknown[]) walkShape(opt, prefix, out, seen)
    return out
  }

  if (type === 'record') {
    // `stats.clipDurations` is an open map — the keys are data, so there is nothing to name.
    return out
  }

  for (const key of UNWRAP) {
    if (d[key] !== undefined) return walkShape(d[key], prefix, out, seen)
  }

  return out
}
