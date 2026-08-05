---
title: Thanh toán và nạp tiền
summary: Hiểu số dư, nạp qua các kênh được hỗ trợ (ưu tiên Việt Nam) và giữ usage trong hạn mức.
section: console
order: 30
audience: [user]
updated: 2026-08-04
status: published
---

## Điều kiện trước

- Đã đăng nhập
- Có quyền vào khu vực billing / nạp tiền trong console

## Kiểm tra số dư

Mở phần billing hoặc ví trong console để xem số dư hiện tại và gói đăng ký (nếu có). Usage trừ theo giá trên [Model Hub](/pricing).

## Nạp tiền
![Billing and top-up](/doc-assets/screenshots/console/billing-topup.en.webp "1. Open Billing → choose amount and payment method")


:::steps
1. Mở top-up / billing trong console.
2. Chọn số tiền và phương thức thanh toán có sẵn trong khu vực của bạn.
3. Hoàn tất thanh toán. Các kênh ưu tiên Việt Nam (ví dụ Waffo và phương thức địa phương khi được bật) sẽ hiện nếu đã cấu hình cho tài khoản.
4. Đợi số dư cập nhật; giữ mã giao dịch nếu cần xét duyệt.
:::

:::callout type="info"
Phương thức thanh toán phụ thuộc cấu hình và khu vực. Nếu thiếu một phương thức, thử tùy chọn khác hoặc liên hệ hỗ trợ với email tài khoản — không gửi API key.
:::

## Sau khi thanh toán

- Xác nhận số dư mới trong console.
- Chạy một [request thử](/docs/start/first-request) nếu trước đó bị chặn vì thiếu quota.
- Xem [Nhật ký sử dụng](/docs/console/usage-logs) để theo dõi tiêu thụ.

## Sự cố thường gặp

| Vấn đề | Việc cần làm |
|--------|----------------|
| Số dư chưa cập nhật | Đợi, làm mới; giữ mã ngân hàng/Waffo cho hàng đợi review |
| Thanh toán chờ duyệt | Tải bằng chứng theo hướng dẫn trong console nếu được yêu cầu |
| Vẫn 403 khi gọi | Kiểm tra quyền model theo group, không chỉ số dư |

## Tiếp theo

- [Nhật ký sử dụng](/docs/console/usage-logs)
- [Bắt đầu](/docs/start/getting-started)
