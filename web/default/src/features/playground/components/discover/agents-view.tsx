/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { listPlaygroundAgents } from '../../api'
import {
  AGENT_CARDS,
  type AgentCard,
  mapApiAgentToCard,
} from '../../lib/workbench/agents-data'

type AgentsViewProps = {
  onSelectAgent: (agent: AgentCard) => void
  className?: string
}

/**
 * Full-width Agents view rendered in the workspace center when the
 * toolbar's Agents tab is active.
 */
export function AgentsView(props: AgentsViewProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<'skill' | 'canvas' | null>(null)

  const apiAgents = useQuery({
    queryKey: ['playground', 'agents'],
    queryFn: listPlaygroundAgents,
    staleTime: 60_000,
  })
  const agents = useMemo(() => {
    if (apiAgents.data && apiAgents.data.length > 0) {
      return apiAgents.data.map(mapApiAgentToCard)
    }
    return AGENT_CARDS
  }, [apiAgents.data])

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

  return (
    <div
      className={cn(
        'min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4 md:p-8',
        props.className
      )}
    >
      <div className='mx-auto max-w-4xl space-y-6'>
        <div>
          <h1 className='text-foreground text-2xl font-semibold'>
            {t('Agents')}
          </h1>
          <p className='text-muted-foreground mt-1 text-sm text-pretty'>
            {t(
              'Scene-ready workflows and API entry points. Pick an agent to jump into the matching model workspace.'
            )}
          </p>
        </div>
        <div className='grid gap-3 sm:grid-cols-2'>
          {agents.map((agent) => (
            <AgentCardButton
              key={agent.id}
              agent={agent}
              onClick={() => runAgent(agent)}
            />
          ))}
        </div>
        <SkillLanding />
      </div>
      <AgentDialogs dialog={dialog} onClose={() => setDialog(null)} />
    </div>
  )
}

function AgentCardButton(props: { agent: AgentCard; onClick: () => void }) {
  const { t } = useTranslation()
  const Icon = props.agent.icon
  return (
    <button
      type='button'
      onClick={props.onClick}
      className={cn(
        'border-border bg-muted/40 w-full rounded-xl border p-4 text-left outline-none transition-colors',
        'hover:border-primary/30 hover:bg-muted/60 focus-visible:ring-ring focus-visible:ring-2'
      )}
    >
      <div className='flex items-start gap-2.5'>
        <span
          className={cn(
            'ring-border flex size-9 shrink-0 items-center justify-center rounded-lg ring-1',
            props.agent.accentClass
          )}
        >
          <Icon className='size-4' aria-hidden='true' />
        </span>
        <span className='min-w-0'>
          <span className='flex items-center gap-1.5'>
            <span className='text-foreground truncate text-sm font-medium'>
              {t(props.agent.titleKey)}
            </span>
            <span className='bg-muted/50 text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-[10px]'>
              {t(props.agent.categoryKey)}
            </span>
          </span>
          <span className='text-muted-foreground mt-0.5 line-clamp-2 text-[11px]'>
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
    <section className='border-border from-primary/10 to-accent/40 rounded-2xl border bg-gradient-to-br via-transparent p-5'>
      <h2 className='text-foreground text-lg font-semibold'>
        {t('Zero-friction API access')}
      </h2>
      <p className='text-muted-foreground mt-2 max-w-2xl text-sm text-pretty'>
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
                window.open(
                  '/api/playground/skill.md',
                  '_blank',
                  'noopener,noreferrer'
                )
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
        footer={<Button onClick={props.onClose}>{t('Got it')}</Button>}
      >
        <span />
      </Dialog>
    </>
  )
}
