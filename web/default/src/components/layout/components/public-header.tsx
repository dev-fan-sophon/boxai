import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { LayoutDashboard } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { LanguageSwitcher } from '@/components/language-switcher'
import { NotificationPopover } from '@/components/notification-popover'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useNotifications } from '@/hooks/use-notifications'
import { useStatus } from '@/hooks/use-status'
import { useSystemConfig } from '@/hooks/use-system-config'
import { useTopNavLinks } from '@/hooks/use-top-nav-links'
import { parseHeaderNavModulesFromStatus } from '@/lib/nav-modules'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { defaultTopNavLinks } from '../config/top-nav.config'
import type { TopNavLink } from '../types'
import { HeaderLogo } from './header-logo'

const AUTH_PROMPT_SECONDS = 5

type AuthPromptTarget = {
  title: string
  href: string
}

// Detail routes (`/pricing/gpt-5`, `/docs/streaming`) keep their section lit.
function isNavLinkActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export interface PublicHeaderProps {
  navLinks?: TopNavLink[]
  showThemeSwitch?: boolean
  showLanguageSwitcher?: boolean
  logo?: React.ReactNode
  siteName?: string
  homeUrl?: string
  showAuthButtons?: boolean
  showNotifications?: boolean
}

export function PublicHeader(props: PublicHeaderProps) {
  const {
    navLinks = defaultTopNavLinks,
    showThemeSwitch = true,
    showLanguageSwitcher = true,
    logo: customLogo,
    siteName: customSiteName,
    homeUrl = '/',
    showAuthButtons = true,
    showNotifications = true,
  } = props

  const { t } = useTranslation()
  const navigate = useNavigate()
  // Lazy init from the live scroll offset: starting at `false` made the header
  // replay its 700ms collapse transition whenever it mounted mid-page.
  const [scrolled, setScrolled] = useState(
    () => typeof window !== 'undefined' && window.scrollY > 20
  )
  const [mobileOpen, setMobileOpen] = useState(false)
  const [authPromptTarget, setAuthPromptTarget] =
    useState<AuthPromptTarget | null>(null)
  const [authPromptSecondsLeft, setAuthPromptSecondsLeft] =
    useState(AUTH_PROMPT_SECONDS)
  const { auth } = useAuthStore()
  const { status } = useStatus()
  const {
    systemName,
    logo: systemLogo,
    loading,
    logoLoaded,
  } = useSystemConfig()
  const dynamicLinks = useTopNavLinks()
  const notifications = useNotifications()
  const routerState = useRouterState()
  const pathname = routerState.location.pathname

  const user = auth.user
  const isAuthenticated = !!user
  const displaySiteName = customSiteName || systemName
  const links = dynamicLinks.length > 0 ? dynamicLinks : navLinks
  // Console entry stays a CTA button, not a primary strip link.
  // Still respect HeaderNavModules.console so admins can hide it.
  const showConsoleCta =
    parseHeaderNavModulesFromStatus(status as Record<string, unknown> | null)
      .console !== false

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  useEffect(() => {
    if (!authPromptTarget) return

    const intervalId = window.setInterval(() => {
      setAuthPromptSecondsLeft((seconds) => Math.max(seconds - 1, 0))
    }, 1000)

    const timeoutId = window.setTimeout(() => {
      const redirect = authPromptTarget.href
      setAuthPromptTarget(null)
      navigate({ to: '/sign-in', search: { redirect } })
    }, AUTH_PROMPT_SECONDS * 1000)

    return () => {
      window.clearInterval(intervalId)
      window.clearTimeout(timeoutId)
    }
  }, [authPromptTarget, navigate])

  const closeAuthPrompt = useCallback(() => {
    setAuthPromptTarget(null)
    setAuthPromptSecondsLeft(AUTH_PROMPT_SECONDS)
  }, [])

  const navigateToSignIn = useCallback(() => {
    const redirect = authPromptTarget?.href || '/'
    setAuthPromptTarget(null)
    navigate({ to: '/sign-in', search: { redirect } })
  }, [authPromptTarget?.href, navigate])

  const openConsoleAuthPrompt = useCallback(
    (closeMobile = false) => {
      if (closeMobile) {
        setMobileOpen(false)
      }
      setAuthPromptSecondsLeft(AUTH_PROMPT_SECONDS)
      setAuthPromptTarget({
        title: t('Console'),
        href: '/dashboard',
      })
    },
    [t]
  )

  const handleNavLinkClick = useCallback(
    (
      event: React.MouseEvent<HTMLAnchorElement>,
      link: TopNavLink,
      closeMobile = false
    ) => {
      if (link.disabled) {
        event.preventDefault()
        return
      }

      if (link.requiresAuth) {
        event.preventDefault()
        if (closeMobile) {
          setMobileOpen(false)
        }
        setAuthPromptSecondsLeft(AUTH_PROMPT_SECONDS)
        setAuthPromptTarget({
          title: t(link.title),
          href: link.href,
        })
        return
      }

      if (closeMobile) {
        setMobileOpen(false)
      }
    },
    [t]
  )

  return (
    <>
      <header className='pointer-events-none fixed inset-x-0 top-0 z-50'>
        <div
          className={cn(
            'pointer-events-auto mx-auto transition-[max-width,padding] duration-expressive ease-emphasized motion-reduce:transition-none',
            scrolled ? 'max-w-[52rem] px-3 pt-3' : 'max-w-7xl px-4 pt-0 md:px-6'
          )}
        >
          <nav
            className={cn(
              'flex items-center justify-between transition-[height,padding,border-radius,background-color,box-shadow] duration-expressive ease-emphasized motion-reduce:transition-none',
              scrolled
                ? 'bg-background/60 ring-border/50 shadow-raised h-12 rounded-2xl pr-1.5 pl-4 ring-[0.5px] backdrop-blur-2xl'
                : 'h-16 px-2'
            )}
          >
            {/* Logo */}
            <Link
              to={homeUrl}
              className='group flex shrink-0 items-center gap-2.5'
            >
              <div className='duration-overlay flex size-7 shrink-0 items-center justify-center transition-transform group-hover:scale-105 motion-reduce:transition-none'>
                {loading && <Skeleton className='size-full rounded-lg' />}
                {!loading && customLogo}
                {!loading && !customLogo && (
                  <HeaderLogo
                    src={systemLogo}
                    loading={loading}
                    logoLoaded={logoLoaded}
                    className='size-full rounded-lg object-contain'
                  />
                )}
              </div>
              <span className='text-sm font-semibold tracking-tight'>
                {loading ? <Skeleton className='h-4 w-16' /> : displaySiteName}
              </span>
            </Link>

            {/* Desktop nav */}
            <div className='hidden items-center gap-0.5 lg:flex'>
              {links.map((link) => {
                const isActive = isNavLinkActive(pathname, link.href)
                const linkClassName = cn(
                  'transition-ui duration-control rounded-lg px-3 py-1.5 text-[13px] font-medium',
                  isActive
                    ? 'bg-foreground/[0.06] text-foreground'
                    : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
                  link.disabled && 'pointer-events-none opacity-50'
                )
                if (link.external) {
                  return (
                    <a
                      key={link.href}
                      href={link.href}
                      target='_blank'
                      rel='noopener noreferrer'
                      aria-disabled={link.disabled}
                      tabIndex={link.disabled ? -1 : undefined}
                      onClick={(event) => handleNavLinkClick(event, link)}
                      className={linkClassName}
                    >
                      {t(link.title)}
                    </a>
                  )
                }
                return (
                  <Link
                    key={link.href}
                    to={link.href}
                    disabled={link.disabled}
                    onClick={(event) => handleNavLinkClick(event, link)}
                    className={linkClassName}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    {t(link.title)}
                  </Link>
                )
              })}

              {(showLanguageSwitcher ||
                showThemeSwitch ||
                showNotifications) && (
                <div className='bg-border/50 mx-2 h-4 w-px' />
              )}

              {showLanguageSwitcher && <LanguageSwitcher />}
              {showThemeSwitch && <ThemeSwitch />}
              {showNotifications && (
                <NotificationPopover
                  open={notifications.popoverOpen}
                  onOpenChange={notifications.setPopoverOpen}
                  unreadCount={notifications.unreadCount}
                  activeTab={notifications.activeTab}
                  onTabChange={notifications.setActiveTab}
                  notice={notifications.notice}
                  announcements={notifications.announcements}
                  loading={notifications.loading}
                />
              )}

              {showAuthButtons && (
                <>
                  <div className='bg-border/50 mx-1 h-4 w-px' />
                  {loading ? (
                    <Skeleton className='h-8 w-20 rounded-lg' />
                  ) : (
                    <>
                      {showConsoleCta &&
                        (isAuthenticated ? (
                          <Button
                            size='sm'
                            variant='cta'
                            className='h-8 px-3.5 text-xs font-medium shadow-sm'
                            render={<Link to='/dashboard' />}
                          >
                            <LayoutDashboard className='mr-1 size-3.5' />
                            {t('Console')}
                          </Button>
                        ) : (
                          <Button
                            size='sm'
                            variant='cta'
                            className='h-8 px-3.5 text-xs font-medium shadow-sm'
                            onClick={() => openConsoleAuthPrompt()}
                          >
                            <LayoutDashboard className='mr-1 size-3.5' />
                            {t('Console')}
                          </Button>
                        ))}
                      {isAuthenticated ? (
                        <ProfileDropdown />
                      ) : (
                        <Button
                          size='sm'
                          variant='outline'
                          className='h-8 px-3.5 text-xs font-medium'
                          render={<Link to='/sign-in' />}
                        >
                          {t('Sign in')}
                        </Button>
                      )}
                    </>
                  )}
                </>
              )}
            </div>

            {/* Mobile: compact actions + hamburger */}
            <div className='flex items-center gap-2 lg:hidden'>
              {showThemeSwitch && <ThemeSwitch />}
              {showAuthButtons && !loading && isAuthenticated && (
                <ProfileDropdown />
              )}
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='text-muted-foreground hover:text-foreground rounded-full'
                onClick={() => setMobileOpen((v) => !v)}
                aria-label={t('Toggle navigation menu')}
              >
                <div className='relative size-4'>
                  <span
                    className={cn(
                      'absolute inset-x-0 block h-[1.5px] origin-center rounded-full bg-current transition-[top,transform] duration-overlay motion-reduce:transition-none',
                      mobileOpen ? 'top-[7px] rotate-45' : 'top-[3px]'
                    )}
                  />
                  <span
                    className={cn(
                      'absolute inset-x-0 top-[7px] block h-[1.5px] rounded-full bg-current transition-[transform,opacity] duration-overlay motion-reduce:transition-none',
                      mobileOpen ? 'scale-x-0 opacity-0' : 'opacity-100'
                    )}
                  />
                  <span
                    className={cn(
                      'absolute inset-x-0 block h-[1.5px] origin-center rounded-full bg-current transition-[top,transform] duration-overlay motion-reduce:transition-none',
                      mobileOpen ? 'top-[7px] -rotate-45' : 'top-[11px]'
                    )}
                  />
                </div>
              </Button>
            </div>
          </nav>
        </div>
      </header>

      {/* Mobile full-screen overlay */}
      <div
        className={cn(
          'bg-background/98 fixed inset-0 z-40 backdrop-blur-2xl transition-opacity duration-expressive ease-emphasized lg:pointer-events-none lg:hidden',
          mobileOpen
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none opacity-0'
        )}
      >
        <div className='flex h-full flex-col justify-between px-8 pt-20 pb-10'>
          <nav className='flex flex-col gap-1'>
            {links.map((link, i) => {
              const isActive = isNavLinkActive(pathname, link.href)
              const linkClassName = cn(
                'flex items-center gap-3 py-3 text-base font-medium tracking-tight transition-[transform,opacity] duration-expressive ease-emphasized motion-reduce:transition-none',
                mobileOpen
                  ? 'translate-y-0 opacity-100'
                  : 'translate-y-4 opacity-0',
                isActive ? 'text-foreground' : 'text-muted-foreground',
                link.disabled && 'pointer-events-none opacity-50'
              )
              const transitionStyle = {
                transitionDelay: mobileOpen ? `${100 + i * 50}ms` : '0ms',
              }
              if (link.external) {
                return (
                  <a
                    key={link.href}
                    href={link.href}
                    target='_blank'
                    rel='noopener noreferrer'
                    aria-disabled={link.disabled}
                    tabIndex={link.disabled ? -1 : undefined}
                    onClick={(event) => handleNavLinkClick(event, link, true)}
                    className={linkClassName}
                    style={transitionStyle}
                  >
                    {t(link.title)}
                  </a>
                )
              }
              return (
                <Link
                  key={link.href}
                  to={link.href}
                  disabled={link.disabled}
                  onClick={(event) => handleNavLinkClick(event, link, true)}
                  className={linkClassName}
                  style={transitionStyle}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {t(link.title)}
                </Link>
              )
            })}
          </nav>

          <div
            className={cn(
              'flex flex-col gap-3 transition-[transform,opacity] duration-expressive motion-reduce:transition-none',
              mobileOpen
                ? 'translate-y-0 opacity-100'
                : 'translate-y-4 opacity-0'
            )}
            style={{ transitionDelay: mobileOpen ? '250ms' : '0ms' }}
          >
            {showAuthButtons && (
              <div className='flex flex-col gap-2'>
                {showConsoleCta &&
                  (isAuthenticated ? (
                    <Link
                      to='/dashboard'
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        buttonVariants({ variant: 'cta' }),
                        'h-10 w-full text-sm font-medium'
                      )}
                    >
                      {t('Console')}
                    </Link>
                  ) : (
                    <button
                      type='button'
                      onClick={() => openConsoleAuthPrompt(true)}
                      className={cn(
                        buttonVariants({ variant: 'cta' }),
                        'h-10 w-full text-sm font-medium'
                      )}
                    >
                      {t('Console')}
                    </button>
                  ))}
                {!isAuthenticated && (
                  <Link
                    to='/sign-in'
                    onClick={() => setMobileOpen(false)}
                    className='border-border bg-background text-foreground inline-flex h-10 items-center justify-center rounded-lg border text-sm font-medium transition-opacity hover:opacity-90'
                  >
                    {t('Sign in')}
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog
        open={!!authPromptTarget}
        onOpenChange={(open) => {
          if (!open) {
            closeAuthPrompt()
          }
        }}
        title={t('Sign in required')}
        description={t('Please sign in to view {{module}}.', {
          module: authPromptTarget?.title || '',
        })}
        contentClassName='sm:max-w-md'
        contentHeight='auto'
        footer={
          <>
            <Button variant='outline' onClick={closeAuthPrompt}>
              {t('Cancel')}
            </Button>
            <Button onClick={navigateToSignIn}>{t('Sign in now')}</Button>
          </>
        }
      >
        <div className='bg-muted/40 text-muted-foreground rounded-lg px-3 py-2 text-sm'>
          {t('Redirecting to sign in in {{seconds}} seconds.', {
            seconds: authPromptSecondsLeft,
          })}
        </div>
      </Dialog>
    </>
  )
}
