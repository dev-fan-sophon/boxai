import { Link } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { DocsManifestPage } from '../lib/types'

export function DocPager(props: {
  prev?: DocsManifestPage
  next?: DocsManifestPage
}) {
  const { t } = useTranslation()
  if (!props.prev && !props.next) return null

  return (
    <div className='mt-12 grid gap-3 border-t pt-8 sm:grid-cols-2'>
      {props.prev ? (
        <Link
          to='/docs/$'
          params={{ _splat: props.prev.path }}
          className='hover:bg-muted/50 rounded-lg border p-4 transition-colors'
        >
          <p className='text-muted-foreground flex items-center gap-1 text-xs'>
            <ArrowLeft className='size-3.5' />
            {t('Previous')}
          </p>
          <p className='mt-1 text-sm font-medium'>{props.prev.title}</p>
        </Link>
      ) : (
        <div />
      )}
      {props.next ? (
        <Link
          to='/docs/$'
          params={{ _splat: props.next.path }}
          className='hover:bg-muted/50 rounded-lg border p-4 text-right transition-colors sm:justify-self-end sm:text-right'
        >
          <p className='text-muted-foreground flex items-center justify-end gap-1 text-xs'>
            {t('Next')}
            <ArrowRight className='size-3.5' />
          </p>
          <p className='mt-1 text-sm font-medium'>{props.next.title}</p>
        </Link>
      ) : null}
    </div>
  )
}
