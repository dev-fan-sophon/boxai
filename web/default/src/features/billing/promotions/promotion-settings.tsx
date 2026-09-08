import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TitledCard } from '@/components/ui/titled-card'
import { api } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'

import { getPromotion, type Promotion } from './api'
import { topUpRequestOptions, topUpErrorMessage } from './errors'

const schema = z
  .object({
    id: z.number(),
    enabled: z.boolean(),
    starts_at: z.number().int().min(0),
    ends_at: z.number().int().min(0),
    min_amount: z.number().int().min(0),
    percent_off: z.number().int().min(1).max(100),
    max_discount: z.number().int().min(0),
    per_user_limit: z.number().int().min(0),
    total_budget: z.number().int().min(0),
    banner_enabled: z.boolean(),
    banner_text: z.string(),
    banner_position: z.enum(['console_top', 'billing', 'both']),
  })
  .refine((value) => !value.ends_at || value.ends_at > value.starts_at, {
    path: ['ends_at'],
    message: 'Invalid time range',
  })

export function PromotionSettings() {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['admin-topup-promotion'],
    queryFn: () => getPromotion(true),
  })
  return (
    <div className='space-y-6'>
      <TitledCard
        title={t('Top-up promotion')}
        description={t(
          'Bank QR balance top-ups only. Zero limits mean unlimited; blank dates have no boundary.'
        )}
      >
        {query.isPending && <p>{t('Loading...')}</p>}
        {query.isError && (
          <Button variant='outline' onClick={() => void query.refetch()}>
            {t('Retry')}
          </Button>
        )}
        {query.data && <PromotionForm promotion={query.data} />}
      </TitledCard>
    </div>
  )
}

function PromotionForm(props: { promotion: Promotion }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const form = useForm<Promotion>({
    resolver: zodResolver(schema),
    defaultValues: props.promotion,
  })
  const mutation = useMutation({
    mutationFn: async (value: Promotion) => {
      const response = await api.put(
        '/api/topup/promotion',
        value,
        topUpRequestOptions
      )
      if (!response.data.success) {
        throw new Error(topUpErrorMessage(response.data))
      }
      return value
    },
    onSuccess: (value) => {
      form.reset(value)
      toast.success(t('Saved successfully'))
      void client.invalidateQueries({ queryKey: ['topup-promotion'] })
      void client.invalidateQueries({ queryKey: ['admin-topup-promotion'] })
    },
    onError: (error) => {
      if (error instanceof Error) toast.error(error.message)
      else handleServerError(error)
    },
  })
  const fields = [
    { key: 'min_amount', label: t('Minimum face amount (VND)') },
    { key: 'percent_off', label: t('Discount percent') },
    { key: 'max_discount', label: t('Maximum discount (VND)') },
    { key: 'per_user_limit', label: t('Uses per user') },
    { key: 'total_budget', label: t('Total discount budget (VND)') },
  ] as const
  return (
    <form
      className='space-y-4'
      onSubmit={form.handleSubmit((value) => mutation.mutate(value))}
    >
      <label className='flex items-center gap-2 text-sm'>
        <input type='checkbox' {...form.register('enabled')} />
        {t('Enable promotion')}
      </label>
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
        {fields.map((field) => (
          <label key={field.key} className='space-y-1 text-sm'>
            {field.label}
            <Input
              type='number'
              min={field.key === 'percent_off' ? 1 : 0}
              max={field.key === 'percent_off' ? 100 : undefined}
              step={1}
              {...form.register(field.key, { valueAsNumber: true })}
            />
          </label>
        ))}
        <PromotionDates
          startsAt={form.watch('starts_at')}
          endsAt={form.watch('ends_at')}
          onChange={(key, value) =>
            form.setValue(key, value, { shouldDirty: true })
          }
        />
      </div>
      <label className='flex items-center gap-2 text-sm'>
        <input type='checkbox' {...form.register('banner_enabled')} />
        {t('Show promotion banner')}
      </label>
      <label className='block space-y-1 text-sm'>
        {t('Banner text (blank uses translated default)')}
        <Input {...form.register('banner_text')} />
      </label>
      <label className='block space-y-1 text-sm'>
        {t('Banner position')}
        <select
          className='bg-background block w-full rounded-md border p-2'
          {...form.register('banner_position')}
        >
          <option value='console_top'>{t('Console top')}</option>
          <option value='billing'>{t('Billing page')}</option>
          <option value='both'>{t('Both')}</option>
        </select>
      </label>
      {Object.keys(form.formState.errors).length > 0 && (
        <p role='alert' className='text-destructive text-sm'>
          {t('Check amounts, limits and date range.')}
        </p>
      )}
      <Button type='submit' disabled={mutation.isPending}>
        {t('Save promotion')}
      </Button>
    </form>
  )
}

export function PromotionDates(props: {
  startsAt: number
  endsAt: number
  onChange: (key: 'starts_at' | 'ends_at', value: number) => void
}) {
  const { t } = useTranslation()
  return (
    <>
      {(
        [
          { key: 'starts_at', label: t('Starts at'), value: props.startsAt },
          { key: 'ends_at', label: t('Ends at'), value: props.endsAt },
        ] as const
      ).map((field) => {
        let value = ''
        if (field.value) {
          const date = new Date(field.value * 1000)
          value = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16)
        }
        return (
          <label key={field.key} className='block space-y-1 text-sm'>
            {field.label}
            <Input
              type='datetime-local'
              value={value}
              onChange={(event) =>
                props.onChange(
                  field.key,
                  event.target.value
                    ? Math.floor(new Date(event.target.value).getTime() / 1000)
                    : 0
                )
              }
            />
          </label>
        )
      })}
    </>
  )
}
