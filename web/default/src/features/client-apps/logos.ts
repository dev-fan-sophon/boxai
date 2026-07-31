import type { ClientAppId } from '@/features/downloads/use-app-release'

/**
 * Product app marks for BoxAI Desktop / Connect.
 * Served from `public/brand/` (same family as the spiral mark, product hues).
 */
export const CLIENT_APP_LOGO: Record<
  ClientAppId,
  { src: string; src2x: string; alt: string }
> = {
  desktop: {
    src: '/brand/desktop-icon.png',
    src2x: '/brand/desktop-icon-256.png',
    alt: 'BoxAI Desktop',
  },
  connect: {
    src: '/brand/connect-icon.png',
    src2x: '/brand/connect-icon-256.png',
    alt: 'BoxAI Connect',
  },
}
