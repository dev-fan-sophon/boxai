import type { ElementType } from 'react'

import type { ClientAppId } from '@/features/downloads/use-app-release'

import { BoxAIConnectIcon, BoxAIDesktopIcon } from './icons'
import { CLIENT_APP_LOGO } from './logos'

export type ClientAppMeta = {
  id: ClientAppId
  /** i18n source keys; render with `t()` at the call site. */
  nameKey: string
  taglineKey: string
  descriptionKey: string
  /** Product mark (img-based); drop-in for Lucide-style `className` slots. */
  icon: ElementType
  /** Public path to the product icon (for <img> / open graph). */
  logoSrc: string
  /** Console section under /dashboard. */
  section: 'connect' | 'desktop'
  /** Setup steps shown on the console page and in the marketing section. */
  stepKeys: readonly string[]
  /** What the app does, for the marketing card. */
  highlightKeys: readonly string[]
}

/**
 * Both apps sign in through the desktop authorization flow, so a session's
 * `client_name` is what tells them apart. BoxAI Connect names its sessions
 * `BoxAI Connect · <device>`; everything else is Desktop.
 */
export const CONNECT_SESSION_PREFIX = 'BoxAI Connect'

export const CLIENT_APPS: Record<ClientAppId, ClientAppMeta> = {
  connect: {
    id: 'connect',
    nameKey: 'BoxAI Connect',
    taglineKey: 'A native app for connecting your AI coding agents to BoxAI',
    descriptionKey:
      'Built in Rust with GPUI, BoxAI Connect brings browser sign-in, model discovery, MCP, official Skills, and account usage into one Vietnamese-first native app.',
    icon: BoxAIConnectIcon,
    logoSrc: CLIENT_APP_LOGO.connect.src,
    section: 'connect',
    stepKeys: [
      'Download and install the app for your platform.',
      'Sign in from the app; approve the request in this browser session.',
      'Choose an agent and model, then apply the configuration in one click.',
    ],
    highlightKeys: [
      'Discover compatible models in Model Plaza',
      'Add MCP servers and official Skills from one place',
      'Apply or disconnect with a reversible one-click change',
    ],
  },
  desktop: {
    id: 'desktop',
    nameKey: 'BoxAI Desktop',
    taglineKey: 'An AI coworker for the office work you do every day',
    descriptionKey:
      'BoxAI Desktop turns everyday office work into finished files. It reads the folders and documents already on your machine, drafts the report, spreadsheet, or deck, and hands back something you can send.',
    icon: BoxAIDesktopIcon,
    logoSrc: CLIENT_APP_LOGO.desktop.src,
    section: 'desktop',
    stepKeys: [
      'Download and install the app for your platform.',
      'Sign in from the app; approve the request in this browser session.',
      'Describe the deliverable and let the coworker produce it on your machine.',
    ],
    highlightKeys: [
      'Documents, spreadsheets, and decks come back as real files',
      'Works with the folders, inboxes, and tools the job already lives in',
      'Standing reports and briefs run on a schedule without you',
    ],
  },
}

/**
 * Announced products that have no release manifest yet. Deliberately outside
 * `CLIENT_APPS`, because every entry there is expected to resolve to a download.
 */
export const UPCOMING_CLIENT_APPS = [
  {
    id: 'coding',
    nameKey: 'BoxAI Coding',
    taglineKey: 'A coding agent that ships changes, not suggestions',
    highlightKeys: [
      'Reads the repository, plans the change, and edits across files',
      'Runs the build and the tests before it hands the work back',
      'Same balance, keys, and usage history as the rest of BoxAI',
    ],
  },
] as const

/**
 * The clients BoxAI Connect writes a provider into, the file it writes, and how
 * that client expects to be configured.
 *
 * A client advertised here must be supported by the current native Connect
 * release. Keep this list intentionally limited to the five supported agents.
 *
 * `icon` is a `@lobehub/icons` key for `LobeIcon` (prefer `.Color` when available).
 * `href` is the product home / docs the marketing strip links to.
 */
export const CONNECT_CLIENTS = [
  {
    name: 'Claude Code',
    config: '~/.claude/settings.json',
    chooseKey: 'Discover a compatible model, then apply it in one click',
    icon: 'ClaudeCode.Color',
    href: 'https://docs.anthropic.com/en/docs/claude-code',
  },
  {
    name: 'Codex CLI',
    config: '~/.codex/config.toml',
    chooseKey: 'Discover a compatible model, then apply it in one click',
    icon: 'Codex.Color',
    href: 'https://developers.openai.com/codex',
  },
  {
    name: 'Gemini CLI',
    config: '~/.gemini/.env',
    chooseKey: 'Discover a compatible model, then apply it in one click',
    icon: 'GeminiCLI.Color',
    href: 'https://github.com/google-gemini/gemini-cli',
  },
  {
    name: 'Grok Build',
    config: '~/.grok/config.toml',
    chooseKey: 'Discover a compatible model, then apply it in one click',
    icon: 'Grok.Color',
    href: 'https://grok.x.ai',
  },
  {
    name: 'OpenCode',
    config: '~/.config/opencode/opencode.json',
    chooseKey: 'Discover a compatible model, then apply it in one click',
    icon: 'OpenCode.Color',
    href: 'https://opencode.ai',
  },
] as const
