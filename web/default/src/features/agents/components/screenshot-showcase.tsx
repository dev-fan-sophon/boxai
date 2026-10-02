import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  MarketingSection,
  SectionIntro,
} from '@/features/home/components/marketing'

// Captured from the real BoxAI Desktop app signed in to a private demo account; regenerate
// them with the desktop capture scripts after a visible UI change.
const SHOTS = [
  {
    id: 'agent',
    tab: 'Agent mode',
    caption:
      'Describe the task and the agent reads the project, edits files, and runs the commands to check its work.',
  },
  {
    id: 'plan',
    tab: 'Plan mode',
    caption:
      'Let it study the project first and approve the plan before a single file changes.',
  },
  {
    id: 'subagents',
    tab: 'Subagents',
    caption:
      'Bigger jobs split into subagents and parallel sessions that report back to one place.',
  },
  {
    id: 'models',
    tab: 'Models',
    caption:
      'Every model in your BoxAI account is one click away, and you can switch mid-session.',
  },
  {
    id: 'review',
    tab: 'Review',
    caption:
      'Each change lands as a diff you can read, keep, or roll back in the work panel.',
  },
  {
    id: 'plugins',
    tab: 'Plugins',
    caption:
      'Skills, plugins, and MCP servers add tools, panels, and workflows to the workspace.',
  },
] as const

type ShotId = (typeof SHOTS)[number]['id']

export function ScreenshotShowcase() {
  const { t } = useTranslation()
  const [active, setActive] = useState<ShotId>(SHOTS[0].id)

  return (
    <MarketingSection labelledBy='desktop-screenshots'>
      <SectionIntro
        id='desktop-screenshots'
        eyebrow={t('A look inside')}
        title={t('A tour of the workspace')}
      />

      <AnimateInView delay={80}>
        <Tabs
          value={active}
          onValueChange={(value) => setActive(value as ShotId)}
        >
          <TabsList className='no-scrollbar max-w-full justify-start overflow-x-auto'>
            {SHOTS.map((shot) => (
              <TabsTrigger key={shot.id} value={shot.id}>
                {t(shot.tab)}
              </TabsTrigger>
            ))}
          </TabsList>

          {SHOTS.map((shot) => (
            <TabsContent key={shot.id} value={shot.id} className='mt-5'>
              <figure className='space-y-3'>
                <div className='bg-muted ring-border/70 shadow-lifted overflow-hidden rounded-2xl ring-1'>
                  <img
                    src={`/desktop-screenshots/${shot.id}-1536.webp`}
                    srcSet={[
                      `/desktop-screenshots/${shot.id}-480.webp 480w`,
                      `/desktop-screenshots/${shot.id}-960.webp 960w`,
                      `/desktop-screenshots/${shot.id}-1536.webp 1536w`,
                    ].join(', ')}
                    sizes='(min-width: 1024px) 1100px, 100vw'
                    width={1536}
                    height={960}
                    loading='lazy'
                    decoding='async'
                    alt={t(shot.caption)}
                    className='block w-full'
                  />
                </div>
                <figcaption className='text-muted-foreground text-center text-sm text-pretty'>
                  {t(shot.caption)}
                </figcaption>
              </figure>
            </TabsContent>
          ))}
        </Tabs>
      </AnimateInView>
    </MarketingSection>
  )
}
