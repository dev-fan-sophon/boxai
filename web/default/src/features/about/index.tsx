import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import {
  ArrowRight,
  BookOpen,
  Braces,
  KeyRound,
  Layers3,
  MonitorSmartphone,
  Sparkles,
  WalletCards,
} from '@/components/icons'
import { PublicLayout } from '@/components/layout'
import { Footer } from '@/components/layout/components/footer'
import { RichContent } from '@/components/rich-content'
import { Button } from '@/components/ui/button'
import { IconBadge } from '@/components/ui/icon-badge'
import { BrandGlow, Eyebrow } from '@/features/home/components/marketing'
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
      icon: <Braces aria-hidden='true' />,
      title: t('API gateway'),
      description: t(
        'One OpenAI-compatible base URL for chat, responses, images, and more across providers.'
      ),
    },
    {
      icon: <Sparkles aria-hidden='true' />,
      title: t('Workspace'),
      description: t(
        'Chat, image, and video in the browser — switch models without writing code.'
      ),
    },
    {
      icon: <MonitorSmartphone aria-hidden='true' />,
      title: t('Desktop apps'),
      description: t(
        'Connect coding clients and Desktop tools to the same BoxAI account.'
      ),
    },
    {
      icon: <Layers3 aria-hidden='true' />,
      title: t('Model Hub'),
      description: t(
        'Browse models, capabilities, and pricing in one catalog.'
      ),
    },
    {
      icon: <KeyRound aria-hidden='true' />,
      title: t('Keys & usage'),
      description: t(
        'Create scoped API keys and review usage, tokens, and cost in one place.'
      ),
    },
    {
      icon: <WalletCards aria-hidden='true' />,
      title: t('One wallet'),
      description: t('A single balance powers the API, workspace, and apps.'),
    },
  ]

  return (
    <PublicLayout showMainContainer={false}>
      <main className='relative z-10 flex min-h-[calc(100vh-3.5rem)] flex-col'>
        <section className='relative isolate overflow-hidden px-4 pt-28 pb-12 sm:px-6 sm:pt-36 sm:pb-16'>
          <BrandGlow />
          <div className='mx-auto max-w-3xl text-center'>
            <Eyebrow className='landing-animate-fade-up mb-5 opacity-0'>
              {t('About')}
            </Eyebrow>
            <h1
              className='landing-animate-fade-up text-4xl leading-[1.05] font-semibold tracking-tight text-balance opacity-0 sm:text-5xl'
              style={{ animationDelay: '60ms' }}
            >
              {brand}
            </h1>
            <p
              className='landing-animate-fade-up text-muted-foreground mx-auto mt-5 max-w-2xl text-base leading-relaxed text-pretty opacity-0 sm:text-lg'
              style={{ animationDelay: '120ms' }}
            >
              {t(
                'Unified AI platform: API gateway, browser workspace, and desktop apps — one account, one set of keys, one bill.'
              )}
            </p>
            <div
              className='landing-animate-fade-up mt-8 flex flex-wrap items-center justify-center gap-3 opacity-0'
              style={{ animationDelay: '180ms' }}
            >
              <Button
                variant='cta'
                size='lg'
                className='group'
                render={
                  <Link to={isAuthenticated ? '/dashboard' : '/sign-up'} />
                }
              >
                {t('Get Started')}
                <ArrowRight
                  className='duration-control size-4 transition-transform group-hover:translate-x-0.5'
                  aria-hidden='true'
                />
              </Button>
              <Button
                variant='outline'
                size='lg'
                className='bg-background/70'
                render={
                  <Link
                    to='/docs/$'
                    params={{ _splat: 'start/getting-started' }}
                  />
                }
              >
                <BookOpen aria-hidden='true' />
                {t('Docs')}
              </Button>
              <Button variant='ghost' size='lg' render={<Link to='/pricing' />}>
                {t('Model Hub')}
              </Button>
            </div>
          </div>
        </section>

        <section className='relative z-10 flex-1 px-4 pb-16 sm:px-6 sm:pb-24'>
          <div className='mx-auto max-w-5xl'>
            <ul className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
              {features.map((item, index) => (
                <AnimateInView
                  as='li'
                  key={item.title}
                  delay={40 + index * 50}
                  className='border-border/60 bg-card hover:border-border hover:shadow-raised transition-ui duration-control flex min-w-0 flex-col rounded-2xl border p-5 shadow-xs'
                >
                  <IconBadge tone='primary' size='lg'>
                    {item.icon}
                  </IconBadge>
                  <p className='mt-4 text-base font-semibold tracking-tight'>
                    {item.title}
                  </p>
                  <p className='text-muted-foreground mt-1.5 text-sm leading-relaxed text-pretty'>
                    {item.description}
                  </p>
                </AnimateInView>
              ))}
            </ul>

            {extraContent ? <OperatorExtra content={extraContent} /> : null}
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

function OperatorExtra(props: { content: string }) {
  const { t } = useTranslation()
  const raw = props.content.trim()
  if (!raw) return null

  if (isHttpUrl(raw)) {
    return (
      <p className='text-muted-foreground mt-10 text-center text-sm'>
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
    <div className='border-border/60 bg-card mt-10 rounded-2xl border p-5 sm:p-8'>
      <RichContent
        mode={isLikelyHtml(raw) ? 'html' : 'markdown'}
        htmlVariant={isLikelyHtml(raw) ? 'isolated' : undefined}
        content={raw}
        className='prose-neutral dark:prose-invert max-w-none text-sm'
      />
    </div>
  )
}
