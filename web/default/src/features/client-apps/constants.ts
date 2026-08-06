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
      'Open a client and set up its models the way that client works, then press Apply.',
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
 * The clients BoxAI Connect writes a provider into, the file it writes, and how
 * that client expects to be configured.
 *
 * Must stay in step with `SUPPORTED_APPS` and the per-client config shapes in
 * `connect/src-tauri/src/boxai/agent_config.rs`. A client advertised here that
 * the app does not seed is a promise the download does not keep, and a `choose`
 * line that does not match its panel sends people looking for a control that
 * client never had.
 *
 * `mode` is the difference users feel first: an exclusive client has one active
 * provider, so BoxAI replaces it and Connect keeps the previous config to
 * restore; an additive client keeps its own providers and gains BoxAI alongside
 * them, so its own default only moves when you ask for it.
 *
 * `icon` is a `@lobehub/icons` key for `LobeIcon` (prefer `.Color` when available).
 * `href` is the product home / docs the marketing strip links to.
 */
export const CONNECT_CLIENTS = [
  {
    name: 'Claude Code',
    config: '~/.claude/settings.json',
    mode: 'exclusive',
    chooseKey: 'One model, plus optional overrides per role',
    icon: 'ClaudeCode.Color',
    href: 'https://docs.anthropic.com/en/docs/claude-code',
  },
  {
    name: 'Codex CLI',
    config: '~/.codex/config.toml',
    mode: 'exclusive',
    chooseKey: 'A set of models, which one is default, and reasoning effort',
    icon: 'Codex.Color',
    href: 'https://developers.openai.com/codex',
  },
  {
    name: 'Gemini CLI',
    config: '~/.gemini/.env',
    mode: 'exclusive',
    chooseKey: 'One model, from the names Gemini CLI accepts',
    icon: 'GeminiCLI.Color',
    href: 'https://github.com/google-gemini/gemini-cli',
  },
  {
    name: 'Grok Build',
    config: '~/.grok/config.toml',
    mode: 'exclusive',
    chooseKey: 'A set of models and which one is default',
    icon: 'Grok.Color',
    href: 'https://grok.x.ai',
  },
  {
    name: 'OpenCode',
    config: '~/.config/opencode/opencode.json',
    mode: 'additive',
    chooseKey: 'A set of models, picked per session inside OpenCode',
    icon: 'OpenCode.Color',
    href: 'https://opencode.ai',
  },
  {
    name: 'OpenClaw',
    config: '~/.openclaw/openclaw.json',
    mode: 'additive',
    chooseKey: 'A set of models, plus a primary and its fallbacks',
    icon: 'OpenClaw.Color',
    href: 'https://openclaw.ai',
  },
  {
    name: 'Hermes',
    config: '~/.hermes/config.yaml',
    mode: 'additive',
    chooseKey: 'A set of models and which one is default',
    icon: 'HermesAgent.Color',
    href: 'https://github.com/HermesAgent/hermes',
  },
] as const
