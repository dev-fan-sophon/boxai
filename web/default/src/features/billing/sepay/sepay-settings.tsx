import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { TitledCard } from '@/components/ui/titled-card'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import type { ApiResponse } from '../types'

// SePay's published bank identifiers: https://vietqr.app/banks.json
// Keep this local so payment configuration does not depend on a third-party fetch.
const banks = [
  { bin: '970415', name: 'VietinBank' },
  { bin: '970436', name: 'Vietcombank' },
  { bin: '970422', name: 'MBBank' },
  { bin: '970416', name: 'ACB' },
  { bin: '970432', name: 'VPBank' },
  { bin: '970423', name: 'TPBank' },
  { bin: '970426', name: 'MSB' },
  { bin: '970449', name: 'LienVietPostBank' },
  { bin: '970454', name: 'VietCapitalBank' },
  { bin: '970418', name: 'BIDV' },
  { bin: '970403', name: 'Sacombank' },
  { bin: '970441', name: 'VIB' },
  { bin: '970437', name: 'HDBank' },
  { bin: '970440', name: 'SeABank' },
  { bin: '970424', name: 'ShinhanBank' },
  { bin: '970405', name: 'Agribank' },
  { bin: '970407', name: 'Techcombank' },
  { bin: '970409', name: 'BacABank' },
  { bin: '970425', name: 'ABBANK' },
  { bin: '970431', name: 'Eximbank' },
  { bin: '970439', name: 'PublicBank' },
  { bin: '970448', name: 'OCB' },
  { bin: '970452', name: 'KienLongBank' },
].sort((a, b) => a.name.localeCompare(b.name))

const schema = z
  .object({
    enabled: z.boolean(),
    bank_name: z.string(),
    bank_bin: z.string(),
    bank_gateway: z.string(),
    account_number: z.string(),
    account_name: z.string(),
    sub_account: z.string(),
    min_topup: z.number().int().min(10000).max(499999999),
    transfer_prefix: z.string(),
    webhook_secret: z.string(),
    clear_webhook_secret: z.boolean(),
  })
  .refine(
    (v) =>
      !v.enabled ||
      (!v.clear_webhook_secret &&
        !!v.bank_bin &&
        !!v.account_number &&
        !!v.account_name)
  )
type Values = z.infer<typeof schema>
type Settings = Omit<Values, 'webhook_secret' | 'clear_webhook_secret'> & {
  webhook_secret_configured: boolean
  webhook_url: string
}
type Events = {
  items: { id: number; trade_no: string; reason: string; received_at: number }[]
  total: number
}

export function SePaySettings() {
  const root = useAuthStore((s) => s.auth.user?.role === 100)
  if (!root) return null
  return <SePaySettingsContent />
}

function SePaySettingsContent() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [page, setPage] = useState(1)
  const settings = useQuery({
    queryKey: ['sepay', 'settings'],
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const res = await api.get<ApiResponse<Settings>>('/api/sepay/settings')
      if (!res.data.success || !res.data.data) throw new Error(res.data.message)
      return res.data.data
    },
  })
  const events = useQuery({
    queryKey: ['sepay', 'events', page],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Events>>('/api/sepay/events', {
        params: { page, page_size: 20 },
      })
      if (!res.data.success || !res.data.data) throw new Error(res.data.message)
      return res.data.data
    },
  })
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: settings.data
      ? {
          enabled: settings.data.enabled,
          bank_name: settings.data.bank_name,
          bank_bin: settings.data.bank_bin,
          bank_gateway: settings.data.bank_gateway,
          account_number: settings.data.account_number,
          account_name: settings.data.account_name,
          sub_account: settings.data.sub_account,
          min_topup: settings.data.min_topup,
          transfer_prefix: settings.data.transfer_prefix,
          webhook_secret: '',
          clear_webhook_secret: false,
        }
      : undefined,
  })
  const save = useMutation({
    mutationFn: async (values: Values) => {
      const res = await api.put<ApiResponse>('/api/sepay/settings', values)
      if (!res.data.success) throw new Error(res.data.message)
    },
    onSuccess: async () => {
      form.setValue('webhook_secret', '')
      form.setValue('clear_webhook_secret', false)
      toast.success(t('Settings saved successfully'))
      await client.invalidateQueries({ queryKey: ['sepay', 'settings'] })
    },
  })
  const labels = {
    account_number: t('Account number'),
    account_name: t('Account holder'),
  }
  const advancedLabels = {
    bank_name: t('Bank'),
    bank_bin: t('Bank BIN'),
    bank_gateway: t('Bank gateway'),
    sub_account: t('Sub-account'),
    transfer_prefix: t('Transfer prefix'),
  }
  const reasons: Record<string, string> = {
    settled: t('Payment successful'),
    unmatched: t('Order not found'),
    outgoing: t('Outgoing transfer'),
    invalid_amount: t('Invalid amount'),
    ambiguous_reference: t('Ambiguous transfer reference'),
    manual_order: t('Manual payment order'),
    invalid_snapshot: t('Invalid order snapshot'),
    destination_mismatch: t('Account mismatch'),
    order_success: t('Already paid'),
    order_cancelled: t('Cancelled'),
    order_expired: t('Expired'),
    accepted: t('Accepted, not necessarily credited'),
    success: t('Payment successful'),
    credited: t('Payment successful'),
    duplicate: t('Duplicate event'),
    amount_mismatch: t('Amount mismatch'),
    account_mismatch: t('Account mismatch'),
    order_not_found: t('Order not found'),
    invalid_signature: t('Invalid signature'),
    expired: t('Expired'),
  }
  return (
    <TitledCard
      title='SePay'
      description={t('Independent automatic bank payments')}
      contentClassName='space-y-4'
    >
      {settings.isPending && <p>{t('Loading...')}</p>}
      {settings.isError && (
        <Button onClick={() => void settings.refetch()}>{t('Retry')}</Button>
      )}
      {settings.data && (
        <form
          className='space-y-4'
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
        >
          <div className='flex items-center gap-3'>
            <Switch
              id='sepay-enabled'
              checked={!!form.watch('enabled')}
              onCheckedChange={(v) => form.setValue('enabled', v)}
            />
            <Label htmlFor='sepay-enabled'>{t('Enable SePay')}</Label>
          </div>
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='space-y-2 sm:col-span-2'>
              <Label htmlFor='sepay-bank'>{t('Bank')}</Label>
              <Select
                value={form.watch('bank_bin') || null}
                onValueChange={(bin) => {
                  const bank = banks.find((item) => item.bin === bin)
                  if (!bank) return
                  form.setValue('bank_bin', bank.bin)
                  form.setValue('bank_name', bank.name)
                  form.setValue('bank_gateway', bank.name)
                }}
              >
                <SelectTrigger id='sepay-bank' className='w-full'>
                  <SelectValue placeholder={t('Select')}>
                    {banks.find((bank) => bank.bin === form.watch('bank_bin'))
                      ?.name ||
                      form.watch('bank_name') ||
                      t('Select')}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {banks.map((bank) => (
                    <SelectItem key={bank.bin} value={bank.bin}>
                      {bank.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {Object.entries(labels).map(([key, label]) => (
              <div key={key} className='space-y-2'>
                <Label htmlFor={`sepay-${key}`}>{label}</Label>
                <Input
                  id={`sepay-${key}`}
                  {...form.register(key as keyof typeof labels)}
                />
              </div>
            ))}
          </div>
          <p className='text-sm'>
            {settings.data.webhook_secret_configured
              ? t('Webhook secret configured')
              : t('Webhook secret not configured')}
          </p>
          <div className='space-y-2'>
            <Label htmlFor='sepay-secret'>
              {t('Webhook secret')} (HMAC-SHA256)
            </Label>
            <Input
              id='sepay-secret'
              type='password'
              autoComplete='new-password'
              {...form.register('webhook_secret')}
            />
          </div>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Configure SePay to POST JSON to this callback using HMAC SHA256 and the same secret. An empty replacement keeps the existing secret.'
            )}
          </p>
          <div className='flex items-center gap-2'>
            <Input
              readOnly
              aria-label={t('Webhook URL')}
              value={settings.data.webhook_url}
            />
            <CopyButton value={settings.data.webhook_url} />
          </div>
          <details className='space-y-4'>
            <summary className='cursor-pointer text-sm font-medium'>
              {t('Advanced Settings')}
            </summary>
            <div className='grid gap-4 sm:grid-cols-2'>
              {Object.entries(advancedLabels).map(([key, label]) => (
                <div key={key} className='space-y-2'>
                  <Label htmlFor={`sepay-${key}`}>{label}</Label>
                  <Input
                    id={`sepay-${key}`}
                    {...form.register(key as keyof typeof advancedLabels)}
                  />
                </div>
              ))}
              <div className='space-y-2'>
                <Label htmlFor='sepay-min'>{t('Minimum top-up')} (VND)</Label>
                <Input
                  id='sepay-min'
                  type='number'
                  min={10000}
                  max={499999999}
                  step={1}
                  {...form.register('min_topup', { valueAsNumber: true })}
                />
              </div>
            </div>
            <label className='flex items-center gap-2 text-sm'>
              <input
                type='checkbox'
                disabled={form.watch('enabled')}
                {...form.register('clear_webhook_secret')}
              />
              {t('Clear stored secret on save (disable SePay first)')}
            </label>
          </details>
          {(save.isError || Object.keys(form.formState.errors).length > 0) && (
            <p role='alert'>
              {t(
                'Unable to save. Check the receiving account and secret settings.'
              )}
            </p>
          )}
          <Button type='submit' disabled={save.isPending}>
            {t('Save')}
          </Button>
        </form>
      )}
      <div className='space-y-3 border-t pt-4'>
        <div className='flex items-center justify-between'>
          <h3 className='font-medium'>{t('Recent webhook outcomes')}</h3>
          <Button
            variant='outline'
            disabled={events.isFetching}
            onClick={() => void events.refetch()}
          >
            {t('Refresh')}
          </Button>
        </div>
        <p className='text-muted-foreground text-sm'>
          {t(
            'Accepted events are not proof of credit. Check the order status before reconciling a payment.'
          )}
        </p>
        {events.isError && <p role='alert'>{t('Failed to load data')}</p>}
        {events.data?.items.length === 0 && <p>{t('No records found')}</p>}
        {events.data?.items.map((event) => (
          <div
            key={event.id}
            className='grid gap-1 border-b pb-2 text-sm sm:grid-cols-3'
          >
            <div className='min-w-0'>
              <code className='block break-all'>{event.trade_no || '—'}</code>
              <span className='text-muted-foreground'>#{event.id}</span>
            </div>
            <span>
              {reasons[event.reason] || t('Other outcome')}
              {!reasons[event.reason] && ` (${event.reason})`}
            </span>
            <time>{new Date(event.received_at * 1000).toLocaleString()}</time>
          </div>
        ))}
        <div className='flex items-center gap-2'>
          <Button
            variant='outline'
            disabled={page <= 1 || events.isFetching}
            onClick={() => setPage(page - 1)}
          >
            {t('Previous')}
          </Button>
          <span>{page}</span>
          <Button
            variant='outline'
            disabled={
              !events.data ||
              page * 20 >= events.data.total ||
              events.isFetching
            }
            onClick={() => setPage(page + 1)}
          >
            {t('Next')}
          </Button>
        </div>
      </div>
    </TitledCard>
  )
}
