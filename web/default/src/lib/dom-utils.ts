import {
  brandPrimaryForeground,
  effectiveDarkBrandPrimary,
  isAccessibleBrandPrimaryForDark,
  isAccessibleBrandPrimaryForLight,
} from '@/lib/colors'

export function applyDocumentTitleToDom(title: string) {
  if (typeof document === 'undefined' || !title) return
  document.title = title
  const metaTitle =
    document.querySelector<HTMLMetaElement>('meta[name="title"]')
  metaTitle?.setAttribute('content', title)
}

export function applyFaviconToDom(url: string) {
  if (typeof document === 'undefined' || !url) return
  try {
    const next = new URL(url, window.location.href).href
    const existing =
      document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')
    if (existing.length === 1 && existing[0].href === next) return
    const link = document.createElement('link')
    link.rel = 'icon'
    link.href = url
    existing.forEach((l) => l.remove())
    document.head.appendChild(link)
  } catch {
    // Ignore malformed URLs
  }
}

/**
 * Only brand tokens — never set --primary/--sidebar-primary here.
 * theme.css binds those per scheme so .dark can switch to the soft fill.
 * Setting --primary inline would override .dark and pin the light seed forever.
 */
const BRAND_CSS_VARS = [
  '--brand-primary',
  '--brand-primary-foreground',
  '--brand-primary-dark',
  '--brand-primary-dark-foreground',
] as const

/**
 * Apply admin brand colors to the document root.
 *
 * - Light scheme: `--brand-primary` → `--primary` (via theme.css)
 * - Dark scheme: `--brand-primary-dark` (override or auto-derived soft fill)
 * - Invalid / empty light color clears overrides so CSS defaults apply
 */
export function applyPrimaryColorToDom(color: string, darkColor = '') {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const light = color.trim()
  const darkOverride = darkColor.trim()

  // Drop any legacy inline --primary from older clients so theme.css wins.
  root.style.removeProperty('--primary')
  root.style.removeProperty('--primary-foreground')
  root.style.removeProperty('--sidebar-primary')
  root.style.removeProperty('--sidebar-primary-foreground')

  if (!isAccessibleBrandPrimaryForLight(light)) {
    for (const property of BRAND_CSS_VARS) {
      root.style.removeProperty(property)
    }
    if (isAccessibleBrandPrimaryForDark(darkOverride)) {
      root.style.setProperty('--brand-primary-dark', darkOverride)
      root.style.setProperty(
        '--brand-primary-dark-foreground',
        brandPrimaryForeground(darkOverride)
      )
    }
    return
  }

  const dark = effectiveDarkBrandPrimary(light, darkOverride)
  root.style.setProperty('--brand-primary', light)
  root.style.setProperty(
    '--brand-primary-foreground',
    brandPrimaryForeground(light)
  )
  root.style.setProperty('--brand-primary-dark', dark)
  root.style.setProperty(
    '--brand-primary-dark-foreground',
    brandPrimaryForeground(dark)
  )
}
