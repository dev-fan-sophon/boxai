import { useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { sendUserCampaign } from '../../api'
import { ERROR_MESSAGES } from '../../constants'
import type { UserSegment } from '../../types'

export function CampaignDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  segment?: UserSegment
  onSent: () => void
}) {
  const { t } = useTranslation()
  const [subject, setSubject] = useState('')
  const [content, setContent] = useState('')

  useEffect(() => {
    if (props.open) {
      setSubject('')
      setContent('')
    }
  }, [props.open])

  const sendMutation = useMutation({
    mutationFn: () =>
      sendUserCampaign({
        name: subject.trim(),
        segment_id: props.segment?.id,
        subject: subject.trim(),
        content: content.trim(),
      }),
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.message || t(ERROR_MESSAGES.UNEXPECTED))
        return
      }
      toast.success(
        t('Campaign queued for {{count}} recipients', {
          count: result.data?.target_count ?? 0,
        })
      )
      props.onOpenChange(false)
      props.onSent()
    },
    onError: () => toast.error(t(ERROR_MESSAGES.UNEXPECTED)),
  })

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='sm:max-w-[560px]'>
        <DialogHeader>
          <DialogTitle>{t('Send email campaign')}</DialogTitle>
          <DialogDescription>
            {props.segment
              ? t('Recipients come from the segment "{{name}}".', {
                  name: props.segment.name,
                })
              : t('Select a segment first.')}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='space-y-1.5'>
            <Label htmlFor='campaign-subject'>{t('Subject')}</Label>
            <Input
              id='campaign-subject'
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={200}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='campaign-content'>{t('Content')}</Label>
            <Textarea
              id='campaign-content'
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={8}
              maxLength={20000}
            />
            <p className='text-muted-foreground text-xs'>
              {t(
                'HTML is delivered as-is. Only enabled users with an email address receive the message.'
              )}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button
            disabled={
              !props.segment ||
              !subject.trim() ||
              !content.trim() ||
              sendMutation.isPending
            }
            onClick={() => sendMutation.mutate()}
          >
            {t('Send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
