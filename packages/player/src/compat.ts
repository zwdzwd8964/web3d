import { assertPackageCompatible } from '@w3/storage'
import type { UnpackedPackage } from '@w3/storage'

/**
 * T-101 acceptance: a package from a NEWER build must fail with a clear message.
 *
 * Silently opening it would render a scene missing whatever the newer schema added — the
 * user sees a subtly wrong result and has no reason to suspect the version. Refusing is
 * the only honest option, and the message names both numbers so the mismatch is
 * diagnosable without opening the zip.
 *
 * The check itself moved to `@w3/storage` (T-116). It belongs next to the format it is
 * about, and — more to the point — it has to run inside `unpackScene`, because a package
 * this function would have refused never got this far: unpacking rejected it first, with a
 * message about scene.json being unreadable rather than about the player being out of date.
 * That made this function dead code from the day it was written.
 *
 * It is kept, delegating, because `createPlayerSession` also accepts an `UnpackedPackage`
 * assembled by other means (the parity harness does exactly that), and that path still
 * needs the gate.
 *
 * Older packages are opened normally: SCHEMA_SPEC's migration chain is what makes
 * constitution C4 ("老文件永远能打开") true, and refusing them here would undo it.
 */
export function assertCompatible(pkg: UnpackedPackage): void {
  assertPackageCompatible(pkg.manifest)
}
