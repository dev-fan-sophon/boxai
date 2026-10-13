import { useQuery } from '@tanstack/react-query'
import { useState, useMemo } from 'react'

import { useStatus } from '@/hooks/use-status'
import { getNotices, type SystemNotice } from '@/lib/api'
import { useNotificationStore } from '@/stores/notification-store'

function hashString(input: string): string {
  let hash = 0
  if (!input) return '0'

  for (let i = 0; i < input.length; i += 1) {
    const chr = input.charCodeAt(i)
    hash = (hash << 5) - hash + chr
    hash |= 0
  }

  return hash.toString(36)
}

/**
 * Generate a unique key for an announcement
 * Prefer backend id, fall back to a content hash so edits register
 */
function getAnnouncementKey(item: Record<string, unknown>): string {
  if (!item) return ''

  if (item.id !== undefined && item.id !== null) {
    return `id:${item.id}`
  }

  const fingerprint = JSON.stringify({
    publishDate: (item?.publishDate as string) || '',
    content: ((item?.content as string) || '').trim(),
    extra: ((item?.extra as string) || '').trim(),
    type: (item?.type as string) || '',
    title: ((item?.title as string) || '').trim(),
    link: ((item?.link as string) || '').trim(),
  })
  return `hash:${hashString(fingerprint)}`
}

/**
 * Hook to manage notifications (Notice + Announcements)
 * Provides unread counts and read status management
 */
export function useNotifications() {
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'notice' | 'announcements'>(
    'notice'
  )

  // Fetch published notices from API
  const {
    data: noticesResponse,
    isLoading: noticeLoading,
    refetch: refetchNotice,
  } = useQuery({
    queryKey: ['notices'],
    queryFn: getNotices,
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchInterval: 1000 * 60 * 5,
  })

  // Fetch Announcements from status
  const { status, loading: statusLoading } = useStatus()
  const announcementsEnabled = status?.announcements_enabled ?? false
  const announcements: Record<string, unknown>[] = useMemo(
    () =>
      announcementsEnabled
        ? ((status?.announcements || []) as Record<string, unknown>[]).slice(
            0,
            20
          )
        : [],
    [announcementsEnabled, status?.announcements]
  )

  // Notification store
  const {
    lastReadNotice,
    readNoticeIds,
    markNoticesRead,
    markAnnouncementsRead,
    isAnnouncementRead,
  } = useNotificationStore()

  const notices: SystemNotice[] = useMemo(
    () => (noticesResponse?.success ? (noticesResponse.data ?? []) : []),
    [noticesResponse]
  )

  // A notice read before notices had ids is matched by its content once.
  const unreadNotices = useMemo(
    () =>
      notices.filter(
        (notice) =>
          !readNoticeIds.includes(notice.id) &&
          notice.content.trim() !== lastReadNotice
      ),
    [notices, readNoticeIds, lastReadNotice]
  )

  // Calculate unread counts
  const unreadCounts = useMemo(() => {
    const announcementsUnread = announcements.filter(
      (item: Record<string, unknown>) => {
        const key = getAnnouncementKey(item)
        return !isAnnouncementRead(key)
      }
    ).length

    return {
      notice: unreadNotices.length,
      announcements: announcementsUnread,
      total: unreadNotices.length + announcementsUnread,
    }
  }, [unreadNotices, announcements, isAnnouncementRead])

  const markAllNoticesRead = () => {
    if (notices.length > 0) {
      markNoticesRead(notices.map((notice) => notice.id))
    }
  }

  const markAnnouncementsAsRead = () => {
    if (announcements.length > 0) {
      const allKeys = announcements.map((item: Record<string, unknown>) =>
        getAnnouncementKey(item)
      )
      markAnnouncementsRead(allKeys)
    }
  }

  // Handle popover open
  const handleOpenPopover = (tab?: 'notice' | 'announcements') => {
    const nextTab = tab || activeTab

    // Mark currently visible content as read when opening the notification center
    markAllNoticesRead()
    if (nextTab === 'announcements') {
      markAnnouncementsAsRead()
    }

    setActiveTab(nextTab)
    setPopoverOpen(true)
  }

  const handlePopoverOpenChange = (open: boolean) => {
    if (open) {
      handleOpenPopover(activeTab)
      return
    }

    setPopoverOpen(false)
  }

  // Handle tab change - mark announcements as read when switching to that tab
  const handleTabChange = (tab: 'notice' | 'announcements') => {
    setActiveTab(tab)

    if (tab === 'announcements') {
      markAnnouncementsAsRead()
    }
  }

  return {
    // Data
    notices,
    unreadNotices,
    announcements,
    loading: noticeLoading || statusLoading,

    // Unread counts
    unreadCount: unreadCounts.total,
    unreadNoticeCount: unreadCounts.notice,
    unreadAnnouncementsCount: unreadCounts.announcements,

    // Popover state
    popoverOpen,
    setPopoverOpen: handlePopoverOpenChange,
    activeTab,
    setActiveTab: handleTabChange,

    // Actions
    openPopover: handleOpenPopover,
    closePopover: () => setPopoverOpen(false),
    markAllNoticesRead,
    refetchNotice,
  }
}
