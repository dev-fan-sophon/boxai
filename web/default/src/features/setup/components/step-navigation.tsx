import { useTranslation } from 'react-i18next'

import { ArrowLeft, ArrowRight, CheckCircle2 } from '@/components/icons'
import { Button } from '@/components/ui/button'

interface StepNavigationProps {
  currentStep: number
  totalSteps: number
  onBack: () => void
  onNext: () => void
  onSubmit: () => void
  isSubmitting?: boolean
}

export function StepNavigation({
  currentStep,
  totalSteps,
  onBack,
  onNext,
  onSubmit,
  isSubmitting = false,
}: StepNavigationProps) {
  const { t } = useTranslation()
  const isFirstStep = currentStep === 0
  const isLastStep = currentStep === totalSteps - 1

  return (
    <div className='flex w-full flex-wrap items-center justify-between gap-2'>
      {isFirstStep ? (
        <span />
      ) : (
        <Button type='button' variant='outline' onClick={onBack}>
          <ArrowLeft />
          {t('Back')}
        </Button>
      )}

      {isLastStep ? (
        <Button
          type='button'
          onClick={onSubmit}
          disabled={isSubmitting}
          loading={isSubmitting}
          className='ms-auto'
        >
          {!isSubmitting && <CheckCircle2 />}
          {isSubmitting ? t('Initializing…') : t('Initialize system')}
        </Button>
      ) : (
        <Button type='button' onClick={onNext} className='ms-auto'>
          {t('Next')}
          <ArrowRight data-icon='inline-end' />
        </Button>
      )}
    </div>
  )
}
