import { useTranslation } from 'react-i18next'

import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

import type { SystemStatus } from '../types'

interface LegalConsentProps {
  status: SystemStatus | null
  checked: boolean
  onCheckedChange: (nextValue: boolean) => void
  className?: string
}

export function LegalConsent({
  status,
  checked,
  onCheckedChange,
  className,
}: LegalConsentProps) {
  const { t } = useTranslation()
  const hasUserAgreement = Boolean(status?.user_agreement_enabled)
  const hasPrivacyPolicy = Boolean(status?.privacy_policy_enabled)

  if (!hasUserAgreement && !hasPrivacyPolicy) {
    return null
  }

  const handleChange = (value: boolean) => {
    onCheckedChange(value === true)
  }

  return (
    <div
      className={cn(
        'bg-surface-subtle ring-border/60 flex items-start gap-3 rounded-xl p-3 ring-1',
        className
      )}
    >
      <Checkbox
        id='legal-consent'
        checked={checked}
        onCheckedChange={handleChange}
        className='mt-0.5'
      />
      <Label
        htmlFor='legal-consent'
        className='text-muted-foreground items-start gap-1 text-left text-xs leading-5 font-normal'
      >
        <span>
          {t('I have read and agree to the')}{' '}
          {hasUserAgreement && (
            <a
              href='/user-agreement'
              target='_blank'
              rel='noopener noreferrer'
              className='text-foreground hover:text-primary font-medium underline-offset-4 hover:underline'
            >
              {t('User Agreement')}
            </a>
          )}
          {hasUserAgreement && hasPrivacyPolicy && ` ${t('and')} `}
          {hasPrivacyPolicy && (
            <a
              href='/privacy-policy'
              target='_blank'
              rel='noopener noreferrer'
              className='text-foreground hover:text-primary font-medium underline-offset-4 hover:underline'
            >
              {t('Privacy Policy')}
            </a>
          )}
          .
        </span>
      </Label>
    </div>
  )
}
