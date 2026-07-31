import { useNavigate, useParams } from '@tanstack/react-router'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { FadeIn } from '@/components/page-enter'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { OpsRangeTabs } from './components/ops/ops-range-tabs'
import { UserProfileDrawer } from './components/ops/user-profile-drawer'
import { UsersDeleteDialog } from './components/users-delete-dialog'
import { UsersMutateDrawer } from './components/users-mutate-drawer'
import { UsersPrimaryButtons } from './components/users-primary-buttons'
import { UsersProvider, useUsers } from './components/users-provider'
import { UsersTable } from './components/users-table'
import { OPS_DEFAULT_RANGE_DAYS } from './lib/ops'
import {
  USERS_DEFAULT_SECTION,
  USERS_SECTION_IDS,
  type UsersSectionId,
} from './section-manifest'

const LazyGrowthOverview = lazy(() =>
  import('./components/ops/growth-overview').then((module) => ({
    default: module.GrowthOverview,
  }))
)
const LazyRevenuePanel = lazy(() =>
  import('./components/ops/revenue-panel').then((module) => ({
    default: module.RevenuePanel,
  }))
)
const LazyAcquisitionPanel = lazy(() =>
  import('./components/ops/acquisition-panel').then((module) => ({
    default: module.AcquisitionPanel,
  }))
)
const LazySegmentsPanel = lazy(() =>
  import('./components/ops/segments-panel').then((module) => ({
    default: module.SegmentsPanel,
  }))
)

const SECTION_TITLES: Record<UsersSectionId, string> = {
  overview: 'Growth overview',
  directory: 'User directory',
  revenue: 'Revenue & conversion',
  acquisition: 'Acquisition & referrals',
  segments: 'Segments & campaigns',
}

function PanelFallback() {
  return (
    <div className='space-y-3'>
      <Skeleton className='h-32 w-full rounded-xl' />
      <Skeleton className='h-72 w-full rounded-xl' />
    </div>
  )
}

function UsersContent() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const params = useParams({ strict: false }) as { section?: string }
  const { open, setOpen, currentRow, profileUserId, setProfileUserId } =
    useUsers()
  const [rangeDays, setRangeDays] = useState(OPS_DEFAULT_RANGE_DAYS)

  const activeSection = (params.section ??
    USERS_DEFAULT_SECTION) as UsersSectionId
  const isDirectory = activeSection === 'directory'
  const showRangeTabs =
    activeSection === 'overview' ||
    activeSection === 'revenue' ||
    activeSection === 'acquisition'

  return (
    <>
      <SectionPageLayout fixedContent={isDirectory}>
        <SectionPageLayout.Title>
          {t(SECTION_TITLES[activeSection] ?? SECTION_TITLES.overview)}
        </SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          {isDirectory && <UsersPrimaryButtons />}
          {showRangeTabs && (
            <OpsRangeTabs days={rangeDays} onDaysChange={setRangeDays} />
          )}
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <div className={isDirectory ? 'flex h-full flex-col' : 'space-y-3'}>
            <div className='shrink-0 overflow-x-auto pb-1'>
              <Tabs
                value={activeSection}
                onValueChange={(section) =>
                  void navigate({
                    to: '/users/$section',
                    params: { section: section as UsersSectionId },
                  })
                }
                className='w-max'
              >
                <TabsList>
                  {USERS_SECTION_IDS.map((section) => (
                    <TabsTrigger
                      key={section}
                      value={section}
                      className='px-2.5 text-xs whitespace-nowrap'
                    >
                      {t(SECTION_TITLES[section])}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>

            {activeSection === 'overview' && (
              <FadeIn>
                <Suspense fallback={<PanelFallback />}>
                  <LazyGrowthOverview days={rangeDays} />
                </Suspense>
              </FadeIn>
            )}
            {activeSection === 'revenue' && (
              <FadeIn>
                <Suspense fallback={<PanelFallback />}>
                  <LazyRevenuePanel days={rangeDays} />
                </Suspense>
              </FadeIn>
            )}
            {activeSection === 'acquisition' && (
              <FadeIn>
                <Suspense fallback={<PanelFallback />}>
                  <LazyAcquisitionPanel days={rangeDays} />
                </Suspense>
              </FadeIn>
            )}
            {activeSection === 'segments' && (
              <FadeIn>
                <Suspense fallback={<PanelFallback />}>
                  <LazySegmentsPanel />
                </Suspense>
              </FadeIn>
            )}
            {isDirectory && (
              <div className='min-h-0 flex-1'>
                <UsersTable />
              </div>
            )}
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <UsersMutateDrawer
        open={open === 'create' || open === 'update'}
        onOpenChange={(isOpen) => !isOpen && setOpen(null)}
        currentRow={open === 'update' ? currentRow || undefined : undefined}
      />
      <UsersDeleteDialog />
      <UserProfileDrawer
        userId={profileUserId}
        onOpenChange={(isOpen) => {
          if (!isOpen) setProfileUserId(null)
        }}
      />
    </>
  )
}

export function Users() {
  return (
    <UsersProvider>
      <UsersContent />
    </UsersProvider>
  )
}
