import { useNavigate } from '@tanstack/react-router'
import { motion } from 'motion/react'
import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'

import {
  Coins,
  CreditCard,
  Gift,
  ListChecks,
  Repeat,
  Tag,
  Trophy,
  Users,
  BadgePercent,
  type IconComponent,
} from '@/components/icons'
import { SectionPageLayout } from '@/components/layout'
import { Skeleton } from '@/components/ui/skeleton'
import { SettingsPageProvider } from '@/features/system-settings/components/settings-page-context'
import { useIsSidebarModuleVisible } from '@/hooks/use-sidebar-config'
import { MOTION_SPRING } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import {
  PRICING_CENTER_TABS,
  PRICING_CENTER_TAB_TITLE_KEYS,
  canAccessPricingCenterTab,
  type PricingCenterTab,
} from './tabs'

const PRICING_CENTER_TAB_ICONS: Record<PricingCenterTab, IconComponent> = {
  models: Tag,
  subscriptions: Repeat,
  groups: Users,
  currency: Coins,
  payments: CreditCard,
  'topup-promotions': BadgePercent,
  'topup-reviews': ListChecks,
  redemption: Gift,
  rewards: Trophy,
}

/** Sidebar grouping for the pricing center's two-pane layout. */
const PRICING_CENTER_NAV_GROUPS: ReadonlyArray<{
  labelKey: string
  tabs: readonly PricingCenterTab[]
}> = [
  {
    labelKey: 'Rates & plans',
    tabs: ['models', 'subscriptions', 'groups', 'currency'],
  },
  {
    labelKey: 'Payments',
    tabs: ['payments', 'topup-promotions', 'topup-reviews'],
  },
  { labelKey: 'Promotions', tabs: ['redemption', 'rewards'] },
]

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

const TopUpPromotionsTab = lazy(() => import('./topup-promotions-tab'))

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
  } else if (props.tab === 'topup-promotions') {
    tabContent = <TopUpPromotionsTab />
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

  const navGroups = PRICING_CENTER_NAV_GROUPS.map((group) => ({
    ...group,
    tabs: group.tabs.filter((tab) => visibleTabs.includes(tab)),
  })).filter((group) => group.tabs.length > 0)

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
        {/* Below `sm` the actions take their own row so the title keeps its
            full width next to long Vietnamese button labels. */}
        <div
          ref={setActionsContainer}
          className='flex flex-wrap items-center justify-end gap-2 empty:hidden max-sm:w-[calc(100vw-2rem)] max-sm:justify-start'
        />
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='flex h-full min-h-0 flex-col gap-4 lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-6'>
          <nav
            aria-label={t('Pricing sections')}
            className='-mx-4 shrink-0 overflow-x-auto px-4 pb-0.5 sm:-mx-6 sm:px-6 lg:mx-0 lg:overflow-visible lg:p-0'
          >
            <div className='flex w-max gap-1 lg:w-full lg:flex-col lg:gap-5'>
              {navGroups.map((group) => (
                <div
                  key={group.labelKey}
                  className='flex gap-1 lg:flex-col lg:gap-0.5'
                >
                  <p className='text-muted-foreground text-2xs hidden px-2.5 pb-1 font-medium lg:block'>
                    {t(group.labelKey)}
                  </p>
                  {group.tabs.map((tab) => {
                    const Icon = PRICING_CENTER_TAB_ICONS[tab]
                    const active = tab === props.tab
                    return (
                      <button
                        key={tab}
                        type='button'
                        aria-current={active ? 'page' : undefined}
                        onClick={() => handleTabChange(tab)}
                        className={cn(
                          'relative flex h-8 min-w-0 items-center gap-2 rounded-lg px-2.5 text-start text-ui font-medium whitespace-nowrap outline-none lg:h-auto lg:min-h-8 lg:py-1.5 lg:whitespace-normal',
                          'transition-colors duration-control focus-visible:ring-ring/50 focus-visible:ring-[3px]',
                          'max-lg:ring-border max-lg:ring-1 max-lg:ring-inset',
                          active
                            ? 'text-foreground max-lg:ring-transparent'
                            : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                        )}
                      >
                        {active && (
                          <motion.span
                            layoutId='pricing-center-nav-active'
                            transition={MOTION_SPRING.snappy}
                            className='bg-accent max-lg:bg-secondary absolute inset-0 rounded-lg'
                            aria-hidden='true'
                          />
                        )}
                        <Icon
                          aria-hidden='true'
                          weight={active ? 'fill' : undefined}
                          className={cn(
                            'relative size-4 shrink-0',
                            active && 'text-primary'
                          )}
                        />
                        <span className='relative min-w-0'>
                          {t(PRICING_CENTER_TAB_TITLE_KEYS[tab])}
                        </span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </nav>

          <div className='min-h-0 min-w-0 flex-1'>
            <SettingsPageProvider
              actionsContainer={actionsContainer}
              titleStatusContainer={titleStatusContainer}
              pageTitle={t(PRICING_CENTER_TAB_TITLE_KEYS[props.tab])}
            >
              <Suspense
                fallback={
                  <div className='space-y-3'>
                    <Skeleton className='h-24 w-full rounded-2xl' />
                    <Skeleton className='h-24 w-full rounded-2xl' />
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
