/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import {
  AGENT_CARDS,
  type AgentCard,
} from '../../lib/workbench/agents-data'

type AgentsPanelProps = {
  onSelectAgent: (agent: AgentCard) => void
  className?: string
  /** compact list mode for left rail */
  variant?: 'rail' | 'main'
}

export function AgentsPanel(props: AgentsPanelProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<'skill' | 'canvas' | null>(null)
  const variant = props.variant ?? 'rail'

  const runAgent = (agent: AgentCard) => {
    const action = agent.action
    if (action.type === 'route') {
      void navigate({ to: action.to })
      return
    }
    if (action.type === 'external') {
      window.open(action.href, '_blank', 'noopener,noreferrer')
      return
    }
    if (action.type === 'dialog') {
      if (action.dialog === 'coming-soon') {
        toast.info(t('Coming soon'))
        return
      }
      setDialog(action.dialog)
      return
    }
    if (action.type === 'modality') {
      props.onSelectAgent(agent)
    }
  }

  if (variant === 'main') {
    return (
      <div className={cn('min-h-0 flex-1 overflow-y-auto p-4 md:p-8', props.className)}>
        <div className='mx-auto max-w-4xl space-y-6'>
          <div>
            <h1 className='text-2xl font-semibold text-foreground'>
              {t('Agents')}
            </h1>
            <p className='mt-1 text-sm text-pretty text-muted-foreground'>
              {t(
                'Scene-ready workflows and API entry points. Pick an agent to jump into the matching model workspace.'
              )}
            </p>
          </div>
          <div className='grid gap-3 sm:grid-cols-2'>
            {AGENT_CARDS.map((agent) => (
              <AgentCardButton
                key={agent.id}
                agent={agent}
                onClick={() => runAgent(agent)}
                large
              />
            ))}
          </div>
          <SkillLanding />
        </div>
        <AgentDialogs dialog={dialog} onClose={() => setDialog(null)} />
      </div>
    )
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col', props.className)}>
      <div className='border-b border-border p-3'>
        <h2 className='text-sm font-semibold text-foreground'>{t('Agents')}</h2>
        <p className='text-[11px] text-muted-foreground'>
          {t('Workflows & API tools')}
        </p>
      </div>
      <div className='min-h-0 flex-1 space-y-1 overflow-y-auto p-2'>
        {AGENT_CARDS.map((agent) => (
          <AgentCardButton
            key={agent.id}
            agent={agent}
            onClick={() => runAgent(agent)}
          />
        ))}
      </div>
      <AgentDialogs dialog={dialog} onClose={() => setDialog(null)} />
    </div>
  )
}

function AgentCardButton(props: {
  agent: AgentCard
  onClick: () => void
  large?: boolean
}) {
  const { t } = useTranslation()
  const Icon = props.agent.icon
  return (
    <button
      type='button'
      onClick={props.onClick}
      className={cn(
        'w-full rounded-xl border border-transparent p-2.5 text-left outline-none transition-colors',
        'hover:border-border hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring',
        props.large && 'border-border bg-muted/40 p-4'
      )}
    >
      <div className='flex items-start gap-2.5'>
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-border',
            props.agent.accentClass
          )}
        >
          <Icon className='size-4' aria-hidden='true' />
        </span>
        <span className='min-w-0'>
          <span className='flex items-center gap-1.5'>
            <span className='truncate text-sm font-medium text-foreground'>
              {t(props.agent.titleKey)}
            </span>
            <span className='shrink-0 rounded bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground'>
              {t(props.agent.categoryKey)}
            </span>
          </span>
          <span className='mt-0.5 line-clamp-2 text-[11px] text-muted-foreground'>
            {t(props.agent.descriptionKey)}
          </span>
        </span>
      </div>
    </button>
  )
}

function SkillLanding() {
  const { t } = useTranslation()
  return (
    <section className='rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-transparent to-accent/40 p-5'>
      <h2 className='text-lg font-semibold text-foreground'>
        {t('Zero-friction API access')}
      </h2>
      <p className='mt-2 max-w-2xl text-sm text-pretty text-muted-foreground'>
        {t(
          'Use Box AI as a unified gateway for chat, image, video, and audio models. Create an API key, pick a model from pricing, and call the OpenAI-compatible endpoints.'
        )}
      </p>
      <div className='mt-4 flex flex-wrap gap-2'>
        <Button
          size='sm'
          className='bg-primary text-primary-foreground hover:bg-primary/90'
          render={<Link to='/docs' />}
        >
          {t('Open API docs')}
        </Button>
        <Button
          size='sm'
          variant='outline'
          className='border-border bg-muted/50 text-foreground hover:bg-muted'
          render={<Link to='/pricing' />}
        >
          {t('Model pricing')}
        </Button>
      </div>
    </section>
  )
}

function AgentDialogs(props: {
  dialog: 'skill' | 'canvas' | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <Dialog
        open={props.dialog === 'skill'}
        onOpenChange={(open) => !open && props.onClose()}
        title={t('Skill kit')}
        description={t(
          'Download a starter SKILL.md with base URL placeholders and playground endpoint map.'
        )}
        footer={
          <>
            <Button
              variant='outline'
              onClick={() => {
                window.open('/api/playground/skill.md', '_blank', 'noopener,noreferrer')
              }}
            >
              {t('Download SKILL.md')}
            </Button>
            <Button onClick={props.onClose}>{t('Got it')}</Button>
          </>
        }
      >
        <ul className='text-muted-foreground list-disc space-y-1 pl-5 text-sm'>
          <li>{t('OpenAI-compatible chat completions')}</li>
          <li>{t('Image, video, and speech playground relays')}</li>
          <li>{t('Group-based routing and billing')}</li>
        </ul>
      </Dialog>
      <Dialog
        open={props.dialog === 'canvas'}
        onOpenChange={(open) => !open && props.onClose()}
        title={t('Infinite canvas')}
        description={t(
          'A freeform multi-node canvas is on the roadmap. Use the Models tab for sequential generation today.'
        )}
        footer={
          <Button onClick={props.onClose}>{t('Got it')}</Button>
        }
      >
        <span />
      </Dialog>
    </>
  )
}
