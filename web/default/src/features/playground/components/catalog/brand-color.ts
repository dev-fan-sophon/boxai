/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { LOBE_BRAND_COLORS } from '@/lib/lobe-brand-colors.generated'

function luminance(hex: string): number | null {
  const trimmed = hex.trim()
  const shorthand = /^#?([\da-f])([\da-f])([\da-f])$/i.exec(trimmed)
  const normalized = shorthand
    ? `${shorthand[1]}${shorthand[1]}${shorthand[2]}${shorthand[2]}${shorthand[3]}${shorthand[3]}`
    : trimmed
  const match = /^#?([\da-f]{6})$/i.exec(normalized)
  if (!match) return null
  const value = Number.parseInt(match[1], 16)
  const r = (value >> 16) & 0xff
  const g = (value >> 8) & 0xff
  const b = value & 0xff
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/**
 * Brand color for a model/vendor icon key from @lobehub/icons
 * (`Icon.colorPrimary`). Near-black and near-white brands (OpenAI, Grok, …)
 * are normalized to a neutral gray so accents stay visible in both themes.
 */
export function getBrandColor(
  icon?: string,
  vendorIcon?: string
): string | undefined {
  const key = (icon?.trim() || vendorIcon?.trim() || '').split('.')[0]
  if (!key) return undefined
  const color = LOBE_BRAND_COLORS[key]
  if (!color) return undefined
  const lum = luminance(color)
  if (lum != null && (lum < 0.12 || lum > 0.92)) {
    return '#8a8f98'
  }
  return color
}
