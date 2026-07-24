# Fitly Project Agent Rules

## Overview
Fitly là ứng dụng Trợ lý AI Hỗ trợ Tập luyện & Dinh dưỡng (Fitness & Nutrition AI Coach).

## System Architecture & Code Conventions

### 1. Stack & Structure
- **Frontend**: React + Vite + TypeScript + Tailwind CSS (`/frontend`).
- **Backend**: Express + TypeScript (`/Backend`), tích hợp Supabase (Database, Auth, Storage) & Telegram Bot.
- **Shared Directory (`/shared`)**: Single Source of Truth cho toàn bộ dữ liệu danh mục (Exercise Catalog, Recipe Catalog, Dietary Preferences) và các TypeScript Interface dùng chung.

### 2. Dữ liệu Danh mục (Catalogs) & Contract
- Mọi định nghĩa bài tập, công thức món ăn, chế độ ăn phải được quản lý hoặc re-export từ `/shared`.
- Frontend re-export từ `/shared` qua `frontend/src/lib/`.
- Chuẩn hóa độ khó bài tập theo 3 cấp độ: `easy`, `medium`, `hard`.
- Đảm bảo tính toán dinh dưỡng (Macros) luôn có đủ: Calo, Protein, Carbs, Fat.

### 3. Quy tắc AI Coach
- AI Coach phản hồi theo ngữ cảnh cuộc trò chuyện (Conversation Context) hợp nhất.
- Phân biệt rõ ràng giữa tư vấn/lời khuyên (`coach_advice`) và yêu cầu điều chỉnh kế hoạch (`plan_adaptation`).
- Mọi thao tác cập nhật kế hoạch tập luyện/thực đơn qua AI phải tuân thủ Guard Check (`personalizationGuardService`, `adjustmentApplyGuard`) trước khi lưu vào DB.

### 4. Cơ sở dữ liệu (Database)
- Đơn vị cấu trúc chuẩn được lưu trữ và mô tả trong `docs/database_schema.md`.
- Sử dụng RLS (Row Level Security) trên Supabase để bảo mật dữ liệu theo `user_id`.
