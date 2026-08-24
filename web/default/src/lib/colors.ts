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

/**
 * Fallback soft coral when dark-mode primary cannot be derived safely.
 * Must match common.DefaultBrandPrimaryDark / DeriveDarkBrandPrimary(#E05A3A).
 */
export const DEFAULT_BRAND_PRIMARY_DARK = '#FF9072'

/** Substitute for vendor accents that vanish into one of the two canvases. */
const NEUTRAL_BRAND_ACCENT = '#8a8f98'

const HEX_RGB = /^#[0-9A-Fa-f]{6}$/

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
  if (!HEX_RGB.test(color)) return undefined
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

function foregroundContrastRatio(color: string): number | undefined {
  const luminance = brandLuminance(color)
  if (luminance === undefined) return undefined
  return brandPrimaryForeground(color) === '#ffffff'
    ? 1.05 / (luminance + 0.05)
    : (luminance + 0.05) / (0.0114 + 0.05)
}

/**
 * Light-scheme brand seed: label AA + visible against the light canvas.
 * Mirrors common.IsAccessibleBrandPrimaryForLight.
 */
export function isAccessibleBrandPrimaryForLight(color: string): boolean {
  const luminance = brandLuminance(color)
  const fg = foregroundContrastRatio(color)
  if (luminance === undefined || fg === undefined) return false
  const lightCanvasContrast = (0.947 + 0.05) / (luminance + 0.05)
  return fg >= 4.5 && lightCanvasContrast >= 3
}

/**
 * Dark-scheme brand fill: label AA + visible against the dark canvas.
 * Mirrors common.IsAccessibleBrandPrimaryForDark.
 */
export function isAccessibleBrandPrimaryForDark(color: string): boolean {
  const luminance = brandLuminance(color)
  const fg = foregroundContrastRatio(color)
  if (luminance === undefined || fg === undefined) return false
  const darkCanvasContrast = (luminance + 0.05) / (0.006 + 0.05)
  return fg >= 4.5 && darkCanvasContrast >= 3
}

/**
 * Dual-scheme check (legacy / vendor accents). Admin brand options use the
 * scheme-specific helpers; light seed and dark override are validated apart.
 */
export function isAccessibleBrandPrimary(color: string): boolean {
  return (
    isAccessibleBrandPrimaryForLight(color) &&
    isAccessibleBrandPrimaryForDark(color)
  )
}

type Oklab = { L: number; a: number; b: number }

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
}

function hexToOklab(color: string): Oklab | undefined {
  if (!HEX_RGB.test(color)) return undefined
  const r = srgbToLinear(Number.parseInt(color.slice(1, 3), 16) / 255)
  const g = srgbToLinear(Number.parseInt(color.slice(3, 5), 16) / 255)
  const b = srgbToLinear(Number.parseInt(color.slice(5, 7), 16) / 255)
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
  const l_ = Math.cbrt(l)
  const m_ = Math.cbrt(m)
  const s_ = Math.cbrt(s)
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  }
}

function oklabToHex(lab: Oklab): string {
  const l_ = lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b
  const m_ = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b
  const s_ = lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b
  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_
  const r = linearToSrgb(
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  )
  const g = linearToSrgb(
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  )
  const b = linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  const channel = (c: number) => {
    const v = Math.round(Math.min(1, Math.max(0, c)) * 255)
    return v.toString(16).padStart(2, '0').toUpperCase()
  }
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

/**
 * Lift + slight desaturate for dark-scheme solid fills (industry pattern:
 * same hue family, softer on navy canvases). Must match common.DeriveDarkBrandPrimary.
 */
export function deriveDarkBrandPrimary(color: string): string {
  const lab = hexToOklab(color)
  if (!lab) return DEFAULT_BRAND_PRIMARY_DARK

  let targetL = lab.L * 1.12 + 0.14
  if (targetL < 0.64) targetL = 0.64
  if (targetL > 0.78) targetL = 0.78
  lab.L = targetL
  lab.a *= 0.88
  lab.b *= 0.88

  let hex = oklabToHex(lab)
  for (let i = 0; i < 10 && !isAccessibleBrandPrimaryForDark(hex); i++) {
    lab.L = Math.min(0.86, lab.L + 0.025)
    hex = oklabToHex(lab)
  }
  return isAccessibleBrandPrimaryForDark(hex) ? hex : DEFAULT_BRAND_PRIMARY_DARK
}

/**
 * Configured dark override when valid; otherwise derived from the light seed.
 * Mirrors common.EffectiveDarkBrandPrimary.
 */
export function effectiveDarkBrandPrimary(
  light: string,
  darkOverride = ''
): string {
  if (isAccessibleBrandPrimaryForDark(darkOverride)) return darkOverride
  if (HEX_RGB.test(light)) return deriveDarkBrandPrimary(light)
  return DEFAULT_BRAND_PRIMARY_DARK
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
