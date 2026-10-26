import { useTranslation } from 'react-i18next'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getCurrentIntlLocale } from '@/i18n/languages'

import type { OfficialModelPricingReference } from './model-pricing-domain'

export function OfficialPriceReference(props: {
  reference: OfficialModelPricingReference
}) {
  const { t } = useTranslation()
  const locale = getCurrentIntlLocale()
  const categories: Record<string, string> = {
    text_input: t('Text input'),
    text_output: t('Text output'),
    cache_read: t('Cache read'),
    cache_write: t('Cache write'),
    image_input: t('Image input'),
    image_output: t('Image output'),
    image_cache_read: t('Cached image input'),
    audio_input: t('Audio input'),
    audio_output: t('Audio output'),
    audio_cache_read: t('Cached audio input'),
    video_input: t('Video input'),
    video_output: t('Video output'),
    transcription: t('Transcription'),
    speech: t('Text to speech'),
    alignment: t('Forced alignment'),
    voice_conversion: t('Voice changer'),
    audio_isolation: t('Audio isolation'),
    sound_effects: t('Sound effects'),
    music: t('Music'),
  }
  const units: Record<string, string> = {
    million_tokens: t('1M tokens'),
    million_video_tokens: t('1M video tokens'),
    thousand_characters: t('1K characters'),
    minute: t('Minute'),
    hour: t('Hour'),
    second: t('Second'),
    image: t('Image'),
  }
  const currency = props.reference.currency ?? 'USD'
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    maximumFractionDigits: 8,
  })

  return (
    <section
      className='mt-3 space-y-3 border-t pt-3'
      aria-label={t('Official price reference')}
    >
      <div className='text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs'>
        <span>
          {t('Official reference from {{provider}}', {
            provider: props.reference.provider,
          })}
        </span>
        {props.reference.source_url && (
          <a
            className='text-primary underline underline-offset-4'
            href={props.reference.source_url}
            target='_blank'
            rel='noopener noreferrer'
          >
            {t('Official pricing documentation')}
          </a>
        )}
        {props.reference.verified_at && (
          <span>
            {t('Verified on {{date}}', { date: props.reference.verified_at })}
          </span>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('Charge component')}</TableHead>
            <TableHead>{t('Official rate')}</TableHead>
            <TableHead>{t('Per unit')}</TableHead>
            <TableHead>{t('Conditions (source text)')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.reference.rates?.map((rate) => (
            <TableRow
              key={`${rate.category}-${rate.unit}-${rate.variant ?? ''}-${rate.condition ?? ''}-${rate.context_min_exclusive ?? ''}-${rate.context_max_inclusive ?? ''}`}
            >
              <TableCell className='align-top'>
                {categories[rate.category] ?? rate.category}
                {rate.variant && (
                  <div className='text-muted-foreground mt-1 max-w-56 text-xs wrap-anywhere'>
                    {rate.variant}
                  </div>
                )}
              </TableCell>
              <TableCell className='align-top whitespace-nowrap'>
                {formatter.format(rate.price)}
              </TableCell>
              <TableCell className='align-top'>
                {units[rate.unit] ?? rate.unit}
              </TableCell>
              <TableCell className='min-w-32 align-top whitespace-normal'>
                {rate.context_min_exclusive !== undefined && (
                  <div>
                    {t('Context > {{tokens}} tokens', {
                      tokens: rate.context_min_exclusive.toLocaleString(locale),
                    })}
                  </div>
                )}
                {rate.context_max_inclusive !== undefined && (
                  <div>
                    {t('Context ≤ {{tokens}} tokens', {
                      tokens: rate.context_max_inclusive.toLocaleString(locale),
                    })}
                  </div>
                )}
                {rate.condition}
                {!rate.condition &&
                  rate.context_min_exclusive === undefined &&
                  rate.context_max_inclusive === undefined &&
                  '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {props.reference.notes && (
        <p className='text-muted-foreground text-xs leading-relaxed'>
          <span className='font-medium'>{t('Conditions (source text)')}: </span>
          {props.reference.notes}
        </p>
      )}
    </section>
  )
}
