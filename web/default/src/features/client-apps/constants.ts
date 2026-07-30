/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { Laptop, Plug, type LucideIcon } from 'lucide-react'

import type { ClientAppId } from '@/features/downloads/use-app-release'

export type ClientAppMeta = {
  id: ClientAppId
  /** i18n source keys; render with `t()` at the call site. */
  nameKey: string
  taglineKey: string
  descriptionKey: string
  icon: LucideIcon
  /** Console section under /dashboard. */
  section: 'connect' | 'desktop'
  /** Setup steps shown on the console page and in the marketing section. */
  stepKeys: readonly string[]
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
    icon: Plug,
    section: 'connect',
    stepKeys: [
      'Download and install the app for your platform.',
      'Sign in from the app; approve the request in this browser session.',
      'Pick the clients to configure — Connect writes each config file and keeps a backup.',
    ],
  },
  desktop: {
    id: 'desktop',
    nameKey: 'BoxAI Desktop',
    taglineKey: 'An AI coworker that runs on your own machine',
    descriptionKey:
      'BoxAI Desktop is an AI coworker that runs on your own machine, works with your files, terminal, and connected apps, and returns finished work.',
    icon: Laptop,
    section: 'desktop',
    stepKeys: [
      'Download and install the app for your platform.',
      'Sign in from the app; approve the request in this browser session.',
      'Describe a task and let the coworker run it on your machine.',
    ],
  },
}

/**
 * The clients BoxAI Connect writes a provider into, and the file it writes.
 *
 * Must stay in step with `SUPPORTED_APPS` in
 * `connect/src-tauri/src/boxai/provider_seed.rs`. A client advertised here that
 * the app does not seed is a promise the download does not keep.
 */
export const CONNECT_CLIENTS = [
  { name: 'Claude Code', config: '~/.claude/settings.json' },
  { name: 'Codex CLI', config: '~/.codex/config.toml' },
  { name: 'Gemini CLI', config: '~/.gemini/settings.json' },
  { name: 'Grok Build', config: '~/.grok/config.toml' },
  { name: 'OpenCode', config: '~/.config/opencode' },
  { name: 'OpenClaw', config: '~/.openclaw/openclaw.json' },
  { name: 'Hermes', config: '~/.hermes/config.yaml' },
] as const
