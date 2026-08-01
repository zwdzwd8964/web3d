/**
 * A valid WAV file of an exactly known length.
 *
 * T-160's acceptance is 「`durationS` 与真实时长误差 < 0.1s」, and there is no way to check
 * that against an injected reader — the injected one returns whatever the test says. It
 * needs a real file, a real browser and a length known independently of what the browser
 * reports. A WAV is the one audio container simple enough to synthesise exactly:
 * 44-byte RIFF header, then raw PCM samples, so duration = samples / sampleRate with no
 * encoder, no frame padding and no VBR header to guess at.
 */

/** A silent mono 16-bit PCM WAV of exactly `seconds` at 8 kHz. */
export function buildWav(seconds: number, sampleRate = 8000): Uint8Array {
  const samples = Math.round(seconds * sampleRate)
  const dataBytes = samples * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM header length
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)
  // The samples themselves stay zero: silence is still a signal of exactly this length,
  // and a tone would make the test's own audio audible on a developer's machine.

  return new Uint8Array(buffer)
}
