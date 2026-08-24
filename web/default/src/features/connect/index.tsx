import { TriangleAlert } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout'
import { Footer } from '@/components/layout/components/footer'
import { Badge } from '@/components/ui/badge'
import { ConnectClientsCard } from '@/features/client-apps/components/connect-clients-card'
import { ConnectWalkthrough } from '@/features/client-apps/components/connect-walkthrough'
import { CLIENT_APPS } from '@/features/client-apps/constants'
import { DownloadActions } from '@/features/downloads/download-actions'
import {
  detectPlatform,
  formatSize,
  primaryDownload,
} from '@/features/downloads/release'
import { useAppRelease } from '@/features/downloads/use-app-release'
import { useSeo } from '@/hooks/use-page-seo'

export function ConnectView() {
  const { t } = useTranslation()
  const meta = CLIENT_APPS.connect
  const { release, loading, failed, fallbackUrl } = useAppRelease('connect')
  const downloads = release?.downloads ?? []
  const primary = primaryDownload(downloads, detectPlatform())
  const appName = t(meta.nameKey)

  useSeo(
    useMemo(
      () => ({
        title: appName,
        description: t(meta.descriptionKey),
        path: '/connect',
        image: meta.logoSrc,
      }),
      [appName, meta.descriptionKey, meta.logoSrc, t]
    )
  )

  let requirement = t('macOS 12 or later · Windows 10 or later')
  if (primary?.platform === 'macos') {
    requirement = t('Requires macOS {{version}} or later', {
      version: primary.minimum_os,
    })
  } else if (primary?.platform === 'windows') {
    requirement = t('Requires Windows {{version}} or later', {
      version: primary.minimum_os,
    })
  }

  const facts = [
    release ? t('Version {{version}}', { version: release.version }) : '',
    primary ? formatSize(primary.size) : '',
    requirement,
  ].filter(Boolean)

  return (
    <PublicLayout showMainContainer={false}>
      <main className='relative z-10 min-h-svh'>
        <section className='px-6 pt-24 pb-14 md:pt-32 md:pb-20'>
          <div className='mx-auto max-w-5xl'>
            <div className='border-border/50 from-card to-muted/30 relative overflow-hidden rounded-3xl border bg-gradient-to-br p-6 shadow-sm sm:p-10 md:p-12'>
              <div
                aria-hidden='true'
                className='bg-primary/10 absolute -top-24 -right-20 size-72 rounded-full blur-3xl'
              />
              <div className='relative max-w-3xl'>
                <div className='mb-5 flex items-center gap-3'>
                  <img
                    src={meta.logoSrc}
                    alt=''
                    aria-hidden='true'
                    draggable={false}
                    className='ring-border/40 size-14 rounded-[22%] object-contain shadow-sm ring-1'
                  />
                  {release && (
                    <Badge variant='outline'>
                      {t('Version {{version}}', { version: release.version })}
                    </Badge>
                  )}
                </div>

                <h1 className='text-4xl font-bold tracking-tight text-balance sm:text-5xl'>
                  {appName}
                </h1>
                <p className='text-foreground/90 mt-4 text-lg font-medium text-pretty sm:text-xl'>
                  {t(meta.taglineKey)}
                </p>
                <p className='text-muted-foreground mt-3 max-w-2xl leading-relaxed text-pretty'>
                  {t(meta.descriptionKey)}
                </p>

                <div className='mt-7'>
                  <DownloadActions
                    downloads={downloads}
                    primary={primary}
                    loading={loading}
                    failed={failed}
                    fallbackUrl={fallbackUrl}
                    productName={appName}
                  />
                </div>

                <p className='text-muted-foreground mt-4 flex flex-wrap gap-x-3 gap-y-1 text-xs'>
                  {facts.map((fact) => (
                    <span key={fact}>{fact}</span>
                  ))}
                </p>
                <p className='text-muted-foreground mt-3 flex max-w-2xl items-start gap-2 text-xs text-pretty'>
                  <TriangleAlert
                    className='mt-0.5 size-3.5 shrink-0'
                    aria-hidden='true'
                  />
                  {t(
                    'The current macOS and Windows installers are not OS-signed or notarized. Your system may show a security warning during installation.'
                  )}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className='px-6 pb-20 md:pb-28'>
          <div className='mx-auto grid max-w-5xl gap-4'>
            <ConnectWalkthrough />
            <ConnectClientsCard />
          </div>
        </section>

        <Footer
          copyright={t(
            'All rights reserved. BoxAI official site: you-box.com. International API service — please comply with applicable local regulations.'
          )}
        />
      </main>
    </PublicLayout>
  )
}
