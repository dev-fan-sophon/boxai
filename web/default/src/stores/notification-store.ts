import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface NotificationState {
  // Legacy: last read single Notice content, from before notices had ids
  lastReadNotice: string
  // Ids of published notices the user has seen
  readNoticeIds: number[]
  // Array of read announcement keys (id or content hash)
  readAnnouncementKeys: string[]
  // Timestamp of last "Close Today" action
  closedUntilDate: string | null
  // Day (toDateString) the low-balance warning was last shown
  lowBalanceWarnedOn: string | null

  // Actions
  markNoticesRead: (ids: number[]) => void
  markAnnouncementsRead: (keys: string[]) => void
  setClosedUntilDate: (date: string | null) => void
  setLowBalanceWarnedOn: (date: string) => void
  isAnnouncementRead: (key: string) => boolean
  isNoticeClosed: () => boolean
}

// Keep the read list bounded; the server only ever returns the newest notices.
const MAX_READ_NOTICE_IDS = 200

/**
 * Notification store for tracking read status of Notice and Announcements
 * Persists to localStorage to maintain state across sessions
 */
export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      lastReadNotice: '',
      readNoticeIds: [],
      readAnnouncementKeys: [],
      closedUntilDate: null,
      lowBalanceWarnedOn: null,

      markNoticesRead: (ids: number[]) => {
        set((state) => ({
          readNoticeIds: [...new Set([...state.readNoticeIds, ...ids])].slice(
            -MAX_READ_NOTICE_IDS
          ),
        }))
      },

      markAnnouncementsRead: (keys: string[]) => {
        set((state) => ({
          readAnnouncementKeys: [
            ...new Set([...state.readAnnouncementKeys, ...keys]),
          ],
        }))
      },

      setClosedUntilDate: (date: string | null) => {
        set({ closedUntilDate: date })
      },

      setLowBalanceWarnedOn: (date: string) => {
        set({ lowBalanceWarnedOn: date })
      },

      isAnnouncementRead: (key: string) => {
        return get().readAnnouncementKeys.includes(key)
      },

      isNoticeClosed: () => {
        const { closedUntilDate } = get()
        if (!closedUntilDate) return false

        const today = new Date().toDateString()
        return closedUntilDate === today
      },
    }),
    {
      name: 'notification-storage',
      partialize: (state) => ({
        lastReadNotice: state.lastReadNotice,
        readNoticeIds: state.readNoticeIds,
        readAnnouncementKeys: state.readAnnouncementKeys,
        closedUntilDate: state.closedUntilDate,
        lowBalanceWarnedOn: state.lowBalanceWarnedOn,
      }),
    }
  )
)
