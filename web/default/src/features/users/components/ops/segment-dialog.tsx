import { useMutation, useQuery } from '@tanstack/react-query'
import { SlidersHorizontal } from 'lucide-react'
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

import {
  createUserSegment,
  previewUserSegment,
  updateUserSegment,
} from '../../api'
import { ERROR_MESSAGES } from '../../constants'
import type { UserQueryFilter, UserSegment } from '../../types'
import { AudienceFilterSheet } from './audience-filter-sheet'

function parseSegmentFilter(raw: string): UserQueryFilter {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as UserQueryFilter
  } catch {
    return {}
  }
}

export function SegmentDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  segment?: UserSegment
  initialFilter?: UserQueryFilter
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [filter, setFilter] = useState<UserQueryFilter>({})
  const [filterOpen, setFilterOpen] = useState(false)

  useEffect(() => {
    if (!props.open) return
    setName(props.segment?.name ?? '')
    setDescription(props.segment?.description ?? '')
    setFilter(
      props.segment
        ? parseSegmentFilter(props.segment.filter)
        : (props.initialFilter ?? {})
    )
  }, [props.open, props.segment, props.initialFilter])

  const { data: previewTotal } = useQuery({
    queryKey: ['user-ops', 'segment-preview', filter],
    queryFn: () => previewUserSegment(filter),
    select: (res) => (res.success ? (res.data?.total ?? 0) : 0),
    enabled: props.open,
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = { name: name.trim(), description, filter }
      return props.segment
        ? updateUserSegment(props.segment.id, payload)
        : createUserSegment(payload)
    },
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.message || t(ERROR_MESSAGES.UNEXPECTED))
        return
      }
      toast.success(t('Segment saved'))
      props.onOpenChange(false)
      props.onSaved()
    },
    onError: () => toast.error(t(ERROR_MESSAGES.UNEXPECTED)),
  })

  const predicateCount = Object.keys(filter).length

  return (
    <>
      <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        <DialogContent className='sm:max-w-[520px]'>
          <DialogHeader>
            <DialogTitle>
              {props.segment ? t('Edit segment') : t('New segment')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'Saved audiences can be reused for bulk actions and campaigns.'
              )}
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-4'>
            <div className='space-y-1.5'>
              <Label htmlFor='segment-name'>{t('Name')}</Label>
              <Input
                id='segment-name'
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('Activated but never paid')}
              />
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='segment-description'>{t('Description')}</Label>
              <Textarea
                id='segment-description'
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
              />
            </div>
            <div className='bg-muted/40 flex items-center justify-between gap-3 rounded-lg px-3 py-2.5'>
              <div className='min-w-0'>
                <div className='text-sm font-medium'>
                  {t('{{count}} matching users', {
                    count: previewTotal ?? 0,
                  })}
                </div>
                <div className='text-muted-foreground text-xs'>
                  {predicateCount === 0
                    ? t('No filters applied, this matches everyone')
                    : t('{{count}} filters applied', {
                        count: predicateCount,
                      })}
                </div>
              </div>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setFilterOpen(true)}
              >
                <SlidersHorizontal />
                {t('Edit filters')}
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant='outline' onClick={() => props.onOpenChange(false)}>
              {t('Cancel')}
            </Button>
            <Button
              disabled={!name.trim() || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {t('Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AudienceFilterSheet
        open={filterOpen}
        onOpenChange={setFilterOpen}
        filter={filter}
        onApply={setFilter}
      />
    </>
  )
}
