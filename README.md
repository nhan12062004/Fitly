# Fitly

Fitly là ứng dụng web hỗ trợ người dùng xây dựng thói quen tập luyện và dinh dưỡng cá nhân hóa. Thay vì phải tự nghĩ hôm nay nên tập gì, ăn gì hoặc điều chỉnh kế hoạch ra sao, người dùng có thể mở Fitly để xem kế hoạch trong ngày, theo dõi tiến độ và trò chuyện với AI Coach.

Mục tiêu của Fitly là biến việc chăm sóc sức khỏe hằng ngày thành một quy trình rõ ràng, dễ duy trì và phù hợp với từng người.

## Fitly Có Gì?

- Kế hoạch tập luyện theo mục tiêu, thể trạng, lịch trình và kinh nghiệm của người dùng.
- Thực đơn cá nhân hóa theo calories, protein, sở thích ăn uống và khả năng chuẩn bị bữa ăn.
- AI Coach có thể trả lời, phân tích tiến độ và đề xuất thay đổi bài tập hoặc món ăn.
- Người dùng được quyền chọn áp dụng hoặc từ chối mọi thay đổi do AI đề xuất.
- Theo dõi tiến độ tập luyện, calories, protein, nước uống, giấc ngủ và chỉ số cơ thể.
- Tích hợp Telegram bot để nhắc nhở và hỗ trợ duy trì thói quen.
- Trang quản trị để quản lý người dùng, bài tập và dữ liệu món ăn.

## Ý Tưởng Sản Phẩm

Fitly không chỉ là một chatbot fitness. AI Coach trong Fitly được thiết kế để trở thành một trợ lý có thể hành động:

1. Hiểu ngữ cảnh cá nhân của người dùng.
2. Đọc kế hoạch tập luyện và thực đơn hiện tại.
3. Phân tích yêu cầu như mệt, bận, muốn đổi món, muốn giảm cường độ hoặc xem tiến độ.
4. Tạo đề xuất thay đổi có cấu trúc.
5. Chỉ cập nhật dữ liệu thật khi người dùng xác nhận.

Điều này giúp Fitly giữ được trải nghiệm tự nhiên của một cuộc trò chuyện, nhưng vẫn có dữ liệu rõ ràng, có thể kiểm tra và có thể áp dụng vào hệ thống.

## Tính Năng Chính

**AI Coach**

- Chat với người dùng theo ngữ cảnh sức khỏe, workout và meal plan.
- Detect intent cho các yêu cầu như điều chỉnh bài tập, đổi món ăn, phân tích tiến độ.
- Tạo proposal có thể apply/reject.
- Lưu lịch sử chat và lịch sử điều chỉnh để audit.

**Workout**

- Lịch tập theo tuần.
- Buổi tập hằng ngày từ weekly plan.
- Theo dõi sets, reps, weight, rest time và trạng thái hoàn thành.
- Ghi nhận feedback sau buổi tập.

**Diet Plan**

- Thực đơn theo ngày và theo bữa.
- Dữ liệu món ăn dùng `food_id` để tránh AI tạo text tự do khó kiểm soát.
- Theo dõi calories, protein, carbs và fat.

**Progress**

- Theo dõi chỉ số cơ thể và thói quen sinh hoạt.
- Tổng hợp dữ liệu tập luyện, ăn uống, nước uống và giấc ngủ.
- Hỗ trợ AI phân tích tiến độ dựa trên dữ liệu thực tế.

**Telegram Bot**

- Liên kết tài khoản với Telegram.
- Nhắc uống nước, nhắc ngủ.
- Hỗ trợ tương tác nhanh với người dùng ngoài web app.

## Công Nghệ Sử Dụng

**Frontend**

- React
- Vite
- TypeScript
- Tailwind CSS
- React Router
- Supabase JS
- Lucide React
- Recharts

**Backend**

- Node.js
- Express
- TypeScript
- Supabase
- Groq/OpenAI-compatible API
- Google Gemini SDK
- Telegram Bot API
- node-cron

**Database**

- Supabase Postgres
- Supabase Auth
- SQL migrations

## Cấu Trúc Dự Án

```text
Fitly/
|-- Frontend/              # React + Vite app
|-- Backend/               # Express API, AI services, Telegram bot
|-- docs/                  # Tài liệu kỹ thuật và schema snapshot
|-- supabase/migrations/   # Database migrations
`-- README.md
```

Một số file quan trọng:

- `Frontend/src/pages/AICoach.tsx`
- `Frontend/src/pages/Overview.tsx`
- `Frontend/src/pages/DietPlan.tsx`
- `Frontend/src/pages/WorkoutSession.tsx`
- `Backend/src/server.ts`
- `Backend/src/services/ai/`
- `Backend/src/TelegramBot.ts`
- `docs/database_schema.md`

## Chạy Dự Án Ở Local

Cài dependencies:

```bash
cd Frontend
npm install

cd ../Backend
npm install
```

Tạo file môi trường:

```text
Frontend/.env
Backend/.env
```

Chạy backend:

```bash
cd Backend
npm run dev
```

Chạy frontend:

```bash
cd Frontend
npm run dev
```

Frontend mặc định chạy tại:

```text
http://localhost:3000
```

Backend mặc định chạy tại:

```text
http://localhost:5000
```

## Biến Môi Trường Chính

Frontend:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_DEV_API_URL=http://127.0.0.1:5000
VITE_API_URL=
```

Backend:

```env
PORT=5000
FRONTEND_URL=http://localhost:3000

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

GROQ_API_KEY=
GROQ_MODEL=
GEMINI_API_KEY=

TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_LINK_SECRET=

CRON_SECRET=
AI_ACTION_FLOW_ENABLED=true
PREMIUM_AUTO_PLAN_ENABLED=true
```

Không commit file `.env` hoặc bất kỳ secret nào lên GitHub.

## Scripts

Frontend:

```bash
npm run dev
npm run build
npm run preview
npm run lint
```

Backend:

```bash
npm run dev
npm run start
npm run db:migration:list
npm run db:push
npm run update:schema-doc
```

## Trạng Thái

Fitly đang trong giai đoạn phát triển tích cực. Các phần cốt lõi như dashboard, AI Coach, workout tracking, meal plan, Telegram bot và admin panel đã có nền tảng hoạt động. Những phần tiếp theo có thể mở rộng gồm test integration, UI diff chi tiết hơn cho AI proposal, observability cho AI metrics và validation schema chặt chẽ hơn.

## Lưu Ý

Fitly là công cụ hỗ trợ tập luyện và dinh dưỡng, không thay thế tư vấn y tế chuyên môn. Người dùng có bệnh nền, chấn thương hoặc nhu cầu dinh dưỡng đặc biệt nên tham khảo chuyên gia phù hợp trước khi thay đổi kế hoạch tập luyện hoặc ăn uống.
