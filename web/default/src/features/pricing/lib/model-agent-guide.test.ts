import { describe, expect, it } from 'vitest'

import type { IntegrationProfile, PricingModel } from '../types'
import {
  buildModelAgentGuide,
  getModelEndpointIntegrations,
  getVerifiedModelIntegrations,
  resolveGatewayBaseUrl,
} from './model-agent-guide'

const profiles: IntegrationProfile[] = [
  {
    id: 'openai-chat',
    endpoint_type: 'openai',
    protocol: 'OpenAI-compatible',
    operation: 'chat',
    name_key: 'OpenAI Chat Completions',
    method: 'POST',
    gateway_path_template: '/v1/chat/completions',
    auth_scheme: 'bearer',
    content_type: 'application/json',
    docs_slug: 'openai-chat',
    sample_kind: 'openai_chat',
    streaming: true,
  },
  {
    id: 'claude-messages',
    endpoint_type: 'anthropic',
    protocol: 'Claude-compatible',
    operation: 'messages',
    name_key: 'Claude Messages',
    method: 'POST',
    gateway_path_template: '/v1/messages',
    auth_scheme: 'x-api-key',
    content_type: 'application/json',
    docs_slug: 'claude-messages',
    sample_kind: 'anthropic_messages',
    streaming: true,
  },
  {
    id: 'unverified',
    endpoint_type: 'unverified',
    protocol: 'Unverified',
    operation: 'chat',
    name_key: 'Unverified profile',
    method: 'POST',
    gateway_path_template: '/unverified',
    auth_scheme: 'bearer',
    content_type: 'application/json',
    docs_slug: 'unverified',
    sample_kind: 'openai_chat',
    streaming: false,
  },
  {
    id: 'openai-video',
    endpoint_type: 'openai-video',
    protocol: 'OpenAI-compatible',
    operation: 'video_create',
    name_key: 'OpenAI Video',
    method: 'POST',
    gateway_path_template: '/v1/videos',
    auth_scheme: 'bearer',
    content_type: 'application/json',
    docs_slug: 'openai-video-create',
    sample_kind: 'openai_video',
    streaming: false,
  },
]

const model: PricingModel = {
  id: 1,
  model_name: 'example/model-v1',
  display_name: 'Example Model',
  vendor_name: 'Example AI',
  description: 'A model for integration tests.',
  quota_type: 0,
  model_ratio: 1,
  completion_ratio: 1,
  enable_groups: ['default', 'pro'],
  context_length: 128_000,
  max_output_tokens: 8_192,
  input_modalities: ['text', 'image'],
  output_modalities: ['text'],
  capabilities: ['streaming', 'vision'],
  integrations: [
    {
      profile_id: 'openai-chat',
      groups: ['default', 'pro'],
      verified: true,
      source: 'explicit',
    },
    {
      profile_id: 'claude-messages',
      groups: ['pro'],
      verified: true,
      source: 'explicit',
    },
    {
      profile_id: 'unverified',
      groups: [],
      verified: false,
      source: 'inferred',
    },
  ],
}

describe('model Agent guide', () => {
  it('copies a self-contained guide with exact verified gateway usage', () => {
    const guide = buildModelAgentGuide({
      model,
      integrationProfiles: profiles,
      gatewayBaseUrl: 'https://you-box.com/',
      siteUrl: 'https://you-box.com/',
    })

    expect(guide).not.toBeNull()
    expect(guide).toContain('Exact model ID: `example/model-v1`')
    expect(guide).toContain('`POST https://you-box.com/v1/chat/completions`')
    expect(guide).toContain('Authorization: Bearer $BOXAI_API_KEY')
    expect(guide).toContain('x-api-key: $BOXAI_API_KEY')
    expect(guide).toContain('anthropic-version: 2023-06-01')
    expect(guide).toContain('https://you-box.com/pricing/example%2Fmodel-v1')
    expect(guide).not.toContain('/unverified')
    expect(guide).not.toContain('api.openai.com')
  })

  it('returns no guide when the model has no verified explicit profile', () => {
    expect(
      buildModelAgentGuide({
        model: {
          ...model,
          integrations: [
            {
              profile_id: 'unverified',
              groups: [],
              verified: false,
              source: 'inferred',
            },
          ],
        },
        integrationProfiles: profiles,
        gatewayBaseUrl: 'https://you-box.com',
      })
    ).toBeNull()
  })

  it('joins only verified explicit profiles that exist in the catalog', () => {
    expect(getVerifiedModelIntegrations(model, profiles)).toHaveLength(2)
  })

  it('derives integration guides from supported endpoint capabilities', () => {
    expect(
      getVerifiedModelIntegrations(
        {
          ...model,
          supported_endpoint_types: ['openai', 'anthropic'],
          integrations: [],
        },
        profiles.slice(0, 2)
      )
    ).toHaveLength(2)
  })

  it('marks an unknown supported endpoint unavailable without a Chat fallback', () => {
    const integrations = getModelEndpointIntegrations(
      {
        ...model,
        supported_endpoint_types: ['future-protocol'],
        integrations: [],
      },
      profiles
    )
    expect(integrations).toHaveLength(1)
    expect(integrations[0].endpointType).toBe('future-protocol')
    expect(integrations[0].profile).toBeUndefined()
    expect(
      getVerifiedModelIntegrations(
        {
          ...model,
          supported_endpoint_types: ['future-protocol'],
          integrations: [],
        },
        profiles
      )
    ).toEqual([])
  })

  it('documents the complete asynchronous workflow for image-required video', () => {
    const guide = buildModelAgentGuide({
      model: {
        ...model,
        model_name: 'grok-imagine-video-1.5',
        input_modalities: ['text', 'image'],
        output_modalities: ['video'],
        integrations: [
          {
            profile_id: 'openai-video',
            groups: ['default'],
            verified: true,
            source: 'explicit',
          },
        ],
      },
      integrationProfiles: profiles,
      gatewayBaseUrl: 'https://you-box.com',
      siteUrl: 'https://you-box.com',
    })

    expect(guide).toContain('"duration": 8')
    expect(guide).toContain('"input_reference": "https://you-box.com/logo.png"')
    expect(guide).toContain('GET https://you-box.com/v1/videos/<VIDEO_ID>')
    expect(guide).toContain(
      'GET https://you-box.com/v1/videos/<VIDEO_ID>/content'
    )
    expect(guide).toContain('--output output.mp4')
    expect(guide).toContain('requires `duration` from 1 to 15 seconds')
  })
})

describe('resolveGatewayBaseUrl', () => {
  it('supports nested status payloads and removes trailing slashes', () => {
    expect(
      resolveGatewayBaseUrl(
        { data: { serverAddress: 'https://gateway.example///' } },
        'https://fallback.example'
      )
    ).toBe('https://gateway.example')
  })

  it('falls back to the browser origin supplied by the caller', () => {
    expect(resolveGatewayBaseUrl(null, 'https://you-box.com/')).toBe(
      'https://you-box.com'
    )
  })
})
