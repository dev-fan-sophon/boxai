## Writing .pptx with python-pptx

```python
from pptx import Presentation
from pptx.util import Cm, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN

prs = Presentation()
prs.slide_width = Cm(33.87)     # 16:9, the default 4:3 looks dated
prs.slide_height = Cm(19.05)

title_slide = prs.slides.add_slide(prs.slide_layouts[0])
title_slide.shapes.title.text = "Báo cáo quý 3"
title_slide.placeholders[1].text = "Phòng Kinh doanh — 10/2026"

prs.save("/workspace/out/bao-cao.pptx")
```

### Layouts

The default template's layouts, by index: `0` title, `1` title + content, `5` title only,
`6` blank. Use `1` for ordinary bullet slides and `6` when placing everything by hand.

```python
slide = prs.slides.add_slide(prs.slide_layouts[1])
slide.shapes.title.text = "Kết quả chính"
body = slide.placeholders[1].text_frame
body.text = "Doanh thu tăng 15%"
for line in ["Chi phí giảm 8%", "Biên lợi nhuận đạt 22%"]:
    paragraph = body.add_paragraph()
    paragraph.text = line
    paragraph.level = 1
```

`text_frame.text` sets the first paragraph; `add_paragraph()` appends. Setting `.text` again wipes
the frame.

### Text will not shrink itself

python-pptx cannot compute autofit, so text that overflows the placeholder simply runs off the
slide and nobody notices until the deck is opened. Keep to **six bullets per slide and about ten
words per bullet**, and split into a second slide instead of shrinking the font.

If a font size must be set:

```python
for paragraph in body.paragraphs:
    for run in paragraph.runs:
        run.font.size = Pt(18)
```

### Charts and images

A native chart stays editable in PowerPoint:

```python
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE

chart_data = CategoryChartData()
chart_data.categories = months
chart_data.add_series("Doanh thu", revenue)
slide.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Cm(2), Cm(4), Cm(29), Cm(13), chart_data)
```

For anything matplotlib does better, save a PNG to `/tmp` and place it:

```python
slide.shapes.add_picture("/tmp/chart.png", Cm(2), Cm(4), width=Cm(29))
```

Give a picture either a width or a height, never both, or it will be distorted.

### Tables

```python
shape = slide.shapes.add_table(rows=len(data) + 1, cols=3, left=Cm(2), top=Cm(4),
                               width=Cm(29), height=Cm(2))
table = shape.table
table.columns[0].width = Cm(9)
for i, title in enumerate(["Tháng", "Doanh thu", "Tăng trưởng"]):
    table.cell(0, i).text = title
```

Table text defaults to 18 pt, which overflows quickly. Drop it to 12-14 pt for anything wider than
four columns.

### Speaker notes

```python
slide.notes_slide.notes_text_frame.text = "Nhấn mạnh mức tăng trưởng quý 3."
```

### Structure

Unless the user asked for something else: title slide, agenda, one idea per content slide, a
summary, and a closing slide. Eight to fifteen slides for a normal request. Do not pad.

### Before saving

- No slide has more than six bullets.
- Every slide has a title.
- Pictures keep their aspect ratio.
