/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import {
  BookOpen,
  Code2,
  Gauge,
  Image as ImageIcon,
  MessageSquare,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Users,
  Wand2,
  Zap,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { useSystemConfig } from '@/hooks/use-system-config'

export function Features() {
  const { t } = useTranslation()
  const { systemName } = useSystemConfig()
  const brand = systemName || 'BoxAI'

  const advantages = [
    {
      icon: <Zap className='size-5' />,
      title: t('Fast Integration'),
      desc: t('Complete SDKs and examples for a straightforward integration'),
    },
    {
      icon: <Gauge className='size-5' />,
      title: t('Elastic Scaling'),
      desc: t('High concurrency routing for business traffic'),
    },
    {
      icon: <Shield className='size-5' />,
      title: t('Stable & Reliable'),
      desc: t('Centralized routing, monitoring, and operational controls'),
    },
    {
      icon: <RefreshCw className='size-5' />,
      title: t('Switch Models On Demand'),
      desc: t('Switch models flexibly without changing business code'),
    },
  ]

  const capabilities = [
    {
      icon: <MessageSquare className='size-4' />,
      title: t('Text Generation'),
      desc: t('Chat, creation, summarization, translation, and more'),
    },
    {
      icon: <ImageIcon className='size-4' />,
      title: t('Image Generation'),
      desc: t('Text-to-image, image-to-image, editing, and more'),
    },
    {
      icon: <Code2 className='size-4' />,
      title: t('Code Assistant'),
      desc: t('Code completion, generation, explanation, and more'),
    },
    {
      icon: <Search className='size-4' />,
      title: t('Vector Search'),
      desc: t('Knowledge retrieval, semantic search'),
    },
    {
      icon: <Sparkles className='size-4' />,
      title: t('Multimodal Comparison'),
      desc: t('Performance comparison, A/B testing'),
    },
  ]

  const useCases = [
    {
      icon: <Users className='size-4' />,
      title: t('Smart Customer Service'),
      desc: t('Automated responses backed by your selected models'),
    },
    {
      icon: <Wand2 className='size-4' />,
      title: t('Content Creation'),
      desc: t('Marketing copy, article writing'),
    },
    {
      icon: <Code2 className='size-4' />,
      title: t('Code Development'),
      desc: t('Dev frameworks, AI pair programming'),
    },
    {
      icon: <BookOpen className='size-4' />,
      title: t('Enterprise Knowledge Base'),
      desc: t('Q&A and knowledge retrieval'),
    },
    {
      icon: <Gauge className='size-4' />,
      title: t('Data Analytics'),
      desc: t('Insights and decision support'),
    },
  ]

  return (
    <section
      aria-label={t('Core Advantages')}
      className='relative z-10 px-6 py-24 md:py-32'
    >
      <div className='mx-auto max-w-6xl'>
        <AnimateInView className='mb-12 max-w-2xl md:mb-16'>
          <p className='text-muted-foreground mb-3 text-xs font-medium tracking-widest uppercase'>
            {t('Core Advantages')}
          </p>
          <h2 className='text-2xl font-bold tracking-tight md:text-3xl'>
            {t('Why Choose {{brand}}', { brand })}
          </h2>
          <p className='text-muted-foreground mt-3 text-sm leading-relaxed md:text-base'>
            {t(
              'Full-stack AI capabilities and typical business scenarios, backed by reliable platform infrastructure.'
            )}
          </p>
        </AnimateInView>

        <div className='mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
          {advantages.map((item, i) => (
            <AnimateInView
              key={item.title}
              delay={i * 70}
              className='border-border/50 bg-background/70 rounded-2xl border p-5 shadow-xs'
            >
              <div className='mb-3 flex size-10 items-center justify-center rounded-xl border border-blue-500/15 bg-blue-500/5 text-blue-600 dark:text-blue-400'>
                {item.icon}
              </div>
              <h3 className='text-sm font-semibold'>{item.title}</h3>
              <p className='text-muted-foreground mt-1.5 text-sm leading-relaxed'>
                {item.desc}
              </p>
            </AnimateInView>
          ))}
        </div>

        <div className='grid gap-4 lg:grid-cols-2'>
          <AnimateInView
            delay={100}
            className='border-border/50 bg-muted/15 rounded-2xl border p-6'
          >
            <p className='text-muted-foreground mb-1 text-xs font-medium tracking-widest uppercase'>
              {t('Product Capabilities')}
            </p>
            <p className='text-muted-foreground mb-5 text-sm'>
              {t('Full-stack AI matrix, unified API out of the box')}
            </p>
            <div className='space-y-3'>
              {capabilities.map((item) => (
                <div
                  key={item.title}
                  className='border-border/40 bg-background/70 flex items-start gap-3 rounded-xl border p-3'
                >
                  <div className='bg-muted text-muted-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg'>
                    {item.icon}
                  </div>
                  <div>
                    <h4 className='text-sm font-semibold'>{item.title}</h4>
                    <p className='text-muted-foreground text-xs leading-relaxed'>
                      {item.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </AnimateInView>

          <AnimateInView
            delay={160}
            className='border-border/50 bg-muted/15 rounded-2xl border p-6'
          >
            <p className='text-muted-foreground mb-1 text-xs font-medium tracking-widest uppercase'>
              {t('Use Cases')}
            </p>
            <p className='text-muted-foreground mb-5 text-sm'>
              {t('From customer service to R&D — typical business paths')}
            </p>
            <div className='space-y-3'>
              {useCases.map((item) => (
                <div
                  key={item.title}
                  className='border-border/40 bg-background/70 flex items-start gap-3 rounded-xl border p-3'
                >
                  <div className='bg-muted text-muted-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg'>
                    {item.icon}
                  </div>
                  <div>
                    <h4 className='text-sm font-semibold'>{item.title}</h4>
                    <p className='text-muted-foreground text-xs leading-relaxed'>
                      {item.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </AnimateInView>
        </div>
      </div>
    </section>
  )
}
