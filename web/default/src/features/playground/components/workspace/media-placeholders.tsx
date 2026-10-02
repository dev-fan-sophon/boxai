import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'

import { Shimmer } from '@/components/ai-elements/shimmer'
import { ImageIcon, Video } from '@/components/icons'
import { MOTION_TRANSITION } from '@/lib/motion'
import { cn } from '@/lib/utils'

/** Chat tool-card thumbnails: height drives the layout across ratios. */
const RESULT_THUMBNAIL_HEIGHT = 'clamp(160px, 30vh, 280px)'

export function ImagePlaceholder(props: {
  delayMs: number
  reduceMotion: boolean
  ratio: number
  sizeLabel: string | null
  /** Rotating status copy shown inside the tile while generating */
  statusText?: string
  elapsedLabel?: string
  percent?: number | null
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'border-border/70 bg-muted/40 relative overflow-hidden rounded-2xl border',
        !props.reduceMotion && 'generation-slot-enter',
        props.className
      )}
      style={{
        width: `min(100%, calc(${RESULT_THUMBNAIL_HEIGHT} * ${props.ratio}))`,
        aspectRatio: props.ratio,
        animationDelay: props.reduceMotion ? undefined : `${props.delayMs}ms`,
      }}
    >
      <div className='skeleton-shimmer absolute inset-0' />
      {!props.reduceMotion && (
        <div
          className='generation-scanline pointer-events-none absolute inset-x-0 h-1/3 opacity-70'
          aria-hidden='true'
        />
      )}
      <div className='absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center'>
        <div
          className={cn(
            'bg-background/40 text-muted-foreground flex size-11 items-center justify-center rounded-full backdrop-blur-sm',
            !props.reduceMotion && 'generation-orb-pulse'
          )}
        >
          <ImageIcon className='size-5 opacity-70' aria-hidden='true' />
        </div>
        {props.statusText && (
          <AnimatePresence mode='wait' initial={false}>
            <motion.div
              key={props.statusText}
              initial={props.reduceMotion ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={props.reduceMotion ? undefined : { opacity: 0, y: -4 }}
              transition={MOTION_TRANSITION.fast}
            >
              <Shimmer className='text-xs font-medium' duration={2.4}>
                {props.statusText}
              </Shimmer>
            </motion.div>
          </AnimatePresence>
        )}
        <div className='text-muted-foreground text-2xs flex flex-wrap items-center justify-center gap-x-2 gap-y-1 tabular-nums'>
          {props.elapsedLabel && (
            <span className='generation-timer inline-flex items-center gap-1.5'>
              <span
                className={cn(
                  'bg-primary size-1.5 rounded-full',
                  !props.reduceMotion && 'generation-timer-dot'
                )}
                aria-hidden='true'
              />
              <span className='text-foreground/90 font-medium'>
                {props.elapsedLabel}
              </span>
              <span className='sr-only'>{t('Elapsed time')}</span>
            </span>
          )}
          {props.sizeLabel && (
            <span className='bg-background/55 text-muted-foreground rounded-full px-2 py-0.5 font-mono backdrop-blur-sm'>
              {props.sizeLabel}
            </span>
          )}
        </div>
      </div>
      {props.statusText && (
        <div className='bg-background/40 absolute inset-x-0 bottom-0 h-1 overflow-hidden'>
          {typeof props.percent === 'number' ? (
            // Scale rather than width: the bar ticks every few hundred ms and a
            // width transition relayouts the whole tile each frame.
            <div
              className='bg-primary duration-expressive absolute inset-y-0 left-0 w-full origin-left transition-transform ease-out motion-reduce:transition-none'
              style={{
                transform: `scaleX(${Math.min(Math.max(props.percent, 0), 100) / 100})`,
              }}
            />
          ) : (
            <div
              className={cn(
                'from-primary/10 via-primary to-primary/10 absolute inset-y-0 w-1/3 bg-gradient-to-r',
                !props.reduceMotion && 'generation-indeterminate'
              )}
            />
          )}
        </div>
      )}
    </div>
  )
}

export function VideoPlaceholder(props: { reduceMotion: boolean }) {
  return (
    <div className='border-border/70 bg-muted/40 relative mx-auto aspect-video w-full max-w-3xl overflow-hidden rounded-2xl border'>
      <div className='skeleton-shimmer absolute inset-0' />
      <div className='absolute inset-0 flex flex-col items-center justify-center gap-3'>
        <div
          className={cn(
            'bg-background/50 text-muted-foreground flex size-16 items-center justify-center rounded-full backdrop-blur-sm',
            !props.reduceMotion && 'animate-pulse'
          )}
        >
          <Video className='size-7 opacity-80' aria-hidden='true' />
        </div>
        <div className='flex gap-1.5'>
          {(['d0', 'd1', 'd2'] as const).map((id, i) => (
            <span
              key={id}
              className={cn(
                'bg-muted-foreground/40 size-1.5 rounded-full',
                !props.reduceMotion && 'animate-bounce'
              )}
              style={
                props.reduceMotion
                  ? undefined
                  : { animationDelay: `${i * 120}ms` }
              }
            />
          ))}
        </div>
      </div>
    </div>
  )
}
