# Kế hoạch triển khai Fitly Mobile (Expo)

**Trạng thái (31/07/2026):** Expo foundation hoàn tất. Đăng nhập/SecureStore và các luồng đọc Core đã chạy trên Android emulator với Supabase RLS. Reset password/deep link được hoãn theo quyết định sản phẩm. Workout mutation hoàn tất theo waiver của chủ dự án cho E2E cross-user (backend contract test vẫn đạt). Milestone AI Coach đang triển khai.

**Mục tiêu:** Xây dựng ứng dụng Android ưu tiên mobile bằng Expo, với giao diện riêng cho Fitly, đồng thời dùng nguyên Supabase Auth, PostgreSQL/RLS và Express Backend hiện có.

## 1. Phạm vi và nguyên tắc

### Trong phạm vi V1

- Đăng ký, đăng nhập, khôi phục mật khẩu và phiên đăng nhập.
- Trang tổng quan hôm nay.
- Workout: lịch tập, bài tập, workout session và ghi nhận set/reps/weight.
- Meal plan: bữa ăn hôm nay, dinh dưỡng và recipe detail.
- AI Coach: chat, đề xuất thay đổi và xác nhận áp dụng/từ chối.
- Progress và Profile.
- Premium mobile UI dành cho fitness, gym và yoga.
- Android emulator, Android thiết bị thật và build nội bộ.

### Ngoài phạm vi V1

- Admin Panel.
- Challenges, Premium checkout và Telegram bot.
- Thay đổi schema, migration hoặc thay thế Express Backend.
- Đồng bộ offline có thể ghi dữ liệu; chỉ triển khai cache đọc ở V1.
- Health Connect và Apple HealthKit; đây là phạm vi sau Android MVP.
- Đọc clinical/medical records, nhịp tim liên tục, vị trí hoặc dữ liệu lịch sử quá 30 ngày.

### Nguyên tắc kỹ thuật

1. Mobile không sao chép component web. Chỉ tái sử dụng chức năng, API contract, model và language của Fitly.
2. Supabase được gọi trực tiếp chỉ cho dữ liệu user-scoped đã có RLS phù hợp.
3. Express API xử lý AI, logic nghiệp vụ, thao tác quyền cao và mutation đã có endpoint.
4. Không đưa `SUPABASE_SERVICE_ROLE_KEY`, Groq key, Telegram token hoặc bất kỳ secret server nào vào ứng dụng.
5. Không tạo migration cho mobile V1 nếu không có yêu cầu dữ liệu mới.

## 2. Đánh giá hiện trạng

| Hạng mục | Hiện trạng | Tác động cho mobile |
| --- | --- | --- |
| Mobile | Thư mục `Mobile/` đang trống | Khởi tạo Expo project mới, không cần chuyển đổi app cũ. |
| Web | React + Vite + TypeScript | Dùng làm tài liệu flow/logic; không dùng trực tiếp component web. |
| Backend | Express + TypeScript | Đã hỗ trợ Bearer token, AI Coach, workout actions và nutrition endpoints. |
| Auth/Data | Supabase Auth + PostgreSQL + RLS | Web và mobile dùng cùng user/session/data. |
| Data access | Web có nhiều truy vấn Supabase trực tiếp | Cần chuẩn hóa theo domain, không nhân bản từng query vào mobile. |
| Shared | Có các type/catalog thuần TypeScript | Có thể dùng dần cho contract không phụ thuộc web/Node. |
| Health data | `daily_progress_logs` không có `source`, `synced_at` hay merge rule | Không ghi dữ liệu health vào DB trước khi có migration và quy tắc merge được duyệt. |

## 3. Kiến trúc mục tiêu

```text
Expo Mobile (Android + iOS)
├── Expo Router + màn hình native
├── Supabase client
│   ├── Auth và session
│   └── Query dữ liệu theo RLS
├── API client
│   └── Authorization: Bearer <Supabase access token>
└── SecureStore
    └── Lưu session an toàn trên thiết bị

             │
             ▼

Supabase hiện tại ───────── Express Backend hiện tại
Auth / PostgreSQL / RLS      AI / workout mutation / business logic
```

### Kiến trúc health platform (sau Android MVP)

```text
iOS: Apple HealthKit ─────┐
                            ├─ Health service trên thiết bị
Android: Health Connect ───┘   ├─ Permission + consent + sync toggle
                               ├─ Aggregate theo ngày
                               └─ Health preview UI (read-only ở V1.1)
```

- **Apple HealthKit** chỉ dành cho iPhone/Apple Watch. HealthKit yêu cầu quyền theo từng data type và không cho app biết rõ người dùng đã từ chối quyền đọc; app phải xử lý trạng thái không có dữ liệu một cách tôn trọng riêng tư. [Apple HealthKit](https://developer.apple.com/documentation/healthkit), [HealthKit authorization](https://developer.apple.com/documentation/HealthKit/authorizing-access-to-health-data)
- **Health Connect** là tương đương trên Android. Android 14+ có Health Connect trong hệ thống; Android 13 trở xuống cần cài ứng dụng Health Connect. App cần khai báo permission theo data type, có màn hình giải thích privacy và khai báo quyền tương ứng trong Play Console. [Android Health Connect](https://developer.android.com/health-and-fitness/health-connect/get-started)
- Cả hai cần native bridge/configuration, nên không chạy được hoàn chỉnh bằng Expo Go. Dùng Expo development build cho feature này.

### Cấu hình môi trường mobile

`Mobile/.env` chỉ chứa các giá trị public:

```env
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
EXPO_PUBLIC_API_URL=https://trendfit.onrender.com
```

`EXPO_PUBLIC_*` được đóng gói vào client. Vì vậy chỉ dùng Supabase publishable/anon key và API URL ở đây.

## 4. Stack đề xuất

- Expo + TypeScript + Expo Router.
- Development build trên Android emulator; Android Studio đã sẵn sàng cho luồng này.
- Supabase JS với adapter session dùng Expo SecureStore.
- TanStack Query cho server-state, loading, retry và cache.
- Thiết kế native bằng React Native styles/tokens; chỉ thêm NativeWind nếu được chọn rõ ràng khi bắt đầu UI.
- Expo Notifications ở giai đoạn sau của V1.
- Native bridge tương thích Expo cho HealthKit và Health Connect là phạm vi sau Android MVP; chọn package/config plugin sau khi chốt Expo SDK để tránh dependency native không tương thích.

## 4.1. Design direction: Premium Performance & Serenity

App không đi theo kiểu dashboard web thu nhỏ. Hướng visual kết hợp năng lượng gym với sự tĩnh tại của yoga:

- **Nền:** obsidian/charcoal sâu, bề mặt graphite; hỗ trợ light mode sau nếu cần.
- **Accent:** lime hoặc electric blue cho hành động/tiến độ, violet/indigo nhẹ cho mindfulness và yoga; không lạm dụng gradient.
- **Typography:** số liệu lớn, đậm và dễ quét; nội dung hướng dẫn nhẹ, thoáng và ít chữ.
- **Surface:** card bo góc lớn, elevation mềm, visual rings cho calories/streak/readiness, ảnh workout/yoga có lớp phủ tối.
- **Interaction:** bottom tabs, primary CTA cố định khi đang workout, bottom sheet cho thao tác nhanh, haptic feedback có chủ đích.
- **Accessibility:** tương phản đạt chuẩn, touch target tối thiểu 44pt, không chỉ truyền đạt trạng thái bằng màu.

Mỗi màn hình cần có một “hero metric” duy nhất (ví dụ hôm nay: workout còn lại; progress: streak; health: sleep/recovery) để cảm giác premium rõ ràng và không quá tải.

## 5. Information architecture và màn hình

### Bottom tabs

| Tab | Màn hình chính | Chức năng |
| --- | --- | --- |
| Home | Today overview | Kế hoạch hôm nay, calories, quick actions, streak. |
| Workout | Workout plan | Lịch tập, chi tiết bài, bắt đầu/tiếp tục session. |
| Meals | Meal plan | Bữa ăn, macro, recipe detail, đổi món khi API cho phép. |
| Coach | AI Coach | Chat, quota, proposal review. |
| Profile | Profile & progress | Mục tiêu, body metrics, tiến độ và cài đặt. |

### Stack/modal screens

- Auth: login, signup, reset password.
- Onboarding/assessment khi profile chưa hoàn tất.
- Workout session và exercise detail.
- Meal/recipe detail.
- AI adjustment confirmation.
- Notifications (giai đoạn sau).

## 6. Lộ trình triển khai

### Milestone 0 — API contract

- Dùng `docs/mobile-api-contract.md` làm contract chính thức cho Mobile; `BACKEND_ENDPOINT_INVENTORY.md` chỉ là nguồn rà soát.
- Chốt endpoint nào dùng Supabase trực tiếp và endpoint nào bắt buộc đi qua Express.
- Bổ sung và chạy trong CI/local bộ fixture cho idempotency AI apply và hành vi gửi trùng `complete-set`.
- Chốt idempotency: khóa UI và reconcile cho workout mutation; `Idempotency-Key` bắt buộc cho AI apply; không auto-retry AI chat hoặc `complete-set`.
- Chỉ chuyển sang Expo foundation khi AI apply được kiểm thử với cùng key/khác key và `complete-set` có test chứng minh nguy cơ gửi trùng.

**Hoàn thành khi:** contract được review, 5 test gate trong `Backend/test/mobile-contract-milestone0.test.ts` chạy đạt trong CI/local và Mobile không phải suy đoán payload từ web UI.

### Milestone 1 — Chốt hướng sản phẩm và visual

- Chọn tên hiển thị, Android application ID, icon và màu thương hiệu.
- Chốt Android-first cho UI delivery.
- Chốt 5 tab và phạm vi V1 ở trên.
- Chốt direction **Premium Performance & Serenity**, dark mode strategy, app icon và asset direction.

**Hoàn thành khi:** có danh sách màn hình V1 và style direction được duyệt.

### Milestone 2 — Khởi tạo Expo foundation

- Khởi tạo project trong `Mobile/` bằng Expo Router + TypeScript.
- Thiết lập app config, icon/splash placeholder, ESLint và aliases.
- Thiết lập `.env.example`, Supabase client, SecureStore adapter và API client.
- Chạy được trên Android emulator bằng development build.

**Hoàn thành khi:** app mở trên emulator, đọc cấu hình đúng và chưa có secret trong Git.

### Milestone 3 — Navigation và design system

- Dựng root layout, auth gate, tab navigation và stack navigation.
- Tạo foundation: color, spacing, typography, radius, elevation và dark/light strategy (nếu được chọn).
- Tạo reusable components: `Button`, `TextField`, `Card`, `Screen`, `EmptyState`, `LoadingState`, `ErrorState`, `BottomSheet`.
- Dựng shell cho 5 tab bằng mock data.

**Hoàn thành khi:** có thể điều hướng toàn bộ flow V1 trên emulator, không phụ thuộc UI web.

### Milestone 4 — Auth và onboarding

- Login/signup/reset password bằng Supabase Auth.
- Persist/refresh session qua SecureStore.
- API client tự gắn Bearer token hiện tại vào mọi API protected.
- Hiển thị onboarding hoặc dashboard theo trạng thái profile.

**Hoàn thành khi:** một tài khoản web hiện có có thể đăng nhập mobile và thấy đúng dữ liệu của chính mình.

**Tiến độ:** Đăng nhập, SecureStore/persist/refresh session và Bearer API đã xác minh trên Android emulator. Luồng reset password/email deep link được hoãn theo quyết định sản phẩm; không được coi là đã hoàn tất E2E.

### Milestone 5 — Core fitness MVP

- Home: today plan, summary và quick actions.
- Workout: plan, exercise list, session, complete set và completion.
- Meals: daily meal plan, macro và recipe detail.
- Profile/Progress: profile, body metrics và biểu đồ/summary phù hợp mobile.

**Hoàn thành khi:** dữ liệu ghi từ mobile hiển thị đúng ở web và ngược lại, vẫn tuân thủ RLS.

**Tiến độ:** Home, Workout, Meals và Profile đã có luồng chỉ đọc bằng dữ liệu thật trên emulator: truy vấn user-scoped qua RLS, có loading/empty/error/retry; Home trả về summary tập/kcal, Profile trả về body metric và lifestyle settings thật. Workout `complete-set` đã gọi qua Express, nhận trạng thái chuẩn từ server, khóa đồng bộ chống chạm nhanh, giữ kết quả sau khi khởi động lại app và refetch sau timeout mà không retry POST; chưa có mutation meal hay recipe detail.

#### Workout mutation E2E gate (test account thường)

Không tạo dữ liệu để test trong tài khoản thật. Dùng một test account không có quyền admin, có một daily exercise session được tạo rõ ràng từ web hoặc fixture test.

- [x] Hoàn thành một set: `completed_sets` tăng đúng một lần và UI chỉ thay đổi theo response từ server.
- [x] Bấm nhanh cùng một set: ba thao tác liên tiếp chỉ tăng `completed_sets` từ `0` lên `1`; UI lock đồng bộ bằng `ref` trước khi gửi POST.
- [x] Đóng/mở lại app: refetch hiển thị `completed_sets` đã được server lưu.
- [x] Giả lập timeout có kiểm soát trong lúc POST: một POST duy nhất được backend nhận, app timeout rồi refetch từ `2/3` lên `3/3`; không tự gửi lại POST.
- [x] Dùng ID session thuộc test account khác: backend contract test cục bộ trả `404` và không gọi update. E2E token thứ hai được chủ dự án chấp thuận bỏ qua vì Supabase email rate limit.

Chỉ khi năm mục này đạt, hoặc có waiver rõ ràng của chủ dự án cho E2E cross-user, mới chuyển Workout mutation sang hoàn tất.

### Milestone 6 — AI Coach

- Chat UI tối ưu mobile, streaming/loading/error states theo API hiện có.
- Hiển thị quota, structured proposal và confirmation trước khi apply/reject.
- Xử lý rõ cold start, timeout và AI rate limit.

**Hoàn thành khi:** mobile dùng cùng AI flow với web mà không tự ý ghi thay đổi plan.

**Tiến độ:** Đã thay placeholder Coach bằng quota read, chat UI, proposal preview và Apply/Reject controls. Chat E2E đã trả lời thành công trên Android emulator. Luồng `adjust_workout` đã tạo proposal `replace_today_workout` thật ở trạng thái `proposed`; màn xem trước hiển thị 4 bài/10 phút thay cho JSON kỹ thuật. Apply giữ một `Idempotency-Key` ổn định cho cùng adjustment; chat không auto-retry, reject khóa khi kết quả mạng không chắc chắn. Proposal đang chờ xác nhận của chủ tài khoản; chỉ sau đó mới chạy E2E apply hoặc reject để đóng milestone.

### Milestone 7 — Android internal build và QA

- Local notifications cho nhắc tập/ăn/uống nước theo setting người dùng.
- Cache đọc cho Home, Workout và Meals; xử lý offline/error/retry.
- Test Android emulator và thiết bị thật: auth expiry, mạng chậm, thao tác workout, AI quota.
- Tạo Android internal build; chuẩn bị production `.aab` sau khi QA đạt.

**Hoàn thành khi:** internal build cài được và checklist regression V1 đạt.

**Tiến độ:** Android application ID đã chốt là `io.github.nhan12062004.fitly`; `Mobile/eas.json` có profile `development`, `preview` (APK internal) và `production`. Expo config và React Native autolinking đã xác nhận cùng dùng ID này. EAS đã tạo thành công APK internal build `0.1.0 (1)` và đã cài/mở trên Redmi Note 4X thật, hiển thị đúng màn đăng nhập; chưa phát hành Play Store. Cần chạy checklist regression đăng nhập/session, đọc dữ liệu, Workout và AI Coach trên thiết bị thật trước khi đóng milestone.

### Milestone 8 — Health Connect V1.1 (Android, read-only)

- Tạo `health` domain service và màn hình **Connected health** trong Profile.
- Chỉ xin quyền khi user bấm kết nối, chỉ cho steps, active calories, exercise sessions và sleep.
- Đọc aggregate theo ngày và hiển thị preview trên thiết bị; không ghi vào Supabase/Express/database.
- Không xin background read hoặc lịch sử hơn 30 ngày. App vẫn hoạt động đầy đủ nếu user từ chối quyền.

**Hoàn thành khi:** user có thể connect/disconnect Health Connect và xem preview dữ liệu được cấp quyền mà không có database mutation.

### Sau V1.1 — Apple HealthKit

- Bắt đầu sau khi có Apple Developer account và iPhone thật để kiểm thử.
- Áp dụng cùng scope read-only, consent tối thiểu và privacy UX như Health Connect.
- Chỉ thiết kế migration `source`, `synced_at` và merge rule nếu có quyết định rõ ràng về việc ghi dữ liệu health lên Fitly.

## 7. Quy tắc phân chia data access

| Loại tác vụ | Kênh ưu tiên | Lý do |
| --- | --- | --- |
| Login/session | Supabase Auth | Dùng chung user identity hiện có. |
| Đọc/ghi dữ liệu riêng của user đã có RLS | Supabase client | Không cần nhân bản endpoint đơn giản. |
| AI chat, AI plan, quota | Express API | Bảo vệ Groq key, limiter và business logic. |
| Workout mutation có endpoint | Express API | Tái sử dụng validation và logic đang chạy trên web. |
| Health data | Không có trong Android MVP | Health Connect V1.1 chỉ đọc/hiển thị; không ghi database. |
| Admin | Không đưa vào V1 | Tránh mở rộng quyền mobile sớm. |

## 8. Rủi ro và cách xử lý

| Rủi ro | Cách xử lý |
| --- | --- |
| Web có nhiều query Supabase trực tiếp | Audit theo từng màn hình; tạo domain service thay vì copy query rải rác. |
| Session mobile khác browser | Dùng SecureStore, refresh token và auth gate tập trung. |
| AI/API cold start hoặc rate limit | Loading/retry rõ ràng, timeout message và quota UI. |
| RLS thiếu policy cho mobile flow | Test bằng access token user thật; chỉ thêm policy qua migration sau khi review. |
| UI web không phù hợp mobile | Xây component và interaction native riêng, không responsive web trong WebView. |
| Expo Go không đủ native module | Chuyển sang development build sớm khi cần native configuration/notifications. |
| Health permission bị từ chối hoặc data trống | Treat as normal state; giải thích lợi ích và cho phép dùng app đầy đủ khi không connect. |
| Người dùng mất niềm tin về dữ liệu sức khỏe | Xin quyền tối thiểu, sync toggle rõ ràng, không dùng cho ads và có privacy policy dễ hiểu. |
| Mapping tự động làm sai dữ liệu progress | Health V1.1 không ghi DB; chỉ thiết kế source/merge rule trong migration riêng sau khi được duyệt. |

## 9. Checklist trước khi bắt đầu Milestone 2

- [ ] Chốt application name và Android package ID.
- [ ] Chốt visual direction (màu, dark mode có/không, reference screen).
- [ ] Chốt app icon, Android package ID và iOS bundle ID.
- [ ] Xác nhận URL production của Backend API.
- [ ] Lấy Supabase URL và publishable/anon key cho môi trường mobile.
- [ ] Có một test account không phải admin.
- [ ] Xác nhận emulator Android mở được từ Android Studio.
- [ ] Review `docs/mobile-api-contract.md` và bổ sung fixture test cần thiết trước khi gọi Express từ Mobile.
- [ ] Không đưa service role/Groq/Telegram secrets vào Mobile.

## 10. Definition of Done cho V1

- User đăng nhập được bằng cùng tài khoản web và thấy cùng dữ liệu.
- Workout, meals, profile/progress và AI Coach chạy được trên Android.
- Không có secret server trong source/app build.
- RLS và API authorization được kiểm thử với user thường.
- App có loading, empty, error và retry state cho tất cả luồng chính.
- Có Android internal build đã kiểm thử trên emulator và thiết bị thật.
