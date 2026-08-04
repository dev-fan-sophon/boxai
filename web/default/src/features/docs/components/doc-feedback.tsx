import { useMutation } from '@tanstack/react-query'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'

export function DocFeedback(props: { docPath: string }) {
  const { t, i18n } = useTranslation()
  const [choice, setChoice] = useState<'yes' | 'no' | null>(null)
  const [comment, setComment] = useState('')
  const [done, setDone] = useState(false)

  const mutation = useMutation({
    mutationFn: async (input: { helpful: boolean; note: string }) => {
      await api.post(
        '/api/docs/feedback',
        {
          path: props.docPath.startsWith('docs/')
            ? props.docPath
            : `docs/${props.docPath}`,
          helpful: input.helpful,
          comment: input.note.trim() || undefined,
          locale: i18n.language,
        },
        { skipBusinessError: true }
      )
    },
    onSuccess: () => {
      setDone(true)
      toast.success(t('Thanks for the feedback'))
    },
    onError: () => {
      toast.error(t('Could not send feedback. Please try again.'))
    },
  })

  if (done) {
    return (
      <div className='text-muted-foreground mt-10 rounded-lg border px-4 py-3 text-sm'>
        {t('Thanks for the feedback')}
      </div>
    )
  }

  return (
    <div className='mt-10 space-y-3 rounded-lg border px-4 py-4'>
      <p className='text-sm font-medium'>{t('Did this page help?')}</p>
      <div className='flex flex-wrap gap-2'>
        <Button
          type='button'
          size='sm'
          variant={choice === 'yes' ? 'default' : 'outline'}
          disabled={mutation.isPending}
          onClick={() => {
            setChoice('yes')
            mutation.mutate({ helpful: true, note: comment })
          }}
        >
          <ThumbsUp className='size-3.5' />
          {t('Yes')}
        </Button>
        <Button
          type='button'
          size='sm'
          variant={choice === 'no' ? 'default' : 'outline'}
          disabled={mutation.isPending}
          onClick={() => setChoice('no')}
        >
          <ThumbsDown className='size-3.5' />
          {t('No')}
        </Button>
      </div>
      {choice === 'no' ? (
        <div className='space-y-2'>
          <Textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder={t('Optional: what should we improve?')}
            rows={3}
            maxLength={500}
          />
          <Button
            type='button'
            size='sm'
            disabled={mutation.isPending}
            onClick={() => mutation.mutate({ helpful: false, note: comment })}
          >
            {t('Send feedback')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
