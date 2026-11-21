<div align="center">
  <img src="Mobile/assets/images/fitly-mark.svg" alt="Biểu trưng Fitly" width="112" height="112" />

  <h1>Fitly</h1>
  <p>Lập kế hoạch tập luyện, ăn uống và theo dõi tiến độ cùng AI Coach.</p>
</div>

## Giới thiệu

Fitly là ứng dụng tập luyện và dinh dưỡng có phiên bản web và ứng dụng di động. Người dùng có thể xem kế hoạch trong ngày, ghi nhận hoạt động, theo dõi thói quen và trao đổi với AI Coach. Hệ thống dùng Supabase cho đăng nhập và dữ liệu, cùng Express API cho các tác vụ nghiệp vụ và AI.

## Tính năng

| Nhóm | Khả năng chính |
| --- | --- |
| Tập luyện | Lập lịch tập, xem hướng dẫn bài tập, ghi từng set và theo dõi buổi tập. |
| Dinh dưỡng | Xem thực đơn, công thức, năng lượng và các chỉ số dinh dưỡng. |
| AI Coach | Trò chuyện theo ngữ cảnh và xem đề xuất điều chỉnh kế hoạch trước khi áp dụng. |
| Tiến độ | Theo dõi chỉ số cơ thể, lượng nước, giấc ngủ và lịch sử hoạt động. |
| Thử thách | Tạo hoặc tham gia thử thách cá nhân, nhóm và theo dõi ngày hoàn thành. |
| Tài khoản | Quản lý hồ sơ, thông báo, quyền riêng tư và gói thành viên. |
| Quản trị web | Quản lý người dùng, danh mục bài tập, món ăn và phản hồi. |

## Công nghệ và cấu trúc

| Thành phần | Công nghệ chính | Thư mục |
| --- | --- | --- |
| Web | React, Vite, TypeScript, Tailwind CSS | [`Frontend/`](Frontend/) |
| Di động | Expo, React Native, TypeScript | [`Mobile/`](Mobile/) |
| API | Node.js, Express, TypeScript, Groq | [`Backend/`](Backend/) |
| Dữ liệu và xác thực | Supabase Postgres, Auth, Storage, SQL migrations | [`supabase/`](supabase/) |
| Mã dùng chung | Các kiểu dữ liệu và tiện ích dùng chung | [`shared/`](shared/) |

## Chạy trên máy cá nhân

Cần Node.js **22.22.0 trở lên**, npm và một dự án Supabase đã áp dụng các migration trong [`supabase/migrations/`](supabase/migrations/). Dùng URL và khóa của đúng dự án Supabase; URL phải truy cập được từ trình duyệt hoặc thiết bị chạy ứng dụng.

### Web

```bash
cp -n Frontend/.env.example Frontend/.env
cd Frontend
npm ci
npm run dev
```

Trước khi chạy, điền `VITE_SUPABASE_URL` và `VITE_SUPABASE_ANON_KEY` trong `Frontend/.env`. Web mở tại `http://localhost:3000`. Ở chế độ phát triển, Vite chuyển tiếp `/api` đến `VITE_API_URL` trong file này; đặt nó thành URL backend đang chạy, chẳng hạn `http://localhost:5001` nếu chạy API trên máy. Khởi động lại Vite sau khi đổi biến môi trường.

### API

```bash
cp -n Backend/.env.example Backend/.env
cd Backend
npm ci
npm run dev
```

Điền ít nhất `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` và `FRONTEND_URL` trong `Backend/.env`. Cấu hình `GROQ_API_KEY` để sử dụng AI Coach. API mặc định lắng nghe tại `http://localhost:5001`.

### Di động

```bash
cp -n Mobile/.env.example Mobile/.env
cd Mobile
npm ci
npm run start
```

Điền `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` và `EXPO_PUBLIC_API_URL` trong `Mobile/.env`. Nếu chạy trên điện thoại thật, `EXPO_PUBLIC_API_URL` phải là địa chỉ mà điện thoại truy cập được; `localhost` trên điện thoại không trỏ tới máy phát triển. Các khóa RevenueCat trong file mẫu chỉ cần khi kiểm thử chức năng mua gói.

> Các biến `VITE_*` và `EXPO_PUBLIC_*` được đưa vào ứng dụng phía người dùng. Chỉ dùng khóa công khai ở đó; giữ `SUPABASE_SERVICE_ROLE_KEY` và `GROQ_API_KEY` trong backend. Khi thay đổi biến môi trường của bản web trên Vercel, cần triển khai lại để bản build nhận giá trị mới.

## Kiểm tra

```bash
(cd Frontend && npm run lint && npm run build)
(cd Backend && npm run typecheck && npm test)
(cd Mobile && npm run typecheck && npm run lint && npm run check:release)
```

CI còn chạy kiểm tra quyền dữ liệu và tích hợp với Supabase cô lập. Để chạy bài kiểm tra RLS trên máy, cần Supabase CLI và Docker:

```bash
supabase start
supabase test db --local supabase/tests/rls_ownership_test.sql
supabase stop --no-backup
```

## Tài liệu liên quan

- [Quy tắc danh mục bài tập](shared/exerciseCatalog.ts) và [công thức](shared/recipeCatalog.ts).
- [Sơ đồ dữ liệu](docs/database_schema.md) và [migration khởi tạo](supabase/migrations/20260728000000_schema_baseline.sql).
- [Vận hành API và background jobs](docs/OPERATIONS.md).
- [Hợp đồng API cho ứng dụng di động](docs/mobile-api-contract.md).
- [Quy trình triển khai và bảo mật](docs/hardening-release-2026-10-26.md).

Fitly hỗ trợ theo dõi tập luyện và dinh dưỡng; ứng dụng không thay thế tư vấn y tế chuyên môn.
