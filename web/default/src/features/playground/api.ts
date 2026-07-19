/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { api } from '@/lib/api'

import { API_ENDPOINTS } from './constants'
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelOption,
  GroupOption,
  GeneratedImage,
  StudioSettings,
  VideoSubmission,
} from './types'

/**
 * Send chat completion request (non-streaming)
 */
export async function sendChatCompletion(
  payload: ChatCompletionRequest,
  signal?: AbortSignal
): Promise<ChatCompletionResponse> {
  const res = await api.post(API_ENDPOINTS.CHAT_COMPLETIONS, payload, {
    signal,
    skipErrorHandler: true,
  } as Record<string, unknown>)
  return res.data
}

/**
 * Get user available models
 */
export async function getUserModels(group: string): Promise<ModelOption[]> {
  const res = await api.get(API_ENDPOINTS.USER_MODELS, {
    params: { group },
  })
  const { data } = res

  if (!data.success || !Array.isArray(data.data)) {
    return []
  }

  return data.data.map((model: string) => ({
    label: model,
    value: model,
  }))
}

/**
 * Get user groups
 */
export async function getUserGroups(): Promise<GroupOption[]> {
  const res = await api.get(API_ENDPOINTS.USER_GROUPS)
  const { data } = res

  if (!data.success || !data.data) {
    return []
  }

  const groupData = data.data as Record<string, { desc: string; ratio: number }>

  // label is for button display (name only); desc is for dropdown content
  return Object.entries(groupData).map(([group, info]) => ({
    label: group,
    value: group,
    ratio: info.ratio,
    desc: info.desc,
  }))
}

export async function generateImages(input: {
  model: string
  group: string
  prompt: string
  settings: StudioSettings
}): Promise<GeneratedImage[]> {
  const response = await api.post(API_ENDPOINTS.IMAGE_GENERATIONS, {
    model: input.model,
    group: input.group,
    prompt: input.prompt,
    n: input.settings.imageCount,
    size: input.settings.imageSize,
    quality: input.settings.imageQuality,
  })
  const items = (response.data?.data ?? []) as Array<{
    url?: string
    b64_json?: string
    revised_prompt?: string
  }>
  return items
    .map((item) => ({
      url:
        item.url ??
        (item.b64_json ? `data:image/png;base64,${item.b64_json}` : ''),
      revisedPrompt: item.revised_prompt,
    }))
    .filter((item) => item.url)
}

export async function submitVideo(input: {
  model: string
  group: string
  prompt: string
  settings: StudioSettings
}): Promise<VideoSubmission> {
  const response = await api.post(API_ENDPOINTS.VIDEO_GENERATIONS, {
    model: input.model,
    group: input.group,
    prompt: input.prompt,
    duration: input.settings.videoDuration,
    size: input.settings.videoSize,
  })
  const data = response.data?.data ?? response.data
  return {
    taskId: String(data?.task_id ?? data?.id ?? ''),
    status: data?.status,
  }
}

export async function generateSpeech(input: {
  model: string
  group: string
  text: string
  settings: StudioSettings
}): Promise<Blob> {
  const response = await api.post(
    API_ENDPOINTS.AUDIO_SPEECH,
    {
      model: input.model,
      group: input.group,
      input: input.text,
      voice: input.settings.voice,
      speed: input.settings.speed,
      response_format: input.settings.audioFormat,
    },
    { responseType: 'blob' }
  )
  return response.data as Blob
}
