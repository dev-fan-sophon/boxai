import { z } from 'zod'

export const chatRequestSchema = z.object({
  conversationId: z.number().int().positive().optional(),
  model: z.string().min(1).max(191),
  group: z.string().max(50).optional(),
  system: z.string().max(20_000).optional(),
  carryHistory: z.boolean().optional(),
  longMemory: z.boolean().optional(),
  maxSteps: z.number().int().min(1).max(21).optional(),
  reasoning: z
    .enum([
      'provider-default',
      'none',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ])
    .optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
  toolMode: z
    .enum(['auto', 'image', 'video', 'search', 'document'])
    .optional(),
  source: z.enum(['web', 'desktop']).optional(),
  trigger: z
    .enum(['submit-message', 'regenerate-message'])
    .default('submit-message'),
  messageId: z.string().min(1).max(64).optional(),
  requestKey: z.string().uuid(),
  message: z.unknown().optional(),
})
