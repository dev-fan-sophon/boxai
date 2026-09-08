import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TitledCard } from '@/components/ui/titled-card'
import { api } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'

import type { Coupon } from './api'
import { topUpRequestOptions, topUpErrorMessage } from './errors'
import { PromotionDates } from './promotion-settings'

const emptyCoupon: Coupon = {
  id: 0,
  code: '',
  enabled: true,
  starts_at: 0,
  ends_at: 0,
  min_amount: 100000,
  discount_type: 'fixed',
  discount_value: 10000,
  max_discount: 0,
  total_limit: 0,
  per_user_limit: 0,
  user_id: 0,
  stackable: false,
}
const schema = z
  .object({
    id: z.number(),
    code: z.string().regex(/^[A-Z0-9_-]{1,64}$/),
    enabled: z.boolean(),
    starts_at: z.number().int().min(0),
    ends_at: z.number().int().min(0),
    min_amount: z.number().int().min(0),
    discount_type: z.enum(['fixed', 'percent']),
    discount_value: z.number().int().min(1),
    max_discount: z.number().int().min(0),
    total_limit: z.number().int().min(0),
    per_user_limit: z.number().int().min(0),
    user_id: z.number().int().min(0),
    stackable: z.boolean(),
  })
  .refine(
    (value) => value.discount_type !== 'percent' || value.discount_value <= 100,
    { path: ['discount_value'] }
  )
  .refine((value) => !value.ends_at || value.ends_at > value.starts_at, {
    path: ['ends_at'],
  })

export function CouponSettings() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Coupon | null>(null)
  const query = useQuery({
    queryKey: ['topup-coupons', page],
    queryFn: async () => {
      const response = await api.get('/api/topup/coupons', {
        params: { page, pagesize: 20 },
      })
      if (!response.data.success) throw new Error(response.data.message)
      return response.data.data as { items: Coupon[]; total: number }
    },
  })
  return (
    <TitledCard
      title={t('Top-up coupons')}
      description={t(
        'The best discount applies by default. Stackable coupons apply after the activity discount.'
      )}
      contentClassName='space-y-4'
    >
      <Button onClick={() => setEditing({ ...emptyCoupon })}>
        {t('Create coupon')}
      </Button>
      {query.isPending && <p>{t('Loading...')}</p>}
      {query.isError && (
        <Button variant='outline' onClick={() => void query.refetch()}>
          {t('Retry')}
        </Button>
      )}
      {query.data?.items.length === 0 && (
        <p className='text-muted-foreground text-sm'>{t('No coupons yet')}</p>
      )}
      <div className='grid gap-3 sm:grid-cols-2'>
        {query.data?.items.map((coupon) => (
          <div
            key={coupon.id}
            className='flex items-center justify-between gap-3 rounded-lg border p-3'
          >
            <div className='min-w-0 text-sm'>
              <code className='font-semibold break-all'>{coupon.code}</code>
              <p>
                {coupon.discount_value.toLocaleString()}
                {coupon.discount_type === 'percent' ? '%' : ' VND'} ·{' '}
                {coupon.enabled ? t('Enabled') : t('Disabled')}
              </p>
              <p className='text-muted-foreground'>
                {coupon.stackable ? t('Stackable') : t('Best discount only')}
              </p>
            </div>
            <Button variant='outline' onClick={() => setEditing(coupon)}>
              {t('Edit')}
            </Button>
          </div>
        ))}
      </div>
      <div className='flex items-center justify-end gap-3'>
        <Button
          variant='outline'
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >
          {t('Previous')}
        </Button>
        <span>
          {page} / {Math.max(1, Math.ceil((query.data?.total || 0) / 20))}
        </span>
        <Button
          variant='outline'
          disabled={page * 20 >= (query.data?.total || 0)}
          onClick={() => setPage(page + 1)}
        >
          {t('Next')}
        </Button>
      </div>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing?.id ? t('Edit coupon') : t('Create coupon')}
        description={t(
          'Zero limits mean unlimited. User ID 0 allows all users.'
        )}
        contentClassName='sm:max-w-2xl'
      >
        {editing && (
          <CouponForm
            key={editing.id}
            coupon={editing}
            onSaved={() => setEditing(null)}
          />
        )}
      </Dialog>
    </TitledCard>
  )
}

function CouponForm(props: { coupon: Coupon; onSaved: () => void }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const form = useForm<Coupon>({
    resolver: zodResolver(schema),
    defaultValues: props.coupon,
  })
  const mutation = useMutation({
    mutationFn: async (value: Coupon) => {
      const response = value.id
        ? await api.put(
            `/api/topup/coupons/${value.id}`,
            value,
            topUpRequestOptions
          )
        : await api.post('/api/topup/coupons', value, topUpRequestOptions)
      if (!response.data.success) {
        throw new Error(topUpErrorMessage(response.data))
      }
    },
    onSuccess: () => {
      toast.success(t('Saved successfully'))
      void client.invalidateQueries({ queryKey: ['topup-coupons'] })
      props.onSaved()
    },
    onError: (error) => {
      if (error instanceof Error) toast.error(error.message)
      else handleServerError(error)
    },
  })
  const fields = [
    { key: 'min_amount', label: t('Minimum face amount (VND)') },
    {
      key: 'discount_value',
      label:
        form.watch('discount_type') === 'percent'
          ? t('Discount percent')
          : t('Fixed discount (VND)'),
    },
    { key: 'max_discount', label: t('Maximum discount (VND)') },
    { key: 'total_limit', label: t('Total uses') },
    { key: 'per_user_limit', label: t('Uses per user') },
    { key: 'user_id', label: t('Eligible user ID') },
  ] as const
  return (
    <form
      className='space-y-4'
      onSubmit={form.handleSubmit((value) => mutation.mutate(value))}
    >
      <label className='block space-y-1 text-sm'>
        {t('Coupon code')}
        <Input
          readOnly={!!props.coupon.id}
          maxLength={64}
          {...form.register('code', {
            onChange: (event) =>
              form.setValue('code', event.target.value.toUpperCase()),
          })}
        />
      </label>
      <label className='block space-y-1 text-sm'>
        {t('Discount type')}
        <select
          className='bg-background block w-full rounded-md border p-2'
          {...form.register('discount_type')}
        >
          <option value='fixed'>{t('Fixed discount (VND)')}</option>
          <option value='percent'>{t('Discount percent')}</option>
        </select>
      </label>
      <div className='grid gap-4 sm:grid-cols-2'>
        {fields.map((field) => (
          <label className='space-y-1 text-sm' key={field.key}>
            {field.label}
            <Input
              type='number'
              min={field.key === 'discount_value' ? 1 : 0}
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
        <input type='checkbox' {...form.register('enabled')} />
        {t('Enabled')}
      </label>
      <label className='flex items-center gap-2 text-sm'>
        <input type='checkbox' {...form.register('stackable')} />
        {t('Allow stacking with promotion')}
      </label>
      {Object.keys(form.formState.errors).length > 0 && (
        <p role='alert' className='text-destructive text-sm'>
          {t('Check the code, amounts, limits and date range.')}
        </p>
      )}
      <Button type='submit' disabled={mutation.isPending}>
        {t('Save coupon')}
      </Button>
    </form>
  )
}
