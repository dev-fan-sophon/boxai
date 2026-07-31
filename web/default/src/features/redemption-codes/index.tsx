import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'

import { RedemptionsDialogs } from './components/redemptions-dialogs'
import { RedemptionsPrimaryButtons } from './components/redemptions-primary-buttons'
import { RedemptionsProvider } from './components/redemptions-provider'
import { RedemptionsTable } from './components/redemptions-table'

/**
 * @param embedded When true, omit the page chrome so the table can sit inside
 *   Pricing Center as a tab panel. The host supplies the page title.
 */
export function Redemptions(props: { embedded?: boolean } = {}) {
  const { t } = useTranslation()
  const body = (
    <RedemptionsProvider>
      {props.embedded ? (
        <div className='flex h-full min-h-0 flex-col gap-3'>
          <div className='flex shrink-0 justify-end'>
            <RedemptionsPrimaryButtons />
          </div>
          <div className='min-h-0 flex-1'>
            <RedemptionsTable />
          </div>
        </div>
      ) : (
        <SectionPageLayout fixedContent>
          <SectionPageLayout.Title>
            {t('Redemption Codes')}
          </SectionPageLayout.Title>
          <SectionPageLayout.Actions>
            <RedemptionsPrimaryButtons />
          </SectionPageLayout.Actions>
          <SectionPageLayout.Content>
            <RedemptionsTable />
          </SectionPageLayout.Content>
        </SectionPageLayout>
      )}
      <RedemptionsDialogs />
    </RedemptionsProvider>
  )
  return body
}
