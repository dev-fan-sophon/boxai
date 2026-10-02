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
 * Identifies legacy Connect sessions; current Connect uses ordinary API keys.
 */
export const CONNECT_SESSION_PREFIX = 'BoxAI Connect'

export const CLIENT_APPS: Record<ClientAppId, ClientAppMeta> = {
  connect: {
    id: 'connect',
    nameKey: 'BoxAI Connect',
    taglineKey: 'A native app for connecting your AI coding agents to BoxAI',
    descriptionKey:
      'Sign in with BoxAI, then keep Connect running while your agents use its local gateway.',
    icon: BoxAIConnectIcon,
    logoSrc: CLIENT_APP_LOGO.connect.src,
    section: 'connect',
    stepKeys: [
      'Download and install the app for your platform.',
      'Sign in from the app; approve the request in this browser session.',
      'Choose an agent and model, then apply the configuration in one click.',
    ],
    highlightKeys: [
      'Choose BoxAI conversational models and manage routing rules.',
      'Manage MCP servers and Skills in the original library.',
      'Configure supported coding agents to use the local gateway.',
    ],
  },
  desktop: {
    id: 'desktop',
    nameKey: 'BoxAI Desktop',
    taglineKey: 'An AI agent workspace for your projects, on your own machine',
    descriptionKey:
      'BoxAI Desktop gives an AI agent a workspace of its own: open a project, describe the change, review the plan and the diff, and keep every model call on your BoxAI account.',
    icon: BoxAIDesktopIcon,
    logoSrc: CLIENT_APP_LOGO.desktop.src,
    section: 'desktop',
    stepKeys: [
      'Download and install the app for your platform.',
      'Sign in from the app; approve the request in this browser session.',
      'Open a project folder, pick a model, and describe the task.',
    ],
    highlightKeys: [
      'Agent and Plan modes that read, edit, run, and test in your project',
      'Subagents and parallel sessions for bigger jobs',
      'Every model in your BoxAI account, with one balance and one bill',
    ],
  },
}

/**
 * The clients BoxAI Connect writes a provider into, the file it writes, and how
 * that client expects to be configured.
 *
 * A client advertised here must be supported by the current native Connect
 * release. This is a selection, not a limit on the native agent catalog.
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
