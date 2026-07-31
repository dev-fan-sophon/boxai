import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { CONNECT_CLIENTS } from '@/features/client-apps/constants'
import { LobeIcon } from '@/lib/lobe-icon'

/**
 * Marketing strip of coding agents that BoxAI Connect can point at the gateway.
 * List is sourced from CONNECT_CLIENTS so the site never advertises a client the
 * desktop app does not seed.
 */
export function SupportedApps() {
  const { t } = useTranslation()

  return (
    <section
      aria-label={t('Supported Apps')}
      className='border-border/40 bg-muted/20 relative z-10 border-y'
    >
      <div className='mx-auto max-w-6xl px-6 py-10 md:py-14'>
        <AnimateInView className='mb-8 text-center'>
          <p className='text-muted-foreground mb-2 text-xs font-medium tracking-[0.16em] uppercase'>
            {t('Supported Apps')}
          </p>
          <h2 className='text-foreground text-lg font-semibold tracking-tight text-balance md:text-xl'>
            {t('One sign-in, your coding agents on BoxAI')}
          </h2>
          <p className='text-muted-foreground mx-auto mt-2 max-w-xl text-sm leading-relaxed text-pretty'>
            {t(
              'BoxAI Connect writes the endpoint and key into the tools you already use — no hand-editing config files.'
            )}
          </p>
        </AnimateInView>

        <div className='flex flex-wrap items-center justify-center gap-2.5 md:gap-3'>
          {CONNECT_CLIENTS.map((app) => (
            <a
              key={app.name}
              href={app.href}
              target='_blank'
              rel='noopener noreferrer'
              className='border-border/50 bg-background/90 text-foreground/90 hover:border-border hover:bg-background hover:text-foreground transition-ui inline-flex items-center gap-2.5 rounded-lg border px-3.5 py-2 text-sm font-medium shadow-xs backdrop-blur-sm hover:scale-[1.02]'
            >
              <span className='flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md'>
                <LobeIcon name={app.icon} size={20} />
              </span>
              {app.name}
            </a>
          ))}
        </div>

        <AnimateInView className='mt-8 flex justify-center'>
          <Link
            to='/dashboard/$section'
            params={{ section: 'connect' }}
            className='text-muted-foreground hover:text-primary transition-ui inline-flex items-center gap-1.5 text-sm font-medium'
          >
            {t('Get BoxAI Connect')}
            <ArrowRight className='size-3.5' aria-hidden='true' />
          </Link>
        </AnimateInView>
      </div>
    </section>
  )
}
