import { Route } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TitledCard } from '@/components/ui/titled-card'

/**
 * Captured from the real signed-in app with
 * `bash connect/packaging/capture_screenshots.sh <id>`; regenerate after a
 * panel changes so the walkthrough never shows controls the download lacks.
 */
const STEPS = [
  {
    id: 'codex',
    tab: 'Choose models',
    caption:
      'Open a client and pick the models it should offer. Codex lists exactly these in its /model picker.',
  },
  {
    id: 'claude',
    tab: 'Per client',
    caption:
      'Every client is set up the way it actually works. Claude Code takes one model plus optional overrides for its Sonnet, Opus and Haiku roles.',
  },
  {
    id: 'gemini',
    tab: 'Only what works',
    caption:
      'Only models the client can really use are offered. Gemini CLI ignores model names outside its own list, so the rest of your catalog is not shown.',
  },
  {
    id: 'additive',
    tab: 'Apply',
    caption:
      'Claude Code, Codex, Gemini and Grok Build switch over to BoxAI. OpenCode, OpenClaw and Hermes gain BoxAI next to their own providers, and keep their default until you move it.',
  },
  {
    id: 'applied',
    tab: 'Live and reversible',
    caption:
      'Once applied, the panel names the file it wrote and keeps the way back. Removing BoxAI restores what the client had before.',
  },
] as const

type StepId = (typeof STEPS)[number]['id']

export function ConnectWalkthrough() {
  const { t } = useTranslation()
  const [active, setActive] = useState<StepId>(STEPS[0].id)

  return (
    <TitledCard
      title={t('Configuring a client')}
      description={t(
        'Sign in once, then set up each client on its own terms. Nothing is written to disk until you apply.'
      )}
      icon={<Route aria-hidden='true' />}
      disableHoverEffect
    >
      <Tabs
        value={active}
        onValueChange={(value) => setActive(value as StepId)}
      >
        <TabsList className='flex-wrap'>
          {STEPS.map((step, index) => (
            <TabsTrigger key={step.id} value={step.id}>
              <span className='text-muted-foreground mr-1.5 font-mono text-xs'>
                {index + 1}
              </span>
              {t(step.tab)}
            </TabsTrigger>
          ))}
        </TabsList>

        {STEPS.map((step) => (
          <TabsContent key={step.id} value={step.id} className='mt-4'>
            <figure className='space-y-2.5'>
              <div className='border-border bg-muted overflow-hidden rounded-xl border'>
                <img
                  src={`/connect-screenshots/${step.id}-1536.webp`}
                  srcSet={[
                    `/connect-screenshots/${step.id}-480.webp 480w`,
                    `/connect-screenshots/${step.id}-960.webp 960w`,
                    `/connect-screenshots/${step.id}-1536.webp 1536w`,
                  ].join(', ')}
                  sizes='(min-width: 1024px) 880px, 100vw'
                  width={1536}
                  height={986}
                  loading='lazy'
                  decoding='async'
                  alt={t(step.caption)}
                  className='block w-full'
                />
              </div>
              <figcaption className='text-muted-foreground text-sm text-pretty'>
                {t(step.caption)}
              </figcaption>
            </figure>
          </TabsContent>
        ))}
      </Tabs>
    </TitledCard>
  )
}
