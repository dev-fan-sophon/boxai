---
title: Lỗi, retry và rate limit
summary: Phân loại lỗi, retry an toàn các request tạm thời, và tôn trọng giới hạn gateway.
section: api
order: 40
audience: [developer]
updated: 2026-08-04
status: published
---

## Nhóm mã HTTP

| Status             | Ý nghĩa            | Hành động                                        |
| ------------------ | ------------------ | ------------------------------------------------ |
| 400, 422           | Input không hợp lệ | Sửa request; không retry nguyên trạng            |
| 401, 403           | Auth hoặc quyền    | Kiểm tra key và quyền model                      |
| 429                | Rate limit         | Tôn trọng `Retry-After` nếu có; giảm concurrency |
| 500, 502, 503, 504 | Lỗi tạm thời       | Chỉ retry nếu thao tác an toàn khi lặp lại       |

## Chính sách retry an toàn

Chỉ retry request idempotent hoặc có cơ chế idempotency. Không tự động retry lỗi xác thực, quyền hoặc validation.

Dùng exponential backoff có giới hạn kèm jitter, tôn trọng `Retry-After`, và giới hạn số lần thử. Hủy retry khi hết deadline hoặc `AbortSignal`.

## Rate limit

Khi nhận **429**:

1. Back off theo `Retry-After` hoặc chính sách client.
2. Giảm số request song song.
3. Kiểm tra [Nhật ký sử dụng](/docs/console/usage-logs) để tìm key nóng hoặc vòng lặp.

## Tiếp theo

- [Streaming](/docs/api/streaming)
- [Xác thực](/docs/api/auth)
