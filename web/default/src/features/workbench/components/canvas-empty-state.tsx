import { useTranslation } from 'react-i18next'

import {
  Film,
  HelpCircle,
  Image as ImageIcon,
  StickyNote,
  type IconComponent,
} from '@/components/icons'
import { Button } from '@/components/ui/button'

export type CanvasStarterKind = 'image' | 'image-to-video' | 'note'

const STARTERS: Array<{
  kind: CanvasStarterKind
  icon: IconComponent
  title: string
  body: string
  chip: string
}> = [
  {
    kind: 'image',
    icon: ImageIcon,
    title: 'Generate an image',
    body: 'One card: write a prompt, pick a model, run it.',
    chip: 'from-chart-2 to-chart-8',
  },
  {
    kind: 'image-to-video',
    icon: Film,
    title: 'Turn an image into a video',
    body: 'Two connected cards: the image feeds the video step.',
    chip: 'from-chart-10 to-chart-3',
  },
  {
    kind: 'note',
    icon: StickyNote,
    title: 'Jot down an idea',
    body: 'A note card to park references and prompt fragments.',
    chip: 'from-chart-5 to-chart-9',
  },
]

/**
 * Shown on an empty canvas. A blank grid gives no signal about what a canvas
 * is for, so the first screen states the three shapes a flow can take.
 */
export function CanvasEmptyState(props: {
  onStart: (kind: CanvasStarterKind) => void
  onShowGuide: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className='pointer-events-none absolute inset-0 flex items-center justify-center overflow-y-auto p-3 pb-20 sm:p-6 sm:pb-24'>
      <div className='landing-animate-scale-in border-border/60 bg-background/85 shadow-lifted pointer-events-auto my-auto w-full max-w-xl rounded-2xl border p-5 backdrop-blur-2xl sm:p-7'>
        <p className='text-primary text-xs font-medium'>{t('Canvas')}</p>
        <h2 className='mt-1.5 text-lg font-semibold tracking-tight'>
          {t('Start your first flow')}
        </h2>
        <p className='text-muted-foreground mt-1 text-sm text-pretty'>
          {t(
            'A canvas is a chain of cards. Each card generates something, and its result can feed the next card.'
          )}
        </p>

        <div className='mt-5 grid gap-2 sm:grid-cols-3 sm:gap-2.5'>
          {STARTERS.map((starter) => (
            <button
              key={starter.kind}
              type='button'
              onClick={() => props.onStart(starter.kind)}
              className='border-border/60 hover:border-primary/40 hover:bg-accent/40 focus-visible:ring-ring group duration-control grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 rounded-xl border p-3 text-left transition-[border-color,background-color,transform] outline-none hover:-translate-y-0.5 focus-visible:ring-2 motion-reduce:hover:translate-y-0 sm:block sm:p-3.5'
            >
              <span
                className={`duration-control text-card row-span-2 flex size-8 items-center justify-center rounded-lg bg-gradient-to-br shadow-sm transition-transform group-hover:scale-105 ${starter.chip}`}
              >
                <starter.icon className='size-4' />
              </span>
              <span className='text-ui block font-semibold sm:mt-2.5'>
                {t(starter.title)}
              </span>
              <span className='text-muted-foreground mt-0.5 block text-xs text-pretty'>
                {t(starter.body)}
              </span>
            </button>
          ))}
        </div>

        <div className='border-border/60 mt-5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t pt-4'>
          <p className='text-muted-foreground min-w-0 flex-1 basis-56 text-xs text-pretty'>
            {t('You can also drop an image or paste a link onto the canvas.')}
          </p>
          <Button
            size='sm'
            variant='ghost'
            className='shrink-0 gap-1.5'
            onClick={props.onShowGuide}
          >
            <HelpCircle className='size-3.5' />
            {t('Show me how')}
          </Button>
        </div>
      </div>
    </div>
  )
}
