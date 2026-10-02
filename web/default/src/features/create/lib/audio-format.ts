/** Language name in the UI language, e.g. `vi` → "Tiếng Việt". */
export function languageName(code: string, locale: string): string {
  try {
    return (
      new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code
    )
  } catch {
    return code
  }
}

/** `mp3_44100_128` → `MP3 · 44.1 kHz · 128 kbps`. */
export function outputFormatLabel(format: string): string {
  const [codec, rate, bitrate] = format.split('_')
  const khz = `${Number(rate) / 1000} kHz`
  return [codec.toUpperCase(), khz, bitrate ? `${bitrate} kbps` : '']
    .filter(Boolean)
    .join(' · ')
}
