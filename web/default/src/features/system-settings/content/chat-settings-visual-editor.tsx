import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table/static/static-data-table'
import { StaticRowActions } from '@/components/data-table/static/static-row-actions'
import { Plus, Search } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { safeJsonParseWithValidation } from '../utils/json-parser'
import { isArray } from '../utils/json-validators'
import { ChatDialog, type ChatEntryData } from './chat-dialog'

type ChatSettingsVisualEditorProps = {
  value: string
  onChange: (value: string) => void
}

type ChatEntry = ChatEntryData

export function ChatSettingsVisualEditor({
  value,
  onChange,
}: ChatSettingsVisualEditorProps) {
  const { t } = useTranslation()
  const [searchText, setSearchText] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editData, setEditData] = useState<ChatEntry | null>(null)

  const chats = useMemo(() => {
    const parsed = safeJsonParseWithValidation<unknown[]>(value, {
      fallback: [],
      validator: isArray,
      validatorMessage: 'Chats must be a JSON array',
      context: 'chats',
    })

    return parsed
      .map((item) => {
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
          const entries = Object.entries(item)
          if (entries.length === 1) {
            const [name, url] = entries[0]
            return { name, url: String(url) }
          }
        }
        return null
      })
      .filter((item): item is ChatEntry => item !== null)
  }, [value])

  const filteredChats = useMemo(() => {
    if (!searchText) return chats
    const lowerSearch = searchText.toLowerCase()
    return chats.filter(
      (chat) =>
        chat.name.toLowerCase().includes(lowerSearch) ||
        chat.url.toLowerCase().includes(lowerSearch)
    )
  }, [chats, searchText])

  const handleSave = (data: ChatEntryData) => {
    const chatsArray = safeJsonParseWithValidation<unknown[]>(value, {
      fallback: [],
      validator: isArray,
      silent: true,
    })

    let updatedArray = [...chatsArray]

    if (editData) {
      updatedArray = updatedArray.filter((item) => {
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
          return !Object.keys(item).includes(editData.name)
        }
        return true
      })
    }

    updatedArray.push({ [data.name]: data.url })

    onChange(JSON.stringify(updatedArray, null, 2))
  }

  const handleDelete = (name: string) => {
    const chatsArray = safeJsonParseWithValidation<unknown[]>(value, {
      fallback: [],
      validator: isArray,
      silent: true,
    })

    const updatedArray = chatsArray.filter((item) => {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        return !Object.keys(item).includes(name)
      }
      return true
    })

    onChange(JSON.stringify(updatedArray, null, 2))
  }

  const handleEdit = (chat: ChatEntry) => {
    setEditData(chat)
    setDialogOpen(true)
  }

  const handleAdd = () => {
    setEditData(null)
    setDialogOpen(true)
  }

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <div className='relative min-w-48 flex-1'>
          <Search
            className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2'
            aria-hidden='true'
          />
          <Input
            placeholder={t('Search chat presets...')}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className='h-8 pl-8'
          />
        </div>
        <Button size='sm' onClick={handleAdd}>
          <Plus data-icon='inline-start' />
          {t('Add chat preset')}
        </Button>
      </div>

      <StaticDataTable
        data={filteredChats}
        getRowKey={(chat) => chat.name}
        emptyContent={
          searchText
            ? t('No chat presets match your search')
            : t(
                'No chat presets configured. Click "Add chat preset" to get started.'
              )
        }
        columns={[
          {
            id: 'name',
            header: t('Chat Client Name'),
            cellClassName: 'font-medium',
            cell: (chat) => chat.name,
          },
          {
            id: 'url',
            header: t('URL'),
            cellClassName: 'max-w-md truncate font-mono text-sm',
            cell: (chat) => chat.url,
          },
          {
            id: 'actions',
            header: t('Actions'),
            className: 'text-right',
            cellClassName: 'text-right',
            cell: (chat) => (
              <StaticRowActions
                editLabel={t('Edit')}
                deleteLabel={t('Delete')}
                menuLabel={t('Open menu')}
                onEdit={() => handleEdit(chat)}
                onDelete={() => handleDelete(chat.name)}
              />
            ),
          },
        ]}
      />

      <ChatDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={handleSave}
        editData={editData}
      />
    </div>
  )
}
