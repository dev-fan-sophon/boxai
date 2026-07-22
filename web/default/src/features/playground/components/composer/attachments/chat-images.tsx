/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function ChatImageAttachmentStrip(props: {
  attachments: string[]
  onRemove: (index: number) => void
}) {
  const { t } = useTranslation()
  if (props.attachments.length === 0) return null

  return (
    <div className='flex flex-wrap gap-2 px-5 pb-2'>
      {props.attachments.map((src, index) => (
        <div key={src} className='relative'>
          <img
            src={src}
            alt={t('Attachment {{index}}', { index: index + 1 })}
            className='border-border size-14 rounded-lg border object-cover'
          />
          <button
            type='button'
            aria-label={t('Remove attachment')}
            onClick={() => props.onRemove(index)}
            className='bg-background border-border absolute -top-1.5 -right-1.5 rounded-full border p-0.5 shadow-sm'
          >
            <X className='size-3' />
          </button>
        </div>
      ))}
    </div>
  )
}
