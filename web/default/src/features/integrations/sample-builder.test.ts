/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { describe, expect, it } from 'vitest'

import type { IntegrationProfile } from '@/features/pricing/types'

import { buildIntegrationSample } from './sample-builder'

function profile(
  sampleKind: string,
  path: string,
  authScheme = 'bearer',
  contentType = 'application/json'
): IntegrationProfile {
  return {
    id: sampleKind,
    protocol: 'test',
    operation: sampleKind,
    name_key: sampleKind,
    method: sampleKind === 'openai_realtime' ? 'GET' : 'POST',
    gateway_path_template: path,
    auth_scheme: authScheme,
    content_type: contentType,
    docs_slug: sampleKind,
    sample_kind: sampleKind,
    streaming: false,
  }
}

describe('buildIntegrationSample', () => {
  const gateway = 'https://gateway.boxai.test'

  it('routes Gemini through the supplied gateway with encoded model substitution and bearer auth', () => {
    const sample = buildIntegrationSample(
      profile(
        'gemini_generate_content',
        '/v1beta/models/{model}:generateContent'
      ),
      'gemini 2/pro',
      'curl',
      gateway
    )
    expect(sample).toContain(
      `${gateway}/v1beta/models/gemini%202%2Fpro:generateContent`
    )
    expect(sample).toContain('Authorization: Bearer $BOXAI_API_KEY')
    expect(sample).toContain('contents')
  })

  it('uses the rerank query and documents payload rather than chat messages', () => {
    const sample = buildIntegrationSample(
      profile('jina_rerank', '/v1/rerank'),
      'reranker',
      'curl',
      gateway
    )
    expect(sample).toContain('"query"')
    expect(sample).toContain('"documents"')
    expect(sample).not.toContain('"messages"')
  })

  it('adds both required Claude gateway headers', () => {
    for (const language of [
      'curl',
      'python',
      'typescript',
      'javascript',
    ] as const) {
      const sample = buildIntegrationSample(
        profile('anthropic_messages', '/v1/messages', 'x-api-key'),
        'claude',
        language,
        gateway
      )
      expect(sample).toContain('x-api-key')
      expect(sample).toContain('anthropic-version')
    }
  })

  it('keeps Responses input distinct from Chat Completions messages', () => {
    const responses = buildIntegrationSample(
      profile('openai_responses', '/v1/responses'),
      'model',
      'javascript',
      gateway
    )
    const chat = buildIntegrationSample(
      profile('openai_chat', '/v1/chat/completions'),
      'model',
      'javascript',
      gateway
    )
    expect(responses).toContain('"input"')
    expect(responses).not.toContain('"messages"')
    expect(chat).toContain('"messages"')
  })

  it('builds honest multipart transcription samples', () => {
    const sample = buildIntegrationSample(
      profile(
        'openai_audio_transcriptions',
        '/v1/audio/transcriptions',
        'bearer',
        'multipart/form-data'
      ),
      'whisper',
      'python',
      gateway
    )
    expect(sample).toContain('files={"file": media}')
    expect(sample).toContain('open("audio.mp3", \'rb\')')
    expect(sample).not.toContain('json=')

    const javascript = buildIntegrationSample(
      profile(
        'openai_audio_transcriptions',
        '/v1/audio/transcriptions',
        'bearer',
        'multipart/form-data'
      ),
      'whisper',
      'javascript',
      gateway
    )
    expect(javascript).toContain("openAsBlob(\"audio.mp3\")")
    expect(javascript).toContain('form.append("file", file, "audio.mp3")')
  })

  it('uses executable server-side environment expressions in JavaScript samples', () => {
    for (const language of ['javascript', 'typescript'] as const) {
      const sample = buildIntegrationSample(
        profile('openai_chat', '/v1/chat/completions'),
        'YOUR_MODEL_ID',
        language,
        gateway
      )
      expect(sample).toContain('`Bearer ${process.env.BOXAI_API_KEY}`')
      expect(sample).not.toMatch(/\bBOXAI_API_KEY\b(?!\})/)
      expect(sample).toContain('YOUR_MODEL_ID')
    }
  })

  it('uses the video input_reference field without patch-marker artifacts', () => {
    const sample = buildIntegrationSample(
      profile('openai_video', '/v1/videos', 'bearer', 'multipart/form-data'),
      'video-model',
      'curl',
      gateway
    )
    expect(sample).toContain('input_reference=@reference.png')
    expect(sample).not.toContain('\n+  -F')
  })

  it('handles speech output as binary in Python and JavaScript', () => {
    const speech = profile('openai_audio_speech', '/v1/audio/speech')
    const curl = buildIntegrationSample(speech, 'tts', 'curl', gateway)
    expect(curl).toContain("}' \\\n  --output speech.mp3")
    expect(buildIntegrationSample(speech, 'tts', 'python', gateway)).toContain(
      "write_bytes(response.content)"
    )
    const javascript = buildIntegrationSample(
      speech,
      'tts',
      'javascript',
      gateway
    )
    expect(javascript).toContain('response.arrayBuffer()')
    expect(javascript).toContain("writeFile('speech.mp3'")
    expect(javascript).not.toContain('response.json()')
  })

  it('uses a WebSocket URL and handshake guidance for realtime', () => {
    const sample = buildIntegrationSample(
      profile('openai_realtime', '/v1/realtime?model={model}'),
      'realtime',
      'curl',
      gateway
    )
    expect(sample).toContain(
      'wss://gateway.boxai.test/v1/realtime?model=realtime'
    )
    expect(sample).toContain('npx wscat')
    expect(sample).toContain('session.update')
  })

  it('uses an executable server-side WebSocket client for realtime JavaScript', () => {
    for (const language of ['javascript', 'typescript'] as const) {
      const sample = buildIntegrationSample(
        profile('openai_realtime', '/v1/realtime?model={model}'),
        'realtime',
        language,
        gateway
      )
      expect(sample).toContain("import WebSocket from 'ws'")
      expect(sample).toContain('process.env.BOXAI_API_KEY')
      expect(sample).toContain("socket.on('message'")
      expect(sample).not.toContain('addEventListener')
    }
  })

  it('never introduces upstream provider hosts', () => {
    const kinds = ['gemini_generate_content', 'openai_chat', 'openai_responses']
    for (const kind of kinds) {
      const sample = buildIntegrationSample(
        profile(kind, '/v1/example'),
        'model',
        'python',
        gateway
      )
      expect(sample).not.toMatch(
        /generativelanguage\.googleapis\.com|api\.openai\.com/
      )
      expect(sample).toContain(gateway)
    }
  })
})
