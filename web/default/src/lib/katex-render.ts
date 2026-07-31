import * as katex from 'katex'

import 'katex/dist/katex.min.css'

function normalizeMathSource(source: string): string {
  return source
    .trim()
    .replace(/^\\\(/, '')
    .replace(/\\\)$/, '')
    .replace(/^\\\[/, '')
    .replace(/\\\]$/, '')
}

export function renderMathToHtml(source: string, displayMode: boolean): string {
  return katex.renderToString(normalizeMathSource(source), {
    displayMode,
    output: 'htmlAndMathml',
    throwOnError: false,
  })
}
