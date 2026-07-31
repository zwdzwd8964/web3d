/**
 * Refuses anything that is not a same-origin relative path.
 *
 * `?src=https://evil.example/x.w3p` would turn the player into an open redirect for
 * arbitrary downloads, and reaching another origin breaks C6 outright — on a customer
 * intranet that is a blank page discovered on go-live day. Absolute and protocol-relative
 * URLs are rejected rather than normalised: normalising would mean guessing what the
 * caller meant.
 *
 * Its own module rather than living in `main.ts` so importing it does not boot the app.
 */
export function resolveSource(raw: string | null): string | null {
  if (!raw) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) return null
  return raw
}
