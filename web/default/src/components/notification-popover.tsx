import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'

import { Bell } from '@/components/icons'
import type {
  AnnouncementItem,
  NotificationTab,
} from '@/components/notification-popover-body'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface NotificationPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  unreadCount: number
  activeTab: NotificationTab
  onTabChange: (tab: NotificationTab) => void
  notice: string
  announcements: AnnouncementItem[]
  loading: boolean
  className?: string
}

// The body renders notices through RichContent (marked + DOMPurify, KaTeX on
// demand); both headers mount this popover, so keep that stack out of the
// shell's first paint and fetch it on intent or first open.
const loadNotificationPopoverBody = () =>
  import('@/components/notification-popover-body')

const NotificationPopoverBody = lazy(() =>
  loadNotificationPopoverBody().then((module) => ({
    default: module.NotificationPopoverBody,
  }))
)

/**
 * Notification popover with Notice and Announcements tabs
 */
export function NotificationPopover(props: NotificationPopoverProps) {
  const { t } = useTranslation()
  return (
    <Popover open={props.open} onOpenChange={props.onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant='ghost'
            size='icon'
            className={cn(
              'text-muted-foreground hover:text-foreground relative rounded-full',
              props.className
            )}
            aria-label={t('Notifications')}
            onPointerEnter={() => void loadNotificationPopoverBody()}
            onFocus={() => void loadNotificationPopoverBody()}
          />
        }
      >
        <Bell className='size-4' />
        {props.unreadCount > 0 ? (
          <Badge
            variant='destructive'
            className='text-3xs absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center px-1 font-semibold tabular-nums'
          >
            {props.unreadCount > 99 ? '99+' : props.unreadCount}
          </Badge>
        ) : null}
      </PopoverTrigger>

      <PopoverContent
        align='end'
        sideOffset={8}
        className='w-[min(26rem,calc(100vw-1rem))] gap-3 p-3'
      >
        <PopoverHeader className='gap-1 px-1'>
          <PopoverTitle>{t('System Announcements')}</PopoverTitle>
          <p className='text-muted-foreground text-xs'>
            {t('Latest platform updates and notices')}
          </p>
        </PopoverHeader>

        <Suspense
          fallback={
            <div className='flex flex-col gap-2' aria-busy='true'>
              <Skeleton className='h-8 w-full' />
              <Skeleton className='h-48 w-full' />
            </div>
          }
        >
          <NotificationPopoverBody
            activeTab={props.activeTab}
            onTabChange={props.onTabChange}
            notice={props.notice}
            announcements={props.announcements}
            loading={props.loading}
            onClose={() => props.onOpenChange(false)}
          />
        </Suspense>
      </PopoverContent>
    </Popover>
  )
}
