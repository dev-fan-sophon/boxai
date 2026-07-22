/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import {
  BookOpen,
  Clapperboard,
  FileDown,
  Image as ImageIcon,
  LayoutTemplate,
  Presentation,
  Sparkles,
  Wand2,
  type LucideIcon,
} from 'lucide-react'

export type AgentAction =
  | { type: 'route'; to: string }
  | { type: 'external'; href: string }
  | { type: 'modality'; modality: 'image' | 'video' | 'chat'; prompt?: string }
  | { type: 'dialog'; dialog: 'skill' | 'canvas' | 'coming-soon' }

export type AgentCard = {
  id: string
  titleKey: string
  descriptionKey: string
  categoryKey: string
  icon: LucideIcon
  action: AgentAction
  accentClass: string
}

// AGENT_ICONS maps backend icon keys to Lucide components.
export const AGENT_ICONS: Record<string, LucideIcon> = {
  'book-open': BookOpen,
  'file-down': FileDown,
  sparkles: Sparkles,
  image: ImageIcon,
  clapperboard: Clapperboard,
  presentation: Presentation,
  wand: Wand2,
  'layout-template': LayoutTemplate,
}

export type ApiAgent = {
  id: number
  slug: string
  title: string
  description: string
  category: string
  icon: string
  action_type: string
  action_value: string
  action_prompt?: string
  accent?: string
}

function mapApiAgentAction(agent: ApiAgent): AgentAction {
  if (agent.action_type === 'route') {
    return { type: 'route', to: agent.action_value }
  }
  if (agent.action_type === 'external') {
    return { type: 'external', href: agent.action_value }
  }
  if (agent.action_type === 'dialog') {
    const dialog =
      agent.action_value === 'skill' || agent.action_value === 'canvas'
        ? agent.action_value
        : 'coming-soon'
    return { type: 'dialog', dialog }
  }
  const modality =
    agent.action_value === 'image' ||
    agent.action_value === 'video' ||
    agent.action_value === 'chat'
      ? agent.action_value
      : 'chat'
  return { type: 'modality', modality, prompt: agent.action_prompt }
}

export function mapApiAgentToCard(agent: ApiAgent): AgentCard {
  return {
    id: agent.slug,
    titleKey: agent.title,
    descriptionKey: agent.description,
    categoryKey: agent.category,
    icon: AGENT_ICONS[agent.icon] ?? Sparkles,
    action: mapApiAgentAction(agent),
    accentClass: agent.accent || 'bg-primary/15 text-primary',
  }
}

export const AGENT_CARDS: AgentCard[] = [
  {
    id: 'api-docs',
    titleKey: 'Open API docs',
    descriptionKey:
      'Browse integration guides and endpoint references for Box AI.',
    categoryKey: 'API',
    icon: BookOpen,
    action: { type: 'route', to: '/docs' },
    accentClass: 'bg-primary/15 text-primary',
  },
  {
    id: 'skill-download',
    titleKey: 'Skill kit',
    descriptionKey:
      'Download starter skills and client snippets for quick integration.',
    categoryKey: 'API',
    icon: FileDown,
    action: { type: 'dialog', dialog: 'skill' },
    accentClass: 'bg-info/15 text-info',
  },
  {
    id: 'pricing',
    titleKey: 'Model pricing',
    descriptionKey: 'Compare model rates and groups before you run a workload.',
    categoryKey: 'API',
    icon: Sparkles,
    action: { type: 'route', to: '/pricing' },
    accentClass: 'bg-accent text-accent-foreground',
  },
  {
    id: 'image-batch',
    titleKey: 'Product image batch',
    descriptionKey:
      'Generate product shots with a shared prompt and count settings.',
    categoryKey: 'Create',
    icon: ImageIcon,
    action: {
      type: 'modality',
      modality: 'image',
      prompt:
        'Studio product photo on a clean background, soft lighting, high detail',
    },
    accentClass: 'bg-accent text-accent-foreground',
  },
  {
    id: 'video-product',
    titleKey: 'Product video',
    descriptionKey: 'Turn a product description into a short promotional clip.',
    categoryKey: 'Create',
    icon: Clapperboard,
    action: {
      type: 'modality',
      modality: 'video',
      prompt:
        'Cinematic 5s product showcase, slow orbit camera, premium lighting',
    },
    accentClass: 'bg-warning/15 text-warning',
  },
  {
    id: 'ppt-outline',
    titleKey: 'PPT outline',
    descriptionKey:
      'Draft a presentation structure with titles and talking points.',
    categoryKey: 'Create',
    icon: Presentation,
    action: {
      type: 'modality',
      modality: 'chat',
      prompt:
        'Create a 10-slide presentation outline with titles, bullet points, and speaker notes for: ',
    },
    accentClass: 'bg-success/15 text-success',
  },
  {
    id: 'generic-image',
    titleKey: 'One-click image',
    descriptionKey: 'Jump into image generation with a ready creative brief.',
    categoryKey: 'Create',
    icon: Wand2,
    action: {
      type: 'modality',
      modality: 'image',
      prompt: 'Ultra detailed concept art, dramatic lighting, 4k',
    },
    accentClass: 'bg-primary/10 text-primary',
  },
  {
    id: 'infinite-canvas',
    titleKey: 'Infinite canvas',
    descriptionKey: 'Open a freeform board for multi-step visual workflows.',
    categoryKey: 'Tools',
    icon: LayoutTemplate,
    action: { type: 'dialog', dialog: 'canvas' },
    accentClass: 'bg-warning/15 text-warning',
  },
]
