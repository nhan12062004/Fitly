<div align="center">
  <img src="Frontend/public/logo.svg" alt="Fitly logo" width="112" />

  <h1>Fitly</h1>

  <p>
    <strong>AI fitness coach giúp người dùng biết hôm nay nên tập gì, ăn gì và điều chỉnh kế hoạch ra sao.</strong>
  </p>

  <p>
    <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=0B1220" />
    <img alt="Vite" src="https://img.shields.io/badge/Vite-6-646CFF?style=for-the-badge&logo=vite&logoColor=white" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
    <img alt="Supabase" src="https://img.shields.io/badge/Supabase-Postgres-3FCF8E?style=for-the-badge&logo=supabase&logoColor=0B1220" />
    <img alt="Node.js" src="https://img.shields.io/badge/Node.js-Express-339933?style=for-the-badge&logo=node.js&logoColor=white" />
  </p>
</div>

## Tổng Quan

Fitly là web app hỗ trợ xây dựng thói quen tập luyện và dinh dưỡng cá nhân hóa. Người dùng có thể xem kế hoạch trong ngày, theo dõi tiến độ, nhận nhắc nhở và trò chuyện với AI Coach để đổi bài tập hoặc thực đơn khi cần.

Điểm khác biệt của Fitly là AI không tự ý sửa dữ liệu. AI chỉ tạo đề xuất có cấu trúc, sau đó người dùng chọn áp dụng hoặc từ chối.

## Tính Năng

| Module | Mô tả |
| --- | --- |
| <img src="Frontend/public/logo.svg" width="24" alt="" /> **AI Coach** | Chat theo ngữ cảnh, phân tích tiến độ, đề xuất đổi workout hoặc meal plan. |
| **Workout** | Lịch tập theo tuần, buổi tập hằng ngày, tracking sets/reps/weight/rest. |
| **Diet Plan** | Thực đơn theo bữa, calories, protein, carbs, fat và food catalog bằng `food_id`. |
| **Progress** | Theo dõi chỉ số cơ thể, nước uống, giấc ngủ, calories và lịch sử tập luyện. |
| **Admin Panel** | Quản lý users, exercises và foods. |

## Tech Stack

| Frontend | Backend | Database & Infra |
| --- | --- | --- |
| React | Node.js | Supabase Postgres |
| Vite | Express | Supabase Auth |
| TypeScript | TypeScript | SQL migrations |
| Tailwind CSS | Groq / Gemini | Vercel / Render-ready |
| React Router | AI services | Cron jobs |

## Cấu Trúc

```text
Fitly/
|-- Frontend/              # React + Vite app
|-- Backend/               # Express API and AI services
|-- docs/                  # Schema snapshot và tài liệu kỹ thuật
|-- supabase/migrations/   # Database migrations
`-- README.md
```

## Chạy Local

```bash
cd Frontend
npm install
npm run dev
```

Frontend: `http://localhost:3000`

<details>
<summary><strong>Biến môi trường chính</strong></summary>

Frontend `.env`:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_API_URL=https://trendfit.onrender.com
```

Backend `.env`:

```env
FRONTEND_URL=https://trend-fit.vercel.app

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

GROQ_API_KEY=
GROQ_MODEL=

CRON_SECRET=
AI_ACTION_FLOW_ENABLED=true
PREMIUM_AUTO_PLAN_ENABLED=true
```

</details>

<details>
<summary><strong>Scripts</strong></summary>

Frontend:

```bash
npm run dev
npm run build
npm run preview
npm run lint
```

Backend:

```bash
npm run start
npm run db:migration:list
npm run db:push
npm run exercises:validate -- --file catalog/exercise-catalog.template.json
npm run exercises:upsert -- --file path/to/exercises.json
npm run exercises:upsert -- --file catalog/exercise-catalog.template.json --allow-empty
npm run recipes:validate -- --file catalog/recipe-catalog.template.json
npm run recipes:upsert -- --file path/to/recipes.json --dry-run
npm run recipes:verify
```

The official 100-exercise SQL seed is [supabase/seeds/fitly_exercise_catalog_100_easy_medium_hard.sql](supabase/seeds/fitly_exercise_catalog_100_easy_medium_hard.sql). Its taxonomy is `easy` (Dễ), `medium` (Trung bình), and `hard` (Khó); `min_experience_months` remains the hard eligibility rule.

`exercises:upsert` rejects an empty catalog by default. Use `--allow-empty` only when an explicit no-op import is intended.

</details>

Exercise catalog validation and import details are in [docs/exercise-catalog-design.md](docs/exercise-catalog-design.md).

Recipe catalog validation/import details are in [docs/recipe-catalog-design.md](docs/recipe-catalog-design.md). The recipe template is intentionally empty; it does not seed or import production data.

## Ghi Chú

Fitly là công cụ hỗ trợ tập luyện và dinh dưỡng, không thay thế tư vấn y tế chuyên môn. Không commit `.env` hoặc secret lên GitHub.
