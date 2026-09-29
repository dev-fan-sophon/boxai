import { useTheme } from '@/context/theme-provider'

/**
 * Canvas palette expressed as CSS token expressions from `src/styles/theme.css`.
 * Every value is consumed as a CSS color (inline style, SVG paint, gradient
 * stop), so it follows the light/dark scheme and the runtime brand color
 * (`--primary`) without re-rendering. Consumers that cannot evaluate CSS, such
 * as the 2D canvas export, go through `resolveCanvasColor`.
 */
const tint = (token: string, percent: number) =>
  `color-mix(in oklab, var(${token}) ${percent}%, transparent)`

const canvasTokens = {
  canvas: {
    background: 'var(--background)',
    dot: tint('--foreground', 15),
    line: tint('--foreground', 6),
    selectionFill: tint('--primary', 12),
  },
  node: {
    label: 'var(--muted-foreground)',
    fill: 'var(--card)',
    panel: 'var(--card)',
    stroke: tint('--foreground', 12),
    activeStroke: 'var(--card-foreground)',
    placeholder: tint('--muted-foreground', 70),
    text: 'var(--card-foreground)',
    muted: 'var(--muted-foreground)',
    faint: tint('--muted-foreground', 55),
  },
  frame: {
    fill: tint('--foreground', 3),
    stroke: tint('--foreground', 18),
    activeFill: tint('--primary', 6),
    activeStroke: 'var(--primary)',
    preview: tint('--card', 84),
  },
  toolbar: {
    panel: tint('--popover', 94),
    border: tint('--foreground', 10),
    item: tint('--popover-foreground', 78),
    itemHover: tint('--foreground', 6),
    activeBg: tint('--foreground', 10),
    activeText: 'var(--popover-foreground)',
  },
  spatial: {
    surface: tint('--card', 72),
    elevated: tint('--popover', 94),
    // The page ground sits below the card surface in both schemes, so a
    // translucent wash of it reads as a recessed well inside a node.
    dropzone: tint('--background', 78),
    glow: tint('--primary', 18),
    glowStrong: tint('--primary', 52),
    // Light shadows tint toward the navy foreground; dark ones need a deeper
    // neutral falloff (mirrors `--elevation-*` in theme.css).
    shadow: tint('--foreground', 18),
  },
  accent: {
    primary: 'var(--primary)',
    primarySoft: tint('--primary', 16),
    danger: 'var(--destructive)',
  },
}

export type CanvasTheme = typeof canvasTokens

const darkCanvasTokens: CanvasTheme = {
  ...canvasTokens,
  spatial: { ...canvasTokens.spatial, shadow: 'rgb(0 0 0 / 0.46)' },
}

export function useCanvasTheme(): CanvasTheme {
  const { resolvedTheme } = useTheme()
  return resolvedTheme === 'dark' ? darkCanvasTokens : canvasTokens
}

/**
 * Resolves a canvas token expression to a concrete color under the active
 * scheme. Only for consumers that paint outside CSS (canvas 2D export).
 */
export function resolveCanvasColor(value: string): string {
  const probe = document.createElement('span')
  probe.style.display = 'none'
  probe.style.color = value
  document.body.appendChild(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  return resolved
}
