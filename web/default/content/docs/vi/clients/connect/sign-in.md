---
title: Đăng nhập BoxAI Connect
summary: Cấp quyền cho Connect qua trình duyệt và hiểu cách lưu khóa API trên máy.
section: clients
order: 32
audience: [user]
updated: 2026-09-27
status: published
---

## Cấp quyền trên cùng máy tính

1. Mở Connect và chọn **Sign in with BoxAI** (đăng nhập bằng BoxAI).
2. Trong trình duyệt, kiểm tra website cấp quyền là `https://you-box.com`. Đăng nhập đúng tài khoản BoxAI muốn sử dụng và chấp thuận cấp quyền.
3. Hoàn tất trên trình duyệt của chính máy tính đó. Connect nhận kết quả qua địa chỉ gọi lại cục bộ tạm thời; không chuyển liên kết cấp quyền sang thiết bị khác hoặc chia sẻ liên kết.
4. Quay lại Connect khi trình duyệt thông báo có thể đóng cửa sổ. Mở **Account** và kiểm tra danh tính trước khi cấu hình agent.

Quy trình hết hạn sau khoảng **ba phút**. Nếu bị kẹt, chọn **Cancel** (hủy) rồi bắt đầu lại. Nếu đã hết hạn, chọn **Retry** (thử lại) và cấp quyền mới, không dùng lại thẻ trình duyệt cũ.

## Việc cấp quyền tạo ra gì?

Cấp quyền tạo một khóa API BoxAI thông thường, hiển thị trong [trang khóa API](/keys) trên website. Đây không phải phiên đăng nhập Desktop hay cơ chế dùng refresh token. Bạn không cần dán khóa nhà cung cấp vào Connect; tự thêm khóa cũng không bỏ qua được màn hình đăng nhập.

Connect lưu khóa tại `~/.config/magpie/auth.json`, bên trong thư mục người dùng của hệ điều hành. Tên thư mục `magpie` được giữ từ dự án gốc. Đây là JSON riêng tư được bảo vệ bằng quyền truy cập tệp, **không phải Keychain hay kho mật khẩu được mã hóa**. Không chia sẻ tệp này, đưa vào kho mã nguồn hoặc đính kèm yêu cầu hỗ trợ.

Khóa thật không được chép vào cấu hình agent hay bản sao lưu nhà cung cấp. Giá trị cục bộ như `boxai` chỉ là giá trị thay thế để dùng với cổng API, không phải khóa trên website.

## Kiểm tra kết quả

- Màn hình đăng nhập được thay bằng sáu thẻ chính.
- **Account** hiển thị đúng tài khoản khi yêu cầu lấy thông tin tài khoản thành công.
- [Trang khóa API](/keys) có khóa được tạo khi cấp quyền. Bạn không cần hiện hay sao chép giá trị bí mật của khóa để kiểm tra.

Thông tin cấp quyền đã lưu cho phép Connect mở mà không kiểm tra dịch vụ tài khoản ở mỗi lần khởi động. Điều đó không bảo đảm khóa vẫn hợp lệ: danh sách mô hình, mức sử dụng và yêu cầu đến máy chủ vẫn cần mạng và khóa được chấp nhận.

## Đăng xuất khác với thu hồi khóa

**Sign out** (đăng xuất) trong Account xóa khóa đã lưu trên máy và đưa bạn về màn hình đăng nhập. Thao tác này **không** thu hồi khóa trên website hoặc khôi phục thiết lập agent trước đó. Để vô hiệu hóa khóa trên máy chủ, thu hồi hoặc xóa mục tương ứng trong [trang khóa API](/keys). Các bản sao khác của cùng khóa đó cũng sẽ mất quyền truy cập.

Tiếp theo: [agent và mô hình](/docs/clients/connect/agents-and-models). Nếu lỗi mạng hoặc khóa đã bị thu hồi, xem [xử lý sự cố](/docs/clients/connect/account-and-troubleshooting).
