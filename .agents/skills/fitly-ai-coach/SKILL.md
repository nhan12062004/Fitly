---
name: fitly-ai-coach
description: Rà soát hoặc phát triển hội thoại, nhận diện ý định, ngữ cảnh cá nhân và thay đổi kế hoạch trong AI Coach của Fitly.
---

# Fitly AI Coach

Áp dụng khi sửa hoặc đánh giá AI Coach. Bắt đầu từ `Backend/src/modules/ai-coach/aiCoachHandlers.ts`; các quy tắc nhận diện, trả lời và kiểm tra an toàn nằm trong `Backend/src/services/ai/`.

## Hiểu câu hỏi và ngữ cảnh

- Phân biệt hỏi xem lịch, hỏi lời khuyên, tạo lịch, đề xuất đổi lịch/món, ghi nhận tiến độ và tình huống chấn thương. Câu hỏi hoặc dự định không được ghi dữ liệu như một hành động đã xảy ra.
- Giải ngày được nhắc trong câu theo múi giờ Việt Nam. “Ngày mai” qua Chủ nhật phải đọc kế hoạch của tuần kế tiếp; “tuần sau” không được dùng tuần đang chọn trên giao diện.
- Dùng lịch sử hội thoại đã lưu làm nguồn chính; chỉ nối phần mới chưa lưu từ client, tránh lặp lại lượt chat. Câu hỏi ngắn nối tiếp phải giữ đúng chủ đề trước đó.
- Lấy hồ sơ, chỉ số cơ thể, sức khỏe, lịch tập/thực đơn của ngày được hỏi và tiến độ gần đây trước khi trả lời. Phân biệt kế hoạch với hoạt động đã hoàn thành; nói rõ khi thiếu dữ liệu.

## Trả lời và hành động

- Câu hỏi nhanh thường cần 40–70 từ; hướng dẫn kỹ thuật hoặc phân tích có thể dài hơn khi cần. Ưu tiên 1–3 dữ kiện cá nhân liên quan và bước làm cụ thể. Không suy ra tuổi, giới tính, mức kcal hoặc giá hiện tại khi nguồn dữ liệu thiếu.
- Trả lời hội thoại theo `AIChatResponse`. Chỉ đặt `actionRequired` khi có đề xuất hợp lệ; lời khuyên thông thường không tự nhận là đã chỉnh kế hoạch.
- Trước khi đề xuất đổi món, xác định đúng món/bữa mà người dùng muốn đổi, lấy công thức đầy đủ và lọc bằng `recipeEligibilityService`. Trước khi áp dụng, kiểm tra lại hồ sơ và dữ liệu đang hoạt động qua guard và RPC nguyên tử. Tương tự, bài tập phải qua `exerciseCatalogService` và `personalizationGuardService`.
- Tình huống đau hoặc dấu hiệu cảnh báo ưu tiên an toàn, không chẩn đoán. Có thể hướng người dùng tới bác sĩ hoặc chuyên gia phù hợp khi vấn đề cần đánh giá chuyên môn.
- Giao diện chỉ hiển thị khả năng mà backend thực sự xử lý. Lỗi mạng hoặc phản hồi trống không được biến thành câu trả lời AI tự dựng; tên tệp đính kèm không đồng nghĩa với việc AI đã đọc nội dung tệp.

## Kiểm tra khi thay đổi

- Thử các câu tạo/xem/đổi lịch, hỏi nối tiếp, câu hỏi về nước/ngủ/kcal, ngày mai qua ranh giới tuần, chấn thương, dị ứng và trường hợp thiếu hồ sơ.
- Kiểm tra web và mobile làm mới dữ liệu sau khi áp dụng kế hoạch. Chạy build/typecheck và các test liên quan; kiểm chứng với Groq/Supabase thật riêng khi có quyền truy cập.
