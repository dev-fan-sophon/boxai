import { Link } from '@tanstack/react-router'
import { ArrowRight, ListChecks, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TitledCard } from '@/components/ui/titled-card'
import { DownloadActions } from '@/features/downloads/download-actions'
import {
  detectPlatform,
  formatSize,
  primaryDownload,
} from '@/features/downloads/release'
import {
  useAppRelease,
  type ClientAppId,
} from '@/features/downloads/use-app-release'

import { CLIENT_APPS } from '../constants'
import { useClientAppSessions } from '../hooks/use-client-app-sessions'
import { ClientAppSessionsCard } from './client-app-sessions-card'
import { ConnectClientsCard } from './connect-clients-card'
import { ConnectWalkthrough } from './connect-walkthrough'

export function ClientAppConsole(props: { app: ClientAppId }) {
  const { t } = useTranslation()
  const meta = CLIENT_APPS[props.app]
  const { release, loading, failed, fallbackUrl } = useAppRelease(props.app)
  const downloads = release?.downloads ?? []
  const primary = primaryDownload(downloads, detectPlatform())
  const sessions = useClientAppSessions()
  const appSessions =
    props.app === 'connect' ? sessions.connect : sessions.desktop
  const appName = t(meta.nameKey)

  let requirement = t('macOS 12 or later · Windows 10 or later')
  if (primary?.platform === 'macos') {
    requirement = t('Requires macOS {{version}} or later', {
      version: primary.minimum_os,
    })
  } else if (primary?.platform === 'windows') {
    requirement = t('Requires Windows {{version}} or later', {
      version: primary.minimum_os,
    })
  }

  const facts = [
    release ? t('Version {{version}}', { version: release.version }) : '',
    primary ? formatSize(primary.size) : '',
    requirement,
  ].filter(Boolean)

  return (
    <div className='flex flex-col gap-3 sm:gap-4'>
      <section className='bg-card ring-border flex flex-col gap-4 rounded-xl px-4 py-4 ring-1 sm:px-5 sm:py-5'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div className='flex min-w-0 items-start gap-3'>
            <img
              src={meta.logoSrc}
              alt=''
              aria-hidden='true'
              draggable={false}
              className='ring-border/40 size-10 shrink-0 rounded-[22%] object-contain shadow-xs ring-1'
            />
            <div className='min-w-0'>
              <div className='flex flex-wrap items-center gap-2'>
                <h2 className='text-base font-semibold sm:text-lg'>
                  {appName}
                </h2>
                <Badge variant={appSessions.length > 0 ? 'default' : 'outline'}>
                  {appSessions.length > 0
                    ? t('{{count}} device(s) connected', {
                        count: appSessions.length,
                      })
                    : t('Not connected')}
                </Badge>
              </div>
              <p className='text-muted-foreground mt-1 max-w-2xl text-sm text-pretty'>
                {t(meta.descriptionKey)}
              </p>
            </div>
          </div>
        </div>

        <DownloadActions
          downloads={downloads}
          primary={primary}
          loading={loading}
          failed={failed}
          fallbackUrl={fallbackUrl}
          productName={appName}
        />

        <p className='text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs'>
          {facts.map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
        </p>
        {props.app === 'connect' && (
          <p className='text-muted-foreground flex items-start gap-2 text-xs text-pretty'>
            <TriangleAlert
              className='mt-0.5 size-3.5 shrink-0'
              aria-hidden='true'
            />
            {t(
              'The current macOS and Windows installers are not OS-signed or notarized. Your system may show a security warning during installation.'
            )}
          </p>
        )}
      </section>

      <ClientAppSessionsCard
        appName={appName}
        sessions={appSessions}
        loading={sessions.loading}
        failed={sessions.failed}
        fetching={sessions.fetching}
        onRefresh={() => void sessions.refetch()}
      />

      <TitledCard
        title={t('Set up in three steps')}
        icon={<ListChecks aria-hidden='true' />}
        disableHoverEffect
      >
        <ol className='space-y-3'>
          {meta.stepKeys.map((step, index) => (
            <li key={step} className='flex items-start gap-3'>
              <span className='bg-muted text-muted-foreground mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-xs'>
                {index + 1}
              </span>
              <p className='text-sm text-pretty'>{t(step)}</p>
            </li>
          ))}
        </ol>
      </TitledCard>

      {props.app === 'connect' ? (
        <>
          <ConnectWalkthrough />
          <ConnectClientsCard />
        </>
      ) : (
        <Button
          variant='outline'
          className='self-start'
          render={<Link to='/agents' />}
        >
          {t('See what BoxAI Desktop can do')}
          <ArrowRight aria-hidden='true' />
        </Button>
      )}
    </div>
  )
}
