import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { CLIENT_APPS } from '@/features/client-apps/constants'
import { DownloadActions } from '@/features/downloads/download-actions'
import { detectPlatform, primaryDownload } from '@/features/downloads/release'
import {
  useAppRelease,
  type ClientAppId,
} from '@/features/downloads/use-app-release'

function ClientAppShowcase(props: { app: ClientAppId; delay: number }) {
  const { t } = useTranslation()
  const meta = CLIENT_APPS[props.app]
  const AppIcon = meta.icon
  const { release, loading, failed, fallbackUrl } = useAppRelease(props.app)
  const downloads = release?.downloads ?? []
  const primary = primaryDownload(downloads, detectPlatform())
  const appName = t(meta.nameKey)

  return (
    <AnimateInView delay={props.delay}>
      <article
        data-card-hover='true'
        className='border-border/50 bg-card hover:border-border flex h-full flex-col rounded-2xl border p-6 shadow-xs md:p-7'
      >
        <div className='flex items-start gap-4'>
          <div className='bg-muted text-foreground flex size-11 shrink-0 items-center justify-center rounded-xl'>
            <AppIcon className='size-5' strokeWidth={1.5} aria-hidden='true' />
          </div>
          <div>
            <h3 className='text-lg font-semibold tracking-tight'>{appName}</h3>
            <p className='text-muted-foreground mt-1 text-sm leading-relaxed text-pretty'>
              {t(meta.taglineKey)}
            </p>
          </div>
        </div>

        <div className='mt-6 flex flex-wrap items-center gap-2'>
          <DownloadActions
            downloads={downloads}
            primary={primary}
            loading={loading}
            failed={failed}
            fallbackUrl={fallbackUrl}
            productName={appName}
          />
        </div>
      </article>
    </AnimateInView>
  )
}

/**
 * The two BoxAI desktop clients on the marketing page: what each one is for and
 * a download for the visitor's platform straight from the release manifest.
 */
export function ClientApps() {
  const { t } = useTranslation()

  return (
    <section
      aria-label={t('Desktop apps')}
      className='border-border/40 relative z-10 border-t px-6 py-24 md:py-32'
    >
      <div className='mx-auto max-w-6xl'>
        <AnimateInView className='mb-8 max-w-2xl md:mb-10'>
          <p className='text-muted-foreground mb-3 text-xs font-medium tracking-widest uppercase'>
            {t('Desktop apps')}
          </p>
          <h2 className='text-2xl font-bold tracking-tight text-balance md:text-3xl'>
            {t('Two apps that put BoxAI on your own machine')}
          </h2>
        </AnimateInView>

        <div className='grid gap-4 md:grid-cols-2'>
          <ClientAppShowcase app='connect' delay={100} />
          <ClientAppShowcase app='desktop' delay={160} />
        </div>
      </div>
    </section>
  )
}
