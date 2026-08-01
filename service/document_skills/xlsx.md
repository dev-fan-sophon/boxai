## Writing .xlsx with openpyxl

```python
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

wb = Workbook()
ws = wb.active
ws.title = "Doanh thu"
ws.append(["Tháng", "Doanh thu", "Chi phí", "Lợi nhuận"])
for row in rows:
    ws.append(row)
wb.save("/workspace/out/doanh-thu.xlsx")
```

A spreadsheet the user can work with, not a screenshot of a table:

### Real values, formatted by number format

Write numbers as numbers and dates as dates. Never write `"1.234.567 ₫"` as a string — it cannot be
summed, sorted or charted.

```python
for row in ws.iter_rows(min_row=2, min_col=2, max_col=4):
    for cell in row:
        cell.number_format = '#,##0 "₫"'
```

Useful formats: `#,##0` counts, `#,##0.00` amounts, `0.0%` percentages (store `0.153`, not `15.3`),
`dd/mm/yyyy` dates for the Vietnamese locale.

### Formulas instead of precomputed totals

If a column is derived, write the formula so it stays correct when the user edits an input.

```python
last = ws.max_row
ws.cell(row=last + 1, column=1, value="Tổng")
ws.cell(row=last + 1, column=2, value=f"=SUM(B2:B{last})")
```

### Header, widths, freeze

Three lines that separate a usable sheet from an unreadable one:

```python
header_fill = PatternFill("solid", start_color="FF1F4E79")
for cell in ws[1]:
    cell.font = Font(bold=True, color="FFFFFFFF")
    cell.fill = header_fill
    cell.alignment = Alignment(horizontal="center", vertical="center")

ws.freeze_panes = "A2"
ws.auto_filter.ref = ws.dimensions

for column in ws.columns:
    width = max(len(str(cell.value)) if cell.value is not None else 0 for cell in column)
    ws.column_dimensions[get_column_letter(column[0].column)].width = min(max(width + 2, 10), 45)
```

openpyxl has no autofit; the loop above is the substitute. Count CJK characters as two if the sheet
is mostly Chinese.

### Charts

openpyxl writes native Excel charts, which stay live when the user edits the data. Prefer these
over an embedded PNG for spreadsheets.

```python
from openpyxl.chart import BarChart, Reference
chart = BarChart()
chart.title = "Doanh thu theo tháng"
data = Reference(ws, min_col=2, min_row=1, max_row=ws.max_row)
categories = Reference(ws, min_col=1, min_row=2, max_row=ws.max_row)
chart.add_data(data, titles_from_data=True)
chart.set_categories(categories)
ws.add_chart(chart, "F2")
```

### Multiple sheets

One sheet per topic, named in the user's language. Remove the default sheet if you did not use it:

```python
summary = wb.create_sheet("Tổng hợp")
if "Sheet" in wb.sheetnames and wb["Sheet"].max_row == 1:
    del wb["Sheet"]
```

### Reading input

`pandas.read_excel` is fine for analysis. When writing, prefer openpyxl directly: `to_excel` gives
no styling, no widths and no freeze panes. If you do use `to_excel`, reopen the file with openpyxl
and apply the formatting afterwards.

### Before saving

- No column is too narrow to read.
- Numeric columns are numeric, with a number format.
- Row 1 is a header and is frozen.
