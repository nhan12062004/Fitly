# TrendFit

TrendFit la mot ung dung fitness co 2 phan chinh:

- `Frontend/`: React + Vite + Tailwind, giao dien nguoi dung.
- `Backend/`: Express + TypeScript + Supabase, API va logic AI/Telegram.

README nay duoc viet lai theo huong "working context" de AI agent hoac dev moi vao du an co the doc nhanh va hieu:

- san pham dang lam gi
- code hien dang to chuc ra sao
- AI Coach dang o trang thai nao
- can chay script gi
- cac rang buoc quan trong can ton trong khi sua code

## Product Intent

Muc tieu cua TrendFit khong chi la chatbot fitness. Huong hien tai la:

- nguoi dung chi thay 1 trang `AI Coach`
- backend tach logic theo intent thanh nhieu service rieng
- AI khong chi tra loi text, ma phai de xuat hanh dong co the ap dung vao database
- moi de xuat can co kha nang audit: ai noi gi, intent gi, payload gi, da apply hay reject

Noi ngan gon: day la mot "actionable AI coach", khong phai chat cho vui.

## Current Architecture

### Frontend

Duong dan chinh:

- `Frontend/src/pages/AICoach.tsx`
- `Frontend/src/pages/Overview.tsx`
- `Frontend/src/pages/DietPlan.tsx`
- `Frontend/src/pages/WorkoutSession.tsx`
- `Frontend/src/contexts/AuthContext.tsx`
- `Frontend/src/lib/Supabase.ts`

Stack:

- React 19
- Vite
- Tailwind CSS
- Supabase JS client
- React Router

Frontend hien tai da co:

- trang `AI Coach` mot man hinh
- quick actions
- chat UI
- nut `Ap dung thay doi` / `Khong ap dung`
- render proposal card cho workout va meal de nguoi dung thay AI dang de xuat gi

### Backend

Duong dan chinh:

- `Backend/src/server.ts`
- `Backend/src/config/Supabase.ts`
- `Backend/src/TelegramBot.ts`
- `Backend/src/services/ai/*`
- `Backend/src/lib/aiObservability.ts`

Stack:

- Node.js
- Express
- TypeScript
- Supabase
- node-cron
- node-telegram-bot-api

AI service layer hien tai:

- `aiRouterService.ts`: detect intent
- `aiChatService.ts`: advice text
- `aiPlannerService.ts`: planner stub/coordinator
- `workoutAdjusterService.ts`: de xuat doi workout
- `mealAdjusterService.ts`: de xuat doi meal theo `food_id`
- `progressAnalyzerService.ts`: nhan xet tien do
- `aiValidationService.ts`: validate action payload truoc khi ghi DB/apply

## AI Coach Flow

Flow hien tai cua `POST /api/ai/chat`:

1. Xac thuc user bang Supabase access token.
2. Lay plan hien tai va du lieu context trong ngay.
3. Detect intent.
4. Goi dung AI service theo intent.
5. Tra ve response chuan:

```json
{
  "reply": "string",
  "intent": "adjust_workout",
  "confidence": 0.87,
  "actionRequired": true,
  "actionType": "replace_today_workout",
  "actionPayload": {},
  "adjustmentId": "uuid-or-null"
}
```

6. Luu chat vao `ai_chat_messages`.
7. Neu co action thi tao dong `ai_plan_adjustments` voi `status='proposed'`.

Flow hien tai cua `POST /api/ai/apply-adjustment`:

1. Xac thuc user.
2. Doc adjustment theo `adjustmentId`.
3. Bat buoc adjustment phai o trang thai `proposed`.
4. Validate lai payload truoc khi apply.
5. Update plan thuc te trong DB.
6. Cap nhat adjustment thanh `applied`.

Flow hien tai cua `POST /api/ai/reject-adjustment`:

1. Xac thuc user.
2. Chi reject khi adjustment dang `proposed`.
3. Cap nhat thanh `rejected`.

## Database Notes

Schema snapshot duoc luu tai:

- `docs/database_schema.md`

Migration dang co trong repo:

- `supabase/migrations/20260602110000_normalize_rls_policies.sql`

Bang quan trong lien quan AI Coach:

- `ai_chat_messages`
- `ai_plan_adjustments`
- `weekly_plans`
- `weekly_plan_exercises`
- `weekly_food_plans`
- `weekly_food_items`
- `workout_session_feedback`
- `meal_feedback`

Nguyen tac quan trong:

- workout adjustment phai sua bang plan data that
- meal adjustment phai dung `food_id`, khong dung text tu do
- lich su AI phai audit duoc
- action chi duoc apply khi payload hop le va state hop le

## Scripts

### Frontend

Chay trong `Frontend/`:

```bash
npm run dev
npm run build
npm run lint
```

### Backend

Chay trong `Backend/`:

```bash
npm run dev
npm run start
npm run update:schema-doc
```

Script backend hien co:

- `npm run dev`: watch server
- `npm run start`: chay server
- `npm run db:migration:list`: xem local/remote migration history cua Supabase
- `npm run db:push`: day migration moi trong `supabase/migrations/` len remote
- `npm run update:schema-doc`: pull schema tu Supabase va cap nhat `docs/database_schema.md` (chi xuat schema, khong xuat data)

## Environment Variables

### Frontend

File `Frontend/.env`:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_API_URL=http://localhost:5000
```

### Backend

File `Backend/.env`:

```env
PORT=5000
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_ANON_KEY=...
FRONTEND_URL=http://localhost:5173
GEMINI_API_KEY=...
GROQ_API_KEY=...
GROQ_MODEL=llama-3.3-70b-versatile
TELEGRAM_BOT_TOKEN=...
TELEGRAM_BOT_USERNAME=trendfitforbot
TELEGRAM_LINK_SECRET=...
CRON_SECRET=...
AI_ACTION_FLOW_ENABLED=true
```

Ghi chu:

- `SUPABASE_SERVICE_ROLE_KEY` duoc backend dung de thao tac DB.
- `AI_ACTION_FLOW_ENABLED=false` se tat action flow va chi de AI tra loi text.

## Local Run

1. Cai dependency:

```bash
cd Frontend
npm install
cd ../Backend
npm install
```

2. Chay migration tren Supabase.

3. Cap nhat schema doc neu can:

```bash
cd Backend
npm run update:schema-doc
```

4. Mo 2 terminal:

```bash
cd Frontend
npm run dev
```

```bash
cd Backend
npm run dev
```

## Current Status

Nhung gi da xong:

- tach AI Coach backend thanh service layer
- tao chat endpoint co intent routing
- tao apply/reject adjustment flow
- co auth bang Supabase token cho endpoint AI
- co idempotency key cho apply
- co validation payload co ban
- meal adjustment da chuyen sang `food_id`
- frontend da render proposal card
- co metrics/logging co ban
- co test nhanh cho AI services
- co script cap nhat `docs/database_schema.md`

Nhung gi chua xong hoan toan:

- `aiPlannerService` van la stub/coordinator, chua sinh weekly plan JSON day du de apply truc tiep
- validation payload moi o muc practical minimum, chua phai schema-rich validation
- metrics hien la in-memory, chua day vao external observability
- frontend AI Coach da hien proposal card, nhung chua phai diff UI rat chi tiet cho moi loai action

## Important Constraints For Future Agents

Neu AI agent tiep tuc sua repo nay, can ton trong cac quy tac sau:

- Khong doi `AI Coach` thanh 2 trang rieng. User van phai thay 1 trang duy nhat.
- Co the tach service backend bao nhieu cung duoc, nhung UX van la 1 coach.
- Khong de AI meal adjustment tra ve text tu do. Phai dung `food_id`.
- Khong de apply/reject bo qua state machine. `proposed -> applied/rejected`.
- Khong trust `userId` tu client cho AI endpoints. Phai lay tu auth token.
- Moi migration moi can duoc them vao `supabase/migrations/` va cap nhat `docs/database_schema.md`.
- Neu sua flow AI, uu tien giu chat response format on dinh vi frontend dang dua vao:

```json
{
  "reply": "string",
  "intent": "string",
  "confidence": 0.0,
  "actionRequired": true,
  "actionType": "string-or-null",
  "actionPayload": {},
  "adjustmentId": "string-or-null"
}
```

## Recommended Working Order

Neu can tiep tuc phat trien AI Coach, thu tu hop ly la:

1. Nâng cap `aiPlannerService` de sinh weekly workout/meal plan chi tiet.
2. Tang cuong validation bang schema nghiem ngat hon.
3. Bo sung UI diff "cu vs moi" chi tiet hon cho tung action.
4. Mo rong test integration cho `chat/apply/reject`.
5. Neu can, dua metrics ra he thong observability that.

## Useful File Map

Neu can tim nhanh:

- AI Coach backend: `Backend/src/services/ai/`
- AI Coach routes: `Backend/src/server.ts`
- AI metrics/logging: `Backend/src/lib/aiObservability.ts`
- AI Coach frontend: `Frontend/src/pages/AICoach.tsx`
- Schema snapshot: `docs/database_schema.md`
- Migrations: `supabase/migrations/`

## License

Hien chua uu tien phan license/documentation marketing. README nay uu tien boi canh ky thuat va tinh lien tuc cho dev/AI agent.
