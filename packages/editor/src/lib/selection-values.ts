/**
 * T-064 · multi-select property editing.
 *
 * When several objects are selected, a field shows their shared value or a "mixed"
 * marker. Getting this wrong in the other direction is the expensive mistake: a panel
 * that shows the FIRST selection's value and writes it to all of them silently
 * overwrites the other objects the moment the user touches an unrelated field.
 *
 * So a mixed field reads as mixed and only writes when the user actually edits it.
 */

export const MIXED = Symbol('mixed')
export type Mixed = typeof MIXED

export type MaybeMixed<T> = T | Mixed

export const isMixed = <T>(value: MaybeMixed<T>): value is Mixed => value === MIXED

/** The shared value across a selection, or MIXED. An empty selection yields undefined. */
export function commonValue<T, V>(items: readonly T[], read: (item: T) => V, equals = Object.is): MaybeMixed<V> | undefined {
  if (items.length === 0) return undefined
  const first = read(items[0]!)
  for (let i = 1; i < items.length; i++) {
    if (!equals(read(items[i]!), first)) return MIXED
  }
  return first
}

const numbersEqual = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((n, i) => Object.is(n, b[i]))

/** Per-component comparison, so `[0, 5, 0]` vs `[0, 9, 0]` is mixed on Y only. */
export function commonVectorComponents<T>(
  items: readonly T[],
  read: (item: T) => readonly number[],
  length = 3,
): MaybeMixed<number>[] {
  return Array.from({ length }, (_, axis) => commonValue(items, (item) => read(item)[axis] ?? 0) ?? MIXED)
}

/** Shared array value across the selection. */
export function commonVector<T>(items: readonly T[], read: (item: T) => readonly number[]): MaybeMixed<readonly number[]> | undefined {
  return commonValue(items, read, numbersEqual as (a: readonly number[], b: readonly number[]) => boolean)
}

/** What a field should display: the value, an em dash for mixed, or empty. */
export function displayValue(value: MaybeMixed<number> | undefined, digits = 3): string {
  if (value === undefined) return ''
  if (isMixed(value)) return '—'
  return formatNumber(value, digits)
}

/** Trims trailing zeros so 0.350000 reads as 0.35 and 1 does not read as 1.000. */
export function formatNumber(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return '0'
  const fixed = value.toFixed(digits)
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed
}

/** Parses user input, rejecting anything that would put NaN into the document. */
export function parseNumber(input: string, fallback: number): number {
  const parsed = Number.parseFloat(input)
  return Number.isFinite(parsed) ? parsed : fallback
}
