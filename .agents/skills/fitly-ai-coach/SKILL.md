---
name: fitly-ai-coach
description: "Hướng dẫn thiết kế, luồng xử lý và quy chuẩn dữ liệu cho AI Coach trong Fitly (Conversation Context, Plan Adaptation Flow, Guard Checks)."
---

# Fitly AI Coach Skill

## Overview
Skill này chứa các hướng dẫn và quy chuẩn kỹ thuật khi làm việc với các tính năng AI Coach của Fitly (giao tiếp, điều chỉnh lịch tập & thực đơn).

## Key Responsibilities & Flow

### 1. Intent Detection & Response Modes
- **`coach_advice`**: Giải đáp thắc mắc, phục hồi, động lực, dinh dưỡng chung. Không sửa đổi dữ liệu kế hoạch.
- **`plan_adaptation`**: Đề xuất hoặc thực thi thay đổi kế hoạch tập luyện hoặc thực đơn của ngày được chọn (`selectedDayIndex`).

### 2. Safeguards & Guard Checks
- Kiểm tra tính an toàn điều chỉnh kế hoạch thông qua `adjustmentApplyGuard` và `personalizationGuardService`.
- Đảm bảo các chỉ số tập luyện và thực đơn phù hợp với mục tiêu và tình trạng thể chất của người dùng.

### 3. Checklist khi cập nhật AI Coach
- [ ] Bảo toàn ngữ cảnh hội thoại theo từng ngày/tuần.
- [ ] Trả về cấu trúc JSON đáp ứng đúng `AIChatResponse` interface.
- [ ] Đảm bảo đồng bộ giao diện Frontend ngay khi kế hoạch được áp dụng thành công.
