import { brandPrimaryForeground, isAccessibleBrandPrimary } from '@/lib/colors'

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

export function applyPrimaryColorToDom(color: string) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  // The label is derived from the same color so a light brand primary keeps a
  // readable button/sidebar label instead of white-on-light.
  const values: Record<string, string> = {
    '--brand-primary': color,
    '--primary': color,
    '--sidebar-primary': color,
    '--brand-primary-foreground': brandPrimaryForeground(color),
  }
  const validColor = isAccessibleBrandPrimary(color)
  for (const [property, value] of Object.entries(values)) {
    if (validColor) {
      root.style.setProperty(property, value)
    } else {
      root.style.removeProperty(property)
    }
  }
}
