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

export function getVerifiedModelIntegrations(
  model: PricingModel,
  integrationProfiles: IntegrationProfile[]
): VerifiedModelIntegration[] {
  return (model.integrations ?? [])
    .filter(
      (integration) => integration.verified && integration.source === 'explicit'
    )
    .flatMap((integration) => {
      const profile = integrationProfiles.find(
        (candidate) => candidate.id === integration.profile_id
      )
      return profile ? [{ integration, profile }] : []
    })
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

    return [
      `### ${profile.name_key}`,
      '',
      `- Protocol: ${profile.protocol}`,
      `- Request: \`${profile.method} ${endpoint}\``,
      `- Authentication: ${auth}`,
      `- Streaming: ${profile.streaming ? 'supported' : 'not supported'}`,
      `- Group scope: ${groupScope}`,
      guideUrl ? `- Full guide: ${guideUrl}` : '',
      '',
      '```bash',
      sample,
      '```',
    ]
      .filter(Boolean)
      .join('\n')
  })

  return [
    `# Use ${displayName || props.model.model_name} through BoxAI`,
    '',
    'This is a self-contained integration guide for an AI coding Agent. Integrate the model into the current project using one of the verified profiles below.',
    '',
    '## Required rules',
    '',
    `1. Send requests only to the BoxAI gateway at \`${gatewayBaseUrl}\`; do not replace it with an upstream provider host.`,
    `2. Use the exact model ID \`${props.model.model_name}\`; do not guess an alias or substitute another model.`,
    '3. Read the API key from the `BOXAI_API_KEY` environment variable or the project secret manager. Never hard-code, log, commit, or expose the key in browser code.',
    '4. Prefer the existing SDK or HTTP client already used by the project. Match its configuration to a verified profile below.',
    '5. If `BOXAI_API_KEY` is missing, ask the user to create or export one. Do not ask them to paste the secret into source code or chat.',
    '',
    '## Model facts',
    '',
    ...modelFacts,
    '',
    '## Verified integration profiles',
    '',
    ...integrationSections,
    '',
    '## Verification',
    '',
    'After integrating, send the smallest valid test request, require a successful HTTP response, and report the selected profile and endpoint. For `401` or `403`, check the key, authentication header, model access, and group scope; do not retry unchanged.',
  ].join('\n')
}
