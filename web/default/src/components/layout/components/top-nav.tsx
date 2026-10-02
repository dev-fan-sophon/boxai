import { Link, useRouterState } from '@tanstack/react-router'
import { motion } from 'motion/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Menu } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MOTION_SPRING } from '@/lib/motion'
import { cn } from '@/lib/utils'

import { isTopNavLinkActive } from '../lib/url-utils'
import type { TopNavLink } from '../types'

type TopNavProps = React.HTMLAttributes<HTMLElement> & {
  links: TopNavLink[]
}

/**
 * 顶部导航栏组件
 * 在大屏幕显示水平导航，在小屏幕显示下拉菜单
 */
export function TopNav({ className, links, ...props }: TopNavProps) {
  const { t } = useTranslation()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  // 规范化链接，确保所有可选属性都有默认值；未显式给出 isActive 时按当前路径推断
  const normalizedLinks = useMemo(
    () =>
      links.map((link) => ({
        disabled: false,
        external: false,
        ...link,
        isActive:
          link.isActive ??
          (!link.external && isTopNavLinkActive(pathname, link.href)),
      })),
    [links, pathname]
  )

  return (
    <>
      {/* 移动端下拉菜单 */}
      <div className='lg:hidden'>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            render={
              <Button
                size='icon'
                variant='ghost'
                className='text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground size-7'
                aria-label={t('Toggle navigation menu')}
              />
            }
          >
            <Menu aria-hidden='true' />
          </DropdownMenuTrigger>
          <DropdownMenuContent side='bottom' align='start'>
            {normalizedLinks.map(
              ({ title, href, isActive, disabled, external }) => (
                <DropdownMenuItem
                  key={`${title}-${href}`}
                  render={
                    external ? (
                      <a
                        href={href}
                        target='_blank'
                        rel='noopener noreferrer'
                        className={!isActive ? 'text-muted-foreground' : ''}
                      >
                        {t(title)}
                      </a>
                    ) : (
                      <Link
                        to={href}
                        className={!isActive ? 'text-muted-foreground' : ''}
                        disabled={disabled}
                      >
                        {t(title)}
                      </Link>
                    )
                  }
                />
              )
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 桌面端水平导航 */}
      <nav
        className={cn('hidden items-center gap-0.5 lg:flex', className)}
        {...props}
      >
        {normalizedLinks.map(
          ({ title, href, isActive, disabled, external }) => {
            const linkClassName = cn(
              'relative isolate inline-flex h-8 items-center rounded-lg px-2.5 text-ui font-medium whitespace-nowrap transition-ui duration-control',
              isActive
                ? 'text-foreground'
                : 'text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-foreground'
            )
            // Shared `layoutId`: the raised pill slides between sections rather
            // than blinking. Reduced motion turns the slide into a cut through
            // the root `MotionConfig`.
            const indicator = isActive ? (
              <motion.span
                layoutId='top-nav-active-indicator'
                aria-hidden='true'
                className='bg-card shadow-raised ring-border/70 dark:bg-sidebar-accent absolute inset-0 -z-10 rounded-lg ring-1 dark:ring-white/5'
                transition={MOTION_SPRING.snappy}
              />
            ) : null
            if (external) {
              return (
                <a
                  key={`${title}-${href}`}
                  href={href}
                  target='_blank'
                  rel='noopener noreferrer'
                  className={linkClassName}
                >
                  {t(title)}
                  {indicator}
                </a>
              )
            }
            return (
              <Link
                key={`${title}-${href}`}
                to={href}
                disabled={disabled}
                className={linkClassName}
                aria-current={isActive ? 'page' : undefined}
              >
                {t(title)}
                {indicator}
              </Link>
            )
          }
        )}
      </nav>
    </>
  )
}
