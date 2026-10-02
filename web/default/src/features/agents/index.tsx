import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { detectPlatform, primaryDownload } from '@/features/downloads/release'
import { useAppRelease } from '@/features/downloads/use-app-release'
import { useSeo } from '@/hooks/use-page-seo'

import { CapabilityGrid } from './components/capability-grid'
import { DesktopCta } from './components/desktop-cta'
import { DesktopFaq } from './components/desktop-faq'
import { DesktopHero } from './components/desktop-hero'
import { DesktopTour } from './components/desktop-tour'
import { InstallGuide } from './components/install-guide'
import { ScreenshotShowcase } from './components/screenshot-showcase'
import { TrustPanel } from './components/trust-panel'

export function AgentsView() {
  const { t } = useTranslation()
  const { release, loading, failed, fallbackUrl } = useAppRelease('desktop')
  const downloads = release?.downloads ?? []
  const primary = primaryDownload(downloads, detectPlatform())

  useSeo(
    useMemo(
      () => ({
        title: t('BoxAI Desktop'),
        description: t(
          'BoxAI Desktop is an AI agent workspace for your projects. It plans, edits, runs, and tests on your own machine, with every model in your BoxAI account.'
        ),
        path: '/agents',
      }),
      [t]
    )
  )

  return (
    <main className='min-h-svh'>
      {/* Entrance comes from `PublicLayout`; sections own their own padding and rhythm. */}
      <DesktopHero
        release={release}
        primary={primary}
        loading={loading}
        failed={failed}
        fallbackUrl={fallbackUrl}
      />

      <DesktopTour />

      <ScreenshotShowcase />

      <CapabilityGrid />

      <TrustPanel />

      {downloads.length > 0 && <InstallGuide downloads={downloads} />}

      <DesktopFaq />

      <DesktopCta
        primary={primary}
        loading={loading}
        failed={failed}
        fallbackUrl={fallbackUrl}
      />
    </main>
  )
}
