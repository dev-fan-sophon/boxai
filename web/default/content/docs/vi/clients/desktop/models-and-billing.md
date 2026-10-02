---
title: Chọn mô hình và hiểu cách tính phí
summary: Chọn mô hình BoxAI khả dụng, thử một yêu cầu nhỏ và kiểm tra mức sử dụng thực tế trên website.
section: clients
order: 13
audience: [user]
updated: 2026-10-02
status: published
---

## Chọn mô hình

1. [Đăng nhập](/docs/clients/desktop/sign-in), rồi mở dự án hoặc phiên làm việc.
2. Mở bộ chọn mô hình trong ô soạn tin và chọn một mô hình khả dụng.
3. Nếu mô hình hỗ trợ, chọn mức suy luận phù hợp với tác vụ. Suy luận nhiều hơn có thể mất thêm thời gian và dùng thêm token.
4. Gửi một yêu cầu ngắn, xác nhận đã nhận được câu trả lời rồi mới bắt đầu tác vụ lớn.

<!-- Screenshot: /desktop-screenshots/docs/models.webp — danh sách mô hình BoxAI thực tế và mô hình đang được chọn. -->

Danh sách mô hình do BoxAI cung cấp, tùy thuộc quyền truy cập của tài khoản và khả năng tương thích với trợ lý trên Desktop. Không phải mọi mô hình tạo ảnh, video hoặc âm thanh trong danh mục website đều xuất hiện ở bộ chọn hội thoại. Đừng sao chép mã mô hình từ hướng dẫn của nhà cung cấp khác hoặc thêm nhà cung cấp riêng để xử lý việc thiếu mô hình.

## Những gì được tính phí

Yêu cầu tới mô hình áp dụng giá, nhóm truy cập và hạn mức của tài khoản BoxAI. Xem [Danh mục mô hình](/pricing) để biết giá hiện tại và [Thanh toán](/billing) để kiểm tra số dư, gói đăng ký. Số token hoặc chi phí ước tính trong ứng dụng không phải hóa đơn: hãy đối chiếu mức tiêu thụ thực tế tại [nhật ký sử dụng](/docs/console/usage-logs) trên website.

Một chỉ dẫn có thể tạo nhiều yêu cầu tới mô hình khi trợ lý đọc tệp, gọi công cụ rồi tiếp tục xử lý. Trợ lý phụ, lần thử lại và hội thoại dài có thể làm tăng mức sử dụng. Dừng tác vụ không hoàn lại các yêu cầu mô hình đã xử lý. Tác vụ chưa hoàn thành vẫn có thể có những yêu cầu đã được tính phí.

Dịch vụ bên ngoài do plugin hoặc MCP sử dụng có thể cần tài khoản riêng và tính phí ngoài BoxAI. Hãy đọc điều khoản của dịch vụ trước khi bật.

## Giữ tác vụ đầu tiên gọn

- Chọn mô hình có mức giá phù hợp cho nhiều lượt xử lý kèm công cụ.
- Yêu cầu một kết quả có giới hạn rõ ràng, thay vì một mục tiêu tự chạy không có điểm dừng.
- Dùng thư mục nhỏ, tránh đính kèm tệp lớn không cần thiết.
- Kiểm tra mức sử dụng sau lần thử rồi mới cấp quyền rộng hơn.

## Nếu mô hình không hoạt động

| Hiện tượng                                      | Cách kiểm tra                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Không có mô hình                                | Xác nhận Desktop đã đăng nhập và tài khoản có quyền truy cập; khởi động lại ứng dụng để làm mới rồi thử lại. |
| Không đủ số dư hoặc hạn mức                     | Kiểm tra số dư, hạn mức gói đăng ký và các giới hạn áp dụng trên website; nạp thêm nếu cần.                  |
| Mô hình không khả dụng hoặc bị từ chối truy cập | Chọn mô hình khác có trong danh sách; kiểm tra quyền của tài khoản/nhóm thay vì tự đặt địa chỉ API.          |
| Bị giới hạn tần suất                            | Chờ trước khi thử lại; tránh gửi lặp liên tục cùng một tác vụ.                                               |
| Phản hồi bị gián đoạn                           | Kiểm tra hội thoại và các tệp đã thay đổi trước khi tiếp tục, để không lặp lại thao tác đã hoàn thành.       |

Tiếp theo: [Dự án và phiên làm việc](/docs/clients/desktop/projects-and-sessions) · [Thanh toán và nạp tiền](/docs/console/billing-topup).
