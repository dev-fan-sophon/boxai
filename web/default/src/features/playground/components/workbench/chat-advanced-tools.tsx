/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Brain, History, Settings2, Theater, Globe, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import {
  createPersona,
  deletePersona,
  listPersonas,
} from '../../api'
import {
  MAX_SYSTEM_PROMPT_CHARS,
  type WorkbenchChatTools,
} from '../../lib/workbench/workbench-prefs'

type ChatAdvancedToolsProps = {
  tools: WorkbenchChatTools
  onToolsChange: (patch: Partial<WorkbenchChatTools>) => void
  className?: string
}

export function ChatAdvancedTools(props: ChatAdvancedToolsProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [roleOpen, setRoleOpen] = useState(false)
  const [draftPrompt, setDraftPrompt] = useState(props.tools.systemPrompt)
  const [personaName, setPersonaName] = useState('')

  const personasQuery = useQuery({
    queryKey: ['playground', 'personas'],
    queryFn: listPersonas,
    enabled: roleOpen,
  })

  const savePersonaMutation = useMutation({
    mutationFn: () =>
      createPersona({
        name: personaName.trim() || t('Persona'),
        system_prompt: draftPrompt.slice(0, MAX_SYSTEM_PROMPT_CHARS),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['playground', 'personas'] })
      toast.success(t('Persona saved to cloud'))
      setPersonaName('')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <div
      className={cn('flex flex-wrap items-center gap-1.5', props.className)}
    >
      <button
        type='button'
        className={cn(
          chipClass,
          props.tools.webSearch && 'border-primary/40 text-primary'
        )}
        aria-pressed={props.tools.webSearch}
        onClick={() => {
          const next = !props.tools.webSearch
          props.onToolsChange({ webSearch: next })
          toast.info(
            next
              ? t('Web search preference saved')
              : t('Web search preference off'),
            {
              description: next
                ? t(
                    'When enabled, the server runs a search pre-pass if PLAYGROUND_SEARCH_URL is configured.'
                  )
                : t('Web search will not run on the next send.'),
            }
          )
        }}
      >
        <Globe className='size-3' aria-hidden='true' />
        {t('Web search')}
      </button>

      <button
        type='button'
        className={cn(
          chipClass,
          props.tools.longMemory && 'border-primary/40 text-primary'
        )}
        aria-pressed={props.tools.longMemory}
        onClick={() => {
          const next = !props.tools.longMemory
          props.onToolsChange({ longMemory: next })
          toast.info(next ? t('Long memory on') : t('Long memory off'), {
            description: t(
              'Stored as a local workbench flag. Server-side memory is not wired yet.'
            ),
          })
        }}
      >
        <Brain className='size-3' aria-hidden='true' />
        {t('Long memory')}
      </button>

      <button
        type='button'
        className={chipClass}
        onClick={() => {
          setDraftPrompt(props.tools.systemPrompt)
          setRoleOpen(true)
        }}
      >
        <Theater className='size-3' aria-hidden='true' />
        {t('Role play')}
      </button>

      <button
        type='button'
        className={chipClass}
        onClick={() => setAdvancedOpen(true)}
      >
        <Settings2 className='size-3' aria-hidden='true' />
        {t('Advanced')}
      </button>

      <Dialog
        open={roleOpen}
        onOpenChange={setRoleOpen}
        title={t('Role play')}
        description={t(
          'Set a system persona. It is prepended to chat requests when non-empty. Save to cloud to reuse later.'
        )}
        contentClassName='sm:max-w-lg border-border bg-popover text-foreground'
        footer={
          <>
            <Button variant='outline' onClick={() => setRoleOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button
              variant='outline'
              disabled={!draftPrompt.trim() || savePersonaMutation.isPending}
              onClick={() => savePersonaMutation.mutate()}
            >
              {t('Save to cloud')}
            </Button>
            <Button
              onClick={() => {
                props.onToolsChange({
                  systemPrompt: draftPrompt.slice(0, MAX_SYSTEM_PROMPT_CHARS),
                })
                setRoleOpen(false)
                toast.success(t('Persona saved'))
              }}
            >
              {t('Apply')}
            </Button>
          </>
        }
      >
        <div className='space-y-3'>
          {(personasQuery.data?.length ?? 0) > 0 && (
            <div className='space-y-1.5'>
              <p className='text-xs font-medium text-muted-foreground'>
                {t('Saved personas')}
              </p>
              <ul className='max-h-28 space-y-1 overflow-y-auto'>
                {personasQuery.data?.map((persona) => (
                  <li
                    key={persona.id}
                    className='flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1'
                  >
                    <button
                      type='button'
                      className='min-w-0 flex-1 truncate text-left text-sm text-foreground hover:text-primary'
                      onClick={() => {
                        setDraftPrompt(persona.system_prompt)
                        props.onToolsChange({
                          systemPrompt: persona.system_prompt,
                        })
                        toast.success(t('Persona applied'))
                      }}
                    >
                      {persona.name}
                    </button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className='size-7 text-muted-foreground hover:text-destructive'
                      aria-label={t('Delete')}
                      onClick={() => {
                        void deletePersona(persona.id).then(() =>
                          queryClient.invalidateQueries({
                            queryKey: ['playground', 'personas'],
                          })
                        )
                      }}
                    >
                      <Trash2 className='size-3.5' />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className='space-y-2'>
            <Label htmlFor='workbench-persona-name'>{t('Name (for cloud save)')}</Label>
            <input
              id='workbench-persona-name'
              value={personaName}
              onChange={(e) => setPersonaName(e.target.value)}
              className='border-input bg-background h-9 w-full rounded-md border px-3 text-sm'
              placeholder={t('Creative director')}
            />
            <Label htmlFor='workbench-system-prompt'>{t('System prompt')}</Label>
            <Textarea
              id='workbench-system-prompt'
              value={draftPrompt}
              maxLength={MAX_SYSTEM_PROMPT_CHARS}
              onChange={(event) =>
                setDraftPrompt(event.target.value.slice(0, MAX_SYSTEM_PROMPT_CHARS))
              }
              rows={6}
              placeholder={t('You are a helpful creative assistant…')}
            />
            <p className='text-muted-foreground text-xs tabular-nums'>
              {draftPrompt.length}/{MAX_SYSTEM_PROMPT_CHARS}
            </p>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        title={t('Advanced chat settings')}
        description={t(
          'Workbench preferences applied to chat: history, system prompt, web search, and tool-loop bounds.'
        )}
        contentClassName='sm:max-w-md border-border bg-popover text-foreground'
        footer={
          <Button onClick={() => setAdvancedOpen(false)}>{t('Done')}</Button>
        }
      >
        <div className='space-y-4'>
          <ToggleRow
            id='wb-carry-history'
            label={t('Carry history')}
            description={t('Include prior turns from this conversation.')}
            checked={props.tools.carryHistory}
            onCheckedChange={(checked) =>
              props.onToolsChange({ carryHistory: checked })
            }
            icon={History}
          />
          <ToggleRow
            id='wb-web-search'
            label={t('Web search')}
            description={t(
              'Run a server search pre-pass when PLAYGROUND_SEARCH_URL is set.'
            )}
            checked={props.tools.webSearch}
            onCheckedChange={(checked) =>
              props.onToolsChange({ webSearch: checked })
            }
            icon={Globe}
          />
          <ToggleRow
            id='wb-long-memory'
            label={t('Long memory')}
            description={t(
              'Mark this session as memory-aware (local flag).'
            )}
            checked={props.tools.longMemory}
            onCheckedChange={(checked) =>
              props.onToolsChange({ longMemory: checked })
            }
            icon={Brain}
          />
          <div className='space-y-1.5'>
            <Label htmlFor='wb-tool-loops'>{t('Max tool loops')}</Label>
            <input
              id='wb-tool-loops'
              type='number'
              min={1}
              max={20}
              value={props.tools.maxToolLoops}
              onChange={(event) => {
                const value = Number(event.target.value)
                if (!Number.isFinite(value)) return
                props.onToolsChange({
                  maxToolLoops: Math.min(20, Math.max(1, Math.round(value))),
                })
              }}
              className='border-input bg-background h-9 w-full rounded-md border px-3 text-sm'
            />
            <p className='text-muted-foreground text-xs'>
              {t('Sent as max_tool_loops with web search requests.')}
            </p>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

function ToggleRow(props: {
  id: string
  label: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  icon: typeof Globe
}) {
  const Icon = props.icon
  return (
    <div className='flex items-start justify-between gap-3'>
      <div className='min-w-0 space-y-0.5'>
        <Label htmlFor={props.id} className='flex items-center gap-1.5'>
          <Icon className='size-3.5' aria-hidden='true' />
          {props.label}
        </Label>
        <p className='text-muted-foreground text-xs text-pretty'>
          {props.description}
        </p>
      </div>
      <Switch
        id={props.id}
        checked={props.checked}
        onCheckedChange={props.onCheckedChange}
      />
    </div>
  )
}

const chipClass = cn(
  'inline-flex h-7 items-center gap-1 rounded-lg border border-border bg-muted/40 px-2 text-[11px] font-medium text-foreground/80',
  'outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'
)
