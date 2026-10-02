import { Link, useRouterState } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'

import { SignInRequiredDialog } from '@/features/playground/components/shell/sign-in-required-dialog'
import { useWorkspaceBootstrap } from '@/features/playground/hooks/use-workspace-bootstrap'
import { MOTION_SPRING } from '@/lib/motion'
import { cn } from '@/lib/utils'

import { CREATE_NAV } from '../../constants'
import { StudioProvider, useStudioContext } from '../../context/studio-context'
import { CreateWorkspaceContext } from '../../context/workspace-context'

import '@/features/playground/styles/playground.css'

/**
 * Shell of the creation studio: tool navigation on top, the active tool
 * below. Owns the generation queue and the workspace bootstrap so moving
 * between tools keeps running jobs, the catalog and the account scope.
 */
export function CreateLayout(props: { children: React.ReactNode }) {
  const workspace = useWorkspaceBootstrap({ surface: 'create' })
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  return (
    <CreateWorkspaceContext.Provider value={workspace}>
      <StudioProvider>
        <div className='playground-workbench bg-background text-foreground flex size-full min-h-0 flex-col overflow-hidden'>
          <CreateNav pathname={pathname} />
          <div className='flex min-h-0 flex-1 flex-col'>{props.children}</div>
        </div>
        <SignInRequiredDialog
          open={workspace.signInDialogOpen}
          onOpenChange={workspace.setSignInDialogOpen}
          redirect={pathname}
        />
      </StudioProvider>
    </CreateWorkspaceContext.Provider>
  )
}

function CreateNav(props: { pathname: string }) {
  const { t } = useTranslation()

  return (
    <div className='border-border/70 bg-background/80 supports-backdrop-filter:bg-background/65 flex h-12 shrink-0 items-center gap-3 border-b px-2 backdrop-blur-xl sm:px-4'>
      <nav
        aria-label={t('Creation tools')}
        className='flex min-w-0 [scrollbar-width:none] items-center gap-0.5 overflow-x-auto [&::-webkit-scrollbar]:hidden'
      >
        {CREATE_NAV.map((item) => {
          const href =
            item.id === 'library' ? '/create/library' : `/create/${item.id}`
          const active = props.pathname.startsWith(href)
          const Icon = item.Icon
          return (
            <Link
              key={item.id}
              to={href}
              title={t(item.descriptionKey)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'focus-visible:ring-ring relative flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2',
                active
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              {active && (
                <motion.span
                  layoutId='create-nav-active'
                  transition={MOTION_SPRING.snappy}
                  className='bg-muted ring-border/60 absolute inset-0 rounded-lg ring-1'
                  aria-hidden='true'
                />
              )}
              <Icon className='relative size-4' aria-hidden='true' />
              <span className='relative'>{t(item.labelKey)}</span>
            </Link>
          )
        })}
      </nav>
      <span className='flex-1' />
      <QueueIndicator />
    </div>
  )
}

/** Studio-wide count of jobs still queued or running, across tools. */
function QueueIndicator() {
  const { t } = useTranslation()
  const studio = useStudioContext()
  const active = studio.pendingRuns.filter((job) => job.status !== 'error')
  const failed = studio.pendingRuns.length - active.length

  if (active.length === 0 && failed === 0) return null

  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={MOTION_SPRING.snappy}
      className='bg-muted/70 text-muted-foreground ring-border/60 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ring-1'
      aria-live='polite'
    >
      {active.length > 0 && (
        <>
          <Loader2
            className='text-primary size-3.5 animate-spin'
            aria-hidden='true'
          />
          {t('{{count}} generating', { count: active.length })}
        </>
      )}
      {failed > 0 && (
        <span className='text-destructive'>
          {t('{{count}} failed', { count: failed })}
        </span>
      )}
    </motion.span>
  )
}
