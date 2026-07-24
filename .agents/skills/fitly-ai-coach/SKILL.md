---
name: fitly-ai-coach
description: "Hướng dẫn thiết kế, luồng xử lý và quy chuẩn dữ liệu cho AI Coach trong Fitly (Conversation Context, Plan Adaptation Flow, Personal DB Context, Dynamic Response Length, Guard Checks)."
---

# Fitly AI Coach Skill

## Overview
Skill này chứa các hướng dẫn và quy chuẩn kỹ thuật khi làm việc với các tính năng AI Coach của Fitly (giao tiếp thông minh, khai thác Database cá nhân, điều chỉnh lịch tập & thực đơn).

## Key Responsibilities & Flow

### 1. Intent Detection & Response Modes
- **`coach_advice`**: Giải đáp thắc mắc, tư vấn dinh dưỡng, hướng dẫn kỹ thuật động tác. Không sửa đổi dữ liệu kế hoạch.
- **`plan_adaptation`**: Đề xuất hoặc thực thi thay đổi kế hoạch tập luyện hoặc thực đơn của ngày được chọn (`selectedDayIndex`).
- **`injury_care / safety`**: Cảnh báo an toàn, gợi ý hạ tải hoặc dừng tập khi có dấu hiệu chấn thương.

### 2. Personal Database Context Retrieval
- **Thông tin Sinh trắc & Sức khỏe**: Tuổi, Giới tính, Chiều cao, Cân nặng hiện tại, Cân nặng mục tiêu, Bệnh lý, Chấn thương, Dị ứng.
- **Dữ liệu Tập luyện & Tải lượng**: Lịch sử tập luyện gần đây (`recent_sessions`), mức tạ đã nâng (`weight_kg`), tỷ lệ hoàn thành set tập.
- **Tiến độ Sinh hoạt**: Tình trạng bù nước (`water_intake_ml`), giấc ngủ (`sleep_hours`), tiêu thụ Calo (`calories_consumed`).

### 3. Dynamic Response Length Rules
- **Nhắc nhở / Giao tiếp ngắn**: 40–70 từ (súc tích, có gạch đầu dòng rõ ràng).
- **Giải đáp Kỹ thuật / Công thức món ăn / Hướng dẫn chuyên sâu**: 150–250 từ (đầy đủ các bước thực hiện, thông số set/rep/rest hoặc khẩu phần Kcal/protein).

### 4. Safeguards & Guard Checks
- Kiểm tra tính an toàn điều chỉnh kế hoạch thông qua `adjustmentApplyGuard` và `personalizationGuardService`.
- Đảm bảo các chỉ số tập luyện và thực đơn phù hợp với mục tiêu và tình trạng thể chất của người dùng.

### 5. Checklist khi cập nhật AI Coach
- [ ] Bảo toàn ngữ cảnh hội thoại đa lượt (Multi-turn Conversation History).
- [ ] Khai thác tối đa dữ liệu trong Personal Database trước khi trả lời.
- [ ] Trả về cấu trúc JSON đáp ứng đúng `AIChatResponse` interface.
- [ ] Đảm bảo đồng bộ giao diện Frontend ngay khi kế hoạch được áp dụng thành công.
