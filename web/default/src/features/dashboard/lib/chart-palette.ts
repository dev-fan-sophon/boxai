/**
 * Categorical series colors. Every entry is a theme token so charts follow the
 * active light/dark scheme; the twelve hues are spread around the wheel so a
 * large domain (per-user series, per-model series) stays distinguishable.
 * Recharts renders SVG, so `var()` resolves at paint time.
 */
export const CHART_SERIES_COLORS: readonly string[] = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
  'var(--chart-9)',
  'var(--chart-10)',
  'var(--chart-11)',
  'var(--chart-12)',
]

/**
 * Returns exactly `domainLength` colors for a categorical chart domain, so a
 * caller can map `domain[i]` to `colors[i]`.
 */
export function getDashboardChartColors(domainLength: number): string[] {
  const size = Math.max(1, Math.floor(domainLength) || 0)
  return Array.from(
    { length: size },
    (_, index) => CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length]
  )
}
