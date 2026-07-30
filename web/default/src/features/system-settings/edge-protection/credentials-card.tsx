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
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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

import { useUpdateOption } from '../hooks/use-update-option'
import type { UpdateOptionRequest } from '../types'
import { verifyCloudflareCredentials } from './api'
import { CLOUDFLARE_STATUS_QUERY_KEY } from './use-cloudflare'

const IDENTIFIER_PATTERN = /^[0-9a-f]{32}$/

const createCredentialsSchema = (t: (key: string) => string) => {
  const identifier = z
    .string()
    .refine((value) => value === '' || IDENTIFIER_PATTERN.test(value), {
      message: t('Cloudflare IDs are 32 hexadecimal characters'),
    })
  return z.object({
    CloudflareApiToken: z.string(),
    CloudflareZoneId: identifier,
    CloudflareAccountId: identifier,
  })
}

type CredentialsFormValues = z.infer<ReturnType<typeof createCredentialsSchema>>

type CredentialsCardProps = {
  zoneId: string
  accountId: string
}

export function CredentialsCard(props: CredentialsCardProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const queryClient = useQueryClient()

  const form = useForm<CredentialsFormValues>({
    resolver: zodResolver(createCredentialsSchema(t)),
    mode: 'onChange',
    defaultValues: {
      CloudflareApiToken: '',
      CloudflareZoneId: props.zoneId,
      CloudflareAccountId: props.accountId,
    },
  })

  useEffect(() => {
    form.reset({
      CloudflareApiToken: '',
      CloudflareZoneId: props.zoneId,
      CloudflareAccountId: props.accountId,
    })
  }, [props.zoneId, props.accountId, form])

  const onSubmit = async (values: CredentialsFormValues) => {
    const updates: UpdateOptionRequest[] = []

    // The options endpoint never returns the stored token, so an empty field
    // means "keep the current one" rather than "clear it".
    if (values.CloudflareApiToken !== '') {
      updates.push({
        key: 'CloudflareApiToken',
        value: values.CloudflareApiToken,
      })
    }
    if (values.CloudflareZoneId !== props.zoneId) {
      updates.push({
        key: 'CloudflareZoneId',
        value: values.CloudflareZoneId,
      })
    }
    if (values.CloudflareAccountId !== props.accountId) {
      updates.push({
        key: 'CloudflareAccountId',
        value: values.CloudflareAccountId,
      })
    }

    await updateOption.mutateAsync(updates)

    form.setValue('CloudflareApiToken', '')

    const verification = await verifyCloudflareCredentials()
    if (!verification.success) {
      toast.error(verification.message)
    }
    void queryClient.invalidateQueries({
      queryKey: CLOUDFLARE_STATUS_QUERY_KEY,
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Cloudflare credentials')}</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className='flex flex-col gap-4'
          >
            <FormField
              control={form.control}
              name='CloudflareApiToken'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('API token')}</FormLabel>
                  <FormControl>
                    <Input
                      type='password'
                      autoComplete='off'
                      placeholder={t('Leave blank to keep the stored token')}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Needs Zone Read, Zone Settings Edit, DNS Edit and Zone WAF Edit permissions on this zone.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='CloudflareZoneId'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Zone ID')}</FormLabel>
                  <FormControl>
                    <Input
                      className='font-mono text-sm'
                      autoComplete='off'
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='CloudflareAccountId'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Account ID')}</FormLabel>
                  <FormControl>
                    <Input
                      className='font-mono text-sm'
                      autoComplete='off'
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div>
              <Button type='submit' disabled={updateOption.isPending}>
                {t('Save and verify')}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
