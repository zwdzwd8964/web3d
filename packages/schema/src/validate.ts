import type { z } from 'zod'
import { SceneDocument } from './document.js'

export interface ValidationIssue {
  /** Dotted/bracketed JSON path, e.g. `nodes[3].transform.p`. */
  readonly path: string
  readonly message: string
  readonly code: string
}

export type ValidateResult =
  | { readonly ok: true; readonly document: SceneDocument }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] }

export function formatPath(path: readonly (string | number | symbol)[]): string {
  let out = ''
  for (const seg of path) {
    if (typeof seg === 'number') out += `[${seg}]`
    else out += out === '' ? String(seg) : `.${String(seg)}`
  }
  return out === '' ? '(root)' : out
}

export function toIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((i) => ({
    path: formatPath(i.path),
    message: i.message,
    code: i.code,
  }))
}

/**
 * Structural validation only: shapes, enums, ranges, id formats.
 * Cross-references are checkIntegrity()'s job — the two are deliberately separate so
 * that a document can be *saved* while still incomplete, but never *published*
 * while broken (D8).
 */
export function validate(input: unknown): ValidateResult {
  const parsed = SceneDocument.safeParse(input)
  if (parsed.success) return { ok: true, document: parsed.data }
  return { ok: false, issues: toIssues(parsed.error) }
}

export class DocumentValidationError extends Error {
  readonly issues: readonly ValidationIssue[]
  constructor(issues: readonly ValidationIssue[]) {
    const head = issues
      .slice(0, 5)
      .map((i) => `  ${i.path}: ${i.message}`)
      .join('\n')
    const more = issues.length > 5 ? `\n  … and ${issues.length - 5} more` : ''
    super(`scene document failed validation (${issues.length} issue(s)):\n${head}${more}`)
    this.name = 'DocumentValidationError'
    this.issues = issues
  }
}

export function assertValid(input: unknown): SceneDocument {
  const r = validate(input)
  if (!r.ok) throw new DocumentValidationError(r.issues)
  return r.document
}
