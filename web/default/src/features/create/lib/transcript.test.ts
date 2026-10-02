import { describe, expect, it } from 'vitest'

import {
  encodeTranscript,
  parseTranscript,
  transcriptFromElevenLabs,
  transcriptToSrt,
  transcriptToText,
  type Transcript,
} from './transcript'

const translate = (key: string, options?: Record<string, unknown>) =>
  key.replace('{{number}}', String(options?.number ?? ''))

describe('transcriptFromElevenLabs', () => {
  it('breaks lines on speaker change and long pauses', () => {
    const transcript = transcriptFromElevenLabs(
      {
        language_code: 'vi',
        words: [
          {
            text: 'Xin',
            type: 'word',
            start: 0,
            end: 0.3,
            speaker_id: 'speaker_0',
          },
          {
            text: ' ',
            type: 'spacing',
            start: 0.3,
            end: 0.35,
            speaker_id: 'speaker_0',
          },
          {
            text: 'chào',
            type: 'word',
            start: 0.35,
            end: 0.8,
            speaker_id: 'speaker_0',
          },
          {
            text: ' ',
            type: 'spacing',
            start: 0.8,
            end: 0.9,
            speaker_id: 'speaker_1',
          },
          {
            text: 'Chào',
            type: 'word',
            start: 0.9,
            end: 1.2,
            speaker_id: 'speaker_1',
          },
          {
            text: 'anh',
            type: 'word',
            start: 3,
            end: 3.4,
            speaker_id: 'speaker_1',
          },
        ],
      },
      'meeting.mp3'
    )
    expect(transcript).toEqual({
      source: 'meeting.mp3',
      language: 'vi',
      segments: [
        { start: 0, end: 0.8, speaker: 'speaker_0', text: 'Xin chào' },
        { start: 0.9, end: 1.2, speaker: 'speaker_1', text: 'Chào' },
        { start: 3, end: 3.4, speaker: 'speaker_1', text: 'anh' },
      ],
    })
  })

  it('falls back to plain text without word timestamps', () => {
    expect(
      transcriptFromElevenLabs({ text: ' Hello world ', words: [] }, 'a.wav')
    ).toEqual({
      source: 'a.wav',
      language: undefined,
      segments: [{ text: 'Hello world' }],
    })
  })
})

describe('transcript storage', () => {
  const transcript: Transcript = {
    source: 'phỏng vấn · số 2.mp3',
    language: 'vi',
    segments: [
      {
        start: 1.2,
        end: 3.4,
        speaker: 'speaker_0',
        text: 'Xin chào mọi người',
      },
      { start: 3661.5, end: 3662, text: 'Hết giờ' },
    ],
  }

  it('round-trips speakers, timestamps and a dotted file name', () => {
    const encoded = encodeTranscript(transcript)
    expect(encoded.split('\n')[1]).toBe(
      '[00:00:01.200-00:00:03.400] speaker_0: Xin chào mọi người'
    )
    expect(parseTranscript(encoded)).toEqual(transcript)
  })

  it('does not treat ordinary prompts as transcripts', () => {
    expect(parseTranscript('Read this aloud')).toBeNull()
    expect(parseTranscript(undefined)).toBeNull()
  })

  it('exports SubRip with comma milliseconds and speaker names', () => {
    expect(transcriptToSrt(transcript, translate)).toBe(
      '1\n00:00:01,200 --> 00:00:03,400\nSpeaker 1: Xin chào mọi người\n\n' +
        '2\n01:01:01,500 --> 01:01:02,000\nHết giờ\n'
    )
    expect(transcriptToText(transcript, translate)).toBe(
      '[0:01] Speaker 1: Xin chào mọi người\n[61:01] Hết giờ'
    )
  })

  it('has no subtitles when nothing is timed', () => {
    expect(
      transcriptToSrt({ source: 'a', segments: [{ text: 'x' }] }, translate)
    ).toBeNull()
  })
})
