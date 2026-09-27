import { TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function ConnectInstallationNote() {
  const { t } = useTranslation()
  return (
    <p className='text-muted-foreground flex max-w-2xl items-start gap-2 text-xs text-pretty'>
      <TriangleAlert className='mt-0.5 size-3.5 shrink-0' aria-hidden='true' />
      {t(
        'The macOS installer is signed and notarized. The Windows installer is unsigned and may trigger a security warning.'
      )}
    </p>
  )
}
