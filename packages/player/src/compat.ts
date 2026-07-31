import { CURRENT_VERSION } from '@w3/schema'
import type { UnpackedPackage } from '@w3/storage'

/**
 * T-101 acceptance: a package from a NEWER build must fail with a clear message.
 *
 * Silently opening it would render a scene missing whatever the newer schema added — the
 * user sees a subtly wrong result and has no reason to suspect the version. Refusing is
 * the only honest option, and the message names both numbers so the mismatch is
 * diagnosable without opening the zip.
 *
 * Older packages are opened normally: SCHEMA_SPEC's migration chain is what makes
 * constitution C4 ("老文件永远能打开") true, and refusing them here would undo it.
 */
export function assertCompatible(pkg: UnpackedPackage): void {
  const { schemaVersion, coreVersion } = pkg.manifest
  if (schemaVersion > CURRENT_VERSION) {
    throw new Error(
      `这个包由更新版本的编辑器发布（文档格式 v${schemaVersion}），当前播放器只支持到 v${CURRENT_VERSION}。` +
        `请升级播放器后重试。（发布时的 core 版本：${coreVersion}）`,
    )
  }
}
