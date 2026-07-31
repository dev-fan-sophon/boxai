import { Link } from '@tanstack/react-router'
import { Wallet } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { getSelfSubscriptionFull } from '@/features/subscriptions/api'
import { getSelf } from '@/lib/api'
import { formatQuota } from '@/lib/format'
import { MOTION_TRANSITION } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

type SubscriptionQuota = { unlimited: boolean; remaining: number } | null

/**
 * Sidebar account strip: wallet balance plus remaining subscription quota.
 * Identity lives in the header profile dropdown, so this stays numbers-only.
 */
export function SidebarAccountFooter() {
  const { t } = useTranslation()
  const { state } = useSidebar()
  const user = useAuthStore((s) => s.auth.user)
  const setUser = useAuthStore((s) => s.auth.setUser)
  const [subscription, setSubscription] = useState<SubscriptionQuota>(null)
  const collapsed = state === 'collapsed'

  useEffect(() => {
    let cancelled = false
    void getSelf()
      .then((res) => {
        if (cancelled || !res.success || !res.data) return
        setUser(res.data as typeof user)
      })
      .catch(() => {
        /* keep existing session user */
      })
    return () => {
      cancelled = true
    }
  }, [setUser])

  useEffect(() => {
    let cancelled = false
    void getSelfSubscriptionFull()
      .then((res) => {
        if (cancelled || !res.success || !res.data) return
        const now = Date.now() / 1000
        const active = (res.data.subscriptions || []).filter(
          (record) =>
            record.subscription?.status === 'active' &&
            (record.subscription?.end_time || 0) > now
        )
        if (active.length === 0) {
          setSubscription(null)
          return
        }
        if (
          active.some((record) => (record.subscription?.amount_total || 0) <= 0)
        ) {
          setSubscription({ unlimited: true, remaining: 0 })
          return
        }
        const remaining = active.reduce((sum, record) => {
          const total = record.subscription?.amount_total || 0
          const used = record.subscription?.amount_used || 0
          return sum + Math.max(0, total - used)
        }, 0)
        setSubscription({ unlimited: false, remaining })
      })
      .catch(() => {
        setSubscription(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!user) return null

  const balance = formatQuota(user.quota ?? 0)
  let subscriptionLabel: string | null = null
  if (subscription?.unlimited) {
    subscriptionLabel = t('Unlimited')
  } else if (subscription) {
    subscriptionLabel = formatQuota(subscription.remaining)
  }
  let collapsedLabel = `${t('Account balance')}: ${balance}`
  if (subscriptionLabel) {
    collapsedLabel += ` · ${t('Subscription remaining')}: ${subscriptionLabel}`
  }

  return (
    <SidebarFooter className='border-sidebar-border/50 gap-0 border-t p-2'>
      <SidebarMenu>
        <SidebarMenuItem>
          {collapsed ? (
            <SidebarMenuButton
              render={<Link to='/wallet' />}
              className='size-8 justify-center'
              aria-label={collapsedLabel}
              tooltip={collapsedLabel}
            >
              <Wallet className='size-4' />
            </SidebarMenuButton>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={MOTION_TRANSITION.fast}
            >
              <Link
                to='/wallet'
                className={cn(
                  'hover:bg-sidebar-accent/60 flex w-full flex-col gap-1 rounded-lg px-1.5 py-1.5',
                  'ring-sidebar-ring transition-colors focus-visible:ring-2 focus-visible:outline-none'
                )}
              >
                <span className='flex items-baseline justify-between gap-2'>
                  <span className='text-muted-foreground text-[10px] tracking-wide uppercase'>
                    {t('Account balance')}
                  </span>
                  <span className='text-sidebar-foreground truncate text-sm font-semibold tabular-nums'>
                    {balance}
                  </span>
                </span>
                {subscriptionLabel && (
                  <span className='flex items-baseline justify-between gap-2'>
                    <span className='text-muted-foreground text-[10px] tracking-wide uppercase'>
                      {t('Subscription remaining')}
                    </span>
                    <span className='text-muted-foreground truncate text-xs font-medium tabular-nums'>
                      {subscriptionLabel}
                    </span>
                  </span>
                )}
              </Link>
            </motion.div>
          )}
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  )
}
