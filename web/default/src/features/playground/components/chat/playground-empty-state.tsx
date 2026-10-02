import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import {
  BarChartIcon,
  CodeSquareIcon,
  GraduationCapIcon,
  MessageSquarePlusIcon,
  NotepadTextIcon,
} from '@/components/icons'
import { StaggerContainer, StaggerItem } from '@/components/page-transition'
import { IconBadge } from '@/components/ui/icon-badge'

type PlaygroundEmptyStateProps = {
  onSelectPrompt: (prompt: string) => void
}

const starterPrompts = [
  { icon: BarChartIcon, text: 'Analyze data', tone: 'chart-1' },
  { icon: NotepadTextIcon, text: 'Summarize text', tone: 'chart-2' },
  { icon: CodeSquareIcon, text: 'Code', tone: 'chart-3' },
  { icon: GraduationCapIcon, text: 'Get advice', tone: 'chart-4' },
] as const

export function PlaygroundEmptyState({
  onSelectPrompt,
}: PlaygroundEmptyStateProps) {
  const { t } = useTranslation()

  return (
    <div className='flex min-h-[min(520px,calc(100svh-18rem))] items-center justify-center px-1 py-8 md:py-12'>
      <StaggerContainer className='grid w-full max-w-2xl gap-5 text-center'>
        <StaggerItem className='relative mx-auto'>
          <div
            className='bg-brand-glow pointer-events-none absolute -inset-6 rounded-full opacity-60 blur-2xl'
            aria-hidden='true'
          />
          <IconBadge tone='primary' size='lg' className='relative size-12'>
            <MessageSquarePlusIcon weight='duotone' aria-hidden='true' />
          </IconBadge>
        </StaggerItem>

        <StaggerItem className='grid gap-2'>
          <h2 className='text-xl font-semibold tracking-tight text-balance'>
            {t('Start a playground chat')}
          </h2>
          <p className='text-muted-foreground mx-auto max-w-lg text-sm leading-6 text-balance'>
            {t(
              'Test a model with a starter prompt, or write your own request below.'
            )}
          </p>
          <p className='mt-1'>
            <Link
              to='/docs/$'
              params={{ _splat: 'start/first-request' }}
              className='text-primary text-ui font-medium underline-offset-4 hover:underline'
            >
              {t('First request guide')}
            </Link>
          </p>
        </StaggerItem>

        <StaggerItem className='grid gap-2 text-left sm:grid-cols-2'>
          {starterPrompts.map(({ icon: Icon, text, tone }) => {
            const prompt = t(text)

            return (
              <button
                type='button'
                className='bg-card ring-border/70 hover:ring-border focus-visible:ring-ring transition-ui flex min-h-12 min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium shadow-xs ring-1 outline-none hover:shadow-sm focus-visible:ring-2'
                key={text}
                onClick={() => onSelectPrompt(prompt)}
              >
                <IconBadge tone={tone} size='sm'>
                  <Icon aria-hidden='true' />
                </IconBadge>
                <span className='min-w-0'>{prompt}</span>
              </button>
            )
          })}
        </StaggerItem>
      </StaggerContainer>
    </div>
  )
}
