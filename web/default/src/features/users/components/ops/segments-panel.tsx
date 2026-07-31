import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Mail, Pencil, Plus, Send, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PanelWrapper } from '@/features/dashboard/components/ui/panel-wrapper'
import { formatNumber, formatTimestamp } from '@/lib/format'

import {
  deleteUserSegment,
  listUserCampaigns,
  listUserSegments,
} from '../../api'
import { ERROR_MESSAGES } from '../../constants'
import type { UserSegment } from '../../types'
import { CampaignDialog } from './campaign-dialog'
import { SegmentDialog } from './segment-dialog'

const CAMPAIGN_STATUS_VARIANT: Record<
  string,
  'default' | 'secondary' | 'destructive'
> = {
  completed: 'default',
  running: 'secondary',
  partial: 'secondary',
  failed: 'destructive',
}

export function SegmentsPanel() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [editorOpen, setEditorOpen] = useState(false)
  const [campaignOpen, setCampaignOpen] = useState(false)
  const [activeSegment, setActiveSegment] = useState<UserSegment | undefined>()
  const [pendingDelete, setPendingDelete] = useState<UserSegment | undefined>()

  const segmentsQuery = useQuery({
    queryKey: ['user-ops', 'segments'],
    queryFn: listUserSegments,
    select: (res) => (res.success ? (res.data ?? []) : []),
  })
  const campaignsQuery = useQuery({
    queryKey: ['user-ops', 'campaigns'],
    queryFn: listUserCampaigns,
    select: (res) => (res.success ? (res.data ?? []) : []),
    refetchInterval: 30_000,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteUserSegment(id),
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.message || t(ERROR_MESSAGES.UNEXPECTED))
        return
      }
      toast.success(t('Segment deleted'))
      void queryClient.invalidateQueries({ queryKey: ['user-ops', 'segments'] })
    },
    onError: () => toast.error(t(ERROR_MESSAGES.UNEXPECTED)),
  })

  const segments = segmentsQuery.data ?? []
  const campaigns = campaignsQuery.data ?? []

  return (
    <div className='space-y-3'>
      <PanelWrapper
        title={t('Saved segments')}
        description={t('Reusable audiences for bulk actions and campaigns')}
        loading={segmentsQuery.isLoading}
        empty={!segmentsQuery.isLoading && segments.length === 0}
        emptyMessage={t('No segments yet. Create one to get started.')}
        height='h-48'
        headerActions={
          <Button
            size='sm'
            onClick={() => {
              setActiveSegment(undefined)
              setEditorOpen(true)
            }}
          >
            <Plus />
            {t('New segment')}
          </Button>
        }
      >
        <div className='grid gap-2 sm:grid-cols-2 xl:grid-cols-3'>
          {segments.map((segment) => (
            <div
              key={segment.id}
              className='ring-border flex flex-col gap-2 rounded-lg p-3 ring-1'
            >
              <div className='flex items-start justify-between gap-2'>
                <div className='min-w-0'>
                  <div className='truncate text-sm font-medium'>
                    {segment.name}
                  </div>
                  {segment.description && (
                    <div className='text-muted-foreground truncate text-xs'>
                      {segment.description}
                    </div>
                  )}
                </div>
                <Badge variant='secondary' className='shrink-0 font-mono'>
                  <Users className='size-3' />
                  {formatNumber(segment.cached_count)}
                </Badge>
              </div>
              <div className='text-muted-foreground text-[11px]'>
                {segment.refreshed_at
                  ? t('Refreshed {{time}}', {
                      time: formatTimestamp(segment.refreshed_at),
                    })
                  : t('Never refreshed')}
              </div>
              <div className='flex flex-wrap gap-1.5'>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => {
                    setActiveSegment(segment)
                    setEditorOpen(true)
                  }}
                >
                  <Pencil />
                  {t('Edit')}
                </Button>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => {
                    setActiveSegment(segment)
                    setCampaignOpen(true)
                  }}
                >
                  <Send />
                  {t('Send')}
                </Button>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => setPendingDelete(segment)}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </PanelWrapper>

      <PanelWrapper
        title={t('Campaign history')}
        description={t('Delivery results of past outreach runs')}
        loading={campaignsQuery.isLoading}
        empty={!campaignsQuery.isLoading && campaigns.length === 0}
        emptyMessage={t('No campaigns sent yet.')}
        height='h-48'
        contentClassName='overflow-x-auto'
      >
        <table className='w-full text-xs'>
          <thead className='text-muted-foreground'>
            <tr>
              <th className='pb-2 text-left font-medium'>{t('Campaign')}</th>
              <th className='pb-2 text-left font-medium'>{t('Status')}</th>
              <th className='pb-2 text-right font-medium'>{t('Targets')}</th>
              <th className='pb-2 text-right font-medium'>{t('Delivered')}</th>
              <th className='pb-2 text-right font-medium'>{t('Failed')}</th>
              <th className='pb-2 text-right font-medium'>{t('Created')}</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((campaign) => (
              <tr key={campaign.id}>
                <td className='py-1.5'>
                  <div className='flex items-center gap-1.5'>
                    <Mail className='text-muted-foreground size-3.5' />
                    <span className='truncate'>{campaign.name}</span>
                  </div>
                </td>
                <td className='py-1.5'>
                  <Badge
                    variant={
                      CAMPAIGN_STATUS_VARIANT[campaign.status] ?? 'secondary'
                    }
                  >
                    {campaign.status}
                  </Badge>
                </td>
                <td className='py-1.5 text-right tabular-nums'>
                  {formatNumber(campaign.target_count)}
                </td>
                <td className='py-1.5 text-right tabular-nums'>
                  {formatNumber(campaign.success_count)}
                </td>
                <td className='py-1.5 text-right tabular-nums'>
                  {formatNumber(campaign.failed_count)}
                </td>
                <td className='py-1.5 text-right whitespace-nowrap'>
                  {formatTimestamp(campaign.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </PanelWrapper>

      <SegmentDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        segment={activeSegment}
        onSaved={() => {
          void queryClient.invalidateQueries({
            queryKey: ['user-ops', 'segments'],
          })
        }}
      />
      <CampaignDialog
        open={campaignOpen}
        onOpenChange={setCampaignOpen}
        segment={activeSegment}
        onSent={() => {
          void queryClient.invalidateQueries({
            queryKey: ['user-ops', 'campaigns'],
          })
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(undefined)
        }}
        title={t('Delete segment')}
        desc={t(
          'This removes the saved audience definition. Users are not affected.'
        )}
        destructive
        handleConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete.id)
          setPendingDelete(undefined)
        }}
      />
    </div>
  )
}
