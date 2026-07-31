import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { detectPlatform, primaryDownload } from '@/features/downloads/release'
import { useAppRelease } from '@/features/downloads/use-app-release'
import { useSeo } from '@/hooks/use-page-seo'

import { CapabilityGrid } from './components/capability-grid'
import { DesktopCta } from './components/desktop-cta'
import { DesktopFaq } from './components/desktop-faq'
import { DesktopHero } from './components/desktop-hero'
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
          'BoxAI Desktop is an AI coworker that runs on your own machine, works with your files, terminal, and connected apps, and returns finished work.'
        ),
        path: '/agents',
      }),
      [t]
    )
  )

  return (
    <main className='playground-discover-hero min-h-svh'>
      {/* Entrance comes from `PublicLayout`; sections own their own padding and rhythm. */}
      <DesktopHero
        release={release}
        primary={primary}
        loading={loading}
        failed={failed}
        fallbackUrl={fallbackUrl}
      />

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
