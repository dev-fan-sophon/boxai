import type { ClientAppId } from '@/features/downloads/use-app-release'
import { cn } from '@/lib/utils'

import { CLIENT_APP_LOGO } from './logos'

type ClientAppLogoProps = {
  app: ClientAppId
  className?: string
  /** Decorative when used next to a visible product name. */
  decorative?: boolean
}

/**
 * Raster product mark. Accepts the same `className` size utilities as Lucide
 * icons so it can drop into sidebar / IconBadge slots.
 */
export function ClientAppLogo(props: ClientAppLogoProps) {
  const logo = CLIENT_APP_LOGO[props.app]
  return (
    <img
      src={logo.src}
      srcSet={`${logo.src} 1x, ${logo.src2x} 2x`}
      alt={props.decorative ? '' : logo.alt}
      aria-hidden={props.decorative ? true : undefined}
      draggable={false}
      className={cn(
        'size-[1.1em] shrink-0 rounded-[22%] object-contain',
        props.className
      )}
    />
  )
}

/** Lucide-compatible component slots for nav / IconBadge. */
export function BoxAIDesktopIcon({
  className,
}: {
  className?: string
  'aria-hidden'?: boolean | 'true'
  strokeWidth?: number
}) {
  return <ClientAppLogo app='desktop' decorative className={className} />
}

export function BoxAIConnectIcon({
  className,
}: {
  className?: string
  'aria-hidden'?: boolean | 'true'
  strokeWidth?: number
}) {
  return <ClientAppLogo app='connect' decorative className={className} />
}
