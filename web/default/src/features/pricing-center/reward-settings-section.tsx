import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

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
import { Switch } from '@/components/ui/switch'
import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '@/features/system-settings/components/settings-form-layout'
import { SettingsPageFormActions } from '@/features/system-settings/components/settings-page-context'
import { SettingsSection } from '@/features/system-settings/components/settings-section'
import { useUpdateOption } from '@/features/system-settings/hooks/use-update-option'
import { getCurrencyLabel } from '@/lib/currency'
import {
  formatQuota,
  parseQuotaFromDollars,
  quotaUnitsToDollars,
} from '@/lib/format'

const schema = z.object({
  enabled: z.boolean(),
  requireVerified: z.boolean(),
  expirePendingDays: z.coerce.number().int().min(0),
  minRedeemAmount: z.coerce.number().min(0),
  defaultPerUserLimit: z.coerce.number().int().min(1),
})

type Values = z.infer<typeof schema>

export function RewardSettingsSection(props: {
  defaultValues: {
    enabled: boolean
    requireVerified: boolean
    expirePendingDays: number
    minRedeemQuota: number
    defaultPerUserLimit: number
  }
}) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const currencyLabel = getCurrencyLabel()

  const form = useForm<Values>({
    resolver: zodResolver(schema) as unknown as Resolver<Values>,
    defaultValues: {
      enabled: props.defaultValues.enabled,
      requireVerified: props.defaultValues.requireVerified,
      expirePendingDays: props.defaultValues.expirePendingDays,
      minRedeemAmount: quotaUnitsToDollars(
        props.defaultValues.minRedeemQuota || 0
      ),
      defaultPerUserLimit: props.defaultValues.defaultPerUserLimit || 1,
    },
  })

  const { isDirty, isSubmitting } = form.formState
  const minQuota = parseQuotaFromDollars(
    Number(form.watch('minRedeemAmount')) || 0
  )

  async function onSubmit(values: Values) {
    const nextMinQuota = parseQuotaFromDollars(
      Number(values.minRedeemAmount) || 0
    )
    const updates: Array<{ key: string; value: string | number | boolean }> = []

    if (values.enabled !== props.defaultValues.enabled) {
      updates.push({ key: 'reward_setting.enabled', value: values.enabled })
    }
    if (values.requireVerified !== props.defaultValues.requireVerified) {
      updates.push({
        key: 'reward_setting.require_verified',
        value: values.requireVerified,
      })
    }
    if (values.expirePendingDays !== props.defaultValues.expirePendingDays) {
      updates.push({
        key: 'reward_setting.expire_pending_days',
        value: values.expirePendingDays,
      })
    }
    if (nextMinQuota !== props.defaultValues.minRedeemQuota) {
      updates.push({
        key: 'reward_setting.min_redeem_quota',
        value: nextMinQuota,
      })
    }
    if (
      values.defaultPerUserLimit !== props.defaultValues.defaultPerUserLimit
    ) {
      updates.push({
        key: 'reward_setting.default_per_user_limit',
        value: values.defaultPerUserLimit,
      })
    }

    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    await updateOption.mutateAsync(updates)
    form.reset(values)
  }

  return (
    <SettingsSection title={t('Rewards settings')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)} autoComplete='off'>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending || isSubmitting}
            isSaveDisabled={!isDirty}
            saveLabel='Save rewards settings'
          />
          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable Rewards')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Allow users to claim reward quota from campaign links and redeem it into their wallet.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />
          <FormField
            control={form.control}
            name='requireVerified'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Require verified email')}</FormLabel>
                  <FormDescription>
                    {t(
                      'When enabled, users must have an email on their account before claiming a reward.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />
          <div className='grid gap-6 sm:grid-cols-3'>
            <FormField
              control={form.control}
              name='minRedeemAmount'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('Minimum redeem amount ({{currency}})', {
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
                    {t(
                      'Stored as {{quota}}. Leave 0 to use 1 USD equivalent.',
                      {
                        quota: formatQuota(minQuota),
                      }
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='defaultPerUserLimit'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Default claims per user')}</FormLabel>
                  <FormControl>
                    <Input type='number' min={1} {...field} />
                  </FormControl>
                  <FormDescription>
                    {t('Used when a new campaign does not set its own limit.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='expirePendingDays'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Pending expiry (days)')}</FormLabel>
                  <FormControl>
                    <Input type='number' min={0} {...field} />
                  </FormControl>
                  <FormDescription>
                    {t(
                      '0 means pending rewards do not expire. Auto-expiry is not enabled yet.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
