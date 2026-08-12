import { Code2, Building2, MapPin } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { SectionHeading } from '@/components/section-heading'

export function WhoFor() {
  const { t } = useTranslation()

  const audiences = [
    {
      icon: <Code2 className='size-5' strokeWidth={1.5} aria-hidden='true' />,
      title: t('Developers'),
      description: t(
        'Ship against one OpenAI-compatible base URL. Swap models and providers without rewriting your integration.'
      ),
    },
    {
      icon: (
        <Building2 className='size-5' strokeWidth={1.5} aria-hidden='true' />
      ),
      title: t('Teams'),
      description: t(
        'Shared wallet, scoped API keys, usage logs, and admin controls so spend and access stay visible.'
      ),
    },
    {
      icon: <MapPin className='size-5' strokeWidth={1.5} aria-hidden='true' />,
      title: t('Vietnam-first users'),
      description: t(
        'Local-friendly login and community paths such as Zalo, payments suited to the region, and Vietnamese product copy — with English and other markets supported next.'
      ),
    },
  ]

  return (
    <section
      aria-labelledby='about-audience-title'
      className='border-border/40 bg-muted/20 relative z-10 border-y px-6 py-20 md:py-28'
    >
      <div className='mx-auto max-w-6xl'>
        <SectionHeading
          id='about-audience-title'
          eyebrow={t('Who it is for')}
          title={t('Built for builders in Vietnam and beyond')}
          description={t(
            'Product decisions default to Vietnam first — payments, login options, SMS, and localization — while remaining usable for international customers.'
          )}
        />

        <div className='grid gap-5 md:grid-cols-3'>
          {audiences.map((item, index) => (
            <AnimateInView key={item.title} delay={index * 70}>
              <article className='border-border/50 bg-card h-full rounded-2xl border p-6 shadow-xs md:p-7'>
                <div className='bg-primary/10 text-primary mb-4 inline-flex size-10 items-center justify-center rounded-xl'>
                  {item.icon}
                </div>
                <h3 className='text-lg font-semibold tracking-tight'>
                  {item.title}
                </h3>
                <p className='text-muted-foreground mt-2 text-sm leading-relaxed text-pretty'>
                  {item.description}
                </p>
              </article>
            </AnimateInView>
          ))}
        </div>
      </div>
    </section>
  )
}
