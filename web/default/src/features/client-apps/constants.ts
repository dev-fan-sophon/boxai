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
    taglineKey:
      'Point your AI coding clients at BoxAI, without editing a config file',
    descriptionKey:
      'Sign in once in your browser. BoxAI Connect writes the endpoint and key into Claude Code, Codex CLI, Gemini CLI, Grok Build, OpenCode and more — backing up what was there and restoring it whenever you want.',
    icon: BoxAIConnectIcon,
    logoSrc: CLIENT_APP_LOGO.connect.src,
    section: 'connect',
    stepKeys: [
      'Download and install the app for your platform.',
      'Sign in from the app; approve the request in this browser session.',
      'Pick the clients to configure — Connect writes each config file and keeps a backup.',
    ],
    highlightKeys: [
      'Writes the endpoint and key into each client for you',
      'Backs up every config it touches, restorable in one click',
      'Switch the whole toolchain to another provider in seconds',
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
 * The clients BoxAI Connect writes a provider into, and the file it writes.
 *
 * Must stay in step with `SUPPORTED_APPS` in
 * `connect/src-tauri/src/boxai/provider_seed.rs`. A client advertised here that
 * the app does not seed is a promise the download does not keep.
 *
 * `icon` is a `@lobehub/icons` key for `LobeIcon` (prefer `.Color` when available).
 * `href` is the product home / docs the marketing strip links to.
 */
export const CONNECT_CLIENTS = [
  {
    name: 'Claude Code',
    config: '~/.claude/settings.json',
    icon: 'ClaudeCode.Color',
    href: 'https://docs.anthropic.com/en/docs/claude-code',
  },
  {
    name: 'Codex CLI',
    config: '~/.codex/config.toml',
    icon: 'Codex.Color',
    href: 'https://developers.openai.com/codex',
  },
  {
    name: 'Gemini CLI',
    config: '~/.gemini/settings.json',
    icon: 'GeminiCLI.Color',
    href: 'https://github.com/google-gemini/gemini-cli',
  },
  {
    name: 'Grok Build',
    config: '~/.grok/config.toml',
    icon: 'Grok.Color',
    href: 'https://grok.x.ai',
  },
  {
    name: 'OpenCode',
    config: '~/.config/opencode',
    icon: 'OpenCode.Color',
    href: 'https://opencode.ai',
  },
  {
    name: 'OpenClaw',
    config: '~/.openclaw/openclaw.json',
    icon: 'OpenClaw.Color',
    href: 'https://openclaw.ai',
  },
  {
    name: 'Hermes',
    config: '~/.hermes/config.yaml',
    icon: 'HermesAgent.Color',
    href: 'https://github.com/HermesAgent/hermes',
  },
] as const
