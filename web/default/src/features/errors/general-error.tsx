import { useNavigate, useRouter } from '@tanstack/react-router'
import { ServerCrash, Timer } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

import { isChunkLoadError } from './chunk-load-error'
import { ErrorPage } from './error-page'

type GeneralErrorProps = {
  minimal?: boolean
  error?: unknown
  className?: string
}

function getHttpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const response = (error as Record<string, unknown>).response
  if (typeof response !== 'object' || response === null) return undefined
  const status = (response as Record<string, unknown>).status
  return typeof status === 'number' ? status : undefined
}

export function GeneralError({
  className,
  minimal = false,
  error,
}: GeneralErrorProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { history } = useRouter()
  const status = getHttpStatus(error)
  const chunkLoadError = isChunkLoadError(error)
  const isRateLimited = status === 429
  const title = isRateLimited
    ? t('Too many requests')
    : t('Something went wrong')
  const description = isRateLimited
    ? t('Please wait a moment before trying again.')
    : t('We ran into an unexpected problem. Please try again in a moment.')

  useEffect(() => {
    if (!chunkLoadError) return

    try {
      const entryScript = [...document.scripts].find((script) =>
        script.src.includes('/static/js/index.')
      )?.src
      const runtimeId = entryScript ?? window.__APP_BUILD__?.rev ?? 'unknown'
      const reloadKey = `app:chunk-reload:${runtimeId}:${window.location.pathname}`
      if (window.sessionStorage.getItem(reloadKey)) return
      window.sessionStorage.setItem(reloadKey, '1')
      window.location.reload()
    } catch {
      // If session storage is unavailable, do not risk a reload loop.
    }
  }, [chunkLoadError])

  if (minimal) {
    return (
      <ErrorPage
        minimal
        code={String(status ?? 500)}
        icon={isRateLimited ? <Timer /> : <ServerCrash />}
        title={title}
        className={className}
        description={description}
      />
    )
  }

  return (
    <ErrorPage
      code={String(status ?? 500)}
      icon={isRateLimited ? <Timer /> : <ServerCrash />}
      iconTone={isRateLimited ? 'warning' : 'destructive'}
      title={title}
      className={className}
      description={description}
      actions={
        <>
          <Button variant='outline' onClick={() => history.go(-1)}>
            {t('Go Back')}
          </Button>
          <Button variant='outline' onClick={() => window.location.reload()}>
            {t('Try again')}
          </Button>
          <Button onClick={() => navigate({ to: '/' })}>
            {t('Back to Home')}
          </Button>
        </>
      }
    />
  )
}
