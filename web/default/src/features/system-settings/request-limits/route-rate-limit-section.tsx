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
import { useForm, type Control } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Form,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

import { SettingsForm } from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

// A throttle window longer than the sliding-window key expiry would keep
// counting requests the backend has already evicted.
const MAX_WINDOW_SECONDS = 1200

const countField = z.number().int().min(1).max(2147483647)
const durationField = z.number().int().min(1).max(MAX_WINDOW_SECONDS)

const routeRateLimitSchema = z.object({
  GlobalApiRateLimitEnabled: z.boolean(),
  GlobalApiRateLimitNum: countField,
  GlobalApiRateLimitDuration: durationField,
  GlobalWebRateLimitEnabled: z.boolean(),
  GlobalWebRateLimitNum: countField,
  GlobalWebRateLimitDuration: durationField,
  CriticalRateLimitEnabled: z.boolean(),
  CriticalRateLimitNum: countField,
  CriticalRateLimitDuration: durationField,
  UploadRateLimitEnabled: z.boolean(),
  UploadRateLimitNum: countField,
  UploadRateLimitDuration: durationField,
  SearchRateLimitEnabled: z.boolean(),
  SearchRateLimitNum: countField,
  SearchRateLimitDuration: durationField,
})

type RouteRateLimitFormValues = z.infer<typeof routeRateLimitSchema>

type ThrottleDefinition = {
  enabledKey: keyof RouteRateLimitFormValues
  numKey: keyof RouteRateLimitFormValues
  durationKey: keyof RouteRateLimitFormValues
  labelKey: string
  descriptionKey: string
}

const THROTTLES: ThrottleDefinition[] = [
  {
    enabledKey: 'GlobalApiRateLimitEnabled',
    numKey: 'GlobalApiRateLimitNum',
    durationKey: 'GlobalApiRateLimitDuration',
    labelKey: 'Console API requests',
    descriptionKey: 'Applies to every /api route, keyed by client IP',
  },
  {
    enabledKey: 'GlobalWebRateLimitEnabled',
    numKey: 'GlobalWebRateLimitNum',
    durationKey: 'GlobalWebRateLimitDuration',
    labelKey: 'Web assets',
    descriptionKey: 'Applies to the frontend bundle and static files',
  },
  {
    enabledKey: 'CriticalRateLimitEnabled',
    numKey: 'CriticalRateLimitNum',
    durationKey: 'CriticalRateLimitDuration',
    labelKey: 'Sensitive operations',
    descriptionKey:
      'Applies to registration, login, password reset and OAuth callbacks',
  },
  {
    enabledKey: 'UploadRateLimitEnabled',
    numKey: 'UploadRateLimitNum',
    durationKey: 'UploadRateLimitDuration',
    labelKey: 'Uploads',
    descriptionKey: 'Applies to file and image upload endpoints',
  },
  {
    enabledKey: 'SearchRateLimitEnabled',
    numKey: 'SearchRateLimitNum',
    durationKey: 'SearchRateLimitDuration',
    labelKey: 'Search',
    descriptionKey:
      'Keyed by user ID instead of IP, so proxy rotation cannot bypass it',
  },
]

function ThrottleFields(props: {
  control: Control<RouteRateLimitFormValues>
  throttle: ThrottleDefinition
}) {
  const { t } = useTranslation()

  return (
    <div className='rounded-lg border p-4'>
      <FormField
        control={props.control}
        name={props.throttle.enabledKey}
        render={({ field }) => (
          <FormItem className='flex items-start justify-between gap-4'>
            <div className='space-y-1'>
              <FormLabel>{t(props.throttle.labelKey)}</FormLabel>
              <FormDescription>
                {t(props.throttle.descriptionKey)}
              </FormDescription>
            </div>
            <FormControl>
              <Switch
                checked={field.value as boolean}
                onCheckedChange={field.onChange}
              />
            </FormControl>
          </FormItem>
        )}
      />
      <div className='mt-4 grid gap-4 md:grid-cols-2'>
        <FormField
          control={props.control}
          name={props.throttle.numKey}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Max requests')}</FormLabel>
              <FormControl>
                <Input
                  type='number'
                  min={1}
                  step={1}
                  value={field.value as number}
                  onChange={(e) =>
                    field.onChange(Number.parseInt(e.target.value) || 1)
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={props.control}
          name={props.throttle.durationKey}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Window (seconds)')}</FormLabel>
              <FormControl>
                <Input
                  type='number'
                  min={1}
                  max={MAX_WINDOW_SECONDS}
                  step={1}
                  value={field.value as number}
                  onChange={(e) =>
                    field.onChange(Number.parseInt(e.target.value) || 1)
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  )
}

type RouteRateLimitSectionProps = {
  defaultValues: RouteRateLimitFormValues
}

export function RouteRateLimitSection(props: RouteRateLimitSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const form = useForm<RouteRateLimitFormValues>({
    resolver: zodResolver(routeRateLimitSchema),
    mode: 'onChange',
    defaultValues: props.defaultValues,
  })

  useEffect(() => {
    form.reset(props.defaultValues)
  }, [props.defaultValues, form])

  const onSubmit = async (values: RouteRateLimitFormValues) => {
    const updates = Object.entries(values).filter(
      ([key, value]) =>
        value !== props.defaultValues[key as keyof RouteRateLimitFormValues]
    )

    await updateOption.mutateAsync(
      updates.map(([key, value]) => ({ key, value }))
    )
  }

  return (
    <SettingsSection title={t('Route Throttling')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
            saveLabel='Save route throttling'
          />
          <p className='text-muted-foreground text-sm'>
            {t(
              'Per-IP request limits applied before authentication. Raise these before a traffic spike rather than disabling them.'
            )}
          </p>
          <div className='space-y-4'>
            {THROTTLES.map((throttle) => (
              <ThrottleFields
                key={throttle.enabledKey}
                control={form.control}
                throttle={throttle}
              />
            ))}
          </div>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
