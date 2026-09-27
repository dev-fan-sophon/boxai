---
title: Cài đặt BoxAI Connect
summary: Cài bản macOS Apple silicon hoặc Windows x64 một cách an toàn.
section: clients
order: 31
audience: [user]
updated: 2026-09-27
status: published
---

Luôn lấy trình cài đặt hiện tại từ [BoxAI Connect](/connect), không tải qua trang bên thứ ba. Liên kết trên trang này theo bản phát hành hiện tại; bạn không cần URL chứa số phiên bản cụ thể.

## Chọn nền tảng

| Nền tảng | Gói cài đặt                    | Yêu cầu và chữ ký                                              |
| -------- | ------------------------------ | -------------------------------------------------------------- |
| macOS    | `.dmg` cho Apple silicon arm64 | macOS 11 trở lên; đã ký Developer ID và được Apple công chứng. |
| Windows  | Trình cài `.exe` x64           | Windows 10 trở lên; hiện chưa có chữ ký số.                    |

Đây không phải các bản dành cho Mac Intel hoặc Windows ARM.

## macOS

1. Tải và mở DMG arm64.
2. Kéo **BoxAI Connect** vào **Applications**.
3. Mở ứng dụng từ Applications, thay vì chạy ngay trên ổ đĩa DMG đang gắn.
4. Nếu không thấy cửa sổ, tìm biểu tượng trên thanh menu và mở Connect từ menu của biểu tượng đó.

Nếu macOS chặn tệp hoặc báo tệp bị hỏng, hãy dừng lại và tải lại từ trang chính thức. Không xóa thuộc tính cách ly của tệp hoặc tắt Gatekeeper. Nếu vẫn gặp cảnh báo, ghi lại nguyên văn thông báo và liên hệ hỗ trợ.

## Windows

1. Tải trình cài EXE x64 từ trang chính thức.
2. Đọc cảnh báo của Windows trước khi quyết định tiếp tục. Trình cài hiện chưa có chữ ký số nên có thể xuất hiện cảnh báo về nhà phát hành hoặc độ tin cậy; điều đó không chứng minh tệp an toàn.
3. Chạy trình cài và chọn thư mục. Ứng dụng được cài cho người dùng hiện tại, mặc định tại `%LOCALAPPDATA%\Programs\BoxAI Connect`.
4. Mở **BoxAI Connect** từ menu Start. Nếu không thấy cửa sổ, kiểm tra vùng thông báo, kể cả các biểu tượng bị ẩn.

Nếu phần mềm bảo mật hoặc chính sách của tổ chức chặn cài đặt, hãy dừng lại và liên hệ quản trị viên hoặc hỗ trợ. Không tắt Defender, SmartScreen hay các biện pháp bảo vệ khác.

## Kiểm tra kết quả và cập nhật

Bạn cần mở được Connect từ biểu tượng trên thanh menu hoặc khay hệ thống, rồi thấy màn hình đăng nhập hoặc sáu thẻ nếu đã cấp quyền. Đóng cửa sổ chỉ ẩn ứng dụng; **Quit BoxAI Connect** thoát hẳn và ngừng phục vụ agent.

Dùng [trang Connect](/connect) để kiểm tra bản phát hành hiện tại và tải trình cài thay thế. Hãy chờ các yêu cầu agent đang chạy hoàn tất trước khi thoát hoặc cập nhật. Không mặc định rằng gỡ cài đặt sẽ xóa thông tin xác thực hoặc hoàn tác cấu hình agent.

Tiếp theo: [đăng nhập](/docs/clients/connect/sign-in). Nếu không thấy cửa sổ hoặc yêu cầu bị chặn, xem [xử lý sự cố](/docs/clients/connect/account-and-troubleshooting).
