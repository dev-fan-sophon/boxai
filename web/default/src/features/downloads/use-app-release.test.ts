import { describe, expect, it } from 'vitest'

import type { DesktopRelease } from './types'
import { connectReleaseDownloads } from './use-app-release'

describe('connectReleaseDownloads', () => {
  it('offers only the two native 1.0 release packages', () => {
    const release: DesktopRelease = {
      version: '1.0.0',
      published_at: '2026-08-24T00:00:00Z',
      notes: 'BoxAI Connect 1.0.0',
      downloads: [
        {
          platform: 'macos',
          arch: 'arm64',
          kind: 'dmg',
          signed: false,
          minimum_os: '12.0',
          url: 'https://dl.you-box.com/connect/1.0.0/mac.dmg',
          filename: 'BoxAI-Connect-1.0.0-macos-arm64.dmg',
          size: 1,
          sha256: 'mac',
        },
        {
          platform: 'windows',
          arch: 'x64',
          kind: 'exe',
          signed: false,
          minimum_os: '10',
          url: 'https://dl.you-box.com/connect/1.0.0/windows.exe',
          filename: 'BoxAI-Connect-1.0.0-windows-x64-setup.exe',
          size: 1,
          sha256: 'windows',
        },
        {
          platform: 'macos',
          arch: 'x64',
          kind: 'dmg',
          signed: true,
          minimum_os: '12.0',
          url: 'https://dl.you-box.com/connect/1.0.0/legacy.dmg',
          filename: 'BoxAI-Connect-macos-x64.dmg',
          size: 1,
          sha256: 'legacy',
        },
      ],
    }

    expect(
      connectReleaseDownloads(release).downloads.map(
        (download) => download.filename
      )
    ).toEqual([
      'BoxAI-Connect-1.0.0-macos-arm64.dmg',
      'BoxAI-Connect-1.0.0-windows-x64-setup.exe',
    ])
  })
})
