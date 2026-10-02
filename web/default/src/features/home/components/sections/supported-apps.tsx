import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { ArrowRight } from '@/components/icons'
import { CONNECT_CLIENTS } from '@/features/client-apps/constants'
import { LobeIcon } from '@/lib/lobe-icon'

import { MarketingSection, SectionIntro } from '../marketing'

/**
 * Marketing strip of coding agents that BoxAI Connect can point at the gateway.
 * List is sourced from CONNECT_CLIENTS so the site never advertises a client the
 * desktop app does not seed.
 */
export function SupportedApps() {
  const { t } = useTranslation()

  return (
    <MarketingSection
      label={t('Supported Apps')}
      tone='muted'
      className='sm:py-20'
    >
      <SectionIntro
        align='center'
        className='md:mb-10'
        eyebrow={t('Supported Apps')}
        title={t('One sign-in, your coding agents on BoxAI')}
        description={t(
          'BoxAI Connect configures agents to use its local gateway. Your cloud API key stays in private local storage, not in agent configuration.'
        )}
      />

      <AnimateInView delay={80}>
        <ul className='flex flex-wrap items-center justify-center gap-2.5 md:gap-3'>
          {CONNECT_CLIENTS.map((app) => (
            <li key={app.name}>
              <a
                href={app.href}
                target='_blank'
                rel='noopener noreferrer'
                className='border-border/60 bg-card text-foreground/90 hover:border-border hover:text-foreground hover:shadow-raised transition-ui duration-control inline-flex items-center gap-2.5 rounded-xl border py-2 pr-4 pl-2.5 text-sm font-medium whitespace-nowrap shadow-xs hover:-translate-y-0.5'
              >
                <span className='bg-background ring-border/50 flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-lg ring-1'>
                  <LobeIcon name={app.icon} size={18} />
                </span>
                {app.name}
              </a>
            </li>
          ))}
        </ul>
      </AnimateInView>

      <AnimateInView delay={140} className='mt-8 flex justify-center'>
        <Link
          to='/dashboard/$section'
          params={{ section: 'connect' }}
          className='group text-foreground hover:text-primary transition-ui inline-flex items-center gap-1.5 text-sm font-medium'
        >
          {t('Get BoxAI Connect')}
          <ArrowRight
            className='duration-control size-3.5 transition-transform group-hover:translate-x-0.5'
            aria-hidden='true'
          />
        </Link>
      </AnimateInView>
    </MarketingSection>
  )
}
