import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import {
  CalendarClock,
  FileOutput,
  Files,
  Link2,
  Sparkles,
  SquareTerminal,
} from '@/components/icons'
import { IconBadge } from '@/components/ui/icon-badge'
import {
  MarketingSection,
  SectionIntro,
} from '@/features/home/components/marketing'

const CAPABILITIES = [
  {
    title: 'Work with local files',
    description:
      'Read, organize, and transform files on your computer without uploading your whole workspace.',
    icon: Files,
  },
  {
    title: 'Use the shell',
    description:
      'Run commands and development tools locally, with every action visible in the transcript.',
    icon: SquareTerminal,
  },
  {
    title: 'Create real deliverables',
    description:
      'Documents, spreadsheets, presentations, and code land as files you can open and share.',
    icon: FileOutput,
  },
  {
    title: 'Connect your tools',
    description:
      'Bring Slack, GitHub, Gmail, Notion, Jira and more into one workspace through secure connectors.',
    icon: Link2,
  },
  {
    title: 'Teach it repeatable work',
    description:
      'Skills are instruction packs it loads on demand, so the same task comes out the same way.',
    icon: Sparkles,
  },
  {
    title: 'Run on a schedule',
    description:
      'Morning briefs, weekly reports, and standing watches run on their own and report back.',
    icon: CalendarClock,
  },
] as const

export function CapabilityGrid() {
  const { t } = useTranslation()

  return (
    <MarketingSection labelledBy='desktop-capabilities' tone='muted'>
      <SectionIntro
        id='desktop-capabilities'
        eyebrow={t('Capabilities')}
        title={t('From conversation to completed work')}
        description={t(
          'Give BoxAI the context and tools it needs, while you stay in control.'
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
