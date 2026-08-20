import { useNavigate } from '@tanstack/react-router'
import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SettingsPageProvider } from '@/features/system-settings/components/settings-page-context'
import { useIsSidebarModuleVisible } from '@/hooks/use-sidebar-config'
import { useAuthStore } from '@/stores/auth-store'

import {
  PRICING_CENTER_TABS,
  PRICING_CENTER_TAB_TITLE_KEYS,
  canAccessPricingCenterTab,
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

const SubscriptionsTab = lazy(() =>
  import('./subscriptions-tab').then((module) => ({
    default: module.SubscriptionsTab,
  }))
)

const RedemptionsTab = lazy(() =>
  import('@/features/redemption-codes').then((module) => ({
    default: module.Redemptions,
  }))
)

const TopUpReviewsTab = lazy(() =>
  import('@/features/topup-reviews').then((module) => ({
    default: module.TopUpReviews,
  }))
)

const RewardsTab = lazy(() =>
  import('./rewards-tab').then((module) => ({
    default: module.RewardsTab,
  }))
)

export function PricingCenter(props: {
  tab: PricingCenterTab
  initialModelFilter?: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const role = useAuthStore((state) => state.auth.user?.role)
  const redemptionVisible = useIsSidebarModuleVisible(
    '/pricing-center/redemption'
  )
  const topupReviewsVisible = useIsSidebarModuleVisible(
    '/pricing-center/topup-reviews'
  )
  const rewardsVisible = useIsSidebarModuleVisible('/pricing-center/rewards')
  const [actionsContainer, setActionsContainer] =
    useState<HTMLDivElement | null>(null)
  const [titleStatusContainer, setTitleStatusContainer] =
    useState<HTMLSpanElement | null>(null)

  const visibleTabs = useMemo(
    () =>
      PRICING_CENTER_TABS.filter((tab) => {
        if (!canAccessPricingCenterTab(tab, role)) return false
        if (tab === 'redemption') return redemptionVisible
        if (tab === 'rewards') return rewardsVisible
        if (tab === 'topup-reviews') return topupReviewsVisible
        return true
      }),
    [role, redemptionVisible, rewardsVisible, topupReviewsVisible]
  )

  // Module toggles can hide the active tab after load; bounce to the first
  // remaining tab instead of rendering an empty shell.
  useEffect(() => {
    if (visibleTabs.length > 0 && !visibleTabs.includes(props.tab)) {
      void navigate({
        to: '/pricing-center/$tab',
        params: { tab: visibleTabs[0] },
        replace: true,
      })
    }
  }, [navigate, props.tab, visibleTabs])

  const handleTabChange = (value: string) => {
    if (value === props.tab) return
    void navigate({
      to: '/pricing-center/$tab',
      params: { tab: value as PricingCenterTab },
    })
  }

  let tabContent: ReactNode
  if (props.tab === 'models') {
    tabContent = (
      <ModelPricingTab initialModelFilter={props.initialModelFilter} />
    )
  } else if (props.tab === 'subscriptions') {
    tabContent = <SubscriptionsTab />
  } else if (props.tab === 'redemption') {
    tabContent = <RedemptionsTab embedded />
  } else if (props.tab === 'topup-reviews') {
    tabContent = <TopUpReviewsTab embedded />
  } else if (props.tab === 'rewards') {
    tabContent = <RewardsTab />
  } else {
    tabContent = <PricingSettingsTab tab={props.tab} />
  }

  const isFixed =
    props.tab === 'models' ||
    props.tab === 'subscriptions' ||
    props.tab === 'redemption' ||
    props.tab === 'rewards' ||
    props.tab === 'topup-reviews'

  return (
    <SectionPageLayout fixedContent={isFixed}>
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
          <div className='shrink-0 overflow-x-auto pb-0.5'>
            <Tabs
              value={props.tab}
              onValueChange={handleTabChange}
              className='w-max'
            >
              <TabsList>
                {visibleTabs.map((tab) => (
                  <TabsTrigger
                    key={tab}
                    value={tab}
                    className='px-2.5 text-xs whitespace-nowrap'
                  >
                    {t(PRICING_CENTER_TAB_TITLE_KEYS[tab])}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

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
                {tabContent}
              </Suspense>
            </SettingsPageProvider>
          </div>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
