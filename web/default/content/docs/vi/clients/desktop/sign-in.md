---
title: Đăng nhập BoxAI Desktop
summary: Cho phép ứng dụng sử dụng tài khoản BoxAI và bảo vệ thông tin truy cập của bạn.
section: clients
order: 12
audience: [user]
updated: 2026-10-02
status: published
---

## Chuẩn bị

[Cài Desktop](/docs/clients/desktop/install) và tạo tài khoản tại [you-box.com](https://you-box.com) nếu bạn chưa có. Dùng đúng tài khoản có số dư hoặc gói đăng ký mà bạn muốn sử dụng.

## Cho phép ứng dụng truy cập

1. Mở BoxAI Desktop và bắt đầu đăng nhập BoxAI.
2. Trong trình duyệt, kiểm tra trang tài khoản nằm trên **you-box.com**, rồi đăng nhập bằng phương thức BoxAI bạn thường dùng.
3. Đọc và chấp thuận yêu cầu cấp quyền cho Desktop. Không chấp thuận yêu cầu mà bạn không chủ động bắt đầu.
4. Quay lại ứng dụng, chờ trạng thái đã đăng nhập rồi mới chọn mô hình.

<!-- Screenshot: /desktop-screenshots/docs/login.webp — màn hình đăng nhập BoxAI thực tế, không có thông tin cá nhân thật. -->

Bạn không cần tạo tài khoản nhà cung cấp OpenAI, Anthropic hay Google, dán API key của họ hoặc cấu hình địa chỉ mô hình riêng. Các yêu cầu tới mô hình tích hợp đều đi qua BoxAI.

## Kiểm tra tài khoản trước khi làm việc

Xác nhận tài khoản hiển thị là tài khoản bạn định dùng. Sau đó [chọn mô hình](/docs/clients/desktop/models-and-billing) và gửi một yêu cầu thử ngắn. Đăng nhập thành công trên website chưa có nghĩa là Desktop đã được cấp quyền xong.

## Nếu đăng nhập chưa hoàn tất

- Giữ ứng dụng mở trong khi cấp quyền trên trình duyệt.
- Nếu đã hủy hoặc yêu cầu hết hạn, bắt đầu lại từ Desktop thay vì dùng tab cấp quyền cũ.
- Nếu trình duyệt đang đăng nhập tài khoản khác, đổi tài khoản trên website trước khi cấp quyền lại.
- Kiểm tra kết nối internet, ngày và giờ trên máy. Không tắt xác minh TLS để xử lý lỗi kết nối.
- Nếu đã cấp quyền nhưng không thấy mô hình, xem [mô hình và tính phí](/docs/clients/desktop/models-and-billing).

## Bảo vệ quyền truy cập

Dùng chức năng đăng xuất của ứng dụng trước khi giao máy cho người khác. Hãy coi dữ liệu cấp quyền lưu trên máy là thông tin bí mật: không gửi cho bộ phận hỗ trợ và không đưa vào bản sao lưu công khai. Đăng xuất website và đăng xuất Desktop là hai thao tác riêng biệt.

Nếu nghi ngờ thông tin xác thực bị lộ, kiểm tra và thu hồi quyền hoặc khóa liên quan trên website BoxAI; đừng cho rằng đăng xuất trên máy sẽ tự động thu hồi quyền phía máy chủ. Xem [bảo mật API key](/docs/console/api-keys).

Tiếp theo: [Mô hình và tính phí](/docs/clients/desktop/models-and-billing) · [Khắc phục sự cố](/docs/clients/desktop/troubleshooting).
