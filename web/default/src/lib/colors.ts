export type SemanticColor =
  | 'blue'
  | 'green'
  | 'cyan'
  | 'purple'
  | 'pink'
  | 'red'
  | 'orange'
  | 'amber'
  | 'yellow'
  | 'lime'
  | 'light-green'
  | 'teal'
  | 'light-blue'
  | 'indigo'
  | 'violet'
  | 'grey'
  | 'slate'

export const colorToBgClass: Record<SemanticColor, string> = {
  blue: 'bg-blue-500',
  green: 'bg-green-500',
  cyan: 'bg-cyan-500',
  purple: 'bg-purple-500',
  pink: 'bg-pink-500',
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  amber: 'bg-amber-500',
  yellow: 'bg-yellow-500',
  lime: 'bg-lime-500',
  'light-green': 'bg-green-400',
  teal: 'bg-teal-500',
  'light-blue': 'bg-sky-400',
  indigo: 'bg-indigo-500',
  violet: 'bg-violet-500',
  grey: 'bg-gray-400',
  slate: 'bg-slate-500',
}

/** Label placed on a brand-colored fill when white would be too dim. */
const BRAND_DARK_FOREGROUND = '#0b1633'

/** Substitute for vendor accents that vanish into one of the two canvases. */
const NEUTRAL_BRAND_ACCENT = '#8a8f98'

/**
 * Vendor brand colors are chosen for a logo, not for our canvases: near-black
 * marks (OpenAI, xAI) disappear in dark mode and near-white marks disappear in
 * light mode. Swap those for a neutral accent so a legend or share chart stays
 * readable in both schemes; every other brand color is passed through intact.
 */
export function visibleBrandAccent(color: string): string {
  const luminance = brandLuminance(color)
  if (luminance === undefined) return color
  return luminance < 0.05 || luminance > 0.85 ? NEUTRAL_BRAND_ACCENT : color
}

function brandLuminance(color: string): number | undefined {
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) return undefined
  const channels = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(color.slice(index, index + 2), 16) / 255
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

/**
 * Label color for a brand-colored fill. Light brand colors get the dark label
 * instead of washing out under white, which is what lets the accessibility
 * check below accept a wider range of brand colors.
 */
export function brandPrimaryForeground(color: string): string {
  const luminance = brandLuminance(color)
  if (luminance === undefined) return '#ffffff'
  const whiteContrast = 1.05 / (luminance + 0.05)
  const darkContrast = (luminance + 0.05) / (0.0114 + 0.05)
  return whiteContrast >= darkContrast ? '#ffffff' : BRAND_DARK_FOREGROUND
}

/**
 * A brand color is usable when its own label clears AA and the fill stays
 * visible against both canvases. Contrast is measured against the derived
 * label rather than white, so a light brand color is judged on how it will
 * actually be rendered.
 */
export function isAccessibleBrandPrimary(color: string): boolean {
  const luminance = brandLuminance(color)
  if (luminance === undefined) return false

  const foregroundContrast =
    brandPrimaryForeground(color) === '#ffffff'
      ? 1.05 / (luminance + 0.05)
      : (luminance + 0.05) / (0.0114 + 0.05)
  const lightCanvasContrast = (0.947 + 0.05) / (luminance + 0.05)
  const darkCanvasContrast = (luminance + 0.05) / (0.006 + 0.05)
  return (
    foregroundContrast >= 4.5 &&
    lightCanvasContrast >= 3 &&
    darkCanvasContrast >= 3
  )
}

export const avatarColorMap: Record<SemanticColor, string> = {
  blue: 'bg-chart-1/10 text-chart-1',
  green: 'bg-success/10 text-success',
  cyan: 'bg-chart-2/10 text-chart-2',
  purple: 'bg-chart-4/10 text-chart-4',
  pink: 'bg-chart-5/10 text-chart-5',
  red: 'bg-destructive/10 text-destructive',
  orange: 'bg-warning/10 text-warning',
  amber: 'bg-warning/10 text-warning',
  yellow: 'bg-warning/10 text-warning',
  lime: 'bg-chart-3/10 text-chart-3',
  'light-green': 'bg-success/10 text-success',
  teal: 'bg-chart-2/10 text-chart-2',
  'light-blue': 'bg-info/10 text-info',
  indigo: 'bg-chart-1/10 text-chart-1',
  violet: 'bg-chart-4/10 text-chart-4',
  grey: 'bg-muted text-muted-foreground',
  slate: 'bg-muted text-muted-foreground',
}

export function getAvatarColorClass(name: string): string {
  return avatarColorMap[stringToColor(name)]
}

export function getBgColorClass(color?: string): string {
  if (!color) return colorToBgClass.blue
  return (
    (colorToBgClass as Record<string, string>)[color] || colorToBgClass.blue
  )
}

/**
 * Announcement status types
 */
export type AnnouncementType =
  | 'default'
  | 'ongoing'
  | 'success'
  | 'warning'
  | 'error'

/**
 * Announcement status color mapping
 */
export const ANNOUNCEMENT_TYPE_COLORS: Record<AnnouncementType, string> = {
  default: 'bg-neutral',
  ongoing: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-destructive',
}

/**
 * Get announcement status color class
 */
export function getAnnouncementColorClass(type?: string): string {
  const validType = (type || 'default') as AnnouncementType
  return ANNOUNCEMENT_TYPE_COLORS[validType] || ANNOUNCEMENT_TYPE_COLORS.default
}

/**
 * Semantic colors for tags and badges
 */
const TAG_COLORS = [
  'amber',
  'blue',
  'cyan',
  'green',
  'grey',
  'indigo',
  'light-blue',
  'lime',
  'orange',
  'pink',
  'purple',
  'red',
  'teal',
  'violet',
  'yellow',
] as const

/**
 * Convert string to a stable semantic color
 * Used for model tags, group badges, user avatars, etc.
 * Same string always returns the same color
 *
 * @param str - Input string (model name, group name, username, etc.)
 * @returns Semantic color name from TAG_COLORS
 *
 * @example
 * stringToColor('gpt-4') // 'blue'
 * stringToColor('claude-3') // 'purple'
 * stringToColor('default') // 'green'
 */
export function stringToColor(str: string): SemanticColor {
  let sum = 0
  for (let i = 0; i < str.length; i++) {
    sum += str.charCodeAt(i)
  }
  const index = sum % TAG_COLORS.length
  return TAG_COLORS[index]
}
