import type { z } from 'zod'
import { SceneDocumentSchema } from './document.js'
import type { SceneDocument } from './document.js'

/** SCHEMA_SPEC §9 · a plain result, so nothing throws into the editor's render path. */
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

export interface ValidationError {
  /** Bracketed JSON path, e.g. `nodes[3].transform.p`. */
  readonly path: string
  readonly message: string
  readonly code: string
}

export function formatPath(path: readonly (string | number | symbol)[]): string {
  let out = ''
  for (const seg of path) {
    if (typeof seg === 'number') out += `[${seg}]`
    else out += out === '' ? String(seg) : `.${String(seg)}`
  }
  return out === '' ? '(root)' : out
}

export function toValidationErrors(error: z.ZodError): ValidationError[] {
  return error.issues.map((i) => ({ path: formatPath(i.path), message: i.message, code: i.code }))
}

/**
 * Structural validation only — shapes, enums, ranges, id formats. Uses `safeParse`, so
 * a malformed document surfaces as a list the UI can point at rather than an exception
 * that takes the editor down (SCHEMA_SPEC §0.4).
 *
 * Cross-references are checkIntegrity's job. The split is deliberate: a document may be
 * SAVED while still incomplete, but must never be PUBLISHED while broken (MVP_V0 D8).
 *
 * Note that `rules[].then[].params` is intentionally unvalidated here — per-action
 * parameter schemas live in core's registry (ECA_SPEC §4.1), which this package sits
 * below. The executor parses them through the registry before running a handler.
 */
export function validate(input: unknown): Result<SceneDocument, ValidationError[]> {
  const parsed = SceneDocumentSchema.safeParse(input)
  return parsed.success ? ok(parsed.data) : err(toValidationErrors(parsed.error))
}

export class DocumentValidationError extends Error {
  readonly errors: readonly ValidationError[]
  constructor(errors: readonly ValidationError[]) {
    const head = errors
      .slice(0, 5)
      .map((e) => `  ${e.path}: ${e.message}`)
      .join('\n')
    const more = errors.length > 5 ? `\n  … and ${errors.length - 5} more` : ''
    super(`scene document failed validation (${errors.length} issue(s)):\n${head}${more}`)
    this.name = 'DocumentValidationError'
    this.errors = errors
  }
}

/** Convenience for tests and fixtures, where an invalid document is a bug, not input. */
export function assertValid(input: unknown): SceneDocument {
  const r = validate(input)
  if (!r.ok) throw new DocumentValidationError(r.error)
  return r.value
}
