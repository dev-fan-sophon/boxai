import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import type { SystemNotice } from '@/lib/api'

// Notices render through RichContent; keep that stack out of first paint and
// load it only when there is something unread to show.
const NoticeList = lazy(() =>
  import('@/components/notification-popover-body').then((module) => ({
    default: module.NoticeList,
  }))
)

/**
 * Opens on arrival whenever published notices are still unread, so a new
 * notice reaches the user without them having to find the bell. Closing it
 * marks every shown notice read; later notices open it again.
 */
export function UnreadNoticeDialog(props: {
  unreadNotices: SystemNotice[]
  onAcknowledge: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  // Snapshot so the content stays put while the dialog animates out after
  // the notices are marked read.
  const [shown, setShown] = useState<SystemNotice[]>([])

  if (!open && props.unreadNotices.length > 0) {
    setShown(props.unreadNotices)
    setOpen(true)
  }

  const handleOpenChange = (next: boolean) => {
    if (next) return
    props.onAcknowledge()
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t('System Notice')}</DialogTitle>
          <DialogDescription>
            {t('Latest platform updates and notices')}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className='max-h-[min(60vh,32rem)] pr-3'>
          <Suspense fallback={<Skeleton className='h-32 w-full' />}>
            <NoticeList notices={shown} />
          </Suspense>
        </ScrollArea>
        <DialogFooter>
          <Button onClick={() => handleOpenChange(false)}>{t('Got it')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
