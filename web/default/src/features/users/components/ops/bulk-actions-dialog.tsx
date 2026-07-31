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
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { getCurrencyLabel } from '@/lib/currency'
import { parseQuotaFromDollars } from '@/lib/format'

import { getGroups, runBulkUserAction } from '../../api'
import { ERROR_MESSAGES } from '../../constants'
import type { BulkUserActionType } from '../../types'

const ACTION_OPTIONS: Array<{ value: BulkUserActionType; labelKey: string }> = [
  { value: 'quota_grant', labelKey: 'Grant quota' },
  { value: 'group_set', labelKey: 'Change group' },
  { value: 'tag_add', labelKey: 'Add tag' },
  { value: 'tag_remove', labelKey: 'Remove tag' },
  { value: 'enable', labelKey: 'Enable' },
  { value: 'disable', labelKey: 'Disable' },
]

export function BulkActionsDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  userIds: number[]
  onApplied: () => void
}) {
  const { t } = useTranslation()
  const [action, setAction] = useState<BulkUserActionType>('quota_grant')
  const [amount, setAmount] = useState('')
  const [group, setGroup] = useState('')
  const [tag, setTag] = useState('')
  const [groups, setGroups] = useState<string[]>([])

  useEffect(() => {
    if (!props.open) return
    setAction('quota_grant')
    setAmount('')
    setGroup('')
    setTag('')
    void getGroups().then((result) => {
      if (result.success) setGroups(result.data ?? [])
    })
  }, [props.open])

  const runMutation = useMutation({
    mutationFn: () =>
      runBulkUserAction({
        action,
        user_ids: props.userIds,
        quota:
          action === 'quota_grant'
            ? parseQuotaFromDollars(Number(amount) || 0)
            : undefined,
        group: action === 'group_set' ? group : undefined,
        tag:
          action === 'tag_add' || action === 'tag_remove'
            ? tag.trim()
            : undefined,
      }),
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.message || t(ERROR_MESSAGES.UNEXPECTED))
        return
      }
      toast.success(
        t('Applied to {{applied}} of {{targets}} users', {
          applied: result.data?.applied ?? 0,
          targets: result.data?.targets ?? 0,
        })
      )
      props.onOpenChange(false)
      props.onApplied()
    },
    onError: () => toast.error(t(ERROR_MESSAGES.UNEXPECTED)),
  })

  const needsAmount = action === 'quota_grant'
  const needsGroup = action === 'group_set'
  const needsTag = action === 'tag_add' || action === 'tag_remove'
  const canSubmit =
    props.userIds.length > 0 &&
    (!needsAmount || Number(amount) > 0) &&
    (!needsGroup || Boolean(group)) &&
    (!needsTag || Boolean(tag.trim()))

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='sm:max-w-[460px]'>
        <DialogHeader>
          <DialogTitle>{t('Bulk action')}</DialogTitle>
          <DialogDescription>
            {t('Applies to {{count}} selected users.', {
              count: props.userIds.length,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='space-y-1.5'>
            <Label htmlFor='bulk-action'>{t('Action')}</Label>
            <NativeSelect
              id='bulk-action'
              className='w-full'
              value={action}
              onChange={(event) =>
                setAction(event.target.value as BulkUserActionType)
              }
            >
              {ACTION_OPTIONS.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          {needsAmount && (
            <div className='space-y-1.5'>
              <Label htmlFor='bulk-amount'>
                {t('Amount ({{currency}})', { currency: getCurrencyLabel() })}
              </Label>
              <Input
                id='bulk-amount'
                inputMode='decimal'
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
          )}

          {needsGroup && (
            <div className='space-y-1.5'>
              <Label htmlFor='bulk-group'>{t('Group')}</Label>
              <NativeSelect
                id='bulk-group'
                className='w-full'
                value={group}
                onChange={(event) => setGroup(event.target.value)}
              >
                <NativeSelectOption value=''>
                  {t('Select a group')}
                </NativeSelectOption>
                {groups.map((name) => (
                  <NativeSelectOption key={name} value={name}>
                    {name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          )}

          {needsTag && (
            <div className='space-y-1.5'>
              <Label htmlFor='bulk-tag'>{t('Tag')}</Label>
              <Input
                id='bulk-tag'
                value={tag}
                onChange={(event) => setTag(event.target.value)}
                maxLength={64}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button
            disabled={!canSubmit || runMutation.isPending}
            onClick={() => runMutation.mutate()}
          >
            {t('Apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
