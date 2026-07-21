/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import type { IntegrationProfile } from '@/features/pricing/types'

export type SampleLanguage = 'curl' | 'python' | 'typescript' | 'javascript'

export function integrationPath(
  profile: IntegrationProfile,
  model: string
): string {
  return profile.gateway_path_template.replace(
    '{model}',
    encodeURIComponent(model)
  )
}

function requestPayload(kind: string, model: string): Record<string, unknown> {
  switch (kind) {
    case 'gemini_generate_content':
      return { contents: [{ parts: [{ text: 'Hello' }] }] }
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
    case 'openai_images':
      return { model, prompt: 'A calm mountain lake' }
    case 'openai_audio_speech':
      return { model, voice: 'alloy', input: 'Hello' }
    default:
      return { model, messages: [{ role: 'user', content: 'Hello' }] }
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
  const isTranscription = profile.sample_kind === 'openai_audio_transcriptions'
  const filename = isTranscription ? 'audio.mp3' : 'reference.png'
  const fileField = isTranscription ? 'file' : 'input_reference'
  const extraField = isTranscription
    ? ''
    : "\n  'prompt': 'A paper plane in flight',"
  if (language === 'curl') {
    const prompt = isTranscription
      ? ''
      : " \\\n  -F 'prompt=A paper plane in flight'"
    return `curl -X ${profile.method} ${JSON.stringify(url)} \\
  -H "Authorization: Bearer $BOXAI_API_KEY" \\
  -F ${JSON.stringify(`${fileField}=@${filename}`)} \\
  -F ${JSON.stringify(`model=${model}`)}${prompt}`
  }
  if (language === 'python') {
    return `import os
import requests

with open(${JSON.stringify(filename)}, 'rb') as media:
    response = requests.${profile.method.toLowerCase()}(
        ${JSON.stringify(url)},
        headers={'Authorization': f"Bearer {os.environ['BOXAI_API_KEY']}"},
        files={${JSON.stringify(fileField)}: media},
        data={'model': ${JSON.stringify(model)},${extraField}
        },
    )
response.raise_for_status()
${profile.sample_kind === 'openai_audio_speech' ? 'audio = response.content' : 'print(response.json())'}`
  }
  return `import { openAsBlob } from 'node:fs'

const file = await openAsBlob(${JSON.stringify(filename)})
const form = new FormData()
form.append(${JSON.stringify(fileField)}, file, ${JSON.stringify(filename)})
form.append('model', ${JSON.stringify(model)})${isTranscription ? '' : "\nform.append('prompt', 'A paper plane in flight')"}

const response = await fetch(${JSON.stringify(url)}, {
  method: ${JSON.stringify(profile.method)},
  headers: { Authorization: 'Bearer ' + process.env.BOXAI_API_KEY },
  body: form, // Do not set Content-Type; the runtime adds the multipart boundary.
})
console.log(await response.json())`
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
    profile.sample_kind === 'openai_audio_transcriptions' ||
    profile.sample_kind === 'openai_video'
  ) {
    return multipartSample(profile, model, language, url)
  }
  if (profile.sample_kind === 'openai_realtime') {
    return realtimeSample(language, url)
  }

  const payload = requestPayload(profile.sample_kind, model)
  const headers = {
    ...authHeaders(profile),
    'Content-Type': profile.content_type,
  }
  if (language === 'curl') {
    const headerFlags = Object.entries(headers)
      .map(([name, value]) => `  -H ${JSON.stringify(`${name}: ${value}`)} \\`)
      .join('\n')
    const output =
      profile.sample_kind === 'openai_audio_speech'
        ? ' \\\n  --output speech.mp3'
        : ''
    return `curl -X ${profile.method} ${JSON.stringify(url)} \\
${headerFlags}
  -d '${JSON.stringify(payload, null, 2)}'${output}`
  }
  if (language === 'python') {
    const pythonHeaders =
      profile.auth_scheme === 'x-api-key'
        ? `{'x-api-key': os.environ['BOXAI_API_KEY'], 'anthropic-version': '2023-06-01', 'Content-Type': ${JSON.stringify(profile.content_type)}}`
        : `{'Authorization': f"Bearer {os.environ['BOXAI_API_KEY']}", 'Content-Type': ${JSON.stringify(profile.content_type)}}`
    const pythonResult =
      profile.sample_kind === 'openai_audio_speech'
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
  const responseHandling =
    profile.sample_kind === 'openai_audio_speech'
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
