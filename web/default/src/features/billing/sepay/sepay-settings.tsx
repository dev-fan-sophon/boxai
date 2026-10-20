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

const schema = z
  .object({
    enabled: z.boolean(),
    api_token: z.string().max(4096),
    bank_account_id: z.string(),
    webhook_secret: z.string(),
  })
  .refine((v) => !v.enabled || !!v.bank_account_id)
type Values = z.infer<typeof schema>
type BankAccount = {
  id: string
  bank_short_name: string
  account_number: string
  account_holder_name: string
}
type Settings = Omit<Values, 'api_token' | 'webhook_secret'> & {
  api_token_configured: boolean
  bank_name: string
  account_number: string
  account_name: string
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
          bank_account_id: settings.data.bank_account_id,
          api_token: '',
          webhook_secret: '',
        }
      : undefined,
  })
  const accounts = useMutation({
    mutationFn: async () => {
      const res = await api.post<ApiResponse<BankAccount[]>>(
        '/api/sepay/accounts',
        {
          api_token: form.getValues('api_token'),
        }
      )
      if (!res.data.success || !res.data.data) throw new Error(res.data.message)
      return res.data.data
    },
  })
  const save = useMutation({
    mutationFn: async (values: Values) => {
      const res = await api.put<ApiResponse>('/api/sepay/settings', values)
      if (!res.data.success) throw new Error(res.data.message)
    },
    onSuccess: async () => {
      form.setValue('api_token', '')
      form.setValue('webhook_secret', '')
      toast.success(t('Settings saved successfully'))
      await client.invalidateQueries({ queryKey: ['sepay', 'settings'] })
    },
  })
  const selected = accounts.data?.find(
    (account) => account.id === form.watch('bank_account_id')
  )
  const savedLabel = [
    settings.data?.bank_name,
    settings.data?.account_number,
    settings.data?.account_name,
  ]
    .filter(Boolean)
    .join(' · ')
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
          <div className='space-y-2'>
            <Label htmlFor='sepay-api-token'>SePay {t('API token')}</Label>
            <Input
              id='sepay-api-token'
              type='password'
              autoComplete='new-password'
              disabled={accounts.isPending || save.isPending}
              {...form.register('api_token', {
                onChange: () => {
                  accounts.reset()
                  form.setValue('bank_account_id', '')
                },
              })}
            />
            <p className='text-muted-foreground text-sm'>
              {settings.data.api_token_configured
                ? t('API token configured')
                : t('API token not configured')}
              {' · '}
              {t(
                'The API token loads linked bank accounts. It is not the HMAC webhook secret. Leave blank to keep the saved token.'
              )}
            </p>
            <Button
              type='button'
              variant='outline'
              disabled={
                accounts.isPending ||
                save.isPending ||
                (!form.watch('api_token') &&
                  !settings.data.api_token_configured)
              }
              onClick={() => accounts.mutate()}
            >
              {accounts.isPending ? t('Loading...') : t('Load linked accounts')}
            </Button>
            {accounts.isError && (
              <p role='alert'>
                {t(
                  'Unable to load accounts. Check the SePay API token and permissions.'
                )}
              </p>
            )}
            {accounts.isSuccess && accounts.data.length === 0 && (
              <p role='status'>
                {t('No supported active bank accounts found in SePay.')}
              </p>
            )}
          </div>
          <div className='space-y-2'>
            <Label htmlFor='sepay-bank'>{t('Receiving account')}</Label>
            <Select
              disabled={
                !accounts.data?.length || accounts.isPending || save.isPending
              }
              value={form.watch('bank_account_id') || null}
              onValueChange={(id) => {
                if (id) form.setValue('bank_account_id', id)
              }}
            >
              <SelectTrigger id='sepay-bank' className='w-full'>
                <SelectValue placeholder={t('Select')}>
                  {selected
                    ? `${selected.bank_short_name} · ${selected.account_number} · ${selected.account_holder_name}`
                    : (form.watch('bank_account_id') ===
                        settings.data.bank_account_id &&
                        savedLabel) ||
                      form.watch('bank_account_id') ||
                      t('Select')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {accounts.data?.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.bank_short_name} · {account.account_number} ·{' '}
                    {account.account_holder_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Choose a linked bank account. Virtual accounts (VA/TKP) are not supported here. Bank details are read from SePay, never entered manually.'
            )}
          </p>
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
          {(save.isError || Object.keys(form.formState.errors).length > 0) && (
            <p role='alert'>
              {t(
                'Unable to save. Check the receiving account and secret settings.'
              )}
            </p>
          )}
          <Button type='submit' disabled={save.isPending || accounts.isPending}>
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
