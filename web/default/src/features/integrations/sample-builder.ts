import type { IntegrationProfile } from '@/features/pricing/types'

export type SampleLanguage = 'curl' | 'python' | 'typescript' | 'javascript'

export function integrationPath(
  profile: IntegrationProfile,
  model: string
): string {
  return profile.gateway_path_template
    .replaceAll('{model}', encodeURIComponent(model))
    .replaceAll('{voice_id}', 'VOICE_ID')
}

function requestPayload(
  kind: string,
  model: string,
  baseUrl: string
): Record<string, unknown> {
  switch (kind) {
    case 'openai_chat':
      return { model, messages: [{ role: 'user', content: 'Hello' }] }
    case 'gemini_generate_content':
      return { contents: [{ parts: [{ text: 'Hello' }] }] }
    case 'gemini_embeddings':
      return { content: { parts: [{ text: 'Hello' }] } }
    case 'jina_rerank':
      return {
        model,
        query: 'What is BoxAI?',
        documents: ['BoxAI is an AI gateway.', 'This document is unrelated.'],
      }
    case 'openai_embeddings':
      return { model, input: 'Hello' }
    case 'anthropic_messages':
      return {
        model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
      }
    case 'openai_responses':
    case 'openai_responses_compact':
      return { model, input: 'Hello' }
    case 'openai_alpha_search':
      return { model, input: 'Find the most relevant answer to this query.' }
    case 'openai_images':
      return { model, prompt: 'A calm mountain lake' }
    case 'openai_video': {
      const request: Record<string, unknown> = {
        model,
        prompt: 'A paper plane flying over a calm mountain lake',
        duration: 8,
      }
      if (model === 'grok-imagine-video-1.5') {
        request.prompt =
          'Animate the reference image with a gentle camera orbit and subtle motion'
        request.input_reference = `${baseUrl || 'https://you-box.com'}/logo.png`
      }
      return request
    }
    case 'openai_audio_speech':
      return { model, voice: 'alloy', input: 'Hello' }
    case 'elevenlabs_audio_tts':
      return { model, voice: 'VOICE_ID', input: 'Hello from BoxAI' }
    case 'elevenlabs_audio_sfx':
      return {
        model_id: model,
        text: 'A cinematic transition with a soft impact',
        duration_seconds: 5,
      }
    case 'elevenlabs_audio_music':
      return {
        model_id: model,
        prompt: 'A warm ambient instrumental with a gentle pulse',
        music_length_ms: 30_000,
      }
    default:
      throw new Error(`Unsupported integration sample kind: ${kind}`)
  }
}

function authHeaders(profile: IntegrationProfile): Record<string, string> {
  if (profile.auth_scheme === 'x-api-key') {
    return {
      'x-api-key': '$BOXAI_API_KEY',
      'anthropic-version': '2023-06-01',
    }
  }
  return { Authorization: 'Bearer $BOXAI_API_KEY' }
}

function multipartSample(
  profile: IntegrationProfile,
  model: string,
  language: SampleLanguage,
  url: string
): string {
  const kind = profile.sample_kind
  const filename = 'audio.mp3'
  let fileField = 'file'
  const fields: Record<string, string> = {}
  switch (kind) {
    case 'openai_audio_transcriptions':
    case 'elevenlabs_audio_stt':
      fields.model = model
      break
    case 'elevenlabs_audio_sts':
    case 'elevenlabs_audio_isolation':
      fileField = 'audio'
      fields.model_id = model
      break
    case 'elevenlabs_audio_alignment':
      fields.model_id = model
      fields.text = 'Hello from BoxAI'
      break
    default:
      throw new Error(`Unsupported multipart sample kind: ${kind}`)
  }
  if (language === 'curl') {
    const fieldFlags = Object.entries(fields)
      .map(([name, value]) => ` \\\n  -F ${JSON.stringify(`${name}=${value}`)}`)
      .join('')
    return `curl -X ${profile.method} ${JSON.stringify(url)} \\
  -H "Authorization: Bearer $BOXAI_API_KEY" \\
  -F ${JSON.stringify(`${fileField}=@${filename}`)}${fieldFlags}`
  }
  if (language === 'python') {
    const pythonFields = Object.entries(fields)
      .map(
        ([name, value]) => `${JSON.stringify(name)}: ${JSON.stringify(value)}`
      )
      .join(', ')
    return `import os
import requests

with open(${JSON.stringify(filename)}, 'rb') as media:
    response = requests.${profile.method.toLowerCase()}(
        ${JSON.stringify(url)},
        headers={'Authorization': f"Bearer {os.environ['BOXAI_API_KEY']}"},
        files={${JSON.stringify(fileField)}: media},
        data={${pythonFields}},
    )
response.raise_for_status()
${isBinarySample(kind) ? "open('output.mp3', 'wb').write(response.content)" : 'print(response.json())'}`
  }
  const formFields = Object.entries(fields)
    .map(
      ([name, value]) =>
        `form.append(${JSON.stringify(name)}, ${JSON.stringify(value)})`
    )
    .join('\n')
  const responseHandling = isBinarySample(kind)
    ? `const { writeFile } = await import('node:fs/promises')
await writeFile('output.mp3', Buffer.from(await response.arrayBuffer()))`
    : 'console.log(await response.json())'
  return `import { openAsBlob } from 'node:fs'

const file = await openAsBlob(${JSON.stringify(filename)})
const form = new FormData()
form.append(${JSON.stringify(fileField)}, file, ${JSON.stringify(filename)})
${formFields}

const response = await fetch(${JSON.stringify(url)}, {
  method: ${JSON.stringify(profile.method)},
  headers: { Authorization: 'Bearer ' + process.env.BOXAI_API_KEY },
  body: form, // Do not set Content-Type; the runtime adds the multipart boundary.
})
${responseHandling}`
}

function isBinarySample(kind: string): boolean {
  return [
    'openai_audio_speech',
    'elevenlabs_audio_tts',
    'elevenlabs_audio_sts',
    'elevenlabs_audio_sfx',
    'elevenlabs_audio_music',
    'elevenlabs_audio_isolation',
  ].includes(kind)
}

function realtimeSample(language: SampleLanguage, url: string): string {
  const websocketUrl = url.replace(/^http/, 'ws')
  if (language === 'python') {
    return `import asyncio
import os
import websockets

async def main():
    async with websockets.connect(
        ${JSON.stringify(websocketUrl)},
        additional_headers={'Authorization': f"Bearer {os.environ['BOXAI_API_KEY']}"},
    ) as socket:
        await socket.send('{"type":"session.update","session":{"modalities":["text"]}}')
        print(await socket.recv())

asyncio.run(main())`
  }
  if (language === 'curl') {
    return `npx wscat -c ${JSON.stringify(websocketUrl)} \\
  -H "Authorization: Bearer $BOXAI_API_KEY"
# After connecting, send:
> {"type":"session.update","session":{"modalities":["text"]}}`
  }
  const typeAnnotation = language === 'typescript' ? ': WebSocket.RawData' : ''
  return `// npm install ws
import WebSocket from 'ws'

const socket = new WebSocket(${JSON.stringify(websocketUrl)}, {
  headers: { Authorization: 'Bearer ' + process.env.BOXAI_API_KEY },
})
socket.on('open', () => {
  socket.send(JSON.stringify({ type: 'session.update', session: { modalities: ['text'] } }))
})
socket.on('message', (data${typeAnnotation}) => console.log(data.toString()))`
}

export function buildIntegrationSample(
  profile: IntegrationProfile,
  model: string,
  language: SampleLanguage,
  baseUrl = ''
): string {
  const url = `${baseUrl.replace(/\/$/, '')}${integrationPath(profile, model)}`
  if (
    [
      'openai_audio_transcriptions',
      'elevenlabs_audio_stt',
      'elevenlabs_audio_sts',
      'elevenlabs_audio_isolation',
      'elevenlabs_audio_alignment',
    ].includes(profile.sample_kind)
  ) {
    return multipartSample(profile, model, language, url)
  }
  if (profile.sample_kind === 'openai_realtime') {
    return realtimeSample(language, url)
  }

  const payload = requestPayload(
    profile.sample_kind,
    model,
    baseUrl.replace(/\/$/, '')
  )
  const contentType =
    profile.sample_kind === 'openai_video'
      ? 'application/json'
      : profile.content_type
  const headers = {
    ...authHeaders(profile),
    'Content-Type': contentType,
  }
  if (language === 'curl') {
    const headerFlags = Object.entries(headers)
      .map(([name, value]) => `  -H ${JSON.stringify(`${name}: ${value}`)} \\`)
      .join('\n')
    const output = isBinarySample(profile.sample_kind)
      ? ' \\\n  --output speech.mp3'
      : ''
    return `curl -X ${profile.method} ${JSON.stringify(url)} \\
${headerFlags}
  -d '${JSON.stringify(payload, null, 2)}'${output}`
  }
  if (language === 'python') {
    const pythonHeaders =
      profile.auth_scheme === 'x-api-key'
        ? `{'x-api-key': os.environ['BOXAI_API_KEY'], 'anthropic-version': '2023-06-01', 'Content-Type': ${JSON.stringify(contentType)}}`
        : `{'Authorization': f"Bearer {os.environ['BOXAI_API_KEY']}", 'Content-Type': ${JSON.stringify(contentType)}}`
    const pythonResult = isBinarySample(profile.sample_kind)
      ? `from pathlib import Path
Path('speech.mp3').write_bytes(response.content)`
      : 'print(response.json())'
    return `import os
import requests

response = requests.${profile.method.toLowerCase()}(
    ${JSON.stringify(url)},
    headers=${pythonHeaders},
    json=${JSON.stringify(payload, null, 4).replaceAll('"', "'")},
)
response.raise_for_status()
${pythonResult}`
  }
  const jsHeaderLines = Object.entries(headers).map(([name, value]) => {
    let expression = JSON.stringify(value)
    if (value === '$BOXAI_API_KEY') {
      expression = 'process.env.BOXAI_API_KEY'
    } else if (value === 'Bearer $BOXAI_API_KEY') {
      expression = '`Bearer ${process.env.BOXAI_API_KEY}`'
    }
    return `    ${JSON.stringify(name)}: ${expression},`
  })
  const responseHandling = isBinarySample(profile.sample_kind)
    ? `const { writeFile } = await import('node:fs/promises')
await writeFile('speech.mp3', Buffer.from(await response.arrayBuffer()))`
    : 'console.log(await response.json())'
  return `const response = await fetch(${JSON.stringify(url)}, {
  method: ${JSON.stringify(profile.method)},
  headers: {
${jsHeaderLines.join('\n')}
  },
  body: JSON.stringify(${JSON.stringify(payload, null, 2)}),
})
${responseHandling}`
}
