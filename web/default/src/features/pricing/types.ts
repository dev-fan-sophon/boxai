import type { LanguageModelCallOptions } from 'ai'

// ----------------------------------------------------------------------------
// Pricing Types
// ----------------------------------------------------------------------------

export type ReasoningLevel = NonNullable<LanguageModelCallOptions['reasoning']>
export type ReasoningEffort = Exclude<ReasoningLevel, 'provider-default'>

export type PricingVendor = {
  id: number
  name: string
  icon?: string
  description?: string
}

export type PricingModel = {
  id: number
  model_name: string
  description?: string
  icon?: string
  vendor_id?: number
  vendor_name?: string
  vendor_icon?: string
  vendor_description?: string
  quota_type: number
  model_ratio: number
  completion_ratio: number
  model_price?: number
  cache_ratio?: number | null
  create_cache_ratio?: number | null
  image_ratio?: number | null
  audio_ratio?: number | null
  audio_completion_ratio?: number | null
  enable_groups: string[]
  tags?: string
  supported_endpoint_types?: string[]
  display_name?: string
  official_discount?: number
  integrations?: ModelIntegration[]
  usage_notes?: string
  key?: string
  group_ratio?: Record<string, number>
  /** Billing mode (e.g. "tiered_expr") used to flag dynamic pricing */
  billing_mode?: string
  /** Raw expression describing dynamic / tiered billing */
  billing_expr?: string
  /** Pricing version returned by backend, useful for cache busting */
  pricing_version?: string
  /**
   * Optional model metadata fields reserved for backend-provided catalog data.
   * Keep them data-driven; do not synthesize display values on the client.
   */
  context_length?: number
  max_output_tokens?: number
  knowledge_cutoff?: string
  release_date?: string
  parameter_count?: string
  input_modalities?: Modality[]
  output_modalities?: Modality[]
  capabilities?: ModelCapability[]
  /** Native AI SDK reasoning levels explicitly supported by this model. */
  reasoning_efforts?: ReasoningEffort[]
}

export type IntegrationProfile = {
  id: string
  protocol: string
  operation: string
  name_key: string
  method: string
  gateway_path_template: string
  auth_scheme: 'bearer' | 'x-api-key' | string
  content_type: string
  docs_slug: string
  sample_kind: string
  streaming: boolean
}

export type ModelIntegration = {
  profile_id: string
  groups: string[]
  verified: boolean
  source: 'explicit' | 'inferred'
}

/**
 * Input/output modalities supported by a model. `pdf` and `file` are both in
 * use: imported model metadata spells document input as `pdf`, while models
 * edited in the admin UI historically stored `file`.
 */
export type Modality = 'text' | 'image' | 'audio' | 'video' | 'file' | 'pdf'

/** Functional capabilities a model exposes. */
export type ModelCapability =
  | 'function_calling'
  | 'streaming'
  | 'vision'
  | 'json_mode'
  | 'structured_output'
  | 'reasoning'
  | 'tools'
  | 'system_prompt'
  | 'web_search'
  | 'code_interpreter'
  | 'caching'
  | 'embeddings'

export type PricingData = {
  success: boolean
  message?: string
  data: PricingModel[]
  vendors: PricingVendor[]
  group_ratio: Record<string, number>
  usable_group: Record<string, string | { desc: string; ratio: number }>
  supported_endpoint: Record<string, { path?: string; method?: string }>
  integration_profiles?: IntegrationProfile[]
  auto_groups: string[]
  legacy_playground_catalog?: boolean
}

export type TokenUnit = 'M' | 'K'
export type PriceType =
  | 'input'
  | 'output'
  | 'cache'
  | 'create_cache'
  | 'image'
  | 'audio_input'
  | 'audio_output'
export type QuotaType = 0 | 1 // 0: token-based, 1: per-request
