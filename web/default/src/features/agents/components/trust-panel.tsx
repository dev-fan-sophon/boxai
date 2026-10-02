import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { CheckCircle2, FolderLock, LockKeyhole } from '@/components/icons'
import { IconBadge } from '@/components/ui/icon-badge'
import {
  MarketingSection,
  SectionIntro,
} from '@/features/home/components/marketing'

export function TrustPanel() {
  const { t } = useTranslation()

  const guarantees = [
    {
      id: 'approval',
      icon: CheckCircle2,
      tone: 'success' as const,
      title: t('Approval stays with you'),
      description: t(
        'Commands, file writes, and MCP tools ask before they run. You see the exact action and decide, or allow it for the session.'
      ),
    },
    {
      id: 'local',
      icon: LockKeyhole,
      tone: 'primary' as const,
      title: t('Local by design'),
      description: t(
        'Projects, sessions, and settings stay on your device. Only the prompt and context a model needs are sent through your BoxAI account.'
      ),
    },
    {
      id: 'workspace',
      icon: FolderLock,
      tone: 'primary' as const,
      title: t('Every change is reviewable'),
      description: t(
        'Edits show up as diffs in the work panel, so you can read, keep, or roll back what the agent did before you commit.'
      ),
    },
  ]

  return (
    <MarketingSection labelledBy='desktop-trust'>
      <SectionIntro
        id='desktop-trust'
        eyebrow={t('Control')}
        title={t('An agent with real access needs real brakes')}
        description={t(
          'BoxAI Desktop can change your files and run your tools, so every one of those powers is gated by something you decide.'
        )}
      />
      <div className='grid gap-3 md:grid-cols-3'>
        {guarantees.map((guarantee, index) => {
          const Icon = guarantee.icon
          return (
            <AnimateInView key={guarantee.id} delay={80 + index * 70}>
              <article className='border-border/60 bg-card h-full rounded-2xl border p-6 shadow-xs'>
                <IconBadge tone={guarantee.tone} size='lg'>
                  <Icon weight='duotone' />
                </IconBadge>
                <h3 className='text-foreground mt-5 text-base font-semibold tracking-tight'>
                  {guarantee.title}
                </h3>
                <p className='text-muted-foreground mt-2 text-sm leading-6'>
                  {guarantee.description}
                </p>
              </article>
            </AnimateInView>
          )
        })}
      </div>
    </MarketingSection>
  )
}
