/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CodeBlock, CodeBlockCopyButton, CodeBlockFrame } from './code-block'
import { FenceViewToggle, type FenceView } from './fence-view-toggle'

type HtmlPreviewFenceProps = {
  code: string
  language: string
  final: boolean
}

function getPreviewSrcDoc(language: string, code: string): string {
  if (language === 'html') return code
  return `<!doctype html><html><body style="margin:0;display:grid;place-items:center;min-height:100vh">${code}</body></html>`
}

/**
 * Claude-artifact style preview for html/svg code fences: sandboxed iframe
 * (no same-origin access) with a Preview | Code toggle. Streaming messages
 * keep showing the raw code until final.
 */
export function HtmlPreviewFence(props: HtmlPreviewFenceProps) {
  const { t } = useTranslation()
  const [view, setView] = useState<FenceView>('preview')
  const isHtml = props.language === 'html'

  if (!props.final || view === 'code') {
    return (
      <CodeBlock
        code={props.code}
        collapsedLines={14}
        defaultCollapsed={props.code.split('\n').length > 14}
        language={props.language}
        maxExpandedLines={44}
        showLineNumbers
        showToolbar
        title={props.language}
      >
        {props.final && <FenceViewToggle view='code' onViewChange={setView} />}
        <CodeBlockCopyButton />
      </CodeBlock>
    )
  }

  return (
    <CodeBlockFrame
      showToolbar
      title={props.language}
      endActions={<FenceViewToggle view='preview' onViewChange={setView} />}
      bodyClassName='p-0'
    >
      <iframe
        className='bg-background h-80 w-full border-0'
        // No allow-same-origin: previewed model output stays fully isolated.
        sandbox={isHtml ? 'allow-scripts' : ''}
        srcDoc={getPreviewSrcDoc(props.language, props.code)}
        title={t('Preview')}
        loading='lazy'
      />
    </CodeBlockFrame>
  )
}
