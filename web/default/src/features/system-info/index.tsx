import { useTranslation } from 'react-i18next'

// Leaf import: avoid `@/components/layout` barrel (cycle via system-settings nav).
import { SectionPageLayout } from '@/components/layout/components/section-page-layout'
import { Badge } from '@/components/ui/badge'

import { SystemInstancesPanel } from './components/system-instances-panel'
import { SystemTasksPanel } from './components/system-tasks-panel'

/**
 * Cluster runtime panel (instances + background tasks).
 *
 * Distinct from System Settings → Site → System Information (branding copy).
 *
 * @param embedded When true, omit page chrome so System Settings → Operations
 *   can host this panel under "System Info".
 */
export function SystemInfo(props: { embedded?: boolean } = {}) {
  const { t } = useTranslation()

  const panel = (
    <div className='space-y-4'>
      <SystemInstancesPanel />
      <SystemTasksPanel />
    </div>
  )

  if (props.embedded) {
    return panel
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        <span className='inline-flex min-w-0 items-center gap-2'>
          <span className='truncate'>{t('System Info')}</span>
          <Badge variant='outline' className='shrink-0'>
            Root
          </Badge>
        </span>
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>{panel}</SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
