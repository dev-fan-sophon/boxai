import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import {
  Bot,
  Coins,
  FileCode2,
  ListChecks,
  Plug,
  SquareTerminal,
} from '@/components/icons'
import { IconBadge } from '@/components/ui/icon-badge'
import {
  MarketingSection,
  SectionIntro,
} from '@/features/home/components/marketing'

const CAPABILITIES = [
  {
    title: 'Works inside your project',
    description:
      'Reads the code and files in the folder you open, edits across them, and keeps every step in the transcript.',
    icon: FileCode2,
  },
  {
    title: 'Runs and tests locally',
    description:
      'Builds, test suites, and scripts run in your own terminal environment, so the agent checks its work before it hands back.',
    icon: SquareTerminal,
  },
  {
    title: 'Plans before it acts',
    description:
      'Plan mode studies the project and proposes the approach first. Nothing changes until you approve it.',
    icon: ListChecks,
  },
  {
    title: 'Delegates to subagents',
    description:
      'Large tasks split into subagents and parallel worker sessions, each with the model that suits it.',
    icon: Bot,
  },
  {
    title: 'Grows with plugins',
    description:
      'Skills, plugins, and MCP servers add tools, panels, and workflows without changing the core app.',
    icon: Plug,
  },
  {
    title: 'One account for every model',
    description:
      'Claude, GPT, Gemini, and the rest of your BoxAI catalog share one balance, one bill, and one usage log.',
    icon: Coins,
  },
] as const

export function CapabilityGrid() {
  const { t } = useTranslation()

  return (
    <MarketingSection labelledBy='desktop-capabilities' tone='muted'>
      <SectionIntro
        id='desktop-capabilities'
        eyebrow={t('Capabilities')}
        title={t('From a prompt to a reviewed change')}
        description={t(
          'Give the agent your project and the tools it needs, while you stay in control of what lands.'
        )}
      />
      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        {CAPABILITIES.map((capability, index) => {
          const Icon = capability.icon
          return (
            <AnimateInView key={capability.title} delay={60 + index * 60}>
              <article className='border-border/60 bg-card hover:border-border hover:shadow-raised transition-ui duration-control h-full rounded-2xl border p-6 shadow-xs'>
                <IconBadge tone='primary' size='lg' className='mb-5'>
                  <Icon weight='duotone' />
                </IconBadge>
                <h3 className='text-foreground text-base font-semibold tracking-tight'>
                  {t(capability.title)}
                </h3>
                <p className='text-muted-foreground mt-1.5 text-sm leading-6'>
                  {t(capability.description)}
                </p>
              </article>
            </AnimateInView>
          )
        })}
      </div>
    </MarketingSection>
  )
}
