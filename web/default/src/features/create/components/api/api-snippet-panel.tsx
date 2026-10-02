import { Link } from '@tanstack/react-router'
import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import type { StudioSettings } from '@/features/playground/types'

import type { CreateTool } from '../../constants'
import type { GenerationDraft } from '../../hooks/use-generation-draft'
import { buildApiRequest } from '../../lib/api-request'

type SnippetLanguage = 'curl' | 'python' | 'node'

function serverAddress(): string {
  try {
    const raw = localStorage.getItem('status')
    const status = raw ? (JSON.parse(raw) as { server_address?: string }) : null
    if (status?.server_address) return status.server_address.replace(/\/$/, '')
  } catch {
    // Fall back to the current origin.
  }
  return window.location.origin
}

function renderSnippet(
  language: SnippetLanguage,
  url: string,
  body: Record<string, unknown>,
  binaryOutput: boolean
): string {
  const json = JSON.stringify(body, null, 2)
  if (language === 'curl') {
    return [
      `curl ${url} \\`,
      `  -H "Authorization: Bearer $BOXAI_API_KEY" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '${json.replaceAll("'", "'\\''")}'${binaryOutput ? ' \\\n  --output speech.mp3' : ''}`,
    ].join('\n')
  }
  if (language === 'python') {
    return [
      'import os',
      'import requests',
      '',
      'response = requests.post(',
      `    "${url}",`,
      '    headers={"Authorization": f"Bearer {os.environ[\'BOXAI_API_KEY\']}"},',
      `    json=${json.replaceAll('\n', '\n    ').replaceAll('true', 'True').replaceAll('false', 'False')},`,
      ')',
      binaryOutput
        ? 'open("speech.mp3", "wb").write(response.content)'
        : 'print(response.json())',
    ].join('\n')
  }
  return [
    `const response = await fetch('${url}', {`,
    "  method: 'POST',",
    '  headers: {',
    '    Authorization: `Bearer ${process.env.BOXAI_API_KEY}`,',
    "    'Content-Type': 'application/json',",
    '  },',
    `  body: JSON.stringify(${json.replaceAll('\n', '\n  ')}),`,
    '})',
    binaryOutput
      ? "await fs.promises.writeFile('speech.mp3', Buffer.from(await response.arrayBuffer()))"
      : 'console.log(await response.json())',
  ].join('\n')
}

/**
 * Shows the exact public API call behind the current panel state, so a run
 * that works here can move into the user's own code unchanged.
 */
export function ApiSnippetPanel(props: {
  modality: CreateTool
  model: string
  prompt: string
  settings: StudioSettings
  draft: Pick<
    GenerationDraft,
    'videoOptions' | 'estimateParams' | 'imageCapabilities'
  >
}) {
  const { t } = useTranslation()
  const [language, setLanguage] = useState<SnippetLanguage>('curl')
  const request = buildApiRequest(props)
  const url = `${serverAddress()}${request.path}`
  const snippet = renderSnippet(
    language,
    url,
    request.body,
    props.modality === 'audio'
  )

  return (
    <div className='mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0 space-y-1'>
          <h2 className='text-foreground text-base font-semibold'>
            {t('Use this in your code')}
          </h2>
          <p className='text-muted-foreground text-sm text-pretty'>
            {t(
              'The same request through the BoxAI API. Your prompt and parameters are filled in.'
            )}
          </p>
        </div>
        <Button
          variant='outline'
          size='sm'
          className='gap-1.5'
          render={<Link to='/keys' />}
        >
          <KeyRound className='size-3.5' aria-hidden='true' />
          {t('Get an API key')}
        </Button>
      </div>
      <SegmentedControl<SnippetLanguage>
        aria-label={t('Language')}
        value={language}
        onValueChange={setLanguage}
        options={[
          { value: 'curl', label: 'cURL' },
          { value: 'python', label: 'Python' },
          { value: 'node', label: 'Node.js' },
        ]}
        className='max-w-xs'
      />
      <div className='border-border/70 bg-muted/30 relative overflow-hidden rounded-xl border'>
        <div className='border-border/60 text-muted-foreground flex items-center justify-between border-b px-3 py-1.5 font-mono text-xs'>
          <span className='truncate'>POST {request.path}</span>
          <CopyButton value={snippet} className='size-7' />
        </div>
        <pre className='overflow-x-auto p-4 font-mono text-xs leading-relaxed'>
          <code>{snippet}</code>
        </pre>
      </div>
      {props.modality === 'video' && (
        <p className='text-muted-foreground text-xs text-pretty'>
          {t(
            'Video generation is asynchronous: the response returns a task id; poll GET /v1/video/generations/{task_id} until it completes.'
          )}
        </p>
      )}
    </div>
  )
}
