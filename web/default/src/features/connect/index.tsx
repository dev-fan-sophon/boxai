import { Link } from '@tanstack/react-router'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { BookOpen } from '@/components/icons'
import { PublicLayout } from '@/components/layout'
import { Footer } from '@/components/layout/components/footer'
import { Button } from '@/components/ui/button'
import { ConnectClientsCard } from '@/features/client-apps/components/connect-clients-card'
import { ConnectInstallationNote } from '@/features/client-apps/components/connect-installation-note'
import { ConnectWalkthrough } from '@/features/client-apps/components/connect-walkthrough'
import { CLIENT_APPS } from '@/features/client-apps/constants'
import { DownloadActions } from '@/features/downloads/download-actions'
import {
  detectPlatform,
  formatSize,
  primaryDownload,
} from '@/features/downloads/release'
import { useAppRelease } from '@/features/downloads/use-app-release'
import {
  BrandGlow,
  MarketingSection,
  SectionIntro,
} from '@/features/home/components/marketing'
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

  let requirement = t('macOS 11 or later · Windows 10 or later')
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
        <section className='relative isolate overflow-hidden px-4 pt-28 pb-16 sm:px-6 sm:pt-36 sm:pb-24'>
          <BrandGlow />
          <div className='mx-auto flex max-w-3xl flex-col items-center text-center'>
            <div className='landing-animate-fade-up mb-6 flex flex-wrap items-center justify-center gap-3 opacity-0'>
              <img
                src={meta.logoSrc}
                alt=''
                aria-hidden='true'
                draggable={false}
                className='ring-border/50 shadow-raised size-16 rounded-[22%] object-contain ring-1'
              />
            </div>
            <h1
              className='landing-animate-fade-up text-4xl leading-[1.05] font-semibold tracking-tight text-balance opacity-0 sm:text-5xl lg:text-6xl'
              style={{ animationDelay: '60ms' }}
            >
              {appName}
            </h1>
            <p
              className='landing-animate-fade-up text-foreground/90 mt-5 text-lg font-medium text-pretty opacity-0 sm:text-xl'
              style={{ animationDelay: '100ms' }}
            >
              {t(meta.taglineKey)}
            </p>
            <p
              className='landing-animate-fade-up text-muted-foreground mt-3 max-w-2xl text-base leading-relaxed text-pretty opacity-0'
              style={{ animationDelay: '140ms' }}
            >
              {t(meta.descriptionKey)}
            </p>

            <div
              className='landing-animate-fade-up mt-8 flex flex-wrap items-center justify-center gap-2 opacity-0'
              style={{ animationDelay: '180ms' }}
            >
              <DownloadActions
                downloads={downloads}
                primary={primary}
                loading={loading}
                failed={failed}
                fallbackUrl={fallbackUrl}
                productName={appName}
                className='justify-center'
              />
              <Button
                variant='ghost'
                size='lg'
                render={
                  <Link to='/docs/$' params={{ _splat: 'clients/connect' }} />
                }
              >
                <BookOpen aria-hidden='true' />
                {t('Documentation')}
              </Button>
            </div>

            <div
              className='landing-animate-fade-up mt-5 flex flex-col items-center gap-2 opacity-0'
              style={{ animationDelay: '240ms' }}
            >
              <p className='text-muted-foreground flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs'>
                {facts.map((fact) => (
                  <span key={fact}>{fact}</span>
                ))}
              </p>
              <div className='max-w-lg text-left'>
                <ConnectInstallationNote />
              </div>
            </div>
          </div>
        </section>

        <MarketingSection labelledBy='connect-features' tone='muted'>
          <SectionIntro
            id='connect-features'
            eyebrow={t('Features')}
            title={t('Everything your agents need')}
            description={t(
              'Sign in with BoxAI, then keep Connect running while your agents use its local gateway.'
            )}
          />
          <ConnectWalkthrough variant='marketing' />
        </MarketingSection>

        <MarketingSection labelledBy='connect-clients'>
          <SectionIntro
            id='connect-clients'
            eyebrow={t('Supported Apps')}
            title={t('Clients it configures')}
            description={t(
              'BoxAI Connect configures agents to use its local gateway. Your cloud API key stays in private local storage, not in agent configuration.'
            )}
          />
          <ConnectClientsCard variant='marketing' />
        </MarketingSection>

        <Footer
          copyright={t(
            'All rights reserved. BoxAI official site: you-box.com. International API service — please comply with applicable local regulations.'
          )}
        />
      </main>
    </PublicLayout>
  )
}
