### Better-looking PDFs: render HTML with a real browser

For anything where layout matters more than plain text — invoices, quotations, certificates,
flyers, one-page profiles, styled reports — do **not** fight reportlab. Write HTML and CSS to
`/workspace/out/<name>.pdf.html` and it is rendered to `<name>.pdf` by headless Chromium. The
`.pdf.html` file itself is not delivered; only the PDF is.

```python
html = """<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 0; }
  body { font-family: "Noto Sans", "Segoe UI", Arial, sans-serif; color: #1a1a1a; margin: 0; }
  .sheet { padding: 16mm 14mm; }
  h1 { font-size: 22pt; margin: 0 0 4mm; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
  th { background: #1F4E79; color: #fff; text-align: left; padding: 6px 8px; }
  td { border-bottom: 1px solid #dcdcdc; padding: 6px 8px; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr { break-inside: avoid; }
</style></head>
<body><div class="sheet">
  <h1>Hóa đơn #2026-0142</h1>
  <table>
    <thead><tr><th>Mô tả</th><th>Số lượng</th><th>Thành tiền</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
</div></body></html>"""

with open("/workspace/out/hoa-don.pdf.html", "w", encoding="utf-8") as f:
    f.write(html.format(rows=rows_html))
```

Rules that matter for print:

- Set `@page { size: A4; margin: 0 }` and do the padding in the body, or Chromium's default
  margins fight your layout. Page margins are already applied by the renderer.
- Use `break-inside: avoid` on rows and cards, and `break-before: page` where a new page belongs.
- Background colours only print because `printBackground` is enabled; do not rely on that for
  legibility — keep sufficient contrast in the text itself.
- Use `mm` and `pt` rather than `px` for anything that must be a physical size.
- Charts: render with matplotlib to `/tmp/chart.png`, base64-encode it, and inline it as
  `<img src="data:image/png;base64,...">`. External image URLs may fail to load in time.
- Latin and Vietnamese render with the system fonts. For Chinese, Japanese or Korean, add a
  webfont, for example
  `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC&display=swap">`
  and put `"Noto Sans SC"` first in `font-family`.

If the rendering fails, the build is reported as failed with the reason, and reportlab remains the
fallback. Use it directly for long text-heavy documents, where its pagination is more predictable.
