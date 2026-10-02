import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ErrorState } from '@/components/error-state'
import { Check } from '@/components/icons'
import { LanguageSwitcher } from '@/components/language-switcher'
import { LoadingState } from '@/components/loading-state'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Form } from '@/components/ui/form'
import { Skeleton } from '@/components/ui/skeleton'
import { useSystemConfig } from '@/hooks/use-system-config'
import { cn } from '@/lib/utils'

import { buildSetupPayload, getSetupStatus, submitSetup } from './api'
import { AdminStep } from './components/admin-step'
import { CompleteStep } from './components/complete-step'
import { DatabaseStep } from './components/database-step'
import { StepNavigation } from './components/step-navigation'
import { UsageModeStep } from './components/usage-mode-step'
import type { SetupFormValues, SetupStatus } from './types'

const STEPS = [
  {
    titleKey: 'Database check',
    descriptionKey: 'Verify your database connection',
  },
  {
    titleKey: 'Administrator account',
    descriptionKey: 'Create credentials for the root user',
  },
  {
    titleKey: 'Usage mode',
    descriptionKey: 'Choose how the platform will operate',
  },
  {
    titleKey: 'Review & initialize',
    descriptionKey: 'Confirm settings and finish setup',
  },
]

const DEFAULT_FORM_VALUES: SetupFormValues = {
  username: '',
  password: '',
  confirmPassword: '',
  usageMode: 'external',
}

export function SetupWizard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { systemName, logo, loading: systemConfigLoading } = useSystemConfig()

  const [currentStep, setCurrentStep] = useState(0)
  const [setupStatus, setSetupStatus] = useState<SetupStatus | undefined>()

  const form = useForm<SetupFormValues>({
    defaultValues: DEFAULT_FORM_VALUES,
    mode: 'onBlur',
  })

  const watchedValues = form.watch()

  const {
    data: statusResponse,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['setup-status'],
    queryFn: getSetupStatus,
    retry: false,
  })

  const mutation = useMutation({
    mutationKey: ['setup-submit'],
    mutationFn: submitSetup,
    onSuccess: async (response) => {
      if (response.success) {
        toast.success(t('System initialized successfully! Redirecting…'))
        await queryClient.invalidateQueries({ queryKey: ['setup-status'] })
        setTimeout(() => {
          navigate({ to: '/' })
        }, 1200)
      } else {
        toast.error(
          response.message || t('Initialization failed, please try again.')
        )
      }
    },
    onError: () => {
      toast.error(t('Failed to initialize system'))
    },
  })

  useEffect(() => {
    if (!statusResponse) return

    if (!statusResponse.success) {
      toast.error(statusResponse.message || t('Failed to load setup status'))
      return
    }

    const status = statusResponse.data
    if (!status) return

    if (status.status) {
      navigate({ to: '/' })
      return
    }

    setSetupStatus(status)
    setCurrentStep(0)

    // Pre-fill usage mode if backend echoes it
    if (status.SelfUseModeEnabled) {
      form.setValue('usageMode', 'self', {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      })
    } else if (status.DemoSiteEnabled) {
      form.setValue('usageMode', 'demo', {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      })
    } else {
      form.setValue('usageMode', 'external', {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusResponse, navigate, form])

  useEffect(() => {
    if (!setupStatus) return

    // Reset admin fields when backend reports they are already initialized
    if (setupStatus.root_init) {
      form.setValue('username', '', {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      })
      form.setValue('password', '', {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      })
      form.setValue('confirmPassword', '', {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      })
    }
  }, [setupStatus, form])

  const currentStepComponent = useMemo(() => {
    if (currentStep === 0) {
      return <DatabaseStep status={setupStatus} />
    }
    if (currentStep === 1) {
      return (
        <AdminStep
          form={form}
          rootInitialized={Boolean(setupStatus?.root_init)}
        />
      )
    }
    if (currentStep === 2) {
      return <UsageModeStep form={form} />
    }
    return <CompleteStep status={setupStatus} values={watchedValues} />
  }, [currentStep, setupStatus, form, watchedValues])

  const validateAdminStep = () => {
    if (setupStatus?.root_init) return true

    const username = form.getValues('username')?.trim()
    const password = form.getValues('password')?.trim()
    const confirmPassword = form.getValues('confirmPassword')?.trim()

    if (!username) {
      form.setError('username', {
        type: 'manual',
        message: t('Please enter an administrator username'),
      })
      toast.error(t('Please enter an administrator username'))
      return false
    }

    if (!password || password.length < 8) {
      form.setError('password', {
        type: 'manual',
        message: t('Password must be at least 8 characters'),
      })
      toast.error(t('Password must be at least 8 characters'))
      return false
    }

    if (password !== confirmPassword) {
      form.setError('confirmPassword', {
        type: 'manual',
        message: t('Passwords do not match'),
      })
      toast.error(t('Passwords do not match'))
      return false
    }

    return true
  }

  const validateUsageModeStep = () => {
    const usageMode = form.getValues('usageMode')
    if (!usageMode) {
      form.setError('usageMode', {
        type: 'manual',
        message: t('Select a usage mode to continue'),
      })
      toast.error(t('Select a usage mode to continue'))
      return false
    }
    return true
  }

  const handleNextStep = () => {
    if (currentStep === 1 && !validateAdminStep()) return
    if (currentStep === 2 && !validateUsageModeStep()) return

    setCurrentStep((step) => Math.min(step + 1, STEPS.length - 1))
  }

  const handlePreviousStep = () => {
    setCurrentStep((step) => Math.max(step - 1, 0))
  }

  const handleSubmit = async () => {
    const adminValid = validateAdminStep()
    const usageValid = validateUsageModeStep()
    if (!adminValid || !usageValid) return

    const payload = buildSetupPayload(
      form.getValues(),
      Boolean(setupStatus?.root_init)
    )

    mutation.mutate(payload)
  }

  return (
    <div className='bg-background relative isolate min-h-svh py-10'>
      <div
        aria-hidden
        className='playground-discover-hero pointer-events-none absolute inset-0 -z-10'
      />
      <div className='absolute top-4 right-4 sm:top-6 sm:right-6'>
        <LanguageSwitcher />
      </div>
      <div className='container mx-auto flex max-w-4xl flex-col gap-8 px-4 sm:px-6'>
        <div className='flex flex-col items-center gap-3'>
          <div className='relative h-12 w-12'>
            {systemConfigLoading ? (
              <Skeleton className='absolute inset-0 rounded-xl' />
            ) : (
              <img
                src={logo}
                alt={t('System logo')}
                className='ring-border h-12 w-12 rounded-xl object-cover shadow-sm ring-1'
              />
            )}
          </div>
          {systemConfigLoading ? (
            <Skeleton className='h-7 w-40' />
          ) : (
            <h1 className='text-center text-2xl font-semibold tracking-tight text-balance'>
              {t('Initialize')} {systemName}
            </h1>
          )}
          <p className='text-muted-foreground max-w-xl text-center text-sm text-pretty sm:text-base'>
            {t(
              'Follow the guided steps to prepare your workspace before the first login.'
            )}
          </p>
        </div>

        <Card className='shadow-lifted'>
          <CardHeader className='space-y-2'>
            <CardTitle className='text-xl font-semibold'>
              {t('System setup wizard')}
            </CardTitle>
            <CardDescription>
              {t('Complete these steps to finish the initial installation.')}
            </CardDescription>
          </CardHeader>

          <CardContent className='space-y-6'>
            <div className='space-y-3'>
              <ol className='grid grid-cols-4 gap-2 sm:gap-3'>
                {STEPS.map((step, index) => {
                  const isActive = currentStep === index
                  const isCompleted = currentStep > index
                  return (
                    <li
                      key={step.titleKey}
                      aria-current={isActive ? 'step' : undefined}
                      className='min-w-0 space-y-2'
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'block h-1 rounded-full transition-colors duration-control',
                          isActive || isCompleted ? 'bg-primary' : 'bg-muted'
                        )}
                      />
                      <div className='flex min-w-0 items-start gap-2'>
                        <span
                          className={cn(
                            'flex size-5 shrink-0 items-center justify-center rounded-full text-2xs font-semibold tabular-nums',
                            isActive || isCompleted
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-muted-foreground'
                          )}
                        >
                          {isCompleted ? (
                            <Check className='size-3' aria-hidden />
                          ) : (
                            index + 1
                          )}
                        </span>
                        <div className='hidden min-w-0 space-y-0.5 sm:block'>
                          <p
                            className={cn(
                              'text-sm font-medium',
                              !isActive && 'text-muted-foreground'
                            )}
                          >
                            {t(step.titleKey)}
                          </p>
                          <p className='text-muted-foreground text-xs'>
                            {t(step.descriptionKey)}
                          </p>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ol>
              <div className='space-y-0.5 sm:hidden'>
                <p className='text-sm font-semibold'>
                  {t(STEPS[currentStep].titleKey)}
                </p>
                <p className='text-muted-foreground text-xs'>
                  {t(STEPS[currentStep].descriptionKey)}
                </p>
              </div>
            </div>

            {isLoading && <LoadingState message={t('Loading setup status…')} />}
            {!isLoading && isError && (
              <ErrorState
                title={t('We could not load the setup status.')}
                onRetry={() => refetch()}
              />
            )}
            {!isLoading && !isError && (
              <Form {...form}>
                <form
                  className='space-y-6'
                  onSubmit={(event) => event.preventDefault()}
                >
                  {currentStepComponent}
                </form>
              </Form>
            )}
          </CardContent>

          {!isLoading && !isError && (
            <CardFooter className='w-full justify-end border-t'>
              <StepNavigation
                currentStep={currentStep}
                totalSteps={STEPS.length}
                onBack={handlePreviousStep}
                onNext={handleNextStep}
                onSubmit={handleSubmit}
                isSubmitting={mutation.isPending}
              />
            </CardFooter>
          )}
        </Card>
      </div>
    </div>
  )
}
