## Writing .pdf with reportlab

Use `platypus` (the flowable layout engine), not the raw canvas. It handles pagination, keeps
tables together, and reflows text; hand-placed canvas coordinates break the moment the content
changes length.

```python
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle)

doc = SimpleDocTemplate("/workspace/out/bao-cao.pdf", pagesize=A4,
                        leftMargin=2*cm, rightMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm)
styles = getSampleStyleSheet()
story = [Paragraph("Báo cáo quý 3", styles["Title"]), Spacer(1, 0.5*cm)]
story.append(Paragraph("Nội dung đoạn văn.", styles["BodyText"]))
doc.build(story)
```

### Fonts — this is where PDFs go wrong

Unlike .docx, a PDF embeds its fonts, so the built-in Helvetica cannot render Vietnamese or CJK.
Text silently turns into black squares. Register a real font first.

**Vietnamese and other Latin scripts** — register the Noto TrueType files:

```python
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

pdfmetrics.registerFont(TTFont("Noto", "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf"))
pdfmetrics.registerFont(TTFont("Noto-Bold", "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf"))
pdfmetrics.registerFontFamily("Noto", normal="Noto", bold="Noto-Bold")

body = ParagraphStyle("body", parent=styles["BodyText"], fontName="Noto", fontSize=10.5, leading=15)
title = ParagraphStyle("title", parent=styles["Title"], fontName="Noto-Bold")
```

**Chinese, Japanese, Korean** — do **not** try to load `NotoSansCJK-Regular.ttc`. reportlab cannot
read it: the file uses PostScript outlines and raises
`TTFError: postscript outlines are not supported`. Use reportlab's built-in CID fonts instead, which
need no file at all:

```python
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))       # Chinese
# HeiseiMin-W3 for Japanese, HYSMyeongJo-Medium for Korean
cjk = ParagraphStyle("cjk", parent=styles["BodyText"], fontName="STSong-Light")
```

Apply the font to every style you use, including table cell styles. A style inherited from the
sample stylesheet still carries Helvetica.

### Tables

```python
table = Table(data, colWidths=[4*cm, 4*cm, 4*cm], repeatRows=1)
table.setStyle(TableStyle([
    ("FONTNAME", (0, 0), (-1, -1), "Noto"),
    ("FONTNAME", (0, 0), (-1, 0), "Noto-Bold"),
    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1F4E79")),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#B0B0B0")),
    ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F2F6FA")]),
]))
```

`repeatRows=1` repeats the header on every page. Wrap long cell text in `Paragraph` objects, or the
column will overflow instead of wrapping.

### Page numbers

```python
def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Noto", 8)
    canvas.drawRightString(A4[0] - 2*cm, 1.2*cm, f"Trang {doc.page}")
    canvas.restoreState()

doc.build(story, onFirstPage=footer, onLaterPages=footer)
```

### Charts and images

Render with matplotlib to `/tmp`, then place:

```python
from reportlab.platypus import Image
story.append(Image("/tmp/chart.png", width=16*cm, height=8*cm))
```

### Before saving

- A font that covers the document's script is registered and applied to every style.
- Tables fit inside the margins; `colWidths` sums to less than the printable width.
- The document builds in one `doc.build(...)` call to `/workspace/out/`.
