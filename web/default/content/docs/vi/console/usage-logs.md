---
title: Nhật ký sử dụng
summary: Đọc lịch sử request, token và mã trạng thái để gỡ lỗi billing và tích hợp.
section: console
order: 40
audience: [user, developer]
updated: 2026-08-04
status: published
---

## Mở nhật ký
![Usage logs table](/doc-assets/screenshots/console/usage-logs.en.webp "Filter by time, model, or status in Usage logs")


Trong console, mở **Usage** / **Logs** ([/usage-logs](/usage-logs) khi đã đăng nhập). Lọc theo thời gian, model hoặc status nếu có.

## Ý nghĩa từng dòng

Các trường thường gặp:

| Trường | Ý nghĩa |
|--------|---------|
| Time | Thời điểm gateway xử lý request |
| Model | Model ID được tính phí |
| Status | Kết quả HTTP hoặc gateway |
| Tokens / quota | Lượng tiêu thụ của lần gọi |
| Key / client | Credential hoặc app đã dùng (khi hiển thị) |

## Gỡ lỗi bằng log

:::steps
1. Tái hiện một lần gọi lỗi.
2. Tìm dòng khớp theo thời gian và model.
3. Đối chiếu status với [Lỗi và rate limit](/docs/api/errors).
4. Sửa request hoặc key, rồi xác nhận có dòng thành công.
:::

## Tiếp theo

- [Lỗi, retry và rate limit](/docs/api/errors)
- [API key](/docs/console/api-keys)
