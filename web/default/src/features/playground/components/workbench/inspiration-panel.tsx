/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import {
  listInspirationCategories,
  listInspirationTemplates,
  listPlaygroundTasks,
  recordInspirationTemplateUse,
} from '../../api'
import {
  INSPIRATION_CATEGORIES,
  INSPIRATION_TEMPLATES,
  type InspirationTemplate,
} from '../../lib/workbench/inspiration-data'
import {
  MODALITY_COLORS,
  modalityLabelKey,
} from '../../lib/workbench/modality-styles'
import type {
  InspirationWork,
  RecentPrompt,
} from '../../lib/workbench/workbench-prefs'
import type { StudioModality } from '../../types'

type InspirationView = 'square' | 'works' | 'usage'

type InspirationPanelProps = {
  variant?: 'rail' | 'main'
  myWorks: InspirationWork[]
  recentPrompts: RecentPrompt[]
  onApplyTemplate: (template: InspirationTemplate) => void
  onApplyPrompt: (prompt: string, modality: StudioModality) => void
  onRemoveWork?: (id: string) => void
  className?: string
}

export function InspirationPanel(props: InspirationPanelProps) {
  const { t } = useTranslation()
  const [view, setView] = useState<InspirationView>('square')
  const [category, setCategory] = useState<string>('all')
  const [modalityFilter, setModalityFilter] = useState<
    'all' | 'image' | 'video' | 'chat'
  >('all')
  const variant = props.variant ?? 'rail'

  const apiCategories = useQuery({
    queryKey: ['playground', 'inspiration', 'categories'],
    queryFn: listInspirationCategories,
    staleTime: 60_000,
  })
  const apiTemplates = useQuery({
    queryKey: [
      'playground',
      'inspiration',
      'templates',
      category,
      modalityFilter,
    ],
    queryFn: () =>
      listInspirationTemplates({
        category: category === 'all' ? undefined : category,
        modality: modalityFilter === 'all' ? undefined : modalityFilter,
        page_size: 50,
      }),
    staleTime: 60_000,
  })
  const serverWorks = useQuery({
    queryKey: ['playground', 'runs'],
    queryFn: listPlaygroundTasks,
    enabled: view === 'works',
  })

  const categories = useMemo(() => {
    if (apiCategories.data && apiCategories.data.length > 0) {
      return [
        { id: 'all' as const, labelKey: 'All' },
        ...apiCategories.data.map((c) => ({
          id: c.slug as InspirationTemplate['category'] | 'all',
          labelKey: c.name,
        })),
      ]
    }
    return INSPIRATION_CATEGORIES
  }, [apiCategories.data])

  const templates = useMemo(() => {
    if (apiTemplates.data && apiTemplates.data.length > 0) {
      return apiTemplates.data
        .filter((item) => {
          if (modalityFilter !== 'all' && item.modality !== modalityFilter) {
            return false
          }
          return true
        })
        .map(
          (item): InspirationTemplate => ({
            id: String(item.id),
            titleKey: item.title,
            prompt: item.prompt,
            modality: item.modality as InspirationTemplate['modality'],
            category: 'all',
            tagKeys: [],
            coverUrl: item.cover_url,
          })
        )
    }
    return INSPIRATION_TEMPLATES.filter((item) => {
      if (category !== 'all' && item.category !== category) return false
      if (modalityFilter !== 'all' && item.modality !== modalityFilter) {
        return false
      }
      return true
    })
  }, [apiTemplates.data, category, modalityFilter])

  const applyTemplate = (template: InspirationTemplate) => {
    const numericId = Number(template.id)
    if (Number.isFinite(numericId) && numericId > 0) {
      void recordInspirationTemplateUse(numericId)
    }
    props.onApplyTemplate(template)
  }

  const worksList = useMemo(() => {
    const serverRuns = (serverWorks.data?.runs ?? []).map((run) => ({
      id: `run-${run.id}`,
      title: run.prompt.slice(0, 48) || t('Untitled work'),
      prompt: run.prompt,
      modality: run.modality as StudioModality,
      createdAt: run.created_at * 1000,
      model: run.model,
      previewUrl: run.result_url,
    }))
    // Prefer server runs when available, merge local works
    const local = props.myWorks
    if (serverRuns.length === 0) return local
    const localIds = new Set(serverRuns.map((r) => r.id))
    return [...serverRuns, ...local.filter((w) => !localIds.has(w.id))]
  }, [props.myWorks, serverWorks.data?.runs, t])

  const body = (
    <>
      <div
        className='bg-muted/40 ring-border flex gap-1 rounded-lg p-1 ring-1'
        role='tablist'
        aria-label={t('Inspiration views')}
      >
        {(
          [
            ['square', 'Square'],
            ['works', 'My works'],
            ['usage', 'Usage'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type='button'
            role='tab'
            aria-selected={view === id}
            onClick={() => setView(id)}
            className={cn(
              'flex-1 rounded-md px-2 py-1 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
              view === id
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t(label)}
          </button>
        ))}
      </div>

      {view === 'square' && (
        <>
          <div
            className='flex flex-wrap gap-1'
            role='group'
            aria-label={t('Categories')}
          >
            {categories.map((item) => (
              <button
                key={item.id}
                type='button'
                aria-pressed={category === item.id}
                onClick={() => setCategory(item.id)}
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  category === item.id
                    ? 'bg-white/10 text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground/80'
                )}
              >
                {t(item.labelKey)}
              </button>
            ))}
          </div>
          <div className='flex gap-1'>
            {(['all', 'image', 'video', 'chat'] as const).map((item) => (
              <button
                key={item}
                type='button'
                aria-pressed={modalityFilter === item}
                onClick={() => setModalityFilter(item)}
                className={cn(
                  'rounded-md px-2 py-0.5 text-[10px]',
                  modalityFilter === item
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:text-foreground/80'
                )}
              >
                {t(
                  item === 'all' ? 'All' : item[0].toUpperCase() + item.slice(1)
                )}
              </button>
            ))}
          </div>
          <div
            className={cn(
              'grid gap-2',
              variant === 'main'
                ? 'sm:grid-cols-2 lg:grid-cols-3'
                : 'grid-cols-1'
            )}
          >
            {templates.map((template) => (
              <button
                key={template.id}
                type='button'
                onClick={() => applyTemplate(template)}
                className='border-border bg-muted/40 hover:border-primary/30 hover:bg-primary/5 focus-visible:ring-ring overflow-hidden rounded-xl border text-left transition outline-none focus-visible:ring-2'
              >
                {template.coverUrl && (
                  <img
                    src={template.coverUrl}
                    alt={t(template.titleKey)}
                    loading='lazy'
                    className='aspect-video w-full object-cover'
                  />
                )}
                <div className='p-3'>
                  <div className='flex items-center justify-between gap-2'>
                    <span className='text-foreground truncate text-sm font-medium'>
                      {t(template.titleKey)}
                    </span>
                    <span
                      className={cn(
                        'shrink-0 rounded border px-1.5 py-0.5 text-[10px]',
                        MODALITY_COLORS[template.modality as StudioModality]
                          ?.tag ?? MODALITY_COLORS.chat.tag
                      )}
                    >
                      {t(modalityLabelKey(template.modality as StudioModality))}
                    </span>
                  </div>
                  <p className='text-muted-foreground mt-1.5 line-clamp-2 text-[11px]'>
                    {template.prompt}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {view === 'works' && (
        <div className='space-y-2'>
          {worksList.length === 0 && (
            <p className='text-muted-foreground py-8 text-center text-sm'>
              {t('Generations you save will show up here.')}
            </p>
          )}
          {worksList.map((work) => (
            <div
              key={work.id}
              className='border-border bg-muted/40 rounded-xl border p-3'
            >
              <div className='flex items-start justify-between gap-2'>
                <button
                  type='button'
                  className='min-w-0 text-left'
                  onClick={() =>
                    props.onApplyPrompt(work.prompt, work.modality)
                  }
                >
                  <p className='text-foreground truncate text-sm font-medium'>
                    {work.title}
                  </p>
                  <p className='text-muted-foreground mt-1 line-clamp-2 text-[11px]'>
                    {work.prompt}
                  </p>
                </button>
                {props.onRemoveWork && !String(work.id).startsWith('run-') && (
                  <Button
                    size='sm'
                    variant='ghost'
                    className='text-muted-foreground h-7 text-xs'
                    onClick={() => props.onRemoveWork?.(work.id)}
                  >
                    {t('Remove')}
                  </Button>
                )}
              </div>
              {work.previewUrl && work.modality === 'image' && (
                <img
                  src={work.previewUrl}
                  alt={work.title}
                  loading='lazy'
                  className='mt-2 aspect-video w-full rounded-lg object-cover'
                />
              )}
              {work.previewUrl && work.modality === 'video' && (
                <video
                  src={work.previewUrl}
                  controls
                  preload='metadata'
                  className='mt-2 aspect-video w-full rounded-lg bg-black'
                >
                  {t('Your browser does not support video playback.')}
                </video>
              )}
              {work.previewUrl && work.modality === 'audio' && (
                <audio src={work.previewUrl} controls className='mt-2 w-full'>
                  {t('Your browser does not support audio playback.')}
                </audio>
              )}
            </div>
          ))}
        </div>
      )}

      {view === 'usage' && (
        <div className='space-y-2'>
          {props.recentPrompts.length === 0 && (
            <p className='text-muted-foreground py-8 text-center text-sm'>
              {t('Recent prompts from this browser will appear here.')}
            </p>
          )}
          {props.recentPrompts.map((item) => (
            <button
              key={item.id}
              type='button'
              onClick={() => props.onApplyPrompt(item.prompt, item.modality)}
              className='border-border bg-muted/40 hover:border-primary/30 w-full rounded-xl border p-3 text-left'
            >
              <p className='text-foreground line-clamp-2 text-sm'>
                {item.prompt}
              </p>
              <p className='text-muted-foreground mt-1 font-mono text-[10px]'>
                {item.model} · {t(modalityLabelKey(item.modality))}
              </p>
            </button>
          ))}
        </div>
      )}
    </>
  )

  if (variant === 'main') {
    return (
      <div
        className={cn(
          'min-h-0 flex-1 space-y-4 overflow-y-auto p-4 md:p-8',
          props.className
        )}
      >
        <div>
          <h1 className='text-foreground text-2xl font-semibold'>
            {t('Inspiration')}
          </h1>
          <p className='text-muted-foreground mt-1 text-sm'>
            {t('Templates, saved works, and recent prompts for faster starts.')}
          </p>
        </div>
        {body}
      </div>
    )
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col', props.className)}>
      <div className='border-border border-b p-3'>
        <h2 className='text-foreground text-sm font-semibold'>
          {t('Inspiration')}
        </h2>
        <p className='text-muted-foreground text-[11px]'>
          {t('Templates & history')}
        </p>
      </div>
      <div className='min-h-0 flex-1 space-y-3 overflow-y-auto p-2'>{body}</div>
    </div>
  )
}
