import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useFieldArray, useForm, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Plus, Trash2 } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { TitledCard } from '@/components/ui/titled-card'
import { toIntlLocale } from '@/i18n/languages'
import { api } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'

import { getPromotion, type Promotion } from './api'
import { topUpRequestOptions, topUpErrorMessage } from './errors'
import { bestPromotionTier } from './tiers'

const MAX_TIERS = 10
// Mirrors model.MaxTopUpFaceVND: thresholds and caps stay below the order limit.
const MAX_FACE_VND = 500_000_000

const tierSchema = z.object({
  min_amount: z.number().int().min(0).lt(MAX_FACE_VND),
  percent_off: z.number().int().min(1).max(100),
  max_discount: z.number().int().min(0).lt(MAX_FACE_VND),
})

const schema = z
  .object({
    id: z.number(),
    enabled: z.boolean(),
    starts_at: z.number().int().min(0),
    ends_at: z.number().int().min(0),
    tiers: z
      .array(tierSchema)
      .min(1)
      .max(MAX_TIERS)
      .superRefine((tiers, ctx) => {
        tiers.forEach((tier, index) => {
          const previous = tiers[index - 1]
          if (!previous) return
          if (tier.min_amount <= previous.min_amount) {
            ctx.addIssue({
              code: 'custom',
              path: [index, 'min_amount'],
              message: 'Thresholds must increase',
            })
          }
          if (tier.percent_off < previous.percent_off) {
            ctx.addIssue({
              code: 'custom',
              path: [index, 'percent_off'],
              message: 'Percent cannot decrease',
            })
          }
        })
      }),
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
          'Bank QR balance top-ups only. Each top-up gets the best tier its face amount reaches. Zero limits or caps mean unlimited; blank dates have no boundary.'
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
    { key: 'per_user_limit', label: t('Uses per user') },
    { key: 'total_budget', label: t('Total discount budget (VND)') },
  ] as const
  return (
    <form
      className='space-y-4'
      onSubmit={form.handleSubmit((value) => mutation.mutate(value))}
    >
      <label className='bg-card flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-sm font-medium'>
        <span className='min-w-0'>{t('Enable promotion')}</span>
        <Switch
          checked={Boolean(form.watch('enabled'))}
          onCheckedChange={(checked) =>
            form.setValue('enabled', checked, { shouldDirty: true })
          }
        />
      </label>
      <PromotionTiersEditor form={form} />
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
        {fields.map((field) => (
          <label key={field.key} className='space-y-1.5 text-sm font-medium'>
            {field.label}
            <Input
              type='number'
              min={0}
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
      <label className='bg-card flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-sm font-medium'>
        <span className='min-w-0'>{t('Show promotion banner')}</span>
        <Switch
          checked={Boolean(form.watch('banner_enabled'))}
          onCheckedChange={(checked) =>
            form.setValue('banner_enabled', checked, { shouldDirty: true })
          }
        />
      </label>
      <label className='block space-y-1.5 text-sm font-medium'>
        {t('Banner text (blank uses translated default)')}
        <Input {...form.register('banner_text')} />
      </label>
      <label className='block space-y-1.5 text-sm font-medium'>
        {t('Banner position')}
        <NativeSelect className='w-full' {...form.register('banner_position')}>
          <NativeSelectOption value='console_top'>
            {t('Console top')}
          </NativeSelectOption>
          <NativeSelectOption value='billing'>
            {t('Billing page')}
          </NativeSelectOption>
          <NativeSelectOption value='both'>{t('Both')}</NativeSelectOption>
        </NativeSelect>
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

function PromotionTiersEditor(props: { form: UseFormReturn<Promotion> }) {
  const { t, i18n } = useTranslation()
  const [previewAmount, setPreviewAmount] = useState(500000)
  const tiers = useFieldArray({ control: props.form.control, name: 'tiers' })
  const values = props.form.watch('tiers') ?? []
  const errors = props.form.formState.errors.tiers
  const money = new Intl.NumberFormat(toIntlLocale(i18n.language), {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  })
  const preview = bestPromotionTier(values, previewAmount)
  const columns = [
    { key: 'min_amount', label: t('Top-up from (VND)'), min: 0, max: undefined },
    { key: 'percent_off', label: t('Discount percent'), min: 1, max: 100 },
    { key: 'max_discount', label: t('Cap (VND, 0 = none)'), min: 0, max: undefined },
  ] as const
  return (
    <section className='space-y-3' aria-label={t('Discount tiers')}>
      <div className='flex items-center justify-between gap-3'>
        <h3 className='text-sm font-semibold'>{t('Discount tiers')}</h3>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={tiers.fields.length >= MAX_TIERS}
          onClick={() => {
            const last = values.at(-1)
            tiers.append({
              min_amount: last ? last.min_amount * 2 || 100000 : 100000,
              percent_off: last?.percent_off ?? 10,
              max_discount: 0,
            })
          }}
        >
          <Plus className='mr-1 size-4' aria-hidden='true' />
          {t('Add tier')}
        </Button>
      </div>
      <div className='space-y-2'>
        {tiers.fields.map((field, index) => (
          <div
            key={field.id}
            className='bg-card grid items-end gap-3 rounded-xl border p-3 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto]'
          >
            {columns.map((column) => (
              <label
                key={column.key}
                className='space-y-1.5 text-sm font-medium'
              >
                {column.label}
                <Input
                  type='number'
                  min={column.min}
                  max={column.max}
                  step={1}
                  aria-invalid={Boolean(errors?.[index]?.[column.key])}
                  {...props.form.register(`tiers.${index}.${column.key}`, {
                    valueAsNumber: true,
                  })}
                />
              </label>
            ))}
            <Button
              type='button'
              variant='ghost'
              size='icon'
              aria-label={t('Remove tier')}
              disabled={tiers.fields.length <= 1}
              onClick={() => tiers.remove(index)}
            >
              <Trash2 className='size-4' aria-hidden='true' />
            </Button>
          </div>
        ))}
      </div>
      {errors && (
        <p role='alert' className='text-destructive text-sm'>
          {t(
            'Tier thresholds must increase and percentages cannot decrease (1–100%).'
          )}
        </p>
      )}
      <div className='bg-muted/40 flex flex-wrap items-center gap-3 rounded-lg p-3 text-sm'>
        <label className='flex items-center gap-2 font-medium'>
          {t('Preview top-up (VND)')}
          <Input
            type='number'
            min={0}
            step={10000}
            className='w-40'
            value={previewAmount}
            onChange={(event) =>
              setPreviewAmount(Math.max(0, Number(event.target.value) || 0))
            }
          />
        </label>
        <span className='tabular-nums'>
          {preview
            ? t('{{percent}}% off: pay {{paid}} (save {{saved}})', {
                percent: preview.tier.percent_off,
                paid: money.format(previewAmount - preview.discount),
                saved: money.format(preview.discount),
              })
            : t('No tier applies: pay {{paid}}', {
                paid: money.format(previewAmount),
              })}
        </span>
      </div>
    </section>
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
          <label
            key={field.key}
            className='block space-y-1.5 text-sm font-medium'
          >
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
