import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { ArrowRight, Check, Code2, Sparkles } from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  CLIENT_APPS,
  UPCOMING_CLIENT_APPS,
} from '@/features/client-apps/constants'
import { DownloadActions } from '@/features/downloads/download-actions'
import { detectPlatform, primaryDownload } from '@/features/downloads/release'
import {
  useAppRelease,
  type ClientAppId,
} from '@/features/downloads/use-app-release'
import { cn } from '@/lib/utils'

import { MarketingSection, SectionIntro } from '../marketing'

/**
 * Shared card frame for the three apps. `mt-auto` on the action row is what
 * keeps the download buttons on one baseline: the taglines run to different
 * line counts once translated, and without it each card's button floats to
 * wherever its own text ended.
 */
function AppCard(props: {
  mark: ReactNode
  name: string
  tagline: string
  highlights: readonly string[]
  badge?: ReactNode
  action: ReactNode
  learnMore?: ReactNode
  note?: string
  delay: number
  muted?: boolean
}) {
  return (
    <AnimateInView delay={props.delay} className='h-full'>
      <article
        className={cn(
          'bg-card flex h-full flex-col rounded-2xl border p-6 md:p-7',
          props.muted
            ? 'border-border/70 bg-card/50 border-dashed'
            : 'border-border/60 hover:border-border hover:shadow-raised transition-ui duration-control shadow-xs'
        )}
      >
        <div className='flex items-start gap-4'>
          {props.mark}
          <div className='min-w-0'>
            <div className='flex flex-wrap items-center gap-2'>
              <h3 className='text-lg font-semibold tracking-tight'>
                {props.name}
              </h3>
              {props.badge}
            </div>
            <p className='text-muted-foreground mt-1 text-sm leading-relaxed text-pretty'>
              {props.tagline}
            </p>
          </div>
        </div>

        <ul className='mt-5 space-y-2.5'>
          {props.highlights.map((highlight) => (
            <li key={highlight} className='flex items-start gap-2.5'>
              <Check
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  props.muted ? 'text-muted-foreground/60' : 'text-primary'
                )}
                strokeWidth={2}
                aria-hidden='true'
              />
              <span className='text-muted-foreground text-sm leading-relaxed'>
                {highlight}
              </span>
            </li>
          ))}
        </ul>

        <div className='mt-auto pt-6'>
          {props.note && (
            <p className='text-muted-foreground mb-3 text-xs'>{props.note}</p>
          )}
          <div className='flex flex-wrap items-center gap-2'>
            {props.action}
          </div>
          {props.learnMore && <div className='mt-4'>{props.learnMore}</div>}
        </div>
      </article>
    </AnimateInView>
  )
}

function ClientAppShowcase(props: { app: ClientAppId; delay: number }) {
  const { t } = useTranslation()
  const meta = CLIENT_APPS[props.app]
  const { release, loading, failed, fallbackUrl } = useAppRelease(props.app)
  const downloads = release?.downloads ?? []
  const primary = primaryDownload(downloads, detectPlatform())
  const appName = t(meta.nameKey)

  return (
    <AppCard
      delay={props.delay}
      name={appName}
      tagline={t(meta.taglineKey)}
      highlights={meta.highlightKeys.map((key) => t(key))}
      mark={
        <img
          src={meta.logoSrc}
          alt=''
          aria-hidden='true'
          draggable={false}
          className='ring-border/40 size-12 shrink-0 rounded-[22%] object-contain shadow-xs ring-1'
        />
      }
      learnMore={
        <Link
          to={props.app === 'connect' ? '/connect' : '/agents'}
          className='group text-foreground hover:text-primary transition-ui inline-flex items-center gap-1.5 text-sm font-medium'
        >
          {t('Learn More')}
          <ArrowRight
            className='duration-control size-3.5 transition-transform group-hover:translate-x-0.5'
            aria-hidden='true'
          />
        </Link>
      }
      action={
        <DownloadActions
          compact
          downloads={downloads}
          primary={primary}
          loading={loading}
          failed={failed}
          fallbackUrl={fallbackUrl}
          productName={appName}
        />
      }
    />
  )
}

function UpcomingAppShowcase(props: { delay: number }) {
  const { t } = useTranslation()
  const app = UPCOMING_CLIENT_APPS[0]

  return (
    <AppCard
      muted
      delay={props.delay}
      name={t(app.nameKey)}
      tagline={t(app.taglineKey)}
      highlights={app.highlightKeys.map((key) => t(key))}
      badge={
        <Badge variant='outline' className='gap-1'>
          <Sparkles className='size-3' aria-hidden='true' />
          {t('Coming soon')}
        </Badge>
      }
      mark={
        <span
          aria-hidden='true'
          className='from-chart-4/25 to-chart-1/25 text-foreground/70 ring-border/40 flex size-12 shrink-0 items-center justify-center rounded-[22%] bg-gradient-to-br shadow-xs ring-1'
        >
          <Code2 className='size-6' strokeWidth={1.5} />
        </span>
      }
      note={t('Announced here the day it ships.')}
      action={
        <Button variant='secondary' size='lg' disabled aria-disabled='true'>
          {t('In development')}
        </Button>
      }
    />
  )
}

/**
 * The BoxAI apps that run on the visitor's own machine: what each one is for,
 * and a download for their platform straight from the release manifest.
 */
export function ClientApps() {
  const { t } = useTranslation()

  return (
    <MarketingSection label={t('Desktop apps')}>
      <SectionIntro
        eyebrow={t('Desktop apps')}
        title={t('Three apps that put BoxAI on your own machine')}
        description={t(
          'One for your coding tools, one for the office work, and one for the codebase itself. All of them sign in with the account you already have.'
        )}
      />

      <div className='grid items-stretch gap-4 md:grid-cols-2 lg:grid-cols-3'>
        <ClientAppShowcase app='connect' delay={100} />
        <ClientAppShowcase app='desktop' delay={160} />
        <UpcomingAppShowcase delay={220} />
      </div>
    </MarketingSection>
  )
}
