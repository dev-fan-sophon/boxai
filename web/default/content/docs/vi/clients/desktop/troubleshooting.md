---
title: Khắc phục sự cố BoxAI Desktop
summary: Xử lý an toàn lỗi khởi động, đăng nhập, quyền mô hình và công cụ; chuẩn bị thông tin hữu ích khi cần hỗ trợ.
section: clients
order: 18
audience: [user]
updated: 2026-10-02
status: published
---

## Bắt đầu bằng kiểm tra nhỏ

Ghi lại phiên bản ứng dụng, hệ điều hành và kiến trúc CPU. Kiểm tra kết nối cùng thông tin phát hành chính thức. Thử một yêu cầu ngắn trong dự án mẫu với quyền Ask. Mỗi lần chỉ đổi một yếu tố; không đặt lại toàn bộ dữ liệu hoặc liên tục gửi lại tác vụ có thể đã sửa tệp.

## Chọn đúng hiện tượng

| Sự cố                                                      | Bước xử lý an toàn                                                                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Không mở được ứng dụng                                     | Kiểm tra kiến trúc bộ cài, hệ điều hành được hỗ trợ và [hướng dẫn bảo mật khi mở lần đầu](/docs/clients/desktop/install).            |
| Đã đăng nhập trình duyệt nhưng ứng dụng vẫn chưa đăng nhập | Giữ Desktop mở, hủy lần thử cũ và bắt đầu [cấp quyền](/docs/clients/desktop/sign-in) mới. Kiểm tra tài khoản đang dùng trên website. |
| Danh sách mô hình trống hoặc bị từ chối truy cập           | Kiểm tra đăng nhập và quyền tài khoản. Chọn mô hình có trong danh sách, không dùng mã sao chép từ nhà cung cấp khác.                 |
| Không đủ số dư/hạn mức                                     | Kiểm tra [Thanh toán](/billing), hạn mức gói đăng ký và [nhật ký sử dụng](/docs/console/usage-logs).                                 |
| Giới hạn tần suất hoặc lỗi cổng API tạm thời               | Chờ rồi thử lại một yêu cầu có giới hạn; tránh nhiều lần thử đồng thời. Xem [lỗi API](/docs/api/errors).                             |
| Trợ lý chờ mà không trả lời                                | Tìm [công cụ hoặc kế hoạch đang chờ duyệt](/docs/clients/desktop/tool-approvals) trong phiên hiện tại.                               |
| Trợ lý dùng nhầm tệp                                       | Dừng, kiểm tra dự án và phạm vi thư mục, rồi tạo phiên với chỉ dẫn rõ ràng.                                                          |
| Kết nối MCP lỗi                                            | Kiểm tra lệnh/URL, công cụ phụ thuộc và thông tin xác thực; chạy kiểm tra kết nối của máy chủ.                                       |
| Lỗi xuất hiện sau khi thêm phần mở rộng                    | Tắt tài nguyên đó và thử lại với ví dụ nhỏ nhất. Xem [phần mở rộng](/docs/clients/desktop/extensions).                               |
| Không áp dụng được bản cập nhật                            | Thoát ứng dụng và dùng bộ cài chính thức cùng nền tảng; xem [cập nhật](/docs/clients/desktop/updates).                               |

## Câu hỏi thường gặp

### Đây có phải BoxAI Connect không?

Không. Desktop cung cấp không gian làm việc của trợ lý. [Connect](/docs/clients/connect) kết nối các trợ lý khác đã cài trên máy với BoxAI. Bạn không cần Connect chỉ để dùng Desktop.

### Có thể dùng API key của nhà cung cấp riêng không?

Ứng dụng BoxAI dùng tài khoản BoxAI và gửi yêu cầu mô hình tích hợp qua BoxAI. Hướng dẫn pi-desktop gốc về cấu hình nhà cung cấp bên thứ ba không áp dụng cho ứng dụng này.

### Dự án có hoàn toàn ngoại tuyến không?

Tệp dự án nằm trên máy, nhưng yêu cầu tới mô hình cần kết nối mạng. Ngữ cảnh hội thoại, nội dung tệp liên quan và kết quả công cụ có thể được gửi ra ngoài để mô hình xử lý. Phần mở rộng có thể có quyền truy cập mạng và chính sách riêng tư riêng.

### Dừng tác vụ có hoàn tác thay đổi không?

Không. Hãy kiểm tra tệp và các thao tác bên ngoài đã hoàn thành. Dùng lịch sử quản lý phiên bản hoặc bản sao lưu nếu cần khôi phục. Đừng chạy lại toàn bộ tác vụ mà chưa kiểm tra sau khi mất kết nối.

### Có nên xóa thư mục dữ liệu không?

Không nên làm ngay từ đầu. Thư mục này có thể chứa phiên làm việc, cài đặt và thông tin xác thực. Giữ bản sao lưu và xin hướng dẫn khôi phục cụ thể. Không tải cả thư mục lên làm tệp đính kèm hỗ trợ.

## Gửi yêu cầu hỗ trợ an toàn

Cung cấp phiên bản, hệ điều hành/kiến trúc, kết quả mong đợi và thực tế, cách tái hiện ngắn nhất, mã mô hình, thời điểm kèm múi giờ và thông báo lỗi đã che dữ liệu nhạy cảm. Nếu có mã yêu cầu cổng API, hãy gửi kèm. Ảnh chỉ nên chứa lỗi liên quan, không có nội dung riêng tư, tệp, email hay thông tin xác thực.

Không gửi mật khẩu, API key, cookie trình duyệt, tệp cấp quyền trên máy hoặc toàn bộ dự án/cơ sở dữ liệu. Báo cáo lỗ hổng bảo mật qua kênh riêng, không đăng chi tiết khai thác vào issue công khai.

Tiếp theo: [Tổng quan Desktop](/docs/clients/desktop) · [Bảo mật API key](/docs/console/api-keys).
