import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { RichContent } from '@/components/rich-content'
import { SectionHeading } from '@/components/section-heading'
import { Button } from '@/components/ui/button'
import { isHttpUrl, isLikelyHtml } from '@/lib/content-format'

type ExtraContentProps = {
  content: string
}

/**
 * Optional operator-supplied block under the built-in About page.
 * Empty → nothing. URL → external link card. HTML/Markdown → rendered body.
 * Never replaces the brand page (avoids blank / iframe-only production About).
 */
export function ExtraContent(props: ExtraContentProps) {
  const { t } = useTranslation()
  const raw = props.content.trim()
  if (!raw) return null

  const isUrl = isHttpUrl(raw)
  const contentIsHtml = isLikelyHtml(raw)

  return (
    <section
      aria-labelledby='about-extra-title'
      className='border-border/40 relative z-10 border-t px-6 py-16 md:py-20'
    >
      <div className='mx-auto max-w-6xl'>
        <SectionHeading
          id='about-extra-title'
          eyebrow={t('More')}
          title={t('Additional information')}
          description={t(
            'Extra details published by the site operator for this deployment.'
          )}
        />

        <AnimateInView>
          {isUrl ? (
            <div className='border-border/50 bg-card rounded-2xl border p-6 shadow-xs md:p-8'>
              <p className='text-muted-foreground text-sm leading-relaxed'>
                {t(
                  'The operator linked an external page for further information about this site.'
                )}
              </p>
              <Button
                variant='outline'
                className='mt-4'
                render={
                  <a href={raw} target='_blank' rel='noopener noreferrer' />
                }
              >
                {t('Open external page')}
              </Button>
            </div>
          ) : (
            <div className='border-border/50 bg-card rounded-2xl border p-6 shadow-xs md:p-8'>
              <RichContent
                mode={contentIsHtml ? 'html' : 'markdown'}
                htmlVariant={contentIsHtml ? 'isolated' : undefined}
                content={raw}
                className='prose-neutral dark:prose-invert max-w-none'
              />
            </div>
          )}
        </AnimateInView>
      </div>
    </section>
  )
}
