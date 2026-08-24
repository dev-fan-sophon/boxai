import { zodResolver } from '@hookform/resolvers/zod'
import type { Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

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
import { Textarea } from '@/components/ui/textarea'
import {
  deriveDarkBrandPrimary,
  isAccessibleBrandPrimaryForDark,
  isAccessibleBrandPrimaryForLight,
} from '@/lib/colors'

import { FormDirtyIndicator } from '../components/form-dirty-indicator'
import { FormNavigationGuard } from '../components/form-navigation-guard'
import {
  SettingsForm,
  SettingsFormGrid,
  SettingsFormGridItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useSettingsForm } from '../hooks/use-settings-form'
import { useUpdateOption } from '../hooks/use-update-option'

const _systemInfoSchema = z.object({
  SystemName: z.string().min(1),
  ServerAddress: z.string().optional(),
  Logo: z.string().optional(),
  branding: z.object({
    favicon_url: z.string().optional(),
    primary_color: z.string().optional(),
    primary_color_dark: z.string().optional(),
  }),
  Footer: z.string().optional(),
  About: z.string().optional(),
  HomePageContent: z.string().optional(),
  legal: z.object({
    user_agreement: z.string().optional(),
    privacy_policy: z.string().optional(),
  }),
})

type SystemInfoFormValues = z.infer<typeof _systemInfoSchema>

type SystemInfoSectionProps = {
  defaultValues: SystemInfoFormValues
}

function normalizeValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : String(value)
}

export function SystemInfoSection({ defaultValues }: SystemInfoSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const normalizedDefaults: SystemInfoFormValues = {
    SystemName: normalizeValue(defaultValues.SystemName),
    ServerAddress: normalizeValue(defaultValues.ServerAddress),
    Logo: normalizeValue(defaultValues.Logo),
    branding: {
      favicon_url: normalizeValue(defaultValues.branding?.favicon_url),
      primary_color: normalizeValue(defaultValues.branding?.primary_color),
      primary_color_dark: normalizeValue(
        defaultValues.branding?.primary_color_dark
      ),
    },
    Footer: normalizeValue(defaultValues.Footer),
    About: normalizeValue(defaultValues.About),
    HomePageContent: normalizeValue(defaultValues.HomePageContent),
    legal: {
      user_agreement: normalizeValue(defaultValues.legal?.user_agreement),
      privacy_policy: normalizeValue(defaultValues.legal?.privacy_policy),
    },
  }

  const systemInfoSchemaWithI18n = z.object({
    SystemName: z.string().min(1, {
      error: () => t('System name is required'),
    }),
    ServerAddress: z.string().optional(),
    Logo: z
      .string()
      .refine(
        (value) =>
          !value || value.startsWith('/') || z.url().safeParse(value).success,
        {
          error: () => t('Enter an absolute URL or a root-relative path'),
        }
      ),
    branding: z.object({
      favicon_url: z
        .string()
        .refine(
          (value) =>
            !value ||
            (value.startsWith('/') && !value.startsWith('//')) ||
            z.httpUrl().safeParse(value).success,
          {
            error: () => t('Enter an absolute URL or a root-relative path'),
          }
        ),
      primary_color: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/, {
          error: () => t('Enter a color in #RRGGBB format'),
        })
        .or(z.literal(''))
        .refine((value) => !value || isAccessibleBrandPrimaryForLight(value), {
          error: () =>
            t('Choose a brand color with accessible contrast in light mode'),
        }),
      primary_color_dark: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/, {
          error: () => t('Enter a color in #RRGGBB format'),
        })
        .or(z.literal(''))
        .refine((value) => !value || isAccessibleBrandPrimaryForDark(value), {
          error: () =>
            t(
              'Choose a dark brand color with accessible contrast in dark mode'
            ),
        }),
    }),
    Footer: z.string().optional(),
    About: z.string().optional(),
    HomePageContent: z.string().optional(),
    legal: z.object({
      user_agreement: z.string().optional(),
      privacy_policy: z.string().optional(),
    }),
  })

  const { form, handleSubmit, handleReset, isDirty, isSubmitting } =
    useSettingsForm<SystemInfoFormValues>({
      resolver: zodResolver(systemInfoSchemaWithI18n) as Resolver<
        SystemInfoFormValues,
        unknown,
        SystemInfoFormValues
      >,
      defaultValues: normalizedDefaults,
      onSubmit: async (_data, changedFields) => {
        await updateOption.mutateAsync(
          Object.entries(changedFields).map(([key, value]) => {
            let v = normalizeValue(value)
            if (key === 'ServerAddress') {
              v = v.replace(/\/+$/, '')
            }
            return { key, value: v }
          })
        )
      },
    })

  const previewName = form.watch('SystemName')
  const previewLogo = form.watch('Logo')
  const previewFavicon = form.watch('branding.favicon_url')
  const previewColor = form.watch('branding.primary_color')
  const previewColorDark = form.watch('branding.primary_color_dark')
  const autoDarkPreview =
    previewColor && isAccessibleBrandPrimaryForLight(previewColor)
      ? deriveDarkBrandPrimary(previewColor)
      : '#FF9072'
  const effectiveDarkPreview = previewColorDark || autoDarkPreview

  const applyBoxAIRecommendedValues = () => {
    form.setValue('SystemName', 'BoxAI', { shouldDirty: true })
    form.setValue('Logo', '/logo.svg', { shouldDirty: true })
    form.setValue('branding.favicon_url', '/favicon.ico', {
      shouldDirty: true,
    })
    form.setValue('branding.primary_color', '#E05A3A', {
      shouldDirty: true,
    })
    // Empty dark → auto-derive soft coral for navy dark canvases.
    form.setValue('branding.primary_color_dark', '', {
      shouldDirty: true,
    })
  }

  return (
    <>
      <FormNavigationGuard when={isDirty} />

      <SettingsSection title={t('System Information')}>
        <Form {...form}>
          <SettingsForm onSubmit={handleSubmit}>
            <SettingsPageFormActions
              onSave={handleSubmit}
              onReset={handleReset}
              isSaving={isSubmitting || updateOption.isPending}
              isResetDisabled={!isDirty}
            />
            <FormDirtyIndicator isDirty={isDirty} />
            <div className='bg-muted/30 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3'>
              <div className='flex min-w-0 items-center gap-3'>
                <img
                  src={previewFavicon || previewLogo || '/logo.png'}
                  alt=''
                  className='size-9 rounded-md object-contain'
                />
                <div className='min-w-0'>
                  <div className='text-muted-foreground text-xs'>
                    {t('Live brand preview')}
                  </div>
                  <div
                    className='truncate font-semibold'
                    style={{ color: previewColor || undefined }}
                  >
                    {previewName || t('System Name')}
                  </div>
                </div>
              </div>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={applyBoxAIRecommendedValues}
              >
                {t('Box AI recommended values')}
              </Button>
            </div>
            <SettingsFormGrid>
              <FormField
                control={form.control}
                name='SystemName'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('System Name')}</FormLabel>
                    <FormControl>
                      <Input placeholder={t('BoxAI')} {...field} />
                    </FormControl>
                    <FormDescription>
                      {t('The name displayed across the application')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='ServerAddress'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Server Address')}</FormLabel>
                    <FormControl>
                      <Input placeholder='https://yourdomain.com' {...field} />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'The public URL of your server, used for OAuth callbacks, webhooks, and other external integrations'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='Logo'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Logo URL')}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t('https://example.com/logo.png')}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('URL to your logo image (optional)')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='branding.favicon_url'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Browser Icon URL')}</FormLabel>
                    <FormControl>
                      <Input placeholder='/favicon.svg' {...field} />
                    </FormControl>
                    <FormDescription>
                      {t('Browser icon shown in tabs and bookmarks')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='branding.primary_color'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Brand Primary Color (light)')}</FormLabel>
                    <FormControl>
                      <div className='flex gap-2'>
                        <Input
                          type='color'
                          aria-label={t('Brand Primary Color (light)')}
                          className='w-12 p-1'
                          value={field.value || '#E05A3A'}
                          onChange={field.onChange}
                        />
                        <Input placeholder='#E05A3A' {...field} />
                      </div>
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Light-mode buttons, rings, and sidebar highlights. Dark mode uses a softer auto-derived fill unless you set a dark override.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='branding.primary_color_dark'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Brand Primary Color (dark)')}</FormLabel>
                    <FormControl>
                      <div className='flex gap-2'>
                        <Input
                          type='color'
                          aria-label={t('Brand Primary Color (dark)')}
                          className='w-12 p-1'
                          value={field.value || effectiveDarkPreview}
                          onChange={field.onChange}
                        />
                        <Input placeholder={autoDarkPreview} {...field} />
                      </div>
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Optional. Leave empty to auto-derive a softer dark fill from the light brand color (recommended). Current auto: {{color}}',
                        { color: autoDarkPreview }
                      )}
                    </FormDescription>
                    <div className='flex flex-wrap items-center gap-2 pt-1'>
                      <span
                        className='inline-block size-6 rounded-md border'
                        style={{ backgroundColor: previewColor || '#E05A3A' }}
                        title={t('Light')}
                      />
                      <span className='text-muted-foreground text-xs'>→</span>
                      <span
                        className='inline-block size-6 rounded-md border'
                        style={{ backgroundColor: effectiveDarkPreview }}
                        title={t('Dark')}
                      />
                      <span className='text-muted-foreground text-xs'>
                        {previewColorDark
                          ? t('Custom dark override')
                          : t('Auto-derived dark')}
                      </span>
                      {previewColorDark ? (
                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          className='h-7 px-2 text-xs'
                          onClick={() =>
                            form.setValue('branding.primary_color_dark', '', {
                              shouldDirty: true,
                            })
                          }
                        >
                          {t('Use auto dark')}
                        </Button>
                      ) : null}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='Footer'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Footer')}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t(
                          '© 2025 Your Company. All rights reserved.'
                        )}
                        rows={4}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('Footer text displayed at the bottom of pages')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='About'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('About')}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t(
                          'Optional HTML, Markdown, or URL shown below the built-in About page'
                        )}
                        rows={4}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'The /about page always shows the built-in BoxAI brand content. Leave empty for the default page only. Optional HTML, Markdown, or a full URL adds an extra section underneath (URL becomes an external link, not a full-page iframe).'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <SettingsFormGridItem span='full'>
                <FormField
                  control={form.control}
                  name='HomePageContent'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Home Page Content')}</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder={t('Welcome to BoxAI...')}
                          rows={6}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Content displayed on the home page (supports Markdown)'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </SettingsFormGridItem>

              <FormField
                control={form.control}
                name='legal.user_agreement'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('User Agreement')}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t(
                          'Provide Markdown, HTML, or an external URL for the user agreement'
                        )}
                        rows={6}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Leave empty to disable the agreement requirement. Supports Markdown, HTML, or a full URL to redirect users.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='legal.privacy_policy'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Privacy Policy')}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t(
                          'Provide Markdown, HTML, or an external URL for the privacy policy'
                        )}
                        rows={6}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Leave empty to disable the privacy policy requirement. Supports Markdown, HTML, or a full URL to redirect users.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </SettingsFormGrid>
          </SettingsForm>
        </Form>
      </SettingsSection>
    </>
  )
}
