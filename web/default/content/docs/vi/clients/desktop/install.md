---
title: Cài đặt và mở BoxAI Desktop
summary: Tải đúng bộ cài và xử lý an toàn cảnh báo bảo mật khi mở lần đầu trên macOS hoặc Windows.
section: clients
order: 11
audience: [user]
updated: 2026-10-02
status: published
---

## Trước khi tải

Mở [trang BoxAI Desktop](/agents) trên `you-box.com`. Tệp chính thức được phân phối qua `dl.you-box.com`; không tải từ trang giả mạo trong quảng cáo tìm kiếm hoặc dùng bộ cài do người lạ gửi.

Chọn **macOS Apple silicon (arm64)** cho máy Mac dùng chip dòng M, hoặc **Windows x64** cho máy tính Intel/AMD 64 bit. Đây là hai bộ cài khác nhau. Kiểm tra yêu cầu hệ thống của bản phát hành trước khi tải; Mac dùng chip Intel và thiết bị Windows ARM không phải cùng nền tảng này. Người dùng bộ cài không cần cài thêm Python, Node.js hay Rust.

Bạn cần kết nối internet, tài khoản BoxAI và số dư hoặc hạn mức gói đăng ký đủ cho các yêu cầu tới mô hình. Cài ứng dụng không đồng nghĩa với việc được sử dụng mô hình không giới hạn.

## Cài trên macOS

:::steps

1. Mở tệp `.dmg` vừa tải.
2. Kéo **BoxAI Desktop** vào **Applications** (Ứng dụng).
3. Tháo ảnh đĩa, rồi mở BoxAI Desktop từ Applications, không mở trực tiếp trong DMG.
4. Tiếp tục [đăng nhập](/docs/clients/desktop/sign-in).

:::

### Nếu macOS chặn bản chưa được ký

Nếu macOS báo không xác minh được nhà phát triển hoặc Apple không thể xác minh ứng dụng, trước tiên hãy kiểm tra bạn đã tải đúng bản chính thức. Sau khi thử mở ứng dụng, vào **System Settings → Privacy & Security** (Cài đặt hệ thống → Quyền riêng tư & Bảo mật), tìm thông báo ứng dụng bị chặn và chọn **Open Anyway** (Vẫn mở) nếu có. Kiểm tra tên ứng dụng và xác thực khi macOS yêu cầu.

Chỉ cho phép ngoại lệ đối với đúng tệp đã xác minh nguồn tải. Không tắt Gatekeeper trên toàn hệ thống, không gỡ dấu cách ly cho cả thư mục và không bỏ qua cảnh báo mã độc. Nếu macOS báo ứng dụng sẽ gây hại cho máy tính, hãy dừng lại và gửi nguyên văn thông báo lỗi. Nếu máy do cơ quan quản lý không cho phép ngoại lệ, hãy liên hệ quản trị viên.

## Cài trên Windows

:::steps

1. Chạy tệp cài đặt x64 `.exe` đã tải và làm theo trình hướng dẫn.
2. Kiểm tra tên tệp và nguồn tải trước khi cấp quyền cài đặt nếu được yêu cầu.
3. Mở **BoxAI Desktop** từ menu Start.
4. Tiếp tục [đăng nhập](/docs/clients/desktop/sign-in).

:::

### Nếu SmartScreen cảnh báo ứng dụng chưa được ký

Bộ cài chưa được ký hoặc chưa có đủ độ tin cậy có thể hiện **Windows protected your PC**. Nếu đã xác minh đây là bản tải chính thức, chọn **More info** (Thông tin thêm), kiểm tra tên tệp rồi chọn **Run anyway** (Vẫn chạy) nếu có. “Unknown publisher” có thể xuất hiện với bản chưa được ký, nhưng không chứng minh tệp an toàn.

Không tắt Microsoft Defender hoặc bỏ qua cảnh báo phát hiện mã độc cụ thể. Chính sách của cơ quan có thể ẩn tùy chọn tiếp tục; hãy hỏi quản trị viên thay vì thay đổi chính sách bảo mật.

## Kiểm tra kết quả

Ứng dụng mở tới màn hình đăng nhập BoxAI hoặc không gian làm việc nếu bạn đã đăng nhập. Nếu chưa mở được, xem [khắc phục lỗi khởi động](/docs/clients/desktop/troubleshooting) và ghi lại phiên bản hệ điều hành, kiến trúc máy cùng thông báo lỗi chính xác. Đừng xóa dữ liệu ứng dụng ngay từ đầu.

Tiếp theo: [Đăng nhập](/docs/clients/desktop/sign-in) · [Cập nhật về sau](/docs/clients/desktop/updates).
