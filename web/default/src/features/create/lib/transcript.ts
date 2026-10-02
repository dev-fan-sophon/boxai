/**
 * Transcription results of the audio studio.
 *
 * A transcription run has no media output, so its transcript is stored as
 * the run text (playground_runs.prompt, up to 16k characters for audio runs):
 *
 *   Transcript · meeting.mp3 · vi
 *   [00:00:01.200-00:00:03.400] speaker_0: Xin chào mọi người
 *   [00:00:03.900-00:00:06.100] speaker_1: Chào anh
 *
 * The format stays readable wherever a run prompt is shown (history,
 * library, other clients) and round-trips into speakers + timestamps for the
 * transcript card and the .txt / .srt downloads. The header token is data,
 * not UI copy, so it is never translated.
 */

export const TRANSCRIPT_HEADER = 'Transcript · '

export type TranscriptSegment = {
  start?: number
  end?: number
  speaker?: string
  text: string
}

export type Transcript = {
  source: string
  language?: string
  segments: TranscriptSegment[]
}

/** Word entry of an ElevenLabs speech-to-text response. */
export type ElevenLabsTranscriptWord = {
  text: string
  type?: 'word' | 'spacing' | 'audio_event' | string
  start?: number | null
  end?: number | null
  speaker_id?: string | null
}

export type ElevenLabsTranscriptResponse = {
  text?: string
  language_code?: string
  words?: ElevenLabsTranscriptWord[]
}

/** A pause this long (seconds) between words starts a new line. */
const SEGMENT_PAUSE_SECONDS = 1
/** Lines longer than this break at the next sentence end. */
const SEGMENT_SOFT_CHARS = 160
const SENTENCE_END = /[.?!。？！…]$/

/**
 * Groups the word timeline into transcript lines: a new line starts when the
 * speaker changes, after a pause, or at a sentence end once a line is long.
 */
export function transcriptFromElevenLabs(
  response: ElevenLabsTranscriptResponse,
  source: string
): Transcript {
  const language = response.language_code || undefined
  const words = response.words ?? []
  const timed = words.some(
    (word) => word.type !== 'spacing' && typeof word.start === 'number'
  )
  if (!timed) {
    const text = response.text?.trim() ?? ''
    return { source, language, segments: text ? [{ text }] : [] }
  }
  const segments: TranscriptSegment[] = []
  let current: TranscriptSegment | null = null
  for (const word of words) {
    if (word.type === 'spacing' || typeof word.start !== 'number') {
      if (current) current.text += word.text
      continue
    }
    const start = word.start
    const end = word.end ?? start
    const speaker = word.speaker_id ?? undefined
    const trimmed = current?.text.trim() ?? ''
    const breakHere =
      current === null ||
      current.speaker !== speaker ||
      start - (current.end ?? start) > SEGMENT_PAUSE_SECONDS ||
      (trimmed.length > SEGMENT_SOFT_CHARS && SENTENCE_END.test(trimmed))
    if (breakHere || current === null) {
      if (current) segments.push(current)
      current = { start, end, speaker, text: word.text }
      continue
    }
    current.text += word.text
    current.end = end
  }
  if (current) segments.push(current)
  return {
    source,
    language,
    segments: segments
      .map((segment) => ({
        ...segment,
        text: segment.text.replaceAll(/\s+/g, ' ').trim(),
      }))
      .filter((segment) => segment.text),
  }
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

/** `HH:MM:SS.mmm` (or `,mmm` for SRT). */
export function formatTimestamp(seconds: number, separator = '.'): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000))
  const ms = totalMs % 1000
  const totalSeconds = Math.floor(totalMs / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${pad(h)}:${pad(m)}:${pad(s)}${separator}${pad(ms, 3)}`
}

/** Short `m:ss` clock for the transcript card. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const m = Math.floor(total / 60)
  return `${m}:${pad(total % 60)}`
}

function parseTimestamp(value: string): number {
  const [clock, fraction = '0'] = value.split(/[.,]/)
  const parts = clock.split(':').map(Number)
  const seconds = parts.reduce((sum, part) => sum * 60 + part, 0)
  return seconds + Number(`0.${fraction}`)
}

export function encodeTranscript(transcript: Transcript): string {
  const header = [transcript.source, transcript.language]
    .filter(Boolean)
    .join(' · ')
  const lines = transcript.segments.map((segment) => {
    const time =
      segment.start === undefined
        ? ''
        : `[${formatTimestamp(segment.start)}-${formatTimestamp(segment.end ?? segment.start)}] `
    const speaker = segment.speaker ? `${segment.speaker}: ` : ''
    return `${time}${speaker}${segment.text.replaceAll(/\n+/g, ' ')}`
  })
  return [`${TRANSCRIPT_HEADER}${header}`, ...lines].join('\n')
}

const TIMED_LINE =
  /^\[(\d{2}:\d{2}:\d{2}[.,]\d{3})-(\d{2}:\d{2}:\d{2}[.,]\d{3})\]\s(?:([\w-]{1,40}):\s)?(.*)$/

/** Parses a stored transcript; null when the text is not a transcript. */
export function parseTranscript(value: string | undefined): Transcript | null {
  if (!value?.startsWith(TRANSCRIPT_HEADER)) return null
  const [header, ...lines] = value.split('\n')
  const headerParts = header.slice(TRANSCRIPT_HEADER.length).split(' · ')
  let language: string | undefined
  if (headerParts.length > 1 && /^[a-z]{2,3}$/.test(headerParts.at(-1) ?? '')) {
    language = headerParts.pop()
  }
  const segments: TranscriptSegment[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    const match = TIMED_LINE.exec(line)
    if (!match) {
      segments.push({ text: line.trim() })
      continue
    }
    segments.push({
      start: parseTimestamp(match[1]),
      end: parseTimestamp(match[2]),
      speaker: match[3] || undefined,
      text: match[4].trim(),
    })
  }
  return { source: headerParts.join(' · '), language, segments }
}

/** `speaker_0` → `Speaker 1`; other ids are shown as-is. */
export function speakerLabel(
  speaker: string,
  translate: (key: string, options?: Record<string, unknown>) => string
): string {
  const match = /^speaker_(\d+)$/.exec(speaker)
  if (!match) return speaker
  return translate('Speaker {{number}}', { number: Number(match[1]) + 1 })
}

type Translate = (key: string, options?: Record<string, unknown>) => string

export function transcriptToText(
  transcript: Transcript,
  translate: Translate
): string {
  return transcript.segments
    .map((segment) => {
      const time =
        segment.start === undefined ? '' : `[${formatClock(segment.start)}] `
      const speaker = segment.speaker
        ? `${speakerLabel(segment.speaker, translate)}: `
        : ''
      return `${time}${speaker}${segment.text}`
    })
    .join('\n')
}

/** SubRip subtitles; null when the transcript has no timestamps. */
export function transcriptToSrt(
  transcript: Transcript,
  translate: Translate
): string | null {
  const timed = transcript.segments.filter(
    (segment) => segment.start !== undefined
  )
  if (timed.length === 0) return null
  return timed
    .map((segment, index) => {
      const start = segment.start ?? 0
      const end = Math.max(segment.end ?? start, start + 0.5)
      const speaker = segment.speaker
        ? `${speakerLabel(segment.speaker, translate)}: `
        : ''
      return `${index + 1}\n${formatTimestamp(start, ',')} --> ${formatTimestamp(end, ',')}\n${speaker}${segment.text}\n`
    })
    .join('\n')
}
