---
title: Tài khoản, mức sử dụng và xử lý sự cố
summary: Hiểu mức sử dụng toàn tài khoản, quản lý quyền truy cập và xử lý lỗi Connect an toàn.
section: clients
order: 35
audience: [user]
updated: 2026-09-27
status: published
---

## Account và Usage

**Account** hiển thị danh tính và thông tin cấp quyền, kèm liên kết nạp tiền, quản lý gói và bảo mật tài khoản. Kiểm tra đúng tài khoản trước khi gửi yêu cầu. Dùng **Reverify authorization** (kiểm tra lại quyền truy cập) khi cần kiểm tra mới và **Sign out** (đăng xuất) để xóa khóa trên máy.

**Usage** lấy dữ liệu từ dịch vụ tài khoản BoxAI: số dư ví, tổng mức sử dụng từ trước đến nay và các bộ đếm của gói được hiển thị theo **đơn vị quota gốc**. Đây là số liệu toàn tài khoản, gồm cả hoạt động ngoài bản Connect trên máy này. Chúng không phải số tiền, thống kê riêng từng agent hay chi phí ước tính cục bộ. Hoạt động Gateway và Routing hữu ích để tìm lỗi, không phải bản ghi thanh toán.

Dùng [Thanh toán](/billing) để quản lý số dư và gói, [trang khóa API](/keys) để quản lý khóa, [bảo mật tài khoản](/profile) cho tài khoản website và [danh mục mô hình](/pricing) để xem giá và mô hình có sẵn.

## Các vấn đề thường gặp

### Ứng dụng đang chạy nhưng không thấy cửa sổ

Kiểm tra thanh menu macOS hoặc vùng thông báo Windows, kể cả biểu tượng bị ẩn. Chọn **Open BoxAI Connect** trong menu của biểu tượng. Đóng cửa sổ thường chỉ ẩn ứng dụng chứ không thoát. Nếu không có biểu tượng, mở ứng dụng đã cài một lần; không khởi chạy nhiều bản để khắc phục.

**Kiểm tra:** màn hình đăng nhập hoặc sáu thẻ xuất hiện. Giữ ứng dụng chạy để agent gửi yêu cầu.

### Cấp quyền qua trình duyệt bị kẹt hoặc hết hạn

Trình duyệt phải gọi lại Connect trên cùng máy tính trong khoảng ba phút. Giữ Connect mở, xác nhận website cấp quyền là `you-box.com` và hoàn tất chấp thuận trên trình duyệt. Dùng **Cancel** khi quy trình còn chờ hoặc **Retry** sau lỗi, rồi bắt đầu quy trình mới. Không dùng lại URL gọi lại đã hết hạn hoặc gửi URL đó cho hỗ trợ.

Nếu trình duyệt do tổ chức quản lý, proxy hoặc tường lửa chặn kết nối gọi lại cục bộ, hãy nhờ quản trị viên kiểm tra kết nối cụ thể đó. Không tắt các biện pháp bảo mật.

**Kiểm tra:** Connect thoát màn hình đăng nhập và Account hiển thị đúng danh tính.

### Không tải được Account, Usage hoặc danh sách mô hình

Kiểm tra trình duyệt có mở được `https://you-box.com` không và mạng hoặc proxy có báo lỗi không. Thử lại khi kết nối ổn định; làm mới danh sách mô hình nếu cần. Dịch vụ tài khoản tạm thời gián đoạn không tự chứng minh khóa đã lưu bị xóa. Connect mở bằng khóa cục bộ, còn các màn hình lấy dữ liệu từ máy chủ cần yêu cầu API thành công.

**Kiểm tra:** Account hoặc Usage tải được dữ liệu mới mà không báo lỗi. Không hiểu dữ liệu bị thiếu là số dư bằng không.

### Khóa đã bị thu hồi, xóa hoặc từ chối

Kiểm tra mục tương ứng trong [trang khóa API](/keys) trên website. Dùng **Reverify authorization** nếu có. Nếu khóa không còn hợp lệ, đăng xuất trên máy rồi [cấp quyền lại](/docs/clients/connect/sign-in) bằng đúng tài khoản. Việc cấp quyền tạo khóa thông thường mới; không chép khóa cũ vào thiết lập agent.

Việc thu hồi có hiệu lực khi yêu cầu đến máy chủ; cửa sổ vẫn đang mở không chứng minh bạn còn quyền truy cập. Đăng xuất chỉ xóa khóa trên máy. Nếu khóa bị lộ, cần thu hồi khóa trên website nữa.

**Kiểm tra:** Account tải được dữ liệu và một yêu cầu ngắn từ agent thành công. Đăng xuất hay gỡ cài đặt đều không bảo đảm khôi phục cấu hình agent trước đó.

### Thiếu mô hình tạo ảnh, video hoặc âm thanh

Điều này bình thường với mô hình tạo nội dung đa phương tiện: bộ chọn BoxAI trong Connect chỉ dành cho hội thoại. Mô hình trò chuyện nhận ảnh đầu vào vẫn có thể xuất hiện. Dùng [danh mục mô hình](/pricing) và [tài liệu API](/docs/api/overview) để chọn quy trình khác phù hợp. Nếu thiếu mô hình trò chuyện, kiểm tra quyền của khóa và làm mới danh sách thay vì bỏ qua bộ lọc.

### Agent không kết nối được

Làm theo [Gateway và Routing](/docs/clients/connect/gateway-and-routing): xác nhận Connect đang chạy và đã đăng nhập, so sánh Base URL và ID mô hình của ứng dụng khách với giá trị hiển thị, rồi kiểm tra yêu cầu gần đây. Với lỗi quota, xem [Thanh toán](/billing). Tránh thử lặp lại nhiều yêu cầu có tính phí trong lúc tìm lỗi.

## Gửi báo cáo lỗi hữu ích

Cung cấp hệ điều hành và kiến trúc máy, phiên bản Connect trong menu, bước bị lỗi, thời điểm gần đúng và nguyên văn thông báo lỗi sau khi xóa dữ liệu riêng tư. Nêu rõ lỗi xảy ra khi đăng nhập, xem tài khoản hay gửi yêu cầu từ agent. Không đính kèm `auth.json`, khóa API, URL gọi lại đầy đủ, nội dung yêu cầu riêng tư hoặc bản sao lưu cấu hình chưa được kiểm tra.

Quay lại [tổng quan Connect](/docs/clients/connect) hoặc [hướng dẫn cài đặt](/docs/clients/connect/install).
