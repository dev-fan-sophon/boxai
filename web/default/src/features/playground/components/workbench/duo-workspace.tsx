/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useMutation } from '@tanstack/react-query'
import { Layers, Loader2, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import { multiChat } from '../../api'
import type { DuoCollabState } from '../../lib/workbench/workbench-prefs'
import type { ModelOption } from '../../types'

const SCENARIOS = [
  {
    id: 'deep-analysis',
    labelKey: 'Deep analysis',
    hint: 'Compare reasoning across models, then summarize.',
  },
  {
    id: 'code-design',
    labelKey: 'Code design',
    hint: 'Collect architecture options from multiple models.',
  },
  {
    id: 'creative',
    labelKey: 'Creative writing',
    hint: 'Generate alternate drafts, then pick a synthesis.',
  },
  {
    id: 'compare',
    labelKey: 'Comparison',
    hint: 'Side-by-side tradeoffs with a final summary model.',
  },
] as const

type DuoWorkspaceProps = {
  duo: DuoCollabState
  chatModels: ModelOption[]
  onChange: (patch: Partial<DuoCollabState>) => void
  onClose: () => void
  group?: string
  className?: string
}

export function DuoWorkspace(props: DuoWorkspaceProps) {
  const { t } = useTranslation()
  const selected = new Set(props.duo.answerModels)
  const [prompt, setPrompt] = useState('')
  const [summary, setSummary] = useState('')
  const [legs, setLegs] = useState<
    Array<{ model: string; content?: string; error?: string }>
  >([])

  const toggleModel = (value: string) => {
    const next = selected.has(value)
      ? props.duo.answerModels.filter((m) => m !== value)
      : [...props.duo.answerModels, value].slice(0, 5)
    props.onChange({ answerModels: next, enabled: true })
  }

  const runMutation = useMutation({
    mutationFn: () =>
      multiChat({
        answer_models: props.duo.answerModels,
        summarizer_model: props.duo.summaryModel,
        group: props.group,
        messages: [{ role: 'user', content: prompt.trim() }],
        timeout: 120,
      }),
    onSuccess: (data) => {
      setLegs(data.legs ?? [])
      setSummary(data.summary || data.summary_error || '')
      if (data.partial) {
        toast.info(t('Partial multi-model result'), {
          description: t('Some answer models failed; summary used successful legs.'),
        })
      }
    },
    onError: (err: Error) => {
      toast.error(err.message || t('Multi-model run failed'))
    },
  })

  const canRun =
    props.duo.answerModels.length > 0 &&
    Boolean(props.duo.summaryModel) &&
    prompt.trim().length > 0 &&
    !runMutation.isPending

  return (
    <div
      className={cn(
        'mx-auto flex w-full max-w-3xl flex-col gap-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.04] p-4 md:p-6',
        props.className
      )}
    >
      <div className='flex items-start justify-between gap-3'>
        <div className='flex items-start gap-3'>
          <span className='flex size-10 items-center justify-center rounded-xl bg-cyan-500/15 text-cyan-300'>
            <Layers className='size-5' aria-hidden='true' />
          </span>
          <div>
            <h2 className='text-base font-semibold text-zinc-50'>
              {t('Multi-model collaboration')}
            </h2>
            <p className='mt-1 text-sm text-pretty text-zinc-400'>
              {t(
                'Pick up to five answer models and one summarizer. Each leg is billed through playground chat; then a summary call runs.'
              )}
            </p>
          </div>
        </div>
        <Button
          variant='ghost'
          size='icon'
          className='text-zinc-400 hover:bg-white/5 hover:text-white'
          onClick={props.onClose}
          aria-label={t('Close')}
        >
          <X className='size-4' />
        </Button>
      </div>

      <div className='flex flex-wrap gap-2'>
        {SCENARIOS.map((scenario) => (
          <button
            key={scenario.id}
            type='button'
            className='rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-zinc-300 hover:border-cyan-400/40 hover:text-cyan-200'
            title={t(scenario.hint)}
            onClick={() => {
              const picks = props.chatModels.slice(0, 3).map((m) => m.value)
              props.onChange({
                enabled: true,
                answerModels: picks,
                summaryModel:
                  props.chatModels[picks.length]?.value || picks[0] || '',
              })
            }}
          >
            {t(scenario.labelKey)}
          </button>
        ))}
      </div>

      <div className='space-y-2'>
        <p className='text-xs font-medium text-zinc-400'>
          {t('Answer models')} ({props.duo.answerModels.length}/5)
        </p>
        <div className='flex max-h-40 flex-wrap gap-1.5 overflow-y-auto'>
          {props.chatModels.map((model) => {
            const active = selected.has(model.value)
            return (
              <button
                key={model.value}
                type='button'
                aria-pressed={active}
                onClick={() => toggleModel(model.value)}
                className={cn(
                  'rounded-lg border px-2 py-1 font-mono text-[11px] transition-colors',
                  active
                    ? 'border-cyan-400/40 bg-cyan-500/15 text-cyan-200'
                    : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:text-zinc-200'
                )}
              >
                {model.label}
              </button>
            )
          })}
          {props.chatModels.length === 0 && (
            <p className='text-sm text-zinc-500'>
              {t('No chat models available yet.')}
            </p>
          )}
        </div>
      </div>

      <div className='space-y-1.5'>
        <label
          htmlFor='duo-summary-model'
          className='text-xs font-medium text-zinc-400'
        >
          {t('Summary model')}
        </label>
        <NativeSelect
          id='duo-summary-model'
          className='w-full border-white/10 bg-white/5 text-zinc-100'
          value={props.duo.summaryModel}
          onChange={(event) =>
            props.onChange({
              summaryModel: event.target.value,
              enabled: true,
            })
          }
        >
          <NativeSelectOption value=''>{t('Select model')}</NativeSelectOption>
          {props.chatModels.map((model) => (
            <NativeSelectOption key={model.value} value={model.value}>
              {model.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      <div className='space-y-1.5'>
        <label
          htmlFor='duo-prompt'
          className='text-xs font-medium text-zinc-400'
        >
          {t('Prompt')}
        </label>
        <Textarea
          id='duo-prompt'
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder={t('Ask all selected models…')}
          className='border-white/10 bg-white/5 text-zinc-100'
        />
      </div>

      <Button
        className='bg-cyan-500 text-zinc-950 hover:bg-cyan-400'
        disabled={!canRun}
        onClick={() => runMutation.mutate()}
      >
        {runMutation.isPending ? (
          <>
            <Loader2 className='size-4 animate-spin' />
            {t('Running…')}
          </>
        ) : (
          t('Run multi-model')
        )}
      </Button>

      {legs.length > 0 && (
        <div className='space-y-2'>
          <p className='text-xs font-medium text-zinc-400'>{t('Legs')}</p>
          {legs.map((leg) => (
            <article
              key={leg.model}
              className='rounded-lg border border-white/[0.08] bg-black/20 p-3'
            >
              <p className='font-mono text-[11px] text-cyan-300'>{leg.model}</p>
              {leg.error ? (
                <p className='mt-1 text-sm text-red-300'>{leg.error}</p>
              ) : (
                <p className='mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-sm text-zinc-200'>
                  {leg.content}
                </p>
              )}
            </article>
          ))}
        </div>
      )}

      {summary && (
        <div className='rounded-xl border border-cyan-400/20 bg-cyan-500/10 p-4'>
          <p className='text-xs font-medium text-cyan-200'>{t('Summary')}</p>
          <p className='mt-2 whitespace-pre-wrap text-sm text-zinc-100'>
            {summary}
          </p>
        </div>
      )}
    </div>
  )
}
