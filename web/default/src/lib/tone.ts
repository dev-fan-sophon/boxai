/**
 * Status tones.
 *
 * These replace the `bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15
 * dark:text-emerald-300` quartets that were spread across the app. Each tone
 * resolves to the `*-subtle` token pair from theme.css, which is contrast
 * checked against its own foreground in both schemes — so a tone cannot drift
 * out of AA the way an ad hoc shade pairing could.
 *
 * Use `tone()` for a filled chip/badge/banner surface, and `toneText()` when
 * only the label needs the status color (for example an inline number or an
 * icon riding on the surrounding background).
 */
export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

const TONE_SURFACE: Record<Tone, string> = {
  success: 'bg-success-subtle text-success-subtle-foreground',
  warning: 'bg-warning-subtle text-warning-subtle-foreground',
  danger: 'bg-destructive-subtle text-destructive-subtle-foreground',
  info: 'bg-info-subtle text-info-subtle-foreground',
  neutral: 'bg-muted text-muted-foreground',
}

const TONE_BORDER: Record<Tone, string> = {
  success: 'border-success/25',
  warning: 'border-warning/25',
  danger: 'border-destructive/25',
  info: 'border-info/25',
  neutral: 'border-border',
}

const TONE_TEXT: Record<Tone, string> = {
  success: 'text-success-subtle-foreground',
  warning: 'text-warning-subtle-foreground',
  danger: 'text-destructive-subtle-foreground',
  info: 'text-info-subtle-foreground',
  neutral: 'text-muted-foreground',
}

const TONE_DOT: Record<Tone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  info: 'bg-info',
  neutral: 'bg-neutral',
}

/** Filled status surface. Pass `bordered` for chips that also need an edge. */
export function tone(name: Tone, options?: { bordered?: boolean }): string {
  const surface = TONE_SURFACE[name]
  return options?.bordered ? `${surface} border ${TONE_BORDER[name]}` : surface
}

/** Status-colored label on an inherited background. */
export function toneText(name: Tone): string {
  return TONE_TEXT[name]
}

/** Solid status indicator dot. */
export function toneDot(name: Tone): string {
  return TONE_DOT[name]
}
