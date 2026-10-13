import {
  buildIntegrationSample,
  integrationPath,
} from '@/features/integrations/sample-builder'

import type {
  IntegrationProfile,
  ModelIntegration,
  PricingModel,
} from '../types'

export type VerifiedModelIntegration = {
  integration: ModelIntegration
  profile: IntegrationProfile
}

export type ModelEndpointIntegration = {
  endpointType: string
  integration: ModelIntegration
  profile?: IntegrationProfile
}

export function getModelEndpointIntegrations(
  model: PricingModel,
  integrationProfiles: IntegrationProfile[]
): ModelEndpointIntegration[] {
  const profilesByEndpoint = new Map(
    integrationProfiles.map((profile) => [profile.endpoint_type, profile])
  )
  const assignmentsByProfile = new Map(
    (model.integrations ?? []).map((integration) => [
      integration.profile_id,
      integration,
    ])
  )
  const endpointTypes = [...new Set(model.supported_endpoint_types ?? [])]

  if (endpointTypes.length === 0) {
    return (model.integrations ?? [])
      .filter(
        (integration) =>
          integration.verified && integration.source === 'explicit'
      )
      .flatMap((integration) => {
        const profile = integrationProfiles.find(
          (candidate) => candidate.id === integration.profile_id
        )
        return profile
          ? [{ endpointType: profile.endpoint_type, integration, profile }]
          : []
      })
  }

  return endpointTypes.map((endpointType) => {
    const profile = profilesByEndpoint.get(endpointType)
    const integration =
      (profile && assignmentsByProfile.get(profile.id)) ||
      ({
        profile_id: profile?.id ?? '',
        groups: model.enable_groups ?? [],
        verified: false,
        source: 'inferred',
      } satisfies ModelIntegration)
    return { endpointType, integration, profile }
  })
}

export function getVerifiedModelIntegrations(
  model: PricingModel,
  integrationProfiles: IntegrationProfile[]
): VerifiedModelIntegration[] {
  return getModelEndpointIntegrations(model, integrationProfiles).flatMap(
    ({ integration, profile }) => {
      return profile ? [{ integration, profile }] : []
    }
  )
}

export function resolveGatewayBaseUrl(
  status: unknown,
  fallbackOrigin = ''
): string {
  const statusRecord =
    status && typeof status === 'object'
      ? (status as Record<string, unknown>)
      : null
  const dataRecord =
    statusRecord?.data && typeof statusRecord.data === 'object'
      ? (statusRecord.data as Record<string, unknown>)
      : null
  const candidates = [
    statusRecord?.server_address,
    statusRecord?.serverAddress,
    dataRecord?.server_address,
    dataRecord?.serverAddress,
    fallbackOrigin,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().replace(/\/+$/, '')
    }
  }
  return ''
}

export function buildModelAgentGuide(props: {
  model: PricingModel
  integrationProfiles: IntegrationProfile[]
  gatewayBaseUrl: string
  siteUrl?: string
}): string | null {
  const integrations = getVerifiedModelIntegrations(
    props.model,
    props.integrationProfiles
  )
  const gatewayBaseUrl = props.gatewayBaseUrl.replace(/\/+$/, '')
  if (!gatewayBaseUrl || integrations.length === 0) return null

  const siteUrl = props.siteUrl?.replace(/\/+$/, '')
  const displayName = props.model.display_name?.trim()
  const description =
    props.model.description?.trim() || props.model.vendor_description?.trim()
  const modelGroups = (props.model.enable_groups ?? []).filter(
    (group) => group && group !== 'auto'
  )
  const modelPageUrl = siteUrl
    ? `${siteUrl}/pricing/${encodeURIComponent(props.model.model_name)}`
    : ''
  const modelFacts = [
    `- Exact model ID: \`${props.model.model_name}\``,
    displayName && displayName !== props.model.model_name
      ? `- Display name: ${displayName}`
      : '',
    props.model.vendor_name ? `- Provider: ${props.model.vendor_name}` : '',
    description ? `- Description: ${description}` : '',
    props.model.context_length
      ? `- Context window: ${props.model.context_length.toLocaleString('en-US')} tokens`
      : '',
    props.model.max_output_tokens
      ? `- Maximum output: ${props.model.max_output_tokens.toLocaleString('en-US')} tokens`
      : '',
    props.model.input_modalities?.length
      ? `- Input modalities: ${props.model.input_modalities.join(', ')}`
      : '',
    props.model.output_modalities?.length
      ? `- Output modalities: ${props.model.output_modalities.join(', ')}`
      : '',
    props.model.capabilities?.length
      ? `- Capabilities: ${props.model.capabilities.join(', ')}`
      : '',
    modelGroups.length > 0
      ? `- Available groups: ${modelGroups.join(', ')}`
      : '',
    props.model.usage_notes?.trim()
      ? `- Usage notes: ${props.model.usage_notes.trim()}`
      : '',
    modelPageUrl ? `- Model details: ${modelPageUrl}` : '',
  ].filter(Boolean)

  const integrationSections = integrations.map(({ integration, profile }) => {
    const route = integrationPath(profile, props.model.model_name)
    const endpoint = `${gatewayBaseUrl}${route}`
    const auth =
      profile.auth_scheme === 'x-api-key'
        ? 'Send `x-api-key: $BOXAI_API_KEY`. Also send `anthropic-version: 2023-06-01` for Claude-compatible requests.'
        : 'Send `Authorization: Bearer $BOXAI_API_KEY`.'
    const groupScope =
      integration.groups.length > 0
        ? integration.groups.join(', ')
        : 'all groups where the model is available'
    const guideUrl = siteUrl ? `${siteUrl}/docs/api/${profile.docs_slug}` : ''
    const sample = buildIntegrationSample(
      profile,
      props.model.model_name,
      'curl',
      gatewayBaseUrl
    )
    const operationGuidance: string[] = []
    const followUpExamples: string[] = []

    if (profile.sample_kind === 'openai_images') {
      operationGuidance.push(
        '- Result: read the generated image from `data[0].url` or `data[0].b64_json`, according to the response.'
      )
    }
    if (profile.sample_kind === 'openai_video') {
      operationGuidance.push(
        '- Workflow: asynchronous. The create response returns a public task ID in `id` (and the legacy alias `task_id`).',
        `- Poll status: \`GET ${gatewayBaseUrl}/v1/videos/<VIDEO_ID>\` with the same bearer token until \`status\` is \`completed\` or \`failed\`.`,
        `- Download: after completion, call \`GET ${gatewayBaseUrl}/v1/videos/<VIDEO_ID>/content\` with the same bearer token.`
      )
      if (props.model.model_name === 'grok-imagine-video-1.5') {
        operationGuidance.push(
          '- Input requirement: this model is image-to-video and requires `input_reference` as an accessible image URL or data URL. It also requires `duration` from 1 to 15 seconds.'
        )
      } else {
        operationGuidance.push(
          '- Input mode: the verified example is text-to-video and does not invent a reference image.'
        )
      }
      followUpExamples.push(
        '',
        'After replacing `<VIDEO_ID>` with the `id` returned by the create call:',
        '',
        '```bash',
        `curl ${JSON.stringify(`${gatewayBaseUrl}/v1/videos/<VIDEO_ID>`)} \\`,
        '  -H "Authorization: Bearer $BOXAI_API_KEY"',
        '',
        `curl ${JSON.stringify(`${gatewayBaseUrl}/v1/videos/<VIDEO_ID>/content`)} \\`,
        '  -H "Authorization: Bearer $BOXAI_API_KEY" \\',
        '  --output output.mp4',
        '```'
      )
    }

    return [
      `### ${profile.name_key}`,
      '',
      `- Protocol: ${profile.protocol}`,
      `- Request: \`${profile.method} ${endpoint}\``,
      `- Authentication: ${auth}`,
      `- Streaming: ${profile.streaming ? 'supported' : 'not supported'}`,
      `- Group scope: ${groupScope}`,
      guideUrl ? `- Full guide: ${guideUrl}` : null,
      ...operationGuidance,
      '',
      '```bash',
      sample,
      '```',
      ...followUpExamples,
    ]
      .filter((line): line is string => line !== null)
      .join('\n')
  })

  return [
    `# Use ${displayName || props.model.model_name} through BoxAI`,
    '',
    'This is a self-contained integration guide for an AI coding Agent. Integrate the model into the current project using one of the supported endpoint profiles below.',
    '',
    '## Required rules',
    '',
    `1. Send requests only to the BoxAI gateway at \`${gatewayBaseUrl}\`; do not replace it with an upstream provider host.`,
    `2. Use the exact model ID \`${props.model.model_name}\`; do not guess an alias or substitute another model.`,
    '3. Read the API key from the `BOXAI_API_KEY` environment variable or the project secret manager. Never hard-code, log, commit, or expose the key in browser code.',
    '4. Prefer the existing SDK or HTTP client already used by the project. Match its configuration to a supported profile below.',
    '5. If `BOXAI_API_KEY` is missing, ask the user to create or export one. Do not ask them to paste the secret into source code or chat.',
    '6. Use only the endpoint operations listed below; do not substitute Chat Completions for another capability.',
    '',
    '## Model facts',
    '',
    ...modelFacts,
    '',
    '## Supported integration profiles',
    '',
    ...integrationSections,
    '',
    '## Verification',
    '',
    'After integrating, send the smallest valid test request, require a successful HTTP response, and report the selected profile and endpoint. For `401` or `403`, check the key, authentication header, model access, and group scope; do not retry unchanged.',
  ].join('\n')
}
