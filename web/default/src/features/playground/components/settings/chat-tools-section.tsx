import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Brain,
  ChartColumn,
  History,
  Theater,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { usePlaygroundStore } from '@/stores/playground-store'

import {
  clearUserMemories,
  createPersona,
  deletePersona,
  deleteUserMemory,
  listPersonas,
  listUserMemories,
} from '../../api'
import { MAX_SYSTEM_PROMPT_CHARS } from '../../lib/workbench/workbench-prefs'

/**
 * Chat tool preferences: web search, history carry-over, long memory,
 * tool-loop bounds, and the system-prompt persona editor.
 */
export function ChatToolsSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const chatTools = usePlaygroundStore((state) => state.chatTools)
  const setChatTools = usePlaygroundStore((state) => state.setChatTools)
  const [roleOpen, setRoleOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [draftPrompt, setDraftPrompt] = useState('')
  const [personaName, setPersonaName] = useState('')

  const memoriesQuery = useQuery({
    queryKey: ['playground', 'memories'],
    queryFn: listUserMemories,
    enabled: memoryOpen,
  })
  const invalidateMemories = () =>
    queryClient.invalidateQueries({ queryKey: ['playground', 'memories'] })

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
      void queryClient.invalidateQueries({
        queryKey: ['playground', 'personas'],
      })
      toast.success(t('Persona saved to cloud'))
      setPersonaName('')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  // The platform base prompt is always applied; a persona only layers on top.
  const hasPersona = chatTools.systemPrompt.trim().length > 0

  return (
    <div className='space-y-3'>
      <ToggleRow
        id='settings-carry-history'
        label={t('Carry history')}
        description={t('Include prior turns from this conversation.')}
        checked={chatTools.carryHistory}
        onCheckedChange={(checked) => setChatTools({ carryHistory: checked })}
        icon={History}
      />
      <ToggleRow
        id='settings-long-memory'
        label={t('Long memory')}
        description={t(
          'Remember key facts about you and reuse them across conversations.'
        )}
        checked={chatTools.longMemory}
        onCheckedChange={(checked) => setChatTools({ longMemory: checked })}
        icon={Brain}
      />
      {chatTools.longMemory && (
        <div className='flex justify-end'>
          <Button
            size='sm'
            variant='outline'
            className='h-7 text-xs'
            onClick={() => setMemoryOpen(true)}
          >
            {t('Manage memory')}
          </Button>
        </div>
      )}
      <ToggleRow
        id='settings-visual-output'
        label={t('Visual output')}
        description={t(
          'Let the model reply with charts, diagrams, formulas, and interactive HTML.'
        )}
        checked={chatTools.visualOutput}
        onCheckedChange={(checked) => setChatTools({ visualOutput: checked })}
        icon={ChartColumn}
      />

      <div className='space-y-1.5'>
        <div className='flex items-center justify-between gap-2'>
          <Label className='flex items-center gap-1.5 text-xs'>
            <Theater className='size-3.5' aria-hidden='true' />
            {t('Role play')}
          </Label>
          <Button
            size='sm'
            variant='outline'
            className='h-7 text-xs'
            onClick={() => {
              setDraftPrompt(chatTools.systemPrompt)
              setRoleOpen(true)
            }}
          >
            {hasPersona ? t('Edit persona') : t('Set persona')}
          </Button>
        </div>
        {hasPersona && (
          <p className='text-muted-foreground line-clamp-2 text-[11px]'>
            {chatTools.systemPrompt}
          </p>
        )}
      </div>

      <Dialog
        open={roleOpen}
        onOpenChange={setRoleOpen}
        title={t('Role play')}
        description={t(
          'Add a role or style on top of the default assistant behavior. Save to cloud to reuse later.'
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
                setChatTools({
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
              <p className='text-muted-foreground text-xs font-medium'>
                {t('Saved personas')}
              </p>
              <ul className='max-h-28 space-y-1 overflow-y-auto'>
                {personasQuery.data?.map((persona) => (
                  <li
                    key={persona.id}
                    className='border-border bg-muted/40 flex items-center gap-1 rounded-md border px-2 py-1'
                  >
                    <button
                      type='button'
                      className='text-foreground hover:text-primary min-w-0 flex-1 truncate text-left text-sm'
                      onClick={() => {
                        setDraftPrompt(persona.system_prompt)
                        setChatTools({ systemPrompt: persona.system_prompt })
                        toast.success(t('Persona applied'))
                      }}
                    >
                      {persona.name}
                    </button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className='text-muted-foreground hover:text-destructive size-7'
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
            <Label htmlFor='settings-persona-name'>
              {t('Name (for cloud save)')}
            </Label>
            <input
              id='settings-persona-name'
              value={personaName}
              onChange={(e) => setPersonaName(e.target.value)}
              className='border-input bg-background h-9 w-full rounded-md border px-3 text-sm'
              placeholder={t('Creative director')}
            />
            <Label htmlFor='settings-system-prompt'>{t('System prompt')}</Label>
            <Textarea
              id='settings-system-prompt'
              value={draftPrompt}
              maxLength={MAX_SYSTEM_PROMPT_CHARS}
              onChange={(event) =>
                setDraftPrompt(
                  event.target.value.slice(0, MAX_SYSTEM_PROMPT_CHARS)
                )
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
        open={memoryOpen}
        onOpenChange={setMemoryOpen}
        title={t('Long memory')}
        description={t(
          'Facts saved from your conversations and shared with the model on every chat turn.'
        )}
        contentClassName='sm:max-w-lg border-border bg-popover text-foreground'
        footer={
          <>
            <Button
              variant='outline'
              disabled={(memoriesQuery.data?.items.length ?? 0) === 0}
              onClick={() => {
                void clearUserMemories()
                  .then(() => {
                    void invalidateMemories()
                    toast.success(t('Memories cleared'))
                  })
                  .catch((error: unknown) => {
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : t('Request error occurred')
                    )
                  })
              }}
            >
              {t('Clear all')}
            </Button>
            <Button onClick={() => setMemoryOpen(false)}>{t('Close')}</Button>
          </>
        }
      >
        <div className='space-y-2'>
          {memoriesQuery.data?.enabled === false && (
            <p className='text-warning text-xs'>
              {t(
                'Automatic memory extraction is not configured on this server.'
              )}
            </p>
          )}
          {(memoriesQuery.data?.items.length ?? 0) === 0 ? (
            <p className='text-muted-foreground text-sm'>
              {t(
                'No memories saved yet. They are collected automatically as you chat.'
              )}
            </p>
          ) : (
            <ul className='max-h-64 space-y-1 overflow-y-auto'>
              {memoriesQuery.data?.items.map((memory) => (
                <li
                  key={memory.id}
                  className='border-border bg-muted/40 flex items-start gap-1 rounded-md border px-2 py-1.5'
                >
                  <span className='text-foreground min-w-0 flex-1 text-sm break-words'>
                    {memory.content}
                  </span>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='text-muted-foreground hover:text-destructive size-7 shrink-0'
                    aria-label={t('Delete')}
                    onClick={() => {
                      void deleteUserMemory(memory.id)
                        .then(() => {
                          void invalidateMemories()
                          toast.success(t('Memory deleted'))
                        })
                        .catch((error: unknown) => {
                          toast.error(
                            error instanceof Error
                              ? error.message
                              : t('Request error occurred')
                          )
                        })
                    }}
                  >
                    <Trash2 className='size-3.5' />
                  </Button>
                </li>
              ))}
            </ul>
          )}
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
  icon: LucideIcon
}) {
  const Icon = props.icon
  return (
    <div className='flex items-start justify-between gap-3'>
      <div className='min-w-0 space-y-0.5'>
        <Label htmlFor={props.id} className='flex items-center gap-1.5 text-xs'>
          <Icon className='size-3.5' aria-hidden='true' />
          {props.label}
        </Label>
        <p className='text-muted-foreground text-[11px] text-pretty'>
          {props.description}
        </p>
      </div>
      <Switch
        id={props.id}
        checked={props.checked}
        onCheckedChange={props.onCheckedChange}
        size='sm'
      />
    </div>
  )
}
