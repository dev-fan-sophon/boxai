import { useTranslation } from 'react-i18next'

import { ShieldCheck } from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { DownloadActions } from '@/features/downloads/download-actions'
import { formatSize } from '@/features/downloads/release'
import type {
  DesktopDownload,
  DesktopRelease,
} from '@/features/downloads/types'
import { BrandGlow } from '@/features/home/components/marketing'

export function DesktopHero(props: {
  release?: DesktopRelease
  primary?: DesktopDownload
  loading: boolean
  failed: boolean
  fallbackUrl: string
}) {
  const { t } = useTranslation()
  const downloads = props.release?.downloads ?? []

  let requirement = t('macOS 12 or later · Windows 10 or later')
  if (props.primary?.platform === 'macos') {
    requirement = t('Requires macOS {{version}} or later', {
      version: props.primary.minimum_os,
    })
  } else if (props.primary?.platform === 'windows') {
    requirement = t('Requires Windows {{version}} or later', {
      version: props.primary.minimum_os,
    })
  }

  return (
    <section
      aria-label={t('BoxAI Desktop')}
      className='relative isolate z-10 overflow-hidden px-4 pt-28 pb-12 sm:px-6 sm:pt-36 sm:pb-16'
    >
      <BrandGlow />
      <div className='relative mx-auto max-w-6xl'>
        <div className='mx-auto flex max-w-3xl flex-col items-center text-center'>
          <div className='landing-animate-fade-up mb-6 flex flex-wrap items-center justify-center gap-2 opacity-0'>
            <div className='bg-primary/10 text-primary inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium'>
              <ShieldCheck className='size-3.5' aria-hidden='true' />
              {t('BoxAI Desktop')}
            </div>
            <Badge variant='outline'>{t('Beta')}</Badge>
          </div>

          <h1
            className='landing-animate-fade-up text-foreground text-4xl leading-[1.05] font-semibold tracking-tight text-balance opacity-0 sm:text-5xl lg:text-6xl'
            style={{ animationDelay: '60ms' }}
          >
            {t('An AI coworker that finishes the work on your computer')}
          </h1>
          <p
            className='landing-animate-fade-up text-muted-foreground mt-5 max-w-2xl text-base leading-relaxed text-pretty opacity-0 sm:text-lg'
            style={{ animationDelay: '120ms' }}
          >
            {t(
              'BoxAI Desktop runs the agent on your own machine, with your files, your terminal, and the apps you already use. You describe the outcome; it comes back with the finished document, spreadsheet, or message.'
            )}
          </p>

          <div
            className='landing-animate-fade-up mt-8 flex justify-center opacity-0'
            style={{ animationDelay: '180ms' }}
          >
            <DownloadActions
              downloads={downloads}
              primary={props.primary}
              loading={props.loading}
              failed={props.failed}
              fallbackUrl={props.fallbackUrl}
              productName={t('BoxAI Desktop')}
              className='justify-center'
            />
          </div>

          <dl
            className='landing-animate-fade-up text-muted-foreground mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs opacity-0'
            style={{ animationDelay: '240ms' }}
          >
            {props.release && (
              <div className='flex items-center gap-1.5'>
                <dt className='sr-only'>{t('Version')}</dt>
                <dd>
                  {t('Version {{version}}', { version: props.release.version })}
                </dd>
              </div>
            )}
            {props.primary && (
              <div className='flex items-center gap-1.5'>
                <dt className='sr-only'>{t('Download size')}</dt>
                <dd>{formatSize(props.primary.size)}</dd>
              </div>
            )}
            <div className='flex items-center gap-1.5'>
              <dt className='sr-only'>{t('System requirements')}</dt>
              <dd>{requirement}</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  )
}
