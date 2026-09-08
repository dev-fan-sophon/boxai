import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { TitledCard } from '@/components/ui/titled-card'
import { updateSystemOption } from '@/features/system-settings/api'
import { handleServerError } from '@/lib/handle-server-error'

const schema = z
  .object({ enabled: z.boolean(), recipients: z.array(z.email()).max(10) })
  .refine((value) => !value.enabled || value.recipients.length > 0, {
    path: ['recipients'],
  })
type Settings = z.infer<typeof schema>

export function ReviewNotificationSettings(props: { value?: string }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  let defaults: Settings = { enabled: false, recipients: [] }
  try {
    const parsed = schema.safeParse(JSON.parse(props.value || '{}'))
    if (parsed.success) defaults = parsed.data
  } catch {
    /* Older installations have no notification configuration. */
  }
  const form = useForm<Settings>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  })
  const mutation = useMutation({
    mutationFn: async (value: Settings) => {
      const response = await updateSystemOption({
        key: 'TopUpReviewNotificationSettings',
        value: JSON.stringify(value),
      })
      if (!response.success) throw new Error(response.message)
      return value
    },
    onSuccess: (value) => {
      form.reset(value)
      toast.success(t('Saved successfully'))
      void client.invalidateQueries({ queryKey: ['system-options'] })
    },
    onError: handleServerError,
  })
  return (
    <TitledCard
      title={t('Payment review email alerts')}
      description={t(
        'Configure SMTP first. New payment proofs notify these administrators; failed emails are retried automatically.'
      )}
    >
      <form
        className='space-y-4'
        onSubmit={form.handleSubmit((value) => mutation.mutate(value))}
      >
        <label className='flex items-center gap-2 text-sm'>
          <input type='checkbox' {...form.register('enabled')} />
          {t('Enable email alerts')}
        </label>
        <label className='block space-y-1 text-sm'>
          {t('Recipient emails (one per line, up to 10)')}
          <Textarea
            defaultValue={defaults.recipients.join('\n')}
            onChange={(event) =>
              form.setValue(
                'recipients',
                event.target.value
                  .split(/[\n,;]/)
                  .map((value) => value.trim())
                  .filter(Boolean),
                { shouldDirty: true }
              )
            }
          />
        </label>
        {form.formState.errors.recipients && (
          <p role='alert' className='text-destructive text-sm'>
            {t(
              'Enter up to 10 valid email addresses; at least one is required when enabled.'
            )}
          </p>
        )}
        <Button type='submit' disabled={mutation.isPending}>
          {t('Save email alerts')}
        </Button>
      </form>
    </TitledCard>
  )
}
