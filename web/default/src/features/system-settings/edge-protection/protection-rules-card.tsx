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
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import {
  applyCloudflareProtection,
  type CloudflareRule,
  type CloudflareProtectionProfile,
} from './api'
import { useCloudflareMutation } from './use-cloudflare'

const MANAGED_RULE_TAG = 'boxai:'

const protectionSchema = z.object({
  rate_limit_enabled: z.boolean(),
  rate_limit_requests: z.number().int().min(1).max(1_000_000),
  rate_limit_period: z.number().int(),
  rate_limit_action: z.string(),
  challenge_enabled: z.boolean(),
  challenge_hosts: z.string(),
  challenge_action: z.string(),
})

type ProtectionFormValues = z.infer<typeof protectionSchema>

type ProtectionRulesCardProps = {
  rateLimitRules: CloudflareRule[]
  firewallRules: CloudflareRule[]
  credentialEndpoints: string[]
  ratePeriods: number[]
  ruleActions: string[]
  zoneName: string
}

const ACTION_LABELS: Record<string, string> = {
  managed_challenge: 'Managed challenge',
  js_challenge: 'JavaScript challenge',
  challenge: 'Interactive challenge',
  block: 'Block',
  log: 'Log only',
}

function managedRule(rules: CloudflareRule[]) {
  return rules.find((rule) => rule.description.startsWith(MANAGED_RULE_TAG))
}

function hostsFromExpression(expression: string) {
  const match = expression.match(/http\.host in \{([^}]*)\}/)
  if (!match) return ''
  return (match[1].match(/"([^"]+)"/g) ?? [])
    .map((quoted) => quoted.slice(1, -1))
    .join('\n')
}

export function ProtectionRulesCard(props: ProtectionRulesCardProps) {
  const { t } = useTranslation()
  const apply = useCloudflareMutation(
    applyCloudflareProtection,
    t('Edge rules applied')
  )

  const currentRateLimit = managedRule(props.rateLimitRules)
  const currentChallenge = managedRule(props.firewallRules)

  const form = useForm<ProtectionFormValues>({
    resolver: zodResolver(protectionSchema),
    mode: 'onChange',
    defaultValues: {
      rate_limit_enabled: Boolean(currentRateLimit),
      rate_limit_requests:
        currentRateLimit?.ratelimit?.requests_per_period ?? 10,
      rate_limit_period: currentRateLimit?.ratelimit?.period ?? 60,
      rate_limit_action: currentRateLimit?.action ?? 'managed_challenge',
      challenge_enabled: Boolean(currentChallenge),
      challenge_hosts: currentChallenge
        ? hostsFromExpression(currentChallenge.expression)
        : props.zoneName,
      challenge_action: currentChallenge?.action ?? 'managed_challenge',
    },
  })

  const onSubmit = (values: ProtectionFormValues) => {
    const profile: CloudflareProtectionProfile = {
      rate_limit_enabled: values.rate_limit_enabled,
      rate_limit_requests: values.rate_limit_requests,
      rate_limit_period: values.rate_limit_period,
      rate_limit_action: values.rate_limit_action,
      challenge_enabled: values.challenge_enabled,
      challenge_hosts: values.challenge_hosts
        .split(/[\n,]/)
        .map((host) => host.trim())
        .filter((host) => host !== ''),
      challenge_action: values.challenge_action,
    }
    apply.mutate(profile)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Credential endpoint rules')}</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className='flex flex-col gap-5'
          >
            <div className='flex flex-col gap-2'>
              <p className='text-muted-foreground text-sm'>
                {t(
                  'These rules apply only to the anonymous sign-in and account recovery routes, so a normal visitor browsing the site or an API client calling the gateway is never challenged. Rules written by hand in the Cloudflare dashboard are left untouched.'
                )}
              </p>
              <div className='bg-muted/40 rounded-lg border p-3'>
                <ul className='grid gap-1 font-mono text-xs sm:grid-cols-2'>
                  {props.credentialEndpoints.map((endpoint) => (
                    <li key={endpoint}>{endpoint}</li>
                  ))}
                </ul>
              </div>
            </div>

            <FormField
              control={form.control}
              name='rate_limit_enabled'
              render={({ field }) => (
                <FormItem className='flex items-center justify-between gap-4'>
                  <div className='flex flex-col gap-1'>
                    <FormLabel>{t('Rate limit sign-in attempts')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Counted per address per data centre. Anything over the threshold gets an invisible challenge rather than an outright block.'
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

            {form.watch('rate_limit_enabled') && (
              <div className='grid gap-4 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='rate_limit_requests'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Requests')}</FormLabel>
                      <FormControl>
                        <Input
                          type='number'
                          min={1}
                          value={field.value}
                          onChange={(event) =>
                            field.onChange(Number(event.target.value))
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='rate_limit_period'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Window')}</FormLabel>
                      <FormControl>
                        <NativeSelect
                          className='w-full'
                          value={String(field.value)}
                          onChange={(event) =>
                            field.onChange(Number(event.target.value))
                          }
                        >
                          {props.ratePeriods.map((period) => (
                            <NativeSelectOption
                              key={period}
                              value={String(period)}
                            >
                              {t('{{count}} seconds', { count: period })}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='rate_limit_action'
                  render={({ field }) => (
                    <FormItem className='sm:col-span-2'>
                      <FormLabel>{t('Mitigation')}</FormLabel>
                      <FormControl>
                        <NativeSelect className='w-full' {...field}>
                          {props.ruleActions.map((action) => (
                            <NativeSelectOption key={action} value={action}>
                              {t(ACTION_LABELS[action] ?? action)}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Which mitigations a zone may use depends on its Cloudflare plan; the free plan only blocks.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            <FormField
              control={form.control}
              name='challenge_enabled'
              render={({ field }) => (
                <FormItem className='flex items-center justify-between gap-4 border-t pt-5'>
                  <div className='flex flex-col gap-1'>
                    <FormLabel>{t('Challenge sign-in pages')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Runs a managed challenge on every request to those routes. Most visitors pass it without seeing anything, but scripted traffic is stopped before it reaches the origin.'
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

            {form.watch('challenge_enabled') && (
              <div className='flex flex-col gap-4'>
                <FormField
                  control={form.control}
                  name='challenge_hosts'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Hostnames to challenge')}</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={3}
                          className='font-mono text-sm'
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'One hostname per line. List only the hosts that serve the browser console.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='challenge_action'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Mitigation')}</FormLabel>
                      <FormControl>
                        <NativeSelect className='w-full' {...field}>
                          {props.ruleActions.map((action) => (
                            <NativeSelectOption key={action} value={action}>
                              {t(ACTION_LABELS[action] ?? action)}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            <div>
              <Button type='submit' disabled={apply.isPending}>
                {t('Apply edge rules')}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
