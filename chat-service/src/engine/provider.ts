import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

import { config } from '../config'
import { billedRelayFetch } from '../gateway/client'

/**
 * Every model call goes through the gateway's /pg relay, which owns provider
 * routing, quota, and billing for the acted-as user. The chat service never
 * talks to an upstream vendor directly and never holds vendor keys.
 */
export function userModel(
  userId: number,
  modelId: string,
  group: string
): LanguageModel {
  const provider = createOpenAICompatible({
    name: 'boxai-gateway',
    baseURL: `${config.gatewayBaseUrl}/pg`,
    fetch: billedRelayFetch(userId, group),
  })
  return provider.chatModel(modelId)
}
