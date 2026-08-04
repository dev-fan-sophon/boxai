---
title: Model, group và quota
summary: Model ID, group truy cập và hạn mức còn lại phối hợp thế nào trên BoxAI.
section: concepts
order: 10
audience: [user, developer]
updated: 2026-08-04
status: published
---

## Model

**Model ID** là chuỗi chính xác bạn gửi trong API. Tìm ID trên [Model Hub](/pricing). Các nhà cung cấp có thể trông giống nhau về thương hiệu nhưng dùng ID khác trên gateway.

## Group

**Group** quyết định model và mức giá tài khoản được dùng. Nếu model hiện trên hub công khai nhưng gọi API bị lỗi quyền, group của bạn có thể chưa gồm model đó.

## Quota

**Quota** là ngân sách usage còn lại. Gọi có thể thất bại khi không đủ quota. Nạp qua [Thanh toán và nạp tiền](/docs/console/billing-topup) và xem tiêu thụ trong [Nhật ký sử dụng](/docs/console/usage-logs).

## Checklist thực tế

- Sao chép model ID từ hub, không nhớ mơ hồ
- Kiểm tra quyền group khi gỡ lỗi 403
- Theo dõi quota trước khi chạy tải lớn

## Tiếp theo

- [Model Hub](/docs/console/model-hub)
- [Lỗi và rate limit](/docs/api/errors)
