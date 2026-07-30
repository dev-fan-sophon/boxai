/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const CIDR_PATTERN = /^(?:[0-9a-fA-F:.]+)(?:\/(?:1[0-2][0-8]|[0-9]{1,2}))?$/

const isValidCIDRList = (value: string | undefined) => {
  if (!value || value.trim() === '') return true
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .every((entry) => CIDR_PATTERN.test(entry))
}

const createTrustedProxySchema = (t: (key: string) => string) =>
  z.object({
    TrustedProxyCIDRs: z.string().refine(isValidCIDRList, {
      message: t('Each entry must be an IP address or CIDR block'),
    }),
    CloudflareProxyEnabled: z.boolean(),
  })

type TrustedProxyFormValues = z.infer<
  ReturnType<typeof createTrustedProxySchema>
>

type TrustedProxySectionProps = {
  defaultValues: TrustedProxyFormValues
}

export function TrustedProxySection(props: TrustedProxySectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const form = useForm<TrustedProxyFormValues>({
    resolver: zodResolver(createTrustedProxySchema(t)),
    mode: 'onChange',
    defaultValues: props.defaultValues,
  })

  useEffect(() => {
    form.reset(props.defaultValues)
  }, [props.defaultValues, form])

  const onSubmit = async (values: TrustedProxyFormValues) => {
    const updates = Object.entries(values).filter(
      ([key, value]) =>
        value !== props.defaultValues[key as keyof TrustedProxyFormValues]
    )

    await updateOption.mutateAsync(
      updates.map(([key, value]) => ({ key, value }))
    )
  }

  return (
    <SettingsSection title={t('Trusted Proxies')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
            saveLabel='Save trusted proxies'
          />
          <p className='text-muted-foreground text-sm'>
            {t(
              'Forwarding headers are only trusted from these networks. Everything else is attributed to the address that actually opened the connection, so a forged X-Forwarded-For cannot escape rate limits or IP allowlists.'
            )}
          </p>

          <FormField
            control={form.control}
            name='TrustedProxyCIDRs'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Additional trusted proxy networks')}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={4}
                    placeholder={'203.0.113.0/24\n2001:db8::/32'}
                    className='font-mono text-sm'
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Loopback and private ranges are always trusted. One IP or CIDR per line.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='CloudflareProxyEnabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Behind Cloudflare')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Trust the Cloudflare edge network and read the client address from CF-Connecting-IP. Only enable this once the origin firewall rejects traffic that does not come from Cloudflare, otherwise the header can be forged.'
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
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
