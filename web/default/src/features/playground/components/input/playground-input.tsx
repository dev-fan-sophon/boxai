/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { ImagePlus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  PromptInput,
  PromptInputFooter,
  PromptInputTextarea,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'
import { Button } from '@/components/ui/button'

import { getSubmittableInputText } from '../../lib'
import type {
  ModelOption,
  GroupOption,
  ParameterEnabled,
  PlaygroundConfig,
} from '../../types'
import { PlaygroundInputControls } from './playground-input-controls'
import { PlaygroundInputTools } from './playground-input-tools'

const MAX_ATTACHMENTS = 4
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024

interface PlaygroundInputProps {
  config: PlaygroundConfig
  onSubmit: (text: string, attachments?: string[]) => boolean
  onStop?: () => void
  disabled?: boolean
  isGenerating?: boolean
  models: ModelOption[]
  modelValue: string
  onModelChange: (value: string) => void
  isModelLoading?: boolean
  groups: GroupOption[]
  groupValue: string
  onGroupChange: (value: string) => void
  hasMessages?: boolean
  onConfigChange: <K extends keyof PlaygroundConfig>(
    key: K,
    value: PlaygroundConfig[K]
  ) => void
  onClearMessages?: () => void
  onParameterEnabledChange: (
    key: keyof ParameterEnabled,
    value: boolean
  ) => void
  parameterEnabled: ParameterEnabled
  /** External prompt prefill from inspiration / agents */
  prefillText?: string
  onPrefillConsumed?: () => void
}

export function PlaygroundInput({
  config,
  onSubmit,
  onStop,
  disabled,
  isGenerating,
  models,
  modelValue,
  onModelChange,
  isModelLoading = false,
  groups,
  groupValue,
  onGroupChange,
  hasMessages = false,
  onConfigChange,
  onClearMessages,
  onParameterEnabledChange,
  parameterEnabled,
  prefillText,
  onPrefillConsumed,
}: PlaygroundInputProps) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (prefillText == null) return
    setText(prefillText)
    onPrefillConsumed?.()
  }, [prefillText, onPrefillConsumed])

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const remaining = MAX_ATTACHMENTS - attachments.length
    if (remaining <= 0) {
      toast.error(
        t('You can attach up to {{count}} images.', { count: MAX_ATTACHMENTS })
      )
      return
    }
    for (const file of [...files].slice(0, remaining)) {
      if (!file.type.startsWith('image/')) {
        toast.error(t('Only image attachments are supported.'))
        continue
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error(t('Image is too large (max 8MB).'))
        continue
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.addEventListener('load', () => resolve(String(reader.result)), {
          once: true,
        })
        reader.addEventListener('error', () => reject(reader.error), {
          once: true,
        })
        reader.readAsDataURL(file)
      })
      setAttachments((prev) =>
        prev.length < MAX_ATTACHMENTS ? [...prev, dataUrl] : prev
      )
    }
  }

  const handleSubmit = (message: PromptInputMessage) => {
    const submittableText = getSubmittableInputText(message, disabled)

    if (!submittableText && attachments.length === 0) return
    if (onSubmit(submittableText ?? '', attachments)) {
      setText('')
      setAttachments([])
    }
  }

  return (
    <div className='grid shrink-0 gap-4 px-1 md:pb-4'>
      <PromptInput
        className='relative'
        groupClassName='bg-background/95 dark:bg-background/80 border-border/70 shadow-[0_18px_60px_-32px_rgba(0,0,0,0.65)] ring-1 ring-foreground/5 rounded-xl overflow-hidden transition-all duration-200 focus-within:border-primary/45 focus-within:ring-primary/15 focus-within:shadow-[0_22px_70px_-34px_rgba(0,0,0,0.75)]'
        onSubmit={handleSubmit}
      >
        <PromptInputTextarea
          autoComplete='off'
          autoCorrect='off'
          autoCapitalize='off'
          spellCheck={false}
          className='min-h-20 px-5 pt-4 pb-3 leading-7 md:min-h-24 md:text-base'
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('Ask anything')}
          value={text}
        />

        {attachments.length > 0 && (
          <div className='flex flex-wrap gap-2 px-5 pb-2'>
            {attachments.map((src, index) => (
              <div key={src} className='relative'>
                <img
                  src={src}
                  alt={t('Attachment {{index}}', { index: index + 1 })}
                  className='border-border size-14 rounded-lg border object-cover'
                />
                <button
                  type='button'
                  aria-label={t('Remove attachment')}
                  onClick={() =>
                    setAttachments((prev) => prev.filter((_, i) => i !== index))
                  }
                  className='bg-background border-border absolute -top-1.5 -right-1.5 rounded-full border p-0.5 shadow-sm'
                >
                  <X className='size-3' />
                </button>
              </div>
            ))}
          </div>
        )}

        <input
          ref={fileInputRef}
          type='file'
          accept='image/*'
          multiple
          className='hidden'
          onChange={(event) => {
            void handleFiles(event.target.files)
            event.target.value = ''
          }}
        />

        <PromptInputFooter className='border-border/60 bg-muted/20 dark:bg-muted/10 border-t px-3 py-2.5 backdrop-blur'>
          <PlaygroundInputControls
            disabled={disabled}
            groups={groups}
            groupValue={groupValue}
            isGenerating={isGenerating}
            isModelLoading={isModelLoading}
            models={models}
            modelValue={modelValue}
            onGroupChange={onGroupChange}
            onModelChange={onModelChange}
            onStop={onStop}
            text={text}
            tools={
              <>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className='text-muted-foreground hover:text-foreground size-8'
                  disabled={disabled || attachments.length >= MAX_ATTACHMENTS}
                  aria-label={t('Attach image')}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImagePlus className='size-4' />
                </Button>
                <PlaygroundInputTools
                  config={config}
                  disabled={disabled}
                  hasMessages={hasMessages}
                  onConfigChange={onConfigChange}
                  onClearMessages={onClearMessages}
                  onParameterEnabledChange={onParameterEnabledChange}
                  parameterEnabled={parameterEnabled}
                />
              </>
            }
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  )
}
