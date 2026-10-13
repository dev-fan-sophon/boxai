import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Trash2 } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { getNotices, type SystemNotice } from '@/lib/api'
import { formatDateTimeObject } from '@/lib/time'

import { deleteSystemNotice, publishSystemNotice } from '../api'
import { SettingsForm } from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'

const noticeSchema = z.object({
  content: z.string().trim().min(1),
})

type NoticeFormValues = z.infer<typeof noticeSchema>

/**
 * Publishing appends a notice; earlier notices stay visible to users until
 * an admin deletes them. Unread notices pop up for users on their next visit.
 */
export function NoticeSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [pendingDelete, setPendingDelete] = useState<SystemNotice | null>(null)
  const form = useForm<NoticeFormValues>({
    resolver: zodResolver(noticeSchema),
    defaultValues: { content: '' },
  })

  const notices = useQuery({ queryKey: ['notices'], queryFn: getNotices })

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['notices'] }),
      queryClient.invalidateQueries({ queryKey: ['system-options'] }),
    ])

  const publish = useMutation({
    mutationFn: publishSystemNotice,
    onSuccess: async (res) => {
      if (!res.success) {
        toast.error(res.message || t('Failed to publish notice'))
        return
      }
      toast.success(t('Notice published'))
      form.reset({ content: '' })
      await refresh()
    },
  })

  const remove = useMutation({
    mutationFn: deleteSystemNotice,
    onSuccess: async (res) => {
      if (!res.success) {
        toast.error(res.message || t('Failed to delete notice'))
        return
      }
      toast.success(t('Notice deleted'))
      setPendingDelete(null)
      await refresh()
    },
  })

  const onSubmit = (values: NoticeFormValues) =>
    publish.mutateAsync(values.content)

  const published = notices.data?.success ? (notices.data.data ?? []) : []

  return (
    <SettingsSection title={t('System Notice')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={publish.isPending}
            saveLabel='Publish notice'
            savingLabel='Publishing...'
          />
          <FormField
            control={form.control}
            name='content'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('New notice')}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={8}
                    placeholder={t(
                      'Planned maintenance on Friday at 22:00 UTC...'
                    )}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Publishing adds a new notice and keeps earlier ones. Users see unread notices when they next open the site.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsForm>
      </Form>

      <div className='mt-6 flex flex-col gap-2'>
        <h4 className='text-sm font-medium'>{t('Published notices')}</h4>
        {published.length === 0 ? (
          <p className='text-muted-foreground text-sm'>
            {t('No announcements at this time')}
          </p>
        ) : (
          <ul className='divide-border flex flex-col divide-y rounded-lg border'>
            {published.map((notice) => (
              <li key={notice.id} className='flex items-start gap-3 p-3'>
                <div className='min-w-0 flex-1'>
                  <p className='line-clamp-3 text-sm break-words whitespace-pre-wrap'>
                    {notice.content}
                  </p>
                  <p className='text-muted-foreground mt-1 text-xs'>
                    {formatDateTimeObject(new Date(notice.created_at * 1000))}
                  </p>
                </div>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-sm'
                  aria-label={t('Delete')}
                  onClick={() => setPendingDelete(notice)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title={t('Delete notice')}
        desc={t('Users will no longer see this notice.')}
        destructive
        confirmText={t('Delete')}
        isLoading={remove.isPending}
        handleConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.id)
        }}
      />
    </SettingsSection>
  )
}
