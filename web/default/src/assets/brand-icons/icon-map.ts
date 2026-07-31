import type { ComponentType, SVGProps } from 'react'

import { IconDiscord } from './icon-discord'
import { IconFacebook } from './icon-facebook'
import { IconGithub } from './icon-github'
import { IconGitlab } from './icon-gitlab'
import { IconGmail } from './icon-gmail'
import { IconGoogle } from './icon-google'
import { IconLinuxDo } from './icon-linuxdo'
import { IconTelegram } from './icon-telegram'
import { IconWeChat } from './icon-wechat'
import { IconZalo } from './icon-zalo'

/**
 * Maps the free-form `icon` string stored on a custom OAuth provider to a brand
 * logo. Values match the keys used by the OAuth preset templates.
 */
const BRAND_ICONS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  discord: IconDiscord,
  facebook: IconFacebook,
  github: IconGithub,
  'github-enterprise': IconGithub,
  gitea: IconGithub,
  gitlab: IconGitlab,
  gmail: IconGmail,
  google: IconGoogle,
  linuxdo: IconLinuxDo,
  telegram: IconTelegram,
  wechat: IconWeChat,
  zalo: IconZalo,
}

export function getBrandIcon(
  icon: string | undefined
): ComponentType<SVGProps<SVGSVGElement>> | null {
  if (!icon) return null
  return BRAND_ICONS[icon.trim().toLowerCase()] ?? null
}
