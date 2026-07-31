import type { ParsedNode, TableNode } from 'stream-markdown-parser'
import { z } from 'zod'

import { hasParsedChildren } from './response-node-guards'

export type ChartSpec = {
  type: 'bar' | 'line' | 'area' | 'pie'
  title?: string
  xKey: string
  yKeys: string[]
  data: Array<Record<string, string | number | null>>
}

export type TableData = {
  headers: string[]
  rows: string[][]
}

const chartRowSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.null()])
)

const chartSpecSchema = z.object({
  type: z.enum(['bar', 'line', 'area', 'pie']),
  title: z.string().optional(),
  xKey: z.string().optional(),
  yKeys: z.array(z.string()).min(1).max(10).optional(),
  data: z.array(chartRowSchema).min(1).max(500),
})

const CHART_COLOR_COUNT = 5

export function chartColor(index: number): string {
  return `var(--chart-${(index % CHART_COLOR_COUNT) + 1})`
}

function isNumericValue(value: string | number | null): boolean {
  if (value === null) return true
  if (typeof value === 'number') return Number.isFinite(value)
  return false
}

/** Parse a ```chart fence body into a normalized spec, or null when invalid. */
export function parseChartSpec(code: string): ChartSpec | null {
  let raw: unknown
  try {
    raw = JSON.parse(code)
  } catch {
    return null
  }

  const parsed = chartSpecSchema.safeParse(raw)
  if (!parsed.success) return null

  const spec = parsed.data
  const keys = Object.keys(spec.data[0])
  if (keys.length === 0) return null

  const numericKeys = keys.filter((key) =>
    spec.data.every((row) => isNumericValue(row[key] ?? null))
  )

  let xKey = spec.xKey
  if (!xKey || !keys.includes(xKey)) {
    xKey = keys.find((key) => !numericKeys.includes(key)) ?? keys[0]
  }

  const yKeys = (
    spec.yKeys?.filter((key) => numericKeys.includes(key)) ??
    numericKeys.filter((key) => key !== xKey)
  ).slice(0, 10)
  if (yKeys.length === 0) return null

  return { type: spec.type, title: spec.title, xKey, yKeys, data: spec.data }
}

function getNodeText(node: ParsedNode): string {
  if ('content' in node && typeof node.content === 'string') {
    return node.content
  }
  if ('code' in node && typeof node.code === 'string') {
    return node.code
  }
  if (hasParsedChildren(node)) {
    return node.children.map(getNodeText).join('')
  }
  return typeof node.raw === 'string' ? node.raw : ''
}

export function extractTableData(node: TableNode): TableData {
  return {
    headers: node.header.cells.map((cell) =>
      cell.children.map(getNodeText).join('').trim()
    ),
    rows: node.rows.map((row) =>
      row.cells.map((cell) => cell.children.map(getNodeText).join('').trim())
    ),
  }
}

function toCsvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`
  }
  return value
}

export function tableToCsv(data: TableData): string {
  return [data.headers, ...data.rows]
    .map((row) => row.map(toCsvField).join(','))
    .join('\n')
}

export function tableToMarkdown(data: TableData): string {
  const escape = (value: string) => value.replaceAll('|', '\\|')
  const headerLine = `| ${data.headers.map(escape).join(' | ')} |`
  const dividerLine = `| ${data.headers.map(() => '---').join(' | ')} |`
  const rowLines = data.rows.map((row) => `| ${row.map(escape).join(' | ')} |`)
  return [headerLine, dividerLine, ...rowLines].join('\n')
}

function parseNumericCell(value: string): number | null {
  const normalized = value.replaceAll(',', '').replace(/%$/, '').trim()
  if (normalized === '') return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function getNumericColumns(data: TableData): number[] {
  return data.headers
    .map((_, columnIndex) => columnIndex)
    .filter((columnIndex) => {
      let hasValue = false
      for (const row of data.rows) {
        const cell = row[columnIndex] ?? ''
        if (cell.trim() === '') continue
        if (parseNumericCell(cell) === null) return false
        hasValue = true
      }
      return hasValue
    })
}

/** Build a chart spec from extracted table data, or null without numeric columns. */
export function buildTableChartSpec(
  data: TableData,
  type: ChartSpec['type']
): ChartSpec | null {
  const numericColumns = getNumericColumns(data)
  if (numericColumns.length === 0 || data.rows.length === 0) return null

  const firstLabelColumn = data.headers.findIndex(
    (_, index) => !numericColumns.includes(index)
  )
  const labelColumn = firstLabelColumn === -1 ? 0 : firstLabelColumn
  const xKey = data.headers[labelColumn] || `#${labelColumn + 1}`
  const yColumns = numericColumns.filter((index) => index !== labelColumn)
  if (yColumns.length === 0) return null

  const yKeys = yColumns.map((index) => data.headers[index] || `#${index + 1}`)
  const rows = data.rows.map((row) => {
    const entry: Record<string, string | number | null> = {
      [xKey]: row[labelColumn] ?? '',
    }
    yColumns.forEach((columnIndex, position) => {
      entry[yKeys[position]] = parseNumericCell(row[columnIndex] ?? '')
    })
    return entry
  })

  return { type, title: undefined, xKey, yKeys, data: rows }
}
