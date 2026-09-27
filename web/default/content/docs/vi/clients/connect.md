---
title: BoxAI Connect
summary: Kết nối các trợ lý lập trình trên máy với BoxAI qua cổng API cục bộ.
section: clients
order: 30
audience: [user]
updated: 2026-09-27
status: published
---

BoxAI Connect là ứng dụng đồng hành với các trợ lý lập trình (agent) mà bạn cài riêng. Ứng dụng cấu hình agent để gửi yêu cầu qua một cổng API cục bộ, rồi chuyển tiếp đến BoxAI bằng tài khoản bạn đã cấp quyền. Hãy giữ Connect chạy trong khi agent sử dụng kết nối này.

Tài liệu này dành cho **BoxAI Connect 1.1.1**, dựa trên **Magpie v0.1.185**. Đây không phải [BoxAI Desktop](/docs/clients/desktop). Hướng dẫn thêm nhà cung cấp bên thứ ba của Magpie không áp dụng: phiên bản này chỉ dùng BoxAI và yêu cầu đăng nhập qua website.

## Bắt đầu

1. [Cài Connect](/docs/clients/connect/install) từ [trang tải Connect](/connect).
2. [Đăng nhập qua trình duyệt](/docs/clients/connect/sign-in).
3. [Chọn agent và mô hình](/docs/clients/connect/agents-and-models).
4. Gửi một yêu cầu ngắn trong agent rồi kiểm tra [Gateway và Routing](/docs/clients/connect/gateway-and-routing).

## Sáu thẻ chính

Tên tiếng Anh dưới đây giúp bạn đối chiếu với giao diện ứng dụng.

| Thẻ | Công dụng |
| --- | --- |
| Agents | Chọn mô hình và các thiết lập được hỗ trợ cho agent phát hiện trên máy. |
| Gateway | Xem thông tin kết nối, ID mô hình và các yêu cầu gần đây. |
| Routing | Theo dõi quyết định định tuyến trực tiếp của cổng API. |
| Usage | Xem số dư ví, tổng mức sử dụng và hạn mức gói của toàn tài khoản BoxAI. |
| Library | Quản lý hướng dẫn, tài nguyên MCP và kỹ năng theo cơ chế gốc của Magpie. |
| Account | Kiểm tra danh tính, mở trang quản lý tài khoản và đăng xuất. |

Không có thẻ Providers. Library giữ trải nghiệm tài nguyên gốc của Magpie, không phải danh mục chỉ gồm nội dung chính thức của BoxAI. Hãy xem xét tài nguyên bên thứ ba trước khi bật.

## Những giới hạn cần biết

- Bộ chọn mô hình dành cho hội thoại và lập trình. Mô hình hỗ trợ thị giác có thể nhận ảnh đầu vào, nhưng đây không phải bộ chọn mô hình tạo ảnh, video hoặc âm thanh.
- Usage là mức sử dụng toàn tài khoản do máy chủ cung cấp theo đơn vị quota, không phải hóa đơn từng agent hay chi phí ước tính trên máy.
- Cấp quyền qua trình duyệt tạo một khóa API thông thường trong [trang khóa API](/keys). Khóa thật được lưu trong tệp `auth.json` riêng tư trên máy, không phải Keychain hay cấu hình agent.
- Đăng xuất trên máy không thu hồi khóa trên website. Xem [tài khoản và xử lý sự cố](/docs/clients/connect/account-and-troubleshooting).

Xem mô hình và giá tại [danh mục mô hình](/pricing). Quản lý số dư và gói tại [Thanh toán](/billing), hoặc đọc [tổng quan API](/docs/api/overview) nếu tích hợp trực tiếp.
