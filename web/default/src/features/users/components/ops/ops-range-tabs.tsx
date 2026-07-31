import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { OPS_RANGE_PRESETS } from '../../lib/ops'

export function OpsRangeTabs(props: {
  days: number
  onDaysChange: (days: number) => void
  loading?: boolean
}) {
  const { t } = useTranslation()

  return (
    <div className='flex items-center gap-2'>
      <Tabs
        value={String(props.days)}
        onValueChange={(value) => props.onDaysChange(Number(value))}
        className='shrink-0'
      >
        <TabsList>
          {OPS_RANGE_PRESETS.map((preset) => (
            <TabsTrigger
              key={preset.days}
              value={String(preset.days)}
              className='px-2.5 text-xs'
            >
              {t(preset.labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {props.loading && (
        <Loader2 className='text-muted-foreground size-4 animate-spin' />
      )}
    </div>
  )
}
