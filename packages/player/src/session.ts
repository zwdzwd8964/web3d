import type { AssetResolver } from '@w3/core'
import { SceneRuntime, createPlaybackSession, registerBuiltinActions } from '@w3/core'
import type { ExecResult, HotspotRenderer, LogLevel, PlaybackSession } from '@w3/core'
import { createPackageResolver } from '@w3/storage'
import type { UnpackedPackage } from '@w3/storage'
import { assertCompatible } from './compat.js'

/**
 * Everything the player does that AFFECTS BEHAVIOUR, with nothing that does not.
 *
 * Split out of `Player` for one reason: the parity suite (T-103) has to drive the real
 * player path, not a re-implementation of it. A parity test that constructed its own
 * runtime and its own session would be comparing the harness against itself and would
 * stay green through exactly the divergence it exists to catch.
 *
 * So `Player.start()` calls this, and parity calls this. What stays in `Player` is the
 * canvas, the overlay, pointer handling and resize — none of which can change which rule
 * fires or what it does.
 */

export interface PlayerSessionOptions {
  readonly pkg: UnpackedPackage
  readonly canvas?: HTMLCanvasElement
  readonly hotspotRenderer?: HotspotRenderer
  /**
   * T-162 · injected so the hotspot layer and the runtime read assets through ONE resolver.
   * Absent means the session builds its own from the package.
   */
  readonly resolver?: AssetResolver
  /** Injected by parity so both sides share one fake clock. */
  readonly now?: () => number
  readonly onResult?: (result: ExecResult) => void
  readonly onLog?: (level: LogLevel, message: string, data?: unknown) => void
}

export interface PlayerSession {
  readonly runtime: SceneRuntime
  readonly session: PlaybackSession
}

export function createPlayerSession(options: PlayerSessionOptions): PlayerSession {
  const { pkg } = options

  // Refuse a package from a newer build before anything is built from it.
  assertCompatible(pkg)

  // ADR-0008 · the host registers; the library does not self-register on import.
  registerBuiltinActions()

  const runtime = new SceneRuntime(pkg.document, {
    // Assets come out of the zip they arrived in — no request of any kind (C6).
    resolver: options.resolver ?? createPackageResolver(pkg),
    // ECA_SPEC §7 · play. No grid, no gizmo, no selection.
    mode: 'play',
    ...(options.canvas ? { canvas: options.canvas } : {}),
    ...(options.hotspotRenderer ? { hotspotRenderer: options.hotspotRenderer } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.onLog ? { onLog: options.onLog } : {}),
  })

  const session = createPlaybackSession({
    runtime,
    document: pkg.document,
    ...(options.onResult ? { onResult: options.onResult } : {}),
  })

  return { runtime, session }
}
