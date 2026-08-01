import { describe, expect, it } from 'vitest'

import { extractDocumentBuildCode, toDocumentArtifacts } from './document-build'

const SCRIPT = "import docx\ndocx.Document().save('/workspace/out/a.docx')"

describe('extractDocumentBuildCode', () => {
  it('takes the script out of a fenced block surrounded by commentary', () => {
    expect(
      extractDocumentBuildCode(
        `Sure, here you go:\n\n\`\`\`python\n${SCRIPT}\n\`\`\`\n\nLet me know.`
      )
    ).toBe(SCRIPT)
  })

  it('prefers the last python block when the model sketches first', () => {
    expect(
      extractDocumentBuildCode(
        `\`\`\`python\nprint('sketch')\n\`\`\`\nNow the real one:\n\`\`\`python\n${SCRIPT}\n\`\`\``
      )
    ).toBe(SCRIPT)
  })

  it('accepts a fence with no language tag', () => {
    expect(extractDocumentBuildCode(`\`\`\`\n${SCRIPT}\n\`\`\``)).toBe(SCRIPT)
  })

  it('prefers a tagged python block over an untagged one', () => {
    expect(
      extractDocumentBuildCode(
        `\`\`\`\nnot the script\n\`\`\`\n\`\`\`python\n${SCRIPT}\n\`\`\``
      )
    ).toBe(SCRIPT)
  })

  it('accepts a bare script with no fence at all', () => {
    expect(extractDocumentBuildCode(SCRIPT)).toBe(SCRIPT)
  })

  it('returns nothing for a refusal', () => {
    expect(extractDocumentBuildCode('I cannot help with that.')).toBe('')
  })

  it('returns nothing for an empty fence', () => {
    expect(extractDocumentBuildCode('```python\n```')).toBe('')
  })
})

describe('toDocumentArtifacts', () => {
  it('marks the documents that failed to reopen', () => {
    const artifacts = toDocumentArtifacts(
      [
        {
          id: 1,
          name: 'report.docx',
          mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size: 1024,
          kind: 'document',
        },
        { id: 2, name: 'chart.png', mime: 'image/png', size: 512, kind: 'image' },
      ],
      ['report.docx']
    )
    expect(artifacts.map((a) => [a.name, a.verified])).toEqual([
      ['report.docx', false],
      ['chart.png', true],
    ])
  })

  it('survives a build that produced nothing', () => {
    expect(toDocumentArtifacts(undefined, undefined)).toEqual([])
  })
})
