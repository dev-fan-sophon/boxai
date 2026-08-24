import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  BookOpen,
  Braces,
  KeyRound,
  Layers3,
  MonitorSmartphone,
  Sparkles,
  WalletCards,
} from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout'
import { Footer } from '@/components/layout/components/footer'
import { RichContent } from '@/components/rich-content'
import { Button } from '@/components/ui/button'
import { useSeo } from '@/hooks/use-page-seo'
import { isHttpUrl, isLikelyHtml } from '@/lib/content-format'
import { buildDefaultJsonLd, DEFAULT_SEO_DESCRIPTION } from '@/lib/seo'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { getAboutContent } from './api'

const ABOUT_SEO_DESCRIPTION =
  'About BoxAI (you-box.com) — unified AI API gateway, browser workspace, and desktop apps with one account, keys, and billing.'

type FeatureItem = {
  icon: ReactNode
  title: string
  description: string
}

export function About() {
  const { t } = useTranslation()
  const systemName = useSystemConfigStore((s) => s.config.systemName)
  const logo = useSystemConfigStore((s) => s.config.logo)
  const isAuthenticated = !!useAuthStore((s) => s.auth.user)
  const brand = systemName?.trim() || 'BoxAI'

  const aboutQuery = useQuery({
    queryKey: ['about-content'],
    queryFn: getAboutContent,
    staleTime: 10 * 60 * 1000,
  })
  const extraContent = aboutQuery.data?.data?.trim() ?? ''

  useSeo(
    useMemo(() => {
      const description = t(ABOUT_SEO_DESCRIPTION)
      return {
        title: t('About BoxAI'),
        description,
        path: '/about',
        siteName: brand,
        image: logo || '/logo.png',
        jsonLd: buildDefaultJsonLd({
          siteName: brand,
          description: description || DEFAULT_SEO_DESCRIPTION,
          logo: logo || '/logo.png',
        }),
      }
    }, [brand, logo, t])
  )

  const features: FeatureItem[] = [
    {
      icon: <Braces className='size-4' strokeWidth={1.5} aria-hidden='true' />,
      title: t('API gateway'),
      description: t(
        'One OpenAI-compatible base URL for chat, responses, images, and more across providers.'
      ),
    },
    {
      icon: (
        <Sparkles className='size-4' strokeWidth={1.5} aria-hidden='true' />
      ),
      title: t('Workspace'),
      description: t(
        'Chat, image, and video in the browser — switch models without writing code.'
      ),
    },
    {
      icon: (
        <MonitorSmartphone
          className='size-4'
          strokeWidth={1.5}
          aria-hidden='true'
        />
      ),
      title: t('Desktop apps'),
      description: t(
        'Connect coding clients and Desktop tools to the same BoxAI account.'
      ),
    },
    {
      icon: <Layers3 className='size-4' strokeWidth={1.5} aria-hidden='true' />,
      title: t('Model Hub'),
      description: t(
        'Browse models, capabilities, and pricing in one catalog.'
      ),
    },
    {
      icon: (
        <KeyRound className='size-4' strokeWidth={1.5} aria-hidden='true' />
      ),
      title: t('Keys & usage'),
      description: t(
        'Create scoped API keys and review usage, tokens, and cost in one place.'
      ),
    },
    {
      icon: (
        <WalletCards className='size-4' strokeWidth={1.5} aria-hidden='true' />
      ),
      title: t('One wallet'),
      description: t('A single balance powers the API, workspace, and apps.'),
    },
  ]

  return (
    <PublicLayout showMainContainer={false}>
      <main className='relative z-10 flex min-h-[calc(100vh-3.5rem)] flex-col'>
        <div className='mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-12 md:py-16'>
          <p className='text-muted-foreground mb-3 text-xs font-medium tracking-widest uppercase'>
            {t('About')}
          </p>
          <h1 className='text-3xl font-bold tracking-tight text-balance md:text-4xl'>
            {brand}
          </h1>
          <p className='text-muted-foreground mt-4 text-base leading-relaxed text-pretty md:text-lg'>
            {t(
              'Unified AI platform: API gateway, browser workspace, and desktop apps — one account, one set of keys, one bill.'
            )}
          </p>

          <ul className='border-border/50 bg-card mt-8 grid gap-3 rounded-2xl border p-4 shadow-xs sm:grid-cols-2 sm:p-5'>
            {features.map((item) => (
              <li key={item.title} className='flex gap-3 rounded-xl p-2 sm:p-3'>
                <div className='bg-muted text-foreground/80 mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg'>
                  {item.icon}
                </div>
                <div className='min-w-0'>
                  <p className='text-sm font-semibold tracking-tight'>
                    {item.title}
                  </p>
                  <p className='text-muted-foreground mt-0.5 text-sm leading-snug text-pretty'>
                    {item.description}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <div className='mt-8 flex flex-wrap items-center gap-3'>
            <Button
              variant='cta'
              render={<Link to={isAuthenticated ? '/dashboard' : '/sign-up'} />}
            >
              {t('Get Started')}
            </Button>
            <Button
              variant='outline'
              className='border-border/50'
              render={
                <Link
                  to='/docs/$'
                  params={{ _splat: 'start/getting-started' }}
                />
              }
            >
              <BookOpen className='size-3.5' aria-hidden='true' />
              {t('Docs')}
            </Button>
            <Button variant='ghost' render={<Link to='/pricing' />}>
              {t('Model Hub')}
            </Button>
          </div>

          {extraContent ? <OperatorExtra content={extraContent} /> : null}
        </div>

        <Footer
          copyright={t(
            'All rights reserved. BoxAI official site: you-box.com. International API service — please comply with applicable local regulations.'
          )}
        />
      </main>
    </PublicLayout>
  )
}

function OperatorExtra(props: { content: string }) {
  const { t } = useTranslation()
  const raw = props.content.trim()
  if (!raw) return null

  if (isHttpUrl(raw)) {
    return (
      <p className='text-muted-foreground mt-8 text-sm'>
        <a
          href={raw}
          target='_blank'
          rel='noopener noreferrer'
          className='text-primary font-medium hover:underline'
        >
          {t('More information')}
        </a>
      </p>
    )
  }

  return (
    <div className='border-border/40 mt-8 border-t pt-6'>
      <RichContent
        mode={isLikelyHtml(raw) ? 'html' : 'markdown'}
        htmlVariant={isLikelyHtml(raw) ? 'isolated' : undefined}
        content={raw}
        className='prose-neutral dark:prose-invert max-w-none text-sm'
      />
    </div>
  )
}
