import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  XCircle,
} from '@/components/icons'
;('use client')

import { Toaster as Sonner, type ToasterProps } from 'sonner'

import { useTheme } from '@/context/theme-provider'

/*
 * App-wide toast defaults. Everything here can still be overridden per mount.
 *
 * - offset: 16px from the edge on desktop, 12px on phones, plus the safe-area
 *   inset so a toast never sits under the notch or the home indicator.
 * - visibleToasts: four stacked at most; older ones collapse behind them
 *   rather than marching down the page during a burst of failures.
 * - swipe: dismiss toward the edge the stack is anchored to, or sideways —
 *   the natural flick on a phone whichever way it is held.
 */
const EDGE_OFFSET = {
  top: 'calc(env(safe-area-inset-top, 0px) + 16px)',
  bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
  left: 16,
  right: 16,
}
const MOBILE_EDGE_OFFSET = {
  top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
  bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
  left: 12,
  right: 12,
}

const Toaster = (props: ToasterProps) => {
  const { resolvedTheme } = useTheme()
  const anchoredEdge = props.position?.startsWith('bottom') ? 'bottom' : 'top'

  return (
    <Sonner
      theme={resolvedTheme}
      className='toaster group'
      offset={EDGE_OFFSET}
      mobileOffset={MOBILE_EDGE_OFFSET}
      visibleToasts={4}
      gap={8}
      swipeDirections={[anchoredEdge, 'left', 'right']}
      icons={{
        success: <CheckCircle2 className='size-4' />,
        info: <Info className='size-4' />,
        warning: <AlertTriangle className='size-4' />,
        error: <XCircle className='size-4' />,
        loading: <Loader2 className='size-4 animate-spin' />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          // 状态色文字一律走 *-subtle / *-subtle-foreground 这对已校准的组合：
          // 基础 token（--success 等）是给实心填充用的，直接当提示正文会低于 4.5:1
          '--success-bg': 'var(--success-subtle)',
          '--success-border':
            'color-mix(in oklch, var(--success) 35%, var(--border))',
          '--success-text': 'var(--success-subtle-foreground)',
          '--info-bg': 'var(--info-subtle)',
          '--info-border':
            'color-mix(in oklch, var(--info) 35%, var(--border))',
          '--info-text': 'var(--info-subtle-foreground)',
          '--warning-bg': 'var(--warning-subtle)',
          '--warning-border':
            'color-mix(in oklch, var(--warning) 38%, var(--border))',
          '--warning-text': 'var(--warning-subtle-foreground)',
          '--error-bg': 'var(--destructive-subtle)',
          '--error-border':
            'color-mix(in oklch, var(--destructive) 35%, var(--border))',
          '--error-text': 'var(--destructive-subtle-foreground)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
