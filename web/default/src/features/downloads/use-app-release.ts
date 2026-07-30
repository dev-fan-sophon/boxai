/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useQuery } from '@tanstack/react-query'

import { useStatus } from '@/hooks/use-status'

import { fetchDesktopRelease } from './release'

export type ClientAppId = 'connect' | 'desktop'

/** Where releases live when the deployment has not overridden the manifest URL. */
const DEFAULT_MANIFEST_URL: Record<ClientAppId, string> = {
  connect: 'https://dl.you-box.com/connect/releases.json',
  desktop: 'https://dl.you-box.com/desktop/releases.json',
}

/**
 * The current release of a BoxAI client app, read straight from the manifest the
 * publish pipeline uploads to R2. Publishing a build therefore updates every
 * download surface without a backend deploy.
 */
export function useAppRelease(app: ClientAppId) {
  const { status } = useStatus()
  const manifestUrl =
    (app === 'connect'
      ? status?.connect_release_manifest_url?.trim()
      : status?.desktop_release_manifest_url?.trim()) ||
    DEFAULT_MANIFEST_URL[app]
  const fallbackUrl =
    (app === 'connect'
      ? status?.connect_download_url?.trim()
      : status?.desktop_download_url?.trim()) || ''

  const query = useQuery({
    queryKey: ['app-release', app, manifestUrl],
    queryFn: () => fetchDesktopRelease(manifestUrl),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })

  return {
    release: query.data,
    loading: query.isLoading,
    failed: query.isError,
    fallbackUrl,
  }
}
