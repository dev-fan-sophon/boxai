import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { CopyButton } from '@/components/copy-button'
import { DateTimePicker } from '@/components/datetime-picker'
import {
  sideDrawerContentClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { StatusBadge } from '@/components/status-badge'
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
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  createRewardCampaign,
  getRewardCampaigns,
  updateRewardCampaign,
} from '@/features/rewards/api'
import {
  campaignPublicStatus,
  dateToUnix,
  quotaFromDisplayAmount,
  rewardClaimLink,
  unixToDate,
} from '@/features/rewards/lib'
import type { RewardCampaign } from '@/features/rewards/types'
import { formatUSDAmount, getCurrencyLabel } from '@/lib/currency'
import { formatQuota, quotaUnitsToDollars } from '@/lib/format'
import { useSystemConfigStore } from '@/stores/system-config-store'

const campaignSchema = z.object({
  slug: z.string().min(2).max(48),
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  amount_display: z.coerce.number().positive(),
  max_claims: z.coerce.number().int().min(0),
  per_user_limit: z.coerce.number().int().min(1),
  starts_at: z.date().optional(),
  ends_at: z.date().optional(),
  new_users_only: z.boolean(),
  require_verified: z.boolean(),
  enabled: z.boolean(),
})

type CampaignFormValues = z.infer<typeof campaignSchema>

function statusVariant(status: ReturnType<typeof campaignPublicStatus>) {
  if (status === 'active') return 'success' as const
  if (status === 'scheduled') return 'info' as const
  if (status === 'sold_out' || status === 'ended') return 'warning' as const
  return 'neutral' as const
}

export function RewardCampaignsPanel() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<RewardCampaign | null>(null)
  const currencyLabel = getCurrencyLabel()
  const quotaPerUnit =
    useSystemConfigStore((state) => state.config.currency.quotaPerUnit) ||
    500000

  const { data, isLoading } = useQuery({
    queryKey: ['reward-campaigns'],
    queryFn: async () => {
      const result = await getRewardCampaigns({ p: 1, page_size: 50 })
      if (!result.success) {
        toast.error(result.message || t('Failed to load reward campaigns'))
        return []
      }
      return result.data?.items ?? []
    },
  })

  const form = useForm<CampaignFormValues>({
    resolver: zodResolver(
      campaignSchema
    ) as unknown as Resolver<CampaignFormValues>,
    defaultValues: {
      slug: '',
      name: '',
      description: '',
      amount_display: 10000,
      max_claims: 0,
      per_user_limit: 1,
      new_users_only: false,
      require_verified: false,
      enabled: true,
    },
  })

  const amountDisplay = form.watch('amount_display')
  const quotaPreview = useMemo(
    () => quotaFromDisplayAmount(Number(amountDisplay) || 0),
    [amountDisplay]
  )

  function openCreate() {
    setEditing(null)
    form.reset({
      slug: '',
      name: '',
      description: '',
      amount_display: 10000,
      max_claims: 0,
      per_user_limit: 1,
      new_users_only: false,
      require_verified: false,
      enabled: true,
    })
    setOpen(true)
  }

  function openEdit(campaign: RewardCampaign) {
    setEditing(campaign)
    form.reset({
      slug: campaign.slug,
      name: campaign.name,
      description: campaign.description ?? '',
      amount_display: quotaUnitsToDollars(campaign.quota),
      max_claims: campaign.max_claims,
      per_user_limit: campaign.per_user_limit || 1,
      starts_at: unixToDate(campaign.starts_at),
      ends_at: unixToDate(campaign.ends_at),
      new_users_only: campaign.new_users_only,
      require_verified: campaign.require_verified,
      enabled: campaign.status === 1,
    })
    setOpen(true)
  }

  const campaigns = data ?? []

  const renderCampaignRows = () => {
    if (isLoading) {
      return (
        <tr>
          <td className='text-muted-foreground px-3 py-6' colSpan={6}>
            {t('Loading...')}
          </td>
        </tr>
      )
    }
    if (campaigns.length === 0) {
      return (
        <tr>
          <td className='text-muted-foreground px-3 py-6' colSpan={6}>
            {t('No reward campaigns yet')}
          </td>
        </tr>
      )
    }
    return campaigns.map((campaign) => {
      const status = campaignPublicStatus(campaign)
      const link = rewardClaimLink(campaign.slug)
      return (
        <tr key={campaign.id} className='border-t'>
          <td className='px-3 py-3'>
            <div className='font-medium'>{campaign.name}</div>
            <div className='text-muted-foreground text-xs'>{campaign.slug}</div>
          </td>
          <td className='px-3 py-3'>{formatQuota(campaign.quota)}</td>
          <td className='px-3 py-3'>
            {campaign.claimed_count}
            {campaign.max_claims > 0 ? ` / ${campaign.max_claims}` : ''}
          </td>
          <td className='px-3 py-3'>
            <StatusBadge
              label={t(statusLabel(status))}
              variant={statusVariant(status)}
              copyable={false}
            />
          </td>
          <td className='px-3 py-3'>
            <div className='flex items-center gap-1'>
              <span className='max-w-40 truncate text-xs'>{link}</span>
              <CopyButton value={link} size='icon' />
            </div>
          </td>
          <td className='px-3 py-3 text-right'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => openEdit(campaign)}
            >
              {t('Edit')}
            </Button>
          </td>
        </tr>
      )
    })
  }

  const mutation = useMutation({
    mutationFn: async (values: CampaignFormValues) => {
      const quota = quotaFromDisplayAmount(values.amount_display)
      if (quota <= 0) {
        throw new Error(
          t('Reward amount is too small for the current currency')
        )
      }
      const payload = {
        slug: values.slug,
        name: values.name,
        description: values.description ?? '',
        quota,
        status: values.enabled ? 1 : 0,
        starts_at: dateToUnix(values.starts_at),
        ends_at: dateToUnix(values.ends_at),
        max_claims: values.max_claims,
        per_user_limit: values.per_user_limit,
        new_users_only: values.new_users_only,
        require_verified: values.require_verified,
      }
      return editing
        ? updateRewardCampaign(editing.id, payload)
        : createRewardCampaign(payload)
    },
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(result.message || t('Failed to save reward campaign'))
        return
      }
      toast.success(
        editing ? t('Reward campaign updated') : t('Reward campaign created')
      )
      setOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['reward-campaigns'] })
    },
  })

  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-between gap-2'>
        <div>
          <h3 className='text-sm font-semibold'>{t('Reward campaigns')}</h3>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Each campaign has a public claim link. Amounts are entered in {{currency}}.',
              {
                currency: currencyLabel,
              }
            )}
          </p>
        </div>
        <Button size='sm' onClick={openCreate}>
          <Plus className='size-4' />
          {t('New campaign')}
        </Button>
      </div>

      <div className='overflow-hidden rounded-lg border'>
        <table className='w-full text-sm'>
          <thead className='bg-muted/40 text-muted-foreground text-left text-xs'>
            <tr>
              <th className='px-3 py-2 font-medium'>{t('Campaign')}</th>
              <th className='px-3 py-2 font-medium'>{t('Amount')}</th>
              <th className='px-3 py-2 font-medium'>{t('Claims')}</th>
              <th className='px-3 py-2 font-medium'>{t('Status')}</th>
              <th className='px-3 py-2 font-medium'>{t('Link')}</th>
              <th className='px-3 py-2 font-medium' />
            </tr>
          </thead>
          <tbody>{renderCampaignRows()}</tbody>
        </table>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          className={sideDrawerContentClassName('sm:max-w-[560px]')}
        >
          <SheetHeader className={sideDrawerHeaderClassName()}>
            <SheetTitle>
              {editing ? t('Edit reward campaign') : t('New reward campaign')}
            </SheetTitle>
            <SheetDescription>
              {t('Enter the reward in {{currency}}. It is stored as quota.', {
                currency: currencyLabel,
              })}
            </SheetDescription>
          </SheetHeader>
          <Form {...form}>
            <form
              className={sideDrawerFormClassName()}
              onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
            >
              <FormField
                control={form.control}
                name='name'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Name')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t('Welcome bonus')} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='slug'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Link slug')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder='welcome-2026' />
                    </FormControl>
                    <FormDescription>
                      {t('Public link: /r/{{slug}}', {
                        slug: field.value || 'slug',
                      })}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='amount_display'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('Reward amount ({{currency}})', {
                        currency: currencyLabel,
                      })}
                    </FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={0}
                        step='1'
                        value={field.value ?? ''}
                        onChange={(event) =>
                          field.onChange(Number(event.target.value) || 0)
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      {t('{{quota}} · {{usd}}', {
                        quota: formatQuota(quotaPreview),
                        usd: formatUSDAmount(quotaPreview / quotaPerUnit),
                      })}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='description'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Description')}</FormLabel>
                    <FormControl>
                      <Textarea rows={3} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className='grid gap-4 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='max_claims'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Total claim limit')}</FormLabel>
                      <FormControl>
                        <Input type='number' min={0} {...field} />
                      </FormControl>
                      <FormDescription>
                        {t('0 means unlimited')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='per_user_limit'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Per-user limit')}</FormLabel>
                      <FormControl>
                        <Input type='number' min={1} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='starts_at'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Starts at')}</FormLabel>
                      <FormControl>
                        <DateTimePicker
                          value={field.value}
                          onChange={field.onChange}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='ends_at'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Ends at')}</FormLabel>
                      <FormControl>
                        <DateTimePicker
                          value={field.value}
                          onChange={field.onChange}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name='new_users_only'
                render={({ field }) => (
                  <FormItem className='flex items-center justify-between gap-3'>
                    <div>
                      <FormLabel>{t('New users only')}</FormLabel>
                      <FormDescription>
                        {t(
                          'Only accounts created after this campaign can claim it.'
                        )}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='require_verified'
                render={({ field }) => (
                  <FormItem className='flex items-center justify-between gap-3'>
                    <div>
                      <FormLabel>{t('Require email')}</FormLabel>
                      <FormDescription>
                        {t('Claimants must have an email on their account.')}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='enabled'
                render={({ field }) => (
                  <FormItem className='flex items-center justify-between gap-3'>
                    <FormLabel>{t('Enabled')}</FormLabel>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <div className='flex justify-end gap-2 pt-2'>
                <Button
                  type='button'
                  variant='outline'
                  onClick={() => setOpen(false)}
                >
                  {t('Cancel')}
                </Button>
                <Button type='submit' disabled={mutation.isPending}>
                  {editing ? t('Save changes') : t('Create campaign')}
                </Button>
              </div>
            </form>
          </Form>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function statusLabel(status: ReturnType<typeof campaignPublicStatus>) {
  switch (status) {
    case 'active':
      return 'Active'
    case 'scheduled':
      return 'Scheduled'
    case 'ended':
      return 'Ended'
    case 'sold_out':
      return 'Sold out'
    default:
      return 'Disabled'
  }
}
