/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import {
  MAX_DOCUMENT_TEXT_CHARS,
  extractDocxText,
  extractPptxText,
  extractSpreadsheetText,
  isDocumentFile,
  truncateDocumentText,
} from './document-extract'

describe('isDocumentFile', () => {
  it('accepts office and text extensions', () => {
    for (const name of ['a.docx', 'b.xlsx', 'c.pptx', 'd.md', 'e.csv']) {
      expect(isDocumentFile(new File([''], name))).toBe(true)
    }
  })

  it('rejects images, PDFs, and unknown binaries', () => {
    expect(isDocumentFile(new File([''], 'a.png', { type: 'image/png' }))).toBe(
      false
    )
    expect(
      isDocumentFile(new File([''], 'a.pdf', { type: 'application/pdf' }))
    ).toBe(false)
    expect(isDocumentFile(new File([''], 'a.bin'))).toBe(false)
  })
})

describe('truncateDocumentText', () => {
  it('normalizes CRLF and trims', () => {
    expect(truncateDocumentText('a\r\nb\r\n')).toBe('a\nb')
  })

  it('caps oversized text with a truncation marker', () => {
    const result = truncateDocumentText('x'.repeat(MAX_DOCUMENT_TEXT_CHARS + 5))
    expect(result.length).toBeLessThanOrEqual(MAX_DOCUMENT_TEXT_CHARS + 20)
    expect(result.endsWith('…[truncated]')).toBe(true)
  })
})

describe('extractDocxText', () => {
  it('extracts paragraph text runs with entities decoded', async () => {
    const zip = new JSZip()
    zip.file(
      'word/document.xml',
      '<w:document><w:body>' +
        '<w:p><w:r><w:t>Hello </w:t></w:r><w:r><w:t xml:space="preserve">A &amp; B</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Second line</w:t></w:r></w:p>' +
        '</w:body></w:document>'
    )
    const buffer = await zip.generateAsync({ type: 'arraybuffer' })
    expect(await extractDocxText(buffer)).toBe('Hello A & B\nSecond line')
  })
})

describe('extractPptxText', () => {
  it('extracts slide text in slide order', async () => {
    const zip = new JSZip()
    zip.file(
      'ppt/slides/slide2.xml',
      '<p:sld><a:p><a:r><a:t>Slide two</a:t></a:r></a:p></p:sld>'
    )
    zip.file(
      'ppt/slides/slide1.xml',
      '<p:sld><a:p><a:r><a:t>Title</a:t></a:r></a:p><a:p><a:r><a:t>Body</a:t></a:r></a:p></p:sld>'
    )
    const buffer = await zip.generateAsync({ type: 'arraybuffer' })
    expect(await extractPptxText(buffer)).toBe('Title\nBody\n\nSlide two')
  })
})

describe('extractSpreadsheetText', () => {
  it('converts sheets to CSV with sheet headers when multiple', async () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['name', 'qty'],
        ['apple', 3],
      ]),
      'Fruits'
    )
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([['total', 3]]),
      'Summary'
    )
    const buffer = XLSX.write(workbook, {
      type: 'array',
      bookType: 'xlsx',
    }) as ArrayBuffer
    const text = await extractSpreadsheetText(buffer)
    expect(text).toContain('# Fruits\nname,qty\napple,3')
    expect(text).toContain('# Summary\ntotal,3')
  })
})
