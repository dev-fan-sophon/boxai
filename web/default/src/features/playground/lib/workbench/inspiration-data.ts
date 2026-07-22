/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import type { StudioModality } from '../../types'

export type InspirationCategory =
  | 'all'
  | 'product'
  | 'portrait'
  | 'landscape'
  | 'design'
  | 'anime'
  | 'video'
  | 'marketing'
  | 'ui'
  | 'architecture'

export type InspirationTemplate = {
  id: string
  titleKey: string
  modality: Exclude<StudioModality, 'audio'> | 'chat'
  category: InspirationCategory
  prompt: string
  tagKeys: string[]
  coverUrl?: string
}

export const INSPIRATION_CATEGORIES: Array<{
  id: InspirationCategory
  labelKey: string
}> = [
  { id: 'all', labelKey: 'All' },
  { id: 'product', labelKey: 'Product' },
  { id: 'portrait', labelKey: 'Portrait' },
  { id: 'landscape', labelKey: 'Landscape' },
  { id: 'design', labelKey: 'Design' },
  { id: 'anime', labelKey: 'Anime' },
  { id: 'video', labelKey: 'Video' },
  { id: 'marketing', labelKey: 'Marketing' },
  { id: 'ui', labelKey: 'UI' },
  { id: 'architecture', labelKey: 'Architecture' },
]

export const INSPIRATION_TEMPLATES: InspirationTemplate[] = [
  {
    id: 'tpl-product-1',
    titleKey: 'Minimal product hero',
    modality: 'image',
    category: 'product',
    prompt:
      'Minimalist product hero shot on matte black acrylic, soft rim light, subtle reflection, commercial photography',
    tagKeys: ['Product', 'Studio'],
  },
  {
    id: 'tpl-product-2',
    titleKey: 'Ecommerce lifestyle',
    modality: 'image',
    category: 'product',
    prompt:
      'Lifestyle ecommerce photo of the product in a bright modern kitchen, natural window light, shallow depth of field',
    tagKeys: ['Product', 'Lifestyle'],
  },
  {
    id: 'tpl-portrait-1',
    titleKey: 'Cinematic portrait',
    modality: 'image',
    category: 'portrait',
    prompt:
      'Cinematic portrait, golden hour backlight, film grain, 85mm lens look, emotional expression',
    tagKeys: ['Portrait'],
  },
  {
    id: 'tpl-landscape-1',
    titleKey: 'Misty mountain dawn',
    modality: 'image',
    category: 'landscape',
    prompt:
      'Misty mountain landscape at dawn, layered ridges, soft volumetric light, ultra wide composition',
    tagKeys: ['Landscape'],
  },
  {
    id: 'tpl-design-1',
    titleKey: 'Poster layout',
    modality: 'image',
    category: 'design',
    prompt:
      'Bold typographic event poster, high contrast neon accents on dark background, generous margins, modern layout',
    tagKeys: ['Design', 'Poster'],
  },
  {
    id: 'tpl-anime-1',
    titleKey: 'Anime key visual',
    modality: 'image',
    category: 'anime',
    prompt:
      'Anime key visual, dynamic pose, vibrant cel shading, detailed background cityscape at night',
    tagKeys: ['Anime'],
  },
  {
    id: 'tpl-video-1',
    titleKey: 'Product orbit clip',
    modality: 'video',
    category: 'video',
    prompt:
      '5 second product orbit shot, seamless loop, premium lighting, clean studio backdrop',
    tagKeys: ['Video', 'Product'],
  },
  {
    id: 'tpl-video-2',
    titleKey: 'Travel teaser',
    modality: 'video',
    category: 'video',
    prompt:
      'Cinematic travel teaser, drone flyover coastline at sunset, gentle camera push, 16:9',
    tagKeys: ['Video', 'Travel'],
  },
  {
    id: 'tpl-marketing-1',
    titleKey: 'Ad campaign line',
    modality: 'chat',
    category: 'marketing',
    prompt:
      'Write 8 short ad headlines and 3 primary CTAs for a premium wireless earbud launch targeting young professionals.',
    tagKeys: ['Marketing', 'Copy'],
  },
  {
    id: 'tpl-ui-1',
    titleKey: 'Dashboard mock concept',
    modality: 'image',
    category: 'ui',
    prompt:
      'Dark mode SaaS analytics dashboard UI mock, glass cards, cyan accents, clean spacing, high fidelity',
    tagKeys: ['UI'],
  },
  {
    id: 'tpl-arch-1',
    titleKey: 'Modern villa exterior',
    modality: 'image',
    category: 'architecture',
    prompt:
      'Modern villa exterior at dusk, warm interior lights, reflective pool, architectural photography',
    tagKeys: ['Architecture'],
  },
  {
    id: 'tpl-chat-story',
    titleKey: 'Brand story outline',
    modality: 'chat',
    category: 'marketing',
    prompt:
      'Outline a brand story for a sustainable outdoor apparel startup: origin, mission, three customer personas, and a 30-day content plan.',
    tagKeys: ['Marketing', 'Story'],
  },
]
