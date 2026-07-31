/**
 * Refuses anything that is not a same-origin relative path.
 *
 * `?src=https://evil.example/x.w3p` would turn the player into a fetcher for arbitrary
 * external downloads, and reaching another origin breaks C6 outright — on a customer
 * intranet that is a blank page discovered on go-live day.
 *
 * The first version checked only a scheme regex and `startsWith('//')`, which is
 * decorative: a URL parser normalises the string before resolving it, and two of those
 * normalisations walk straight past both checks.
 *
 *   - WHATWG treats a backslash as a slash for special schemes, so a backslash pair
 *     resolves to another origin while failing `startsWith('//')`;
 *   - leading C0 control characters and spaces are stripped first, so a tab in front of
 *     `//host` does the same.
 *
 * So: normalise the same way, reject on the obvious shapes, and then resolve and insist
 * the origin did not move. That last check is the one that actually holds — the first two
 * only make the common cases fail early and legibly.
 *
 * Its own module rather than living in `main.ts` so importing it does not boot the app.
 */
export function resolveSource(raw: string | null): string | null {
  if (!raw) return null

  // Leading C0 controls and spaces, stripped the way the URL parser strips them.
  //
  // A scan rather than a character class: the class would be precisely what
  // `no-control-regex` exists to flag, and suppressing that rule here would teach the
  // next reader to suppress it somewhere it matters.
  let start = 0
  while (start < raw.length && raw.charCodeAt(start) <= 0x20) start++
  const normalised = raw.slice(start).replace(/\\/g, '/')

  if (normalised === '') return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalised)) return null
  if (normalised.startsWith('//')) return null

  try {
    if (new URL(normalised, location.href).origin !== location.origin) return null
  } catch {
    return null
  }

  return normalised
}
