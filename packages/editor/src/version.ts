/**
 * The core version stamped into every published package's manifest.
 *
 * D8 calls this "v1 之后排查『老包新播放器』问题的唯一线索", so it must change whenever
 * runtime behaviour changes — not whenever the editor's UI does. Read from the workspace
 * version rather than hardcoded in two places.
 */
export const CORE_VERSION = __W3_CORE_VERSION__
