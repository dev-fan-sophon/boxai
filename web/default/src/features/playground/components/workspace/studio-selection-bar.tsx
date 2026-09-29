import {
  FolderDown,
  ImagePlus,
  LayoutDashboard,
  Loader2,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type StudioSelectionBarProps = {
  count: number
  total: number
  downloading: boolean
  sending: boolean
  onDownload: () => void
  onUseAsReferences?: () => void
  onSendToCanvas: () => void
  onSelectAll: () => void
  onClear: () => void
  onDone: () => void
}

/**
 * Floating action bar for select mode, pinned to the bottom of the feed's
 * scroll area so it stays reachable while the user picks tiles further up.
 */
export function StudioSelectionBar(props: StudioSelectionBarProps) {
  const { t } = useTranslation()
  const empty = props.count === 0
  const allSelected = props.count > 0 && props.count >= props.total

  return (
    <div
      role='toolbar'
      aria-label={t('Selection actions')}
      className={cn(
        'bg-surface-overlay border-border/70 shadow-lifted sticky bottom-3 z-sticky mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-1 rounded-2xl border px-2 py-1.5 backdrop-blur-md',
        'generation-slot-enter'
      )}
    >
      <span
        className='text-foreground px-1.5 text-xs font-medium tabular-nums'
        aria-live='polite'
      >
        {t('{{count}} selected', { count: props.count })}
      </span>
      <Button
        size='xs'
        variant='ghost'
        className='text-muted-foreground'
        onClick={allSelected ? props.onClear : props.onSelectAll}
      >
        {allSelected ? t('Clear selection') : t('Select all')}
      </Button>
      <span className='bg-border mx-0.5 h-4 w-px' aria-hidden='true' />
      <Button
        size='xs'
        variant='ghost'
        disabled={empty || props.downloading}
        aria-label={t('Download selected as ZIP')}
        title={t('Download selected as ZIP')}
        onClick={props.onDownload}
      >
        {props.downloading ? (
          <Loader2 className='animate-spin' aria-hidden='true' />
        ) : (
          <FolderDown aria-hidden='true' />
        )}
        <span className='hidden sm:inline'>{t('Download')}</span>
      </Button>
      {props.onUseAsReferences && (
        <Button
          size='xs'
          variant='ghost'
          disabled={empty}
          aria-label={t('Use as references')}
          title={t('Use as references')}
          onClick={props.onUseAsReferences}
        >
          <ImagePlus aria-hidden='true' />
          <span className='hidden sm:inline'>{t('Use as references')}</span>
        </Button>
      )}
      <Button
        size='xs'
        variant='default'
        disabled={empty || props.sending}
        onClick={props.onSendToCanvas}
      >
        {props.sending ? (
          <Loader2 className='animate-spin' aria-hidden='true' />
        ) : (
          <LayoutDashboard aria-hidden='true' />
        )}
        {t('Send to canvas')}
      </Button>
      <Button
        size='icon-xs'
        variant='ghost'
        className='text-muted-foreground'
        aria-label={t('Exit selection')}
        title={t('Exit selection')}
        onClick={props.onDone}
      >
        <X aria-hidden='true' />
      </Button>
    </div>
  )
}
