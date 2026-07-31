import { visibleBrandAccent } from '@/lib/colors'
import { LOBE_BRAND_COLORS } from '@/lib/lobe-brand-colors.generated'

/**
 * Brand color for a model/vendor icon key from @lobehub/icons
 * (`Icon.colorPrimary`), normalized so near-black and near-white marks stay
 * visible in both themes.
 */
export function getBrandColor(
  icon?: string,
  vendorIcon?: string
): string | undefined {
  const key = (icon?.trim() || vendorIcon?.trim() || '').split('.')[0]
  if (!key) return undefined
  const color = LOBE_BRAND_COLORS[key]
  return color ? visibleBrandAccent(color) : undefined
}
