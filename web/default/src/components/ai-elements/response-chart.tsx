/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
'use client'

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts'

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'

import { chartColor, parseChartSpec, type ChartSpec } from './chart-spec'
import { CodeBlock, CodeBlockCopyButton, CodeBlockFrame } from './code-block'
import { FenceViewToggle, type FenceView } from './fence-view-toggle'

/** Themed recharts renderer shared by chart fences and table visualization. */
export function ChartSpecRenderer(props: { spec: ChartSpec }) {
  const spec = props.spec
  const config = useMemo(() => {
    const entries: ChartConfig = {}
    spec.yKeys.forEach((key, index) => {
      entries[key] = { label: key, color: chartColor(index) }
    })
    return entries
  }, [spec.yKeys])

  const commonAxes = (
    <>
      <CartesianGrid vertical={false} strokeDasharray='3 3' />
      <XAxis dataKey={spec.xKey} tickLine={false} axisLine={false} />
      <YAxis tickLine={false} axisLine={false} width={44} />
      <ChartTooltip content={<ChartTooltipContent />} />
      <ChartLegend content={<ChartLegendContent />} />
    </>
  )

  let chart: React.ReactElement
  if (spec.type === 'pie') {
    const valueKey = spec.yKeys[0]
    const pieData = spec.data.map((row, index) => ({
      key: `slice-${index}`,
      fill: chartColor(index),
      name: String(row[spec.xKey] ?? ''),
      value: typeof row[valueKey] === 'number' ? row[valueKey] : 0,
    }))
    chart = (
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent nameKey='name' />} />
        <Pie
          data={pieData}
          dataKey='value'
          nameKey='name'
          innerRadius='45%'
          strokeWidth={2}
        >
          {pieData.map((entry) => (
            <Cell key={entry.key} fill={entry.fill} />
          ))}
        </Pie>
        <ChartLegend content={<ChartLegendContent nameKey='name' />} />
      </PieChart>
    )
  } else if (spec.type === 'line') {
    chart = (
      <LineChart data={spec.data}>
        {commonAxes}
        {spec.yKeys.map((key, index) => (
          <Line
            key={key}
            dataKey={key}
            stroke={chartColor(index)}
            strokeWidth={2}
            dot={false}
            type='monotone'
          />
        ))}
      </LineChart>
    )
  } else if (spec.type === 'area') {
    chart = (
      <AreaChart data={spec.data}>
        {commonAxes}
        {spec.yKeys.map((key, index) => (
          <Area
            key={key}
            dataKey={key}
            stroke={chartColor(index)}
            fill={chartColor(index)}
            fillOpacity={0.25}
            type='monotone'
          />
        ))}
      </AreaChart>
    )
  } else {
    chart = (
      <BarChart data={spec.data}>
        {commonAxes}
        {spec.yKeys.map((key, index) => (
          <Bar key={key} dataKey={key} fill={chartColor(index)} radius={3} />
        ))}
      </BarChart>
    )
  }

  return (
    <ChartContainer config={config} className='aspect-video max-h-80 w-full'>
      {chart}
    </ChartContainer>
  )
}

type ChartFenceProps = {
  code: string
  final: boolean
}

/**
 * Renders ```chart fences (JSON spec) as an inline data visualization once
 * the message is final; invalid or streaming specs fall back to raw JSON.
 */
export function ChartFence(props: ChartFenceProps) {
  const { t } = useTranslation()
  const [view, setView] = useState<FenceView>('preview')
  const spec = useMemo(
    () => (props.final ? parseChartSpec(props.code) : null),
    [props.code, props.final]
  )

  if (!spec || view === 'code') {
    return (
      <CodeBlock
        code={props.code}
        collapsedLines={14}
        defaultCollapsed={false}
        language='json'
        maxExpandedLines={44}
        showLineNumbers
        showToolbar
        title={t('Chart')}
      >
        {spec !== null && (
          <FenceViewToggle
            view='code'
            onViewChange={setView}
            previewLabelKey='Chart'
          />
        )}
        <CodeBlockCopyButton />
      </CodeBlock>
    )
  }

  return (
    <CodeBlockFrame
      showToolbar
      title={spec.title || t('Chart')}
      endActions={
        <FenceViewToggle
          view='preview'
          onViewChange={setView}
          previewLabelKey='Chart'
        />
      }
      bodyClassName='p-3'
    >
      <ChartSpecRenderer spec={spec} />
    </CodeBlockFrame>
  )
}
