import { sendChatCompletion } from '@/features/playground/api'

export type StoryboardShotDraft = {
  plotDescription: string
  imageGenerationPrompt: string
  videoMotionPrompt: string
  durationSeconds: number
}

const SHOT_SYSTEM_PROMPT = [
  'You are a film storyboard assistant.',
  'Split the user idea into sequential shots.',
  'Reply with JSON only, no prose and no markdown fences.',
  'Schema: {"shots":[{"plot":string,"image_prompt":string,"video_prompt":string,"duration":number}]}',
  'plot is a short beat description, image_prompt is a detailed still-frame prompt,',
  'video_prompt describes camera and subject motion, duration is seconds between 2 and 10.',
].join(' ')

function stripCodeFence(content: string): string {
  const trimmed = content.trim()
  if (!trimmed.startsWith('```')) return trimmed
  return trimmed
    .replace(/^```[\da-z]*\s*/i, '')
    .replace(/```$/, '')
    .trim()
}

function readShotArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object') {
    const shots = (parsed as { shots?: unknown }).shots
    if (Array.isArray(shots)) return shots
  }
  return []
}

function readString(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

/** Parses the model reply into storyboard rows, tolerating fences and key aliases. */
export function parseStoryboardShots(content: string): StoryboardShotDraft[] {
  const cleaned = stripCodeFence(content)
  const start = cleaned.search(/[[{]/)
  if (start < 0) return []
  const candidate = cleaned.slice(start)

  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch {
    const lastBracket = Math.max(
      candidate.lastIndexOf(']'),
      candidate.lastIndexOf('}')
    )
    if (lastBracket < 0) return []
    try {
      parsed = JSON.parse(candidate.slice(0, lastBracket + 1))
    } catch {
      return []
    }
  }

  return readShotArray(parsed)
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object'
    )
    .map((item) => {
      const plot = readString(item, ['plot', 'plotDescription', 'description'])
      const imagePrompt = readString(item, [
        'image_prompt',
        'imagePrompt',
        'imageGenerationPrompt',
      ])
      const videoPrompt = readString(item, [
        'video_prompt',
        'videoPrompt',
        'videoMotionPrompt',
        'motion',
      ])
      const duration = Number(item.duration ?? item.durationSeconds)
      return {
        plotDescription: plot || imagePrompt,
        imageGenerationPrompt: imagePrompt || plot,
        videoMotionPrompt: videoPrompt,
        durationSeconds:
          Number.isFinite(duration) && duration > 0
            ? Math.min(30, Math.round(duration * 2) / 2)
            : 5,
      }
    })
    .filter((shot) => shot.imageGenerationPrompt.length > 0)
}

export async function requestStoryboardShots(input: {
  model: string
  group: string
  idea: string
  shotCount: number
  style?: string
  signal?: AbortSignal
}): Promise<StoryboardShotDraft[]> {
  const userPrompt = [
    `Idea: ${input.idea.trim()}`,
    `Shot count: ${input.shotCount}`,
    input.style?.trim() ? `Visual style: ${input.style.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const response = await sendChatCompletion(
    {
      model: input.model,
      group: input.group,
      stream: false,
      temperature: 0.7,
      messages: [
        { role: 'system', content: SHOT_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    },
    input.signal
  )

  const content = response.choices?.[0]?.message?.content ?? ''
  return parseStoryboardShots(
    typeof content === 'string' ? content : String(content)
  ).slice(0, Math.max(1, input.shotCount))
}
