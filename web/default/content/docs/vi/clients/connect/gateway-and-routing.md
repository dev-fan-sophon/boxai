---
title: Gateway và Routing
summary: Dùng thông tin kết nối cục bộ và kiểm tra yêu cầu mà không để lộ khóa BoxAI thật.
section: clients
order: 34
audience: [user]
updated: 2026-09-27
status: published
---

## Giữ cổng API hoạt động

Agent đã cấu hình cho Connect gửi yêu cầu đến cổng API cục bộ; cổng này dùng khóa BoxAI riêng tư của bạn để kết nối máy chủ. Ứng dụng phải tiếp tục chạy và đã đăng nhập. Đóng cửa sổ chỉ ẩn ứng dụng; thoát hẳn sẽ dừng cổng API. Máy ngủ hoặc mất mạng cũng có thể làm gián đoạn yêu cầu.

## Dùng thông tin kết nối đang hiển thị

Với agent được hỗ trợ, ưu tiên [thẻ Agents](/docs/clients/connect/agents-and-models). Nếu cấu hình ứng dụng khách thủ công:

1. Mở **Gateway** và kiểm tra trạng thái.
2. Dùng thông tin kết nối cho giao thức mà ứng dụng khách hỗ trợ. Sao chép **Base URL** đang hiển thị thay vì đoán cổng cố định hoặc nối thêm đường dẫn API.
3. Dùng giá trị thay thế khóa API cục bộ đang hiển thị, chẳng hạn `boxai`, cùng một ID mô hình trong danh sách Gateway. Sao chép đầy đủ ID thay vì đoán tiền tố.
4. Gửi một yêu cầu ngắn và kiểm tra **Recent calls** (các yêu cầu gần đây).

Giá trị thay thế cục bộ **không phải khóa BoxAI bí mật** và không cấp quyền gọi trực tiếp đến `you-box.com`. Không thay nó bằng khóa thật hoặc lấy khóa từ `auth.json`. Thông tin kết nối cục bộ dành cho máy này; không công khai cổng API ra internet hoặc mở cổng tường lửa để sửa lỗi kết nối.

## Kiểm tra định tuyến

**Routing** hiển thị quyết định định tuyến khi cổng API xử lý yêu cầu. Kết hợp với danh sách yêu cầu gần đây của Gateway để biết yêu cầu được chuyển đến đâu và tìm lỗi. Đây là thông tin định tuyến cục bộ, không phải bằng chứng về khoản phí cuối cùng và không phải cách thêm nhà cung cấp bên thứ ba vào phiên bản chỉ dùng BoxAI này.

**Kiểm tra kết quả:** ứng dụng khách nhận được câu trả lời, Gateway ghi nhận yêu cầu và Routing phản ánh yêu cầu đi qua cổng API. Nếu không có gì xuất hiện, trước tiên hãy kiểm tra ứng dụng khách có đang dùng Base URL của Connect thay vì địa chỉ nhà cung cấp cũ hay không.

Trước khi chia sẻ ảnh chụp màn hình, dùng chức năng ẩn email của Routing rồi kiểm tra xem còn thông tin cá nhân nào khác không. Không chia sẻ khóa, URL gọi lại khi cấp quyền hoặc nội dung yêu cầu riêng tư.

## Nếu yêu cầu thất bại

- **Bị từ chối kết nối:** xác nhận Connect đang chạy, rồi so sánh địa chỉ của ứng dụng khách với thông tin Gateway hiện tại.
- **Bị từ chối xác thực:** kiểm tra [trang khóa API](/keys) và [đăng nhập lại](/docs/clients/connect/sign-in) nếu khóa đã bị thu hồi.
- **Lỗi mạng hoặc máy chủ:** kiểm tra truy cập đến `you-box.com` và thử lại khi mạng ổn định. Không tắt kiểm tra TLS hay phần mềm bảo mật.
- **Vấn đề số dư hoặc hạn mức:** kiểm tra [Thanh toán](/billing); định tuyến cục bộ không tạo thêm quota.

Xem [tài khoản và xử lý sự cố](/docs/clients/connect/account-and-troubleshooting) để biết thêm cách khắc phục và hiểu số liệu Usage.
