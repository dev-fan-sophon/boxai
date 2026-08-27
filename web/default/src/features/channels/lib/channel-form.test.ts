import { describe, expect, it } from 'vitest'

import { ELEVENLABS_DEFAULT_MODELS, MODEL_FETCHABLE_TYPES } from '../constants'
import {
  CHANNEL_FORM_DEFAULT_VALUES,
  channelFormSchema,
  transformFormDataToCreatePayload,
} from './channel-form'
import { getChannelTypeConfig } from './channel-type-config'

describe('Codex Proxy channel form', () => {
  it('requires a strict upstream base URL', () => {
    const missing = channelFormSchema.safeParse({
      ...CHANNEL_FORM_DEFAULT_VALUES,
      type: 61,
      name: 'Codex Proxy',
      key: 'secret',
      models: 'gpt-5.6-luna',
    })
    expect(missing.success).toBe(false)

    const withV1 = channelFormSchema.safeParse({
      ...CHANNEL_FORM_DEFAULT_VALUES,
      type: 61,
      name: 'Codex Proxy',
      base_url: 'https://proxy.example/v1',
      key: 'secret',
      models: 'gpt-5.6-luna',
    })
    expect(withV1.success).toBe(false)
  })

  it('requires and serializes the Responses image host for gpt-image-2', () => {
    const missingHost = channelFormSchema.safeParse({
      ...CHANNEL_FORM_DEFAULT_VALUES,
      type: 61,
      name: 'Codex Proxy',
      base_url: 'https://proxy.example',
      key: 'secret',
      models: 'gpt-5.6-luna,gpt-image-2',
    })
    expect(missingHost.success).toBe(false)

    const parsed = channelFormSchema.parse({
      ...CHANNEL_FORM_DEFAULT_VALUES,
      type: 61,
      name: 'Codex Proxy',
      base_url: 'https://proxy.example/',
      key: 'secret',
      models: 'gpt-5.6-luna,gpt-image-2',
      image_generation_via_responses_model: ' gpt-5.6-sol ',
    })
    const payload = transformFormDataToCreatePayload(parsed)
    expect(payload.channel.base_url).toBe('https://proxy.example')
    expect(JSON.parse(payload.channel.setting || '{}')).toMatchObject({
      image_generation_via_responses_model: 'gpt-5.6-sol',
    })
  })

  it('is discoverable and uses dedicated provider metadata', () => {
    expect(MODEL_FETCHABLE_TYPES.has(61)).toBe(true)
    expect(getChannelTypeConfig(61)).toMatchObject({
      id: 61,
      name: 'Codex Proxy',
      icon: 'openai',
    })
  })
})

describe('ElevenLabs channel form', () => {
  it('exposes the official provider metadata and exactly seven audio models', () => {
    expect(MODEL_FETCHABLE_TYPES.has(62)).toBe(true)
    expect(getChannelTypeConfig(62)).toMatchObject({
      id: 62,
      name: 'ElevenLabs',
      icon: 'ElevenLabs',
      defaultBaseUrl: 'https://api.elevenlabs.io',
      supportedModels: ELEVENLABS_DEFAULT_MODELS,
    })
  })
})
