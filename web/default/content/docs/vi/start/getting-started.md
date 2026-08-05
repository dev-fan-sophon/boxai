---
title: Bắt đầu
summary: Tạo API key, chọn mô hình và gửi request gateway đầu tiên trên you-box.com.
section: start
order: 20
audience: [user, developer]
updated: 2026-08-04
status: published
checklist: [Tạo tài khoản, Tạo API key, Chọn model ID, Gửi request thử]
---

## Điều kiện trước
![Getting started guide](/docs/screenshots/start/getting-started.en.webp "BoxAI getting started guide on you-box.com")


- Tài khoản BoxAI tại [you-box.com](https://you-box.com)
- Đủ hạn mức cho một lần gọi thử (nạp thêm nếu cần — xem [Thanh toán và nạp tiền](/docs/console/billing-topup))

## Ba bước lên production

:::steps
1. Tạo và lưu an toàn một [API key](/docs/console/api-keys).
2. Chọn đúng model ID mà nhóm của bạn được phép dùng trên [Model Hub](/docs/console/model-hub).
3. Gửi request tới gateway BoxAI và theo dõi mã trạng thái cùng [usage](/docs/console/usage-logs).
:::

## Gửi request đầu tiên

Trên BoxAI, dùng base URL production `https://you-box.com`. Tạo key trong dashboard, rồi sao chép đúng model ID từ Model Hub.

```bash
curl "https://you-box.com/v1/chat/completions" \
  -H "Authorization: Bearer $BOXAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"YOUR_MODEL_ID","messages":[{"role":"user","content":"Hello"}]}'
```

Muốn làm trên trình duyệt trước? Làm theo [Request đầu tiên](/docs/start/first-request) trong Playground, rồi chuyển sang mẫu API ở trên cho production.

## Bảo mật thông tin đăng nhập

:::callout type="warning"
Không bao giờ để lộ API key trong mã trình duyệt, kho công khai, ảnh chụp màn hình hoặc log. Gọi gateway từ máy chủ tin cậy và xoay key ngay nếu bị lộ.
:::

## Kiểm tra thành công

- API trả HTTP **200** với payload `choices` (hoặc tương đương theo protocol).
- Usage xuất hiện trong [Nhật ký sử dụng](/docs/console/usage-logs) sau một lúc ngắn.

## Tiếp theo

- [Request đầu tiên (Playground + API)](/docs/start/first-request)
- [Tổng quan API](/docs/api/overview)
- [Streaming](/docs/api/streaming)
