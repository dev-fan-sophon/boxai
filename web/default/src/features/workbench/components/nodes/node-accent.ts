import {
  Frame,
  Image as ImageIcon,
  Music,
  Settings2,
  StickyNote,
  Table,
  Video,
  type IconComponent,
} from '@/components/icons'

import { CanvasNodeType } from '../../types'

/**
 * Per-type identity for node cards. The tint is what lets a dense canvas read
 * as a composition instead of a wall of identical grey boxes.
 */
type NodeAccent = {
  icon: IconComponent
  /** Tailwind gradient (chart/semantic tokens) for the header icon chip. */
  chip: string
  /** Faint wash behind the card header. */
  wash: string
  /** Ring colour (CSS expression) used while the node is selected or hovered. */
  ring: string
}

const ring = (token: string) =>
  `color-mix(in oklab, var(${token}) 45%, transparent)`

// Hues come from the categorical `chart-*` series in theme.css, which is tuned
// per scheme, so the identity tints stay legible on both canvases.
const NODE_ACCENTS: Record<CanvasNodeType, NodeAccent> = {
  [CanvasNodeType.Image]: {
    icon: ImageIcon,
    chip: 'from-chart-2 to-chart-8',
    wash: 'from-chart-2/12',
    ring: ring('--chart-2'),
  },
  [CanvasNodeType.Video]: {
    icon: Video,
    chip: 'from-chart-10 to-chart-3',
    wash: 'from-chart-3/12',
    ring: ring('--chart-3'),
  },
  [CanvasNodeType.Audio]: {
    icon: Music,
    chip: 'from-chart-7 to-chart-4',
    wash: 'from-chart-4/12',
    ring: ring('--chart-4'),
  },
  [CanvasNodeType.Text]: {
    icon: StickyNote,
    chip: 'from-chart-5 to-chart-9',
    wash: 'from-chart-5/14',
    ring: ring('--chart-5'),
  },
  [CanvasNodeType.Script]: {
    icon: Table,
    chip: 'from-chart-6 to-chart-8',
    wash: 'from-chart-6/12',
    ring: ring('--chart-6'),
  },
  [CanvasNodeType.Config]: {
    icon: Settings2,
    chip: 'from-neutral to-chart-12',
    wash: 'from-neutral/12',
    ring: ring('--neutral'),
  },
  [CanvasNodeType.Frame]: {
    icon: Frame,
    chip: 'from-neutral/70 to-neutral',
    wash: 'from-neutral/10',
    ring: ring('--neutral'),
  },
}

export function nodeAccent(type: CanvasNodeType): NodeAccent {
  return NODE_ACCENTS[type]
}
