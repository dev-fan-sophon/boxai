## Writing .docx with python-docx

```python
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH

doc = Document()
doc.add_heading("Báo cáo quý 3", level=0)   # level=0 is the title style
doc.add_heading("Tổng quan", level=1)
p = doc.add_paragraph("Nội dung đoạn văn. ")
p.add_run("Phần in đậm.").bold = True
doc.save("/workspace/out/bao-cao.docx")
```

### Use the built-in styles

A .docx does not embed fonts; the reader's Word picks them. Setting an exotic font makes the
document look worse on the user's machine, not better. Use `add_heading`, `Normal`, `List Bullet`,
`List Number`, `Quote`, and `Table Grid` and the document will look right everywhere.

Change the document-wide font once, on the style, rather than run by run:

```python
style = doc.styles["Normal"]
style.font.name = "Calibri"
style.font.size = Pt(11)
```

If the document contains Chinese, Japanese or Korean **and** you set a font name, also set the
East Asian font or Word will substitute an unrelated one:

```python
from docx.oxml.ns import qn
style.element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
```

Vietnamese needs nothing special: Calibri, Arial and Times New Roman all carry the diacritics.

### Tables

```python
table = doc.add_table(rows=1, cols=3)
table.style = "Table Grid"          # without this the table has no borders
header = table.rows[0].cells
for i, title in enumerate(["Tháng", "Doanh thu", "Tăng trưởng"]):
    header[i].text = title
    header[i].paragraphs[0].runs[0].bold = True
for month, revenue, growth in data:
    row = table.add_row().cells
    row[0].text = str(month)
    row[1].text = f"{revenue:,.0f} ₫"
    row[2].text = f"{growth:.1%}"
```

Set column widths on **every cell**, not on the column; Word ignores the column width otherwise.

```python
for row in table.rows:
    row.cells[0].width = Cm(3)
```

### Charts and images

python-docx cannot create a native chart. Render it with matplotlib, save a PNG, and insert it.
Fonts are already configured, so CJK and Vietnamese labels render correctly with no setup.

```python
import matplotlib.pyplot as plt
fig, ax = plt.subplots(figsize=(7, 3.5))
ax.bar(months, revenue)
ax.set_title("Doanh thu theo tháng")
fig.tight_layout()
fig.savefig("/tmp/chart.png", dpi=200)
doc.add_picture("/tmp/chart.png", width=Cm(16))
```

Write the chart PNG to `/tmp`, not to `/workspace/out`, unless the user asked for the image
itself — every file in `/workspace/out` is delivered to them.

### Page setup

```python
section = doc.sections[0]
section.left_margin = section.right_margin = Cm(2.5)
```

`doc.add_page_break()` starts a new page. A real table of contents needs a field Word refreshes on
open; unless the user insists, write a plain list of headings instead of a broken TOC field.

### Before saving

- Every heading level used exists in the document flow (do not jump from level 1 to level 3).
- Numbers are formatted for the reader (thousands separators, currency, percentages), not raw
  floats.
- The file is saved once, at the end, to `/workspace/out/`.
