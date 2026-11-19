import { api } from './api'
import {
  getOAuthSessionStorage,
  markOAuthBindPopup,
} from './oauth-callback-mode'

// ============================================================================
// OAuth URL Builders
// ============================================================================

/**
 * Build GitHub OAuth URL
 */
export function buildGitHubOAuthUrl(clientId: string, state: string): string {
  return `https://github.com/login/oauth/authorize?client_id=${clientId}&state=${state}&scope=user:email`
}

/**
 * Build Discord OAuth URL
 */
export function buildDiscordOAuthUrl(clientId: string, state: string): string {
  const url = new URL('https://discord.com/oauth2/authorize')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set(
    'redirect_uri',
    `${window.location.origin}/oauth/discord`
  )
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'identify+openid')
  url.searchParams.set('state', state)
  return url.toString()
}

/**
 * Build Google OAuth URL
 */
export function buildGoogleOAuthUrl(clientId: string, state: string): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', `${window.location.origin}/oauth/google`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid profile email')
  url.searchParams.set('state', state)
  return url.toString()
}

/**
 * Build Facebook OAuth URL
 */
export function buildFacebookOAuthUrl(clientId: string, state: string): string {
  const url = new URL('https://www.facebook.com/v21.0/dialog/oauth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set(
    'redirect_uri',
    `${window.location.origin}/oauth/facebook`
  )
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'public_profile,email')
  url.searchParams.set('state', state)
  return url.toString()
}

/**
 * Build Zalo OAuth URL
 *
 * Zalo OAuth v4 names the client credential `app_id` and does not accept
 * `response_type`, so it cannot reuse the standard builder shape.
 */
export function buildZaloOAuthUrl(appId: string, state: string): string {
  const url = new URL('https://oauth.zaloapp.com/v4/permission')
  url.searchParams.set('app_id', appId)
  url.searchParams.set('redirect_uri', `${window.location.origin}/oauth/zalo`)
  url.searchParams.set('state', state)
  return url.toString()
}

/**
 * Build OIDC OAuth URL
 */
export function buildOIDCOAuthUrl(
  authUrl: string,
  clientId: string,
  state: string
): string {
  const url = new URL(authUrl)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', `${window.location.origin}/oauth/oidc`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid profile email')
  url.searchParams.set('state', state)
  return url.toString()
}

/**
 * Build LinuxDO OAuth URL
 */
export function buildLinuxDOOAuthUrl(clientId: string, state: string): string {
  return `https://connect.linux.do/oauth2/authorize?response_type=code&client_id=${clientId}&state=${state}`
}

// ============================================================================
// OAuth Helper Functions
// ============================================================================

/**
 * Get OAuth state token
 * Includes affiliate code from localStorage if available
 */
export async function getOAuthState(): Promise<string | null> {
  try {
    let path = '/api/oauth/state'
    const affCode = localStorage.getItem('aff')
    if (affCode && affCode.length > 0) {
      path += `?aff=${affCode}`
    }
    const res = await api.get(path)
    if (res.data.success) {
      return res.data.data
    }
    return null
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to get OAuth state:', error)
    return null
  }
}

/**
 * Open the provider in a popup marked as an account bind flow. The popup is
 * stamped while it is still same-origin (about:blank) so the /oauth/:provider
 * callback can tell it apart from a login tab that merely has a foreign
 * window.opener (for example one opened from a Zalo or mail link).
 */
function openOAuthBindPopup(provider: string, state: string, url: string) {
  const popup = window.open('', '_blank')
  if (!popup) return
  markOAuthBindPopup(getOAuthSessionStorage(popup), provider, state)
  popup.location.replace(url)
}

/**
 * Handle GitHub OAuth binding/login
 */
export async function handleGitHubOAuth(clientId: string): Promise<void> {
  const state = await getOAuthState()
  if (!state) return

  openOAuthBindPopup('github', state, buildGitHubOAuthUrl(clientId, state))
}

/**
 * Handle Discord OAuth binding/login
 */
export async function handleDiscordOAuth(clientId: string): Promise<void> {
  const state = await getOAuthState()
  if (!state) return

  openOAuthBindPopup('discord', state, buildDiscordOAuthUrl(clientId, state))
}

/**
 * Handle Google OAuth binding/login
 */
export async function handleGoogleOAuth(clientId: string): Promise<void> {
  const state = await getOAuthState()
  if (!state) return

  openOAuthBindPopup('google', state, buildGoogleOAuthUrl(clientId, state))
}

/**
 * Handle Facebook OAuth binding/login
 */
export async function handleFacebookOAuth(clientId: string): Promise<void> {
  const state = await getOAuthState()
  if (!state) return

  openOAuthBindPopup('facebook', state, buildFacebookOAuthUrl(clientId, state))
}

/**
 * Handle Zalo OAuth binding/login
 */
export async function handleZaloOAuth(appId: string): Promise<void> {
  const state = await getOAuthState()
  if (!state) return

  openOAuthBindPopup('zalo', state, buildZaloOAuthUrl(appId, state))
}

/**
 * Handle OIDC OAuth binding/login
 */
export async function handleOIDCOAuth(
  authUrl: string,
  clientId: string
): Promise<void> {
  const state = await getOAuthState()
  if (!state) return

  openOAuthBindPopup('oidc', state, buildOIDCOAuthUrl(authUrl, clientId, state))
}

/**
 * Handle LinuxDO OAuth binding/login
 */
export async function handleLinuxDOOAuth(clientId: string): Promise<void> {
  const state = await getOAuthState()
  if (!state) return

  openOAuthBindPopup('linuxdo', state, buildLinuxDOOAuthUrl(clientId, state))
}
