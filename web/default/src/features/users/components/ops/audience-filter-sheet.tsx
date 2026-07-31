import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  SideDrawerSection,
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'

import { getGroups, getUserTags } from '../../api'
import { compactFilter } from '../../lib/ops'
import type { UserQueryFilter } from '../../types'

/** Tri-state select value used for the optional boolean predicates. */
type TriState = '' | 'true' | 'false'

function toTriState(value: boolean | null | undefined): TriState {
  if (value === true) return 'true'
  if (value === false) return 'false'
  return ''
}

function fromTriState(value: TriState): boolean | undefined {
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function toNumberInput(value: number | null | undefined): string {
  return value === undefined || value === null ? '' : String(value)
}

function fromNumberInput(value: string): number | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

function toDateInput(timestamp: number | undefined): string {
  if (!timestamp) return ''
  const date = new Date(timestamp * 1000)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function fromDateInput(value: string, endOfDay: boolean): number | undefined {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  if (endOfDay) {
    date.setHours(23, 59, 59, 999)
  } else {
    date.setHours(0, 0, 0, 0)
  }
  return Math.floor(date.getTime() / 1000)
}

export function AudienceFilterSheet(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  filter: UserQueryFilter
  onApply: (filter: UserQueryFilter) => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<UserQueryFilter>(props.filter)

  useEffect(() => {
    if (props.open) setDraft(props.filter)
  }, [props.open, props.filter])

  const { data: groupsData } = useQuery({
    queryKey: ['groups'],
    queryFn: getGroups,
    staleTime: 5 * 60 * 1000,
  })
  const { data: tagsData } = useQuery({
    queryKey: ['user-ops', 'tags'],
    queryFn: getUserTags,
    select: (res) => (res.success ? (res.data ?? []) : []),
    staleTime: 60_000,
  })

  const groups = groupsData?.data ?? []
  const tags = tagsData ?? []

  const patch = (changes: Partial<UserQueryFilter>) => {
    setDraft((previous) => ({ ...previous, ...changes }))
  }

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className={sideDrawerContentClassName('sm:max-w-[520px]')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>{t('Audience filters')}</SheetTitle>
          <SheetDescription>
            {t('Narrow the audience by lifecycle, spend, and attribution.')}
          </SheetDescription>
        </SheetHeader>

        <div className={sideDrawerFormClassName()}>
          <SideDrawerSection>
            <h3 className='text-sm font-medium'>{t('Identity')}</h3>
            <div className='grid gap-3 sm:grid-cols-2'>
              <div className='space-y-1.5'>
                <Label htmlFor='audience-keyword'>{t('Keyword')}</Label>
                <Input
                  id='audience-keyword'
                  value={draft.keyword ?? ''}
                  onChange={(event) => patch({ keyword: event.target.value })}
                  placeholder={t('ID, username, email or remark')}
                />
              </div>
              <div className='space-y-1.5'>
                <Label htmlFor='audience-group'>{t('Group')}</Label>
                <NativeSelect
                  id='audience-group'
                  className='w-full'
                  value={draft.group ?? ''}
                  onChange={(event) => patch({ group: event.target.value })}
                >
                  <NativeSelectOption value=''>{t('Any')}</NativeSelectOption>
                  {groups.map((group) => (
                    <NativeSelectOption key={group} value={group}>
                      {group}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className='space-y-1.5'>
                <Label htmlFor='audience-tag'>{t('Tag')}</Label>
                <NativeSelect
                  id='audience-tag'
                  className='w-full'
                  value={draft.tags?.[0] ?? ''}
                  onChange={(event) =>
                    patch({
                      tags: event.target.value ? [event.target.value] : [],
                    })
                  }
                >
                  <NativeSelectOption value=''>{t('Any')}</NativeSelectOption>
                  {tags.map((tag) => (
                    <NativeSelectOption key={tag.tag} value={tag.tag}>
                      {`${tag.tag} (${tag.users})`}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className='space-y-1.5'>
                <Label htmlFor='audience-status'>{t('Status')}</Label>
                <NativeSelect
                  id='audience-status'
                  className='w-full'
                  value={draft.status == null ? '' : String(draft.status)}
                  onChange={(event) =>
                    patch({
                      status: event.target.value
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                >
                  <NativeSelectOption value=''>{t('Any')}</NativeSelectOption>
                  <NativeSelectOption value='1'>
                    {t('Enabled')}
                  </NativeSelectOption>
                  <NativeSelectOption value='2'>
                    {t('Disabled')}
                  </NativeSelectOption>
                </NativeSelect>
              </div>
            </div>
          </SideDrawerSection>

          <SideDrawerSection>
            <h3 className='text-sm font-medium'>{t('Acquisition')}</h3>
            <div className='grid gap-3 sm:grid-cols-2'>
              <div className='space-y-1.5'>
                <Label htmlFor='audience-source'>{t('Signup channel')}</Label>
                <Input
                  id='audience-source'
                  value={draft.register_source ?? ''}
                  onChange={(event) =>
                    patch({ register_source: event.target.value })
                  }
                  placeholder='password, oauth:zalo'
                />
              </div>
              <div className='space-y-1.5'>
                <Label htmlFor='audience-utm-source'>{t('UTM source')}</Label>
                <Input
                  id='audience-utm-source'
                  value={draft.utm_source ?? ''}
                  onChange={(event) =>
                    patch({ utm_source: event.target.value })
                  }
                />
              </div>
              <div className='space-y-1.5'>
                <Label htmlFor='audience-utm-campaign'>
                  {t('UTM campaign')}
                </Label>
                <Input
                  id='audience-utm-campaign'
                  value={draft.utm_campaign ?? ''}
                  onChange={(event) =>
                    patch({ utm_campaign: event.target.value })
                  }
                />
              </div>
              <div className='space-y-1.5'>
                <Label htmlFor='audience-inviter'>{t('Inviter ID')}</Label>
                <Input
                  id='audience-inviter'
                  inputMode='numeric'
                  value={toNumberInput(draft.inviter_id)}
                  onChange={(event) =>
                    patch({ inviter_id: fromNumberInput(event.target.value) })
                  }
                />
              </div>
              <div className='space-y-1.5'>
                <Label htmlFor='audience-created-after'>
                  {t('Registered after')}
                </Label>
                <Input
                  id='audience-created-after'
                  type='date'
                  value={toDateInput(draft.created_after)}
                  onChange={(event) =>
                    patch({
                      created_after: fromDateInput(event.target.value, false),
                    })
                  }
                />
              </div>
              <div className='space-y-1.5'>
                <Label htmlFor='audience-created-before'>
                  {t('Registered before')}
                </Label>
                <Input
                  id='audience-created-before'
                  type='date'
                  value={toDateInput(draft.created_before)}
                  onChange={(event) =>
                    patch({
                      created_before: fromDateInput(event.target.value, true),
                    })
                  }
                />
              </div>
            </div>
          </SideDrawerSection>

          <SideDrawerSection>
            <h3 className='text-sm font-medium'>{t('Activity')}</h3>
            <div className='grid gap-3 sm:grid-cols-2'>
              <div className='space-y-1.5'>
                <Label htmlFor='audience-inactive-days'>
                  {t('Inactive for at least (days)')}
                </Label>
                <Input
                  id='audience-inactive-days'
                  inputMode='numeric'
                  value={toNumberInput(draft.inactive_days)}
                  onChange={(event) =>
                    patch({
                      inactive_days: fromNumberInput(event.target.value),
                    })
                  }
                />
              </div>
              <div className='flex items-center justify-between gap-3 pt-6'>
                <Label htmlFor='audience-never-active'>
                  {t('Never made a call')}
                </Label>
                <Switch
                  id='audience-never-active'
                  checked={Boolean(draft.never_active)}
                  onCheckedChange={(checked) =>
                    patch({ never_active: checked })
                  }
                />
              </div>
              <div className='space-y-1.5'>
                <Label htmlFor='audience-min-quota'>
                  {t('Minimum balance')}
                </Label>
                <Input
                  id='audience-min-quota'
                  inputMode='numeric'
                  value={toNumberInput(draft.min_quota)}
                  onChange={(event) =>
                    patch({ min_quota: fromNumberInput(event.target.value) })
                  }
                />
              </div>
              <div className='space-y-1.5'>
                <Label htmlFor='audience-max-quota'>
                  {t('Maximum balance')}
                </Label>
                <Input
                  id='audience-max-quota'
                  inputMode='numeric'
                  value={toNumberInput(draft.max_quota)}
                  onChange={(event) =>
                    patch({ max_quota: fromNumberInput(event.target.value) })
                  }
                />
              </div>
            </div>
          </SideDrawerSection>

          <SideDrawerSection>
            <h3 className='text-sm font-medium'>{t('Monetization')}</h3>
            <div className='grid gap-3 sm:grid-cols-2'>
              <div className='space-y-1.5'>
                <Label htmlFor='audience-has-paid'>{t('Has paid')}</Label>
                <NativeSelect
                  id='audience-has-paid'
                  className='w-full'
                  value={toTriState(draft.has_paid)}
                  onChange={(event) =>
                    patch({
                      has_paid: fromTriState(event.target.value as TriState),
                    })
                  }
                >
                  <NativeSelectOption value=''>{t('Any')}</NativeSelectOption>
                  <NativeSelectOption value='true'>
                    {t('Yes')}
                  </NativeSelectOption>
                  <NativeSelectOption value='false'>
                    {t('No')}
                  </NativeSelectOption>
                </NativeSelect>
              </div>
              <div className='space-y-1.5'>
                <Label htmlFor='audience-has-subscription'>
                  {t('Has active subscription')}
                </Label>
                <NativeSelect
                  id='audience-has-subscription'
                  className='w-full'
                  value={toTriState(draft.has_subscription)}
                  onChange={(event) =>
                    patch({
                      has_subscription: fromTriState(
                        event.target.value as TriState
                      ),
                    })
                  }
                >
                  <NativeSelectOption value=''>{t('Any')}</NativeSelectOption>
                  <NativeSelectOption value='true'>
                    {t('Yes')}
                  </NativeSelectOption>
                  <NativeSelectOption value='false'>
                    {t('No')}
                  </NativeSelectOption>
                </NativeSelect>
              </div>
              <div className='space-y-1.5'>
                <Label htmlFor='audience-min-spend'>
                  {t('Minimum lifetime spend')}
                </Label>
                <Input
                  id='audience-min-spend'
                  inputMode='decimal'
                  value={toNumberInput(draft.min_topup_money)}
                  onChange={(event) =>
                    patch({
                      min_topup_money: fromNumberInput(event.target.value),
                    })
                  }
                />
              </div>
              <div className='space-y-1.5'>
                <Label htmlFor='audience-min-orders'>
                  {t('Minimum paid orders')}
                </Label>
                <Input
                  id='audience-min-orders'
                  inputMode='numeric'
                  value={toNumberInput(draft.min_topup_count)}
                  onChange={(event) =>
                    patch({
                      min_topup_count: fromNumberInput(event.target.value),
                    })
                  }
                />
              </div>
            </div>
          </SideDrawerSection>
        </div>

        <SheetFooter className={sideDrawerFooterClassName()}>
          <Button
            variant='outline'
            onClick={() => {
              setDraft({})
              props.onApply({})
              props.onOpenChange(false)
            }}
          >
            {t('Reset')}
          </Button>
          <Button
            onClick={() => {
              props.onApply(compactFilter(draft))
              props.onOpenChange(false)
            }}
          >
            {t('Apply')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
