/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import type { StudioModality } from '../../types'

export const MODALITY_COLORS: Record<
  StudioModality | 'tool',
  { tag: string; bg: string; text: string }
> = {
  chat: {
    tag: 'bg-primary/15 text-primary border-primary/30',
    bg: 'bg-primary/10',
    text: 'text-primary',
  },
  image: {
    tag: 'bg-accent text-accent-foreground border-border',
    bg: 'bg-accent',
    text: 'text-accent-foreground',
  },
  video: {
    tag: 'bg-warning/15 text-warning border-warning/30',
    bg: 'bg-warning/10',
    text: 'text-warning',
  },
  audio: {
    tag: 'bg-success/15 text-success border-success/30',
    bg: 'bg-success/10',
    text: 'text-success',
  },
  tool: {
    tag: 'bg-info/15 text-info border-info/30',
    bg: 'bg-info/10',
    text: 'text-info',
  },
}

export function modalityLabelKey(modality: StudioModality): string {
  return modality[0].toUpperCase() + modality.slice(1)
}

/** Heuristic NEW badge when release_date is within ~60 days or name suggests a new flagship. */
export function isLikelyNewModel(model: {
  model_name: string
  release_date?: string
  tags?: string
}): boolean {
  const tags = (model.tags ?? '').toLowerCase()
  if (/\bnew\b|新品|最新/.test(tags)) return true
  if (model.release_date) {
    const ts = Date.parse(model.release_date)
    if (Number.isFinite(ts) && Date.now() - ts < 60 * 24 * 60 * 60 * 1000) {
      return true
    }
  }
  return /-(latest|preview|exp)\b/i.test(model.model_name)
}
