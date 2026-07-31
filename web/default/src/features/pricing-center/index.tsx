import { useNavigate } from '@tanstack/react-router'
import { Suspense, lazy, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SettingsPageProvider } from '@/features/system-settings/components/settings-page-context'

import {
  PRICING_CENTER_TABS,
  PRICING_CENTER_TAB_TITLE_KEYS,
  type PricingCenterTab,
} from './tabs'

const ModelPricingTab = lazy(() =>
  import('./model-pricing-tab').then((module) => ({
    default: module.ModelPricingTab,
  }))
)

const PricingSettingsTab = lazy(() =>
  import('./settings-tabs').then((module) => ({
    default: module.PricingSettingsTab,
  }))
)

export function PricingCenter(props: {
  tab: PricingCenterTab
  initialModelFilter?: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [actionsContainer, setActionsContainer] =
    useState<HTMLDivElement | null>(null)
  const [titleStatusContainer, setTitleStatusContainer] =
    useState<HTMLSpanElement | null>(null)

  const handleTabChange = (value: string) => {
    if (value === props.tab) return
    void navigate({
      to: '/pricing-center/$tab',
      params: { tab: value as PricingCenterTab },
    })
  }

  return (
    <SectionPageLayout fixedContent={props.tab === 'models'}>
      <SectionPageLayout.Title>
        <span className='inline-flex max-w-full min-w-0 items-center gap-2 align-middle'>
          <span className='truncate'>{t('Pricing Center')}</span>
          <span
            ref={setTitleStatusContainer}
            className='inline-flex min-w-0 shrink-0 items-center'
          />
        </span>
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <div
          ref={setActionsContainer}
          className='flex flex-wrap items-center justify-end gap-2'
        />
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='flex h-full min-h-0 flex-col gap-3'>
          <Tabs
            value={props.tab}
            onValueChange={handleTabChange}
            className='shrink-0'
          >
            <TabsList className='grid w-fit max-w-full grid-cols-4'>
              {PRICING_CENTER_TABS.map((tab) => (
                <TabsTrigger key={tab} value={tab}>
                  {t(PRICING_CENTER_TAB_TITLE_KEYS[tab])}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className='min-h-0 flex-1'>
            <SettingsPageProvider
              actionsContainer={actionsContainer}
              titleStatusContainer={titleStatusContainer}
            >
              <Suspense
                fallback={
                  <div className='space-y-3'>
                    <Skeleton className='h-24 w-full' />
                    <Skeleton className='h-24 w-full' />
                  </div>
                }
              >
                {props.tab === 'models' ? (
                  <ModelPricingTab
                    initialModelFilter={props.initialModelFilter}
                  />
                ) : (
                  <PricingSettingsTab tab={props.tab} />
                )}
              </Suspense>
            </SettingsPageProvider>
          </div>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
