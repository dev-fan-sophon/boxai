import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout'
import { Footer } from '@/components/layout/components/footer'
import { ZaloCommunity } from '@/features/home/components'
import { useSeo } from '@/hooks/use-page-seo'
import { buildDefaultJsonLd, DEFAULT_SEO_DESCRIPTION } from '@/lib/seo'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { getAboutContent } from './api'
import {
  AboutCta,
  AboutHero,
  ExtraContent,
  OfficialLinks,
  ProductGlance,
  Trust,
  WhoFor,
} from './components'

const ABOUT_SEO_DESCRIPTION =
  'About BoxAI (you-box.com) — unified AI API gateway for multi-model access, billing, and admin. Primary market: Vietnam; secondary: other overseas markets.'

export function About() {
  const { t } = useTranslation()
  const systemName = useSystemConfigStore((s) => s.config.systemName)
  const logo = useSystemConfigStore((s) => s.config.logo)

  const aboutQuery = useQuery({
    queryKey: ['about-content'],
    queryFn: getAboutContent,
    staleTime: 10 * 60 * 1000,
  })
  const extraContent = aboutQuery.data?.data?.trim() ?? ''

  useSeo(
    useMemo(() => {
      const siteName = systemName?.trim() || 'BoxAI'
      const description = t(ABOUT_SEO_DESCRIPTION)
      return {
        title: t('About BoxAI'),
        description,
        path: '/about',
        siteName,
        image: logo || '/logo.png',
        jsonLd: buildDefaultJsonLd({
          siteName,
          description: description || DEFAULT_SEO_DESCRIPTION,
          logo: logo || '/logo.png',
        }),
      }
    }, [systemName, logo, t])
  )

  return (
    <PublicLayout showMainContainer={false}>
      <AboutHero />
      <ProductGlance />
      <WhoFor />
      <Trust />
      <OfficialLinks />
      <ZaloCommunity />
      {extraContent ? <ExtraContent content={extraContent} /> : null}
      <AboutCta />
      <Footer
        copyright={t(
          'All rights reserved. BoxAI official site: you-box.com. International API service — please comply with applicable local regulations.'
        )}
      />
    </PublicLayout>
  )
}
