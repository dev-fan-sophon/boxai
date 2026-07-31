import { Languages } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  INTERFACE_LANGUAGE_OPTIONS,
  normalizeInterfaceLanguage,
} from '@/i18n/languages'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation()
  const user = useAuthStore((s) => s.auth.user)
  const currentLanguage = normalizeInterfaceLanguage(i18n.language)
  const handleChangeLanguage = useCallback(
    async (code: string) => {
      await i18n.changeLanguage(code)
      if (user) {
        try {
          await api.put('/api/user/self', { language: code })
        } catch {
          // Best-effort persistence; don't block the UI on failure
        }
      }
    },
    [i18n, user]
  )

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={t('Change language')}
        render={
          <Button
            variant='ghost'
            size='icon'
            className='text-muted-foreground hover:text-foreground rounded-full'
          />
        }
      >
        <Languages className='size-4' />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' sideOffset={8} className='w-44'>
        <DropdownMenuRadioGroup
          value={currentLanguage}
          onValueChange={(value) => void handleChangeLanguage(String(value))}
        >
          <DropdownMenuLabel>{t('Language')}</DropdownMenuLabel>
          {INTERFACE_LANGUAGE_OPTIONS.map((lang) => (
            <DropdownMenuRadioItem key={lang.code} value={lang.code}>
              <span className='text-muted-foreground w-5 shrink-0 text-[11px] font-medium'>
                {lang.short}
              </span>
              {lang.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
