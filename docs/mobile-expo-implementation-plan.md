# Kế hoạch triển khai Fitly Mobile (Expo)

**Trạng thái:** Lập kế hoạch — chưa khởi tạo ứng dụng

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
- Kết nối Apple HealthKit (iOS) và Health Connect (Android) với sự đồng ý rõ ràng của người dùng.
- Android emulator, Android thiết bị thật và build nội bộ.

### Ngoài phạm vi V1

- Admin Panel.
- Challenges, Premium checkout và Telegram bot.
- Thay đổi schema, migration hoặc thay thế Express Backend.
- Đồng bộ offline có thể ghi dữ liệu; chỉ triển khai cache đọc ở V1.
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
| Health data | `daily_progress_logs` đã có calories burned, workout duration và sleep hours | Có thể đồng bộ aggregate dữ liệu V1 mà không cần migration. |

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

### Kiến trúc health platform

```text
iOS: Apple HealthKit ─────┐
                            ├─ Health service trên thiết bị
Android: Health Connect ───┘   ├─ Permission + consent + sync toggle
                               ├─ Aggregate theo ngày
                               └─ Progress UI / daily_progress_logs
```

- **Apple HealthKit** chỉ dành cho iPhone/Apple Watch. HealthKit yêu cầu quyền theo từng data type và không cho app biết rõ người dùng đã từ chối quyền đọc; app phải xử lý trạng thái không có dữ liệu một cách tôn trọng riêng tư. [Apple HealthKit](https://developer.apple.com/documentation/healthkit), [HealthKit authorization](https://developer.apple.com/documentation/HealthKit/authorizing-access-to-health-data)
- **Health Connect** là tương đương trên Android. Android 14+ có Health Connect trong hệ thống; Android 13 trở xuống cần cài ứng dụng Health Connect. App cần khai báo permission theo data type, có màn hình giải thích privacy và khai báo quyền tương ứng trong Play Console. [Android Health Connect](https://developer.android.com/health-and-fitness/health-connect/get-started)
- Cả hai cần native bridge/configuration, nên không chạy được hoàn chỉnh bằng Expo Go. Dùng Expo development build cho feature này.

### Cấu hình môi trường mobile

`Mobile/.env` chỉ chứa các giá trị public:

```env
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
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
- Native bridge tương thích Expo cho HealthKit và Health Connect; chọn package/config plugin sau khi chốt Expo SDK để tránh dependency native không tương thích.

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

### Milestone 0 — Chốt hướng sản phẩm, visual và health consent

- Chọn tên hiển thị, Android application ID, icon và màu thương hiệu.
- Chốt Android-first cho UI delivery, đồng thời giữ iOS là target chính thức cho HealthKit.
- Chốt 5 tab và phạm vi V1 ở trên.
- Chốt direction **Premium Performance & Serenity**, dark mode strategy, app icon và asset direction.
- Chốt data Health V1: steps, active calories, exercise sessions và sleep. Không xin heart rate/clinical records/location.
- Chốt rõ dữ liệu nào chỉ hiển thị trên máy, dữ liệu nào được phép đồng bộ lên Fitly.

**Hoàn thành khi:** có danh sách màn hình V1, style direction và health consent scope được duyệt.

### Milestone 1 — Khởi tạo Expo foundation

- Khởi tạo project trong `Mobile/` bằng Expo Router + TypeScript.
- Thiết lập app config, icon/splash placeholder, ESLint và aliases.
- Thiết lập `.env.example`, Supabase client, SecureStore adapter và API client.
- Chạy được trên Android emulator bằng development build.

**Hoàn thành khi:** app mở trên emulator, đọc cấu hình đúng và chưa có secret trong Git.

### Milestone 2 — Navigation và design system

- Dựng root layout, auth gate, tab navigation và stack navigation.
- Tạo foundation: color, spacing, typography, radius, elevation và dark/light strategy (nếu được chọn).
- Tạo reusable components: `Button`, `TextField`, `Card`, `Screen`, `EmptyState`, `LoadingState`, `ErrorState`, `BottomSheet`.
- Dựng shell cho 5 tab bằng mock data.

**Hoàn thành khi:** có thể điều hướng toàn bộ flow V1 trên emulator, không phụ thuộc UI web.

### Milestone 3 — Auth và onboarding

- Login/signup/reset password bằng Supabase Auth.
- Persist/refresh session qua SecureStore.
- API client tự gắn Bearer token hiện tại vào mọi API protected.
- Hiển thị onboarding hoặc dashboard theo trạng thái profile.

**Hoàn thành khi:** một tài khoản web hiện có có thể đăng nhập mobile và thấy đúng dữ liệu của chính mình.

### Milestone 4 — Core fitness MVP

- Home: today plan, summary và quick actions.
- Workout: plan, exercise list, session, complete set và completion.
- Meals: daily meal plan, macro và recipe detail.
- Profile/Progress: profile, body metrics và biểu đồ/summary phù hợp mobile.

**Hoàn thành khi:** dữ liệu ghi từ mobile hiển thị đúng ở web và ngược lại, vẫn tuân thủ RLS.

### Milestone 5 — AI Coach

- Chat UI tối ưu mobile, streaming/loading/error states theo API hiện có.
- Hiển thị quota, structured proposal và confirmation trước khi apply/reject.
- Xử lý rõ cold start, timeout và AI rate limit.

**Hoàn thành khi:** mobile dùng cùng AI flow với web mà không tự ý ghi thay đổi plan.

### Milestone 6 — Apple HealthKit và Android Health Connect

- Tạo `health` domain service với API chung cho iOS/Android, còn native provider được tách riêng theo platform.
- Thêm màn hình **Connected health** trong Profile: mô tả lợi ích, chọn data type, connect/disconnect và sync toggle.
- Xin quyền ngay khi user bấm kết nối, chỉ cho 4 data type V1: steps, active calories, exercise sessions, sleep.
- Đọc dữ liệu **aggregate theo ngày** thay vì lưu raw records. Lịch sử mặc định chỉ đồng bộ 7 ngày gần nhất.
- Mapping V1 vào dữ liệu Fitly hiện có:
  - active calories → `daily_progress_logs.calories_burned`
  - exercise duration → `daily_progress_logs.workout_duration`
  - sleep duration → `daily_progress_logs.sleep_hours`
  - steps → hiển thị trong mobile health card, chưa ghi database vì schema hiện tại chưa có field rõ nghĩa
- Không tự động ghi đè số người dùng đã nhập. Trước khi write cần có source/merge rule được duyệt; V1 an toàn nhất là hiển thị preview và user bấm **Sync today**.
- Không xin quyền background read hoặc đọc lịch sử hơn 30 ngày ở V1. Android có giới hạn mặc định 30 ngày từ khi cấp quyền và cần permission riêng cho lịch sử xa hơn. [Health Connect data access](https://developer.android.com/health-and-fitness/health-connect/read-data)
- iOS: cấu hình HealthKit entitlement và usage description. Android: manifest permissions, privacy rationale activity và khai báo Play Console theo data type.

**Hoàn thành khi:** user có thể connect/disconnect, sync dữ liệu aggregate được cấp quyền và vẫn dùng app bình thường khi không cấp quyền.

### Milestone 7 — Notifications, QA và Android/iOS delivery

- Local notifications cho nhắc tập/ăn/uống nước theo setting người dùng.
- Cache đọc cho Home, Workout và Meals; xử lý offline/error/retry.
- Test Android emulator và thiết bị thật: auth expiry, mạng chậm, thao tác workout, AI quota.
- Tạo internal Android build và iOS TestFlight build; chuẩn bị production `.aab`/iOS release sau khi QA đạt.

**Hoàn thành khi:** internal build cài được và checklist regression V1 đạt.

## 7. Quy tắc phân chia data access

| Loại tác vụ | Kênh ưu tiên | Lý do |
| --- | --- | --- |
| Login/session | Supabase Auth | Dùng chung user identity hiện có. |
| Đọc/ghi dữ liệu riêng của user đã có RLS | Supabase client | Không cần nhân bản endpoint đơn giản. |
| AI chat, AI plan, quota | Express API | Bảo vệ Groq key, limiter và business logic. |
| Workout mutation có endpoint | Express API | Tái sử dụng validation và logic đang chạy trên web. |
| Health aggregate được user xác nhận sync | Supabase client theo RLS hoặc API riêng khi cần merge rule | Không đẩy raw health records và không vượt quyền user. |
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
| Mapping tự động làm sai dữ liệu progress | Sync aggregate theo ngày, preview trước write và áp dụng source/merge rule rõ ràng. |

## 9. Checklist trước khi bắt đầu Milestone 1

- [ ] Chốt application name và Android package ID.
- [ ] Chốt visual direction (màu, dark mode có/không, reference screen).
- [ ] Chốt app icon, Android package ID và iOS bundle ID.
- [ ] Xác nhận URL production của Backend API.
- [ ] Lấy Supabase URL và publishable/anon key cho môi trường mobile.
- [ ] Có một test account không phải admin.
- [ ] Xác nhận emulator Android mở được từ Android Studio.
- [ ] Có thiết bị iPhone và Apple Developer account trước khi kiểm thử HealthKit/release iOS.
- [ ] Chuẩn bị Privacy Policy mô tả rõ cách đọc, đồng bộ và ngắt kết nối dữ liệu sức khỏe.
- [ ] Chốt 4 data type Health V1: steps, active calories, exercise sessions, sleep.
- [ ] Không đưa service role/Groq/Telegram secrets vào Mobile.

## 10. Definition of Done cho V1

- User đăng nhập được bằng cùng tài khoản web và thấy cùng dữ liệu.
- Workout, meals, profile/progress và AI Coach chạy được trên Android.
- Không có secret server trong source/app build.
- RLS và API authorization được kiểm thử với user thường.
- HealthKit/Health Connect chỉ xin quyền tối thiểu, có connect/disconnect và sync toggle rõ ràng.
- App hoạt động đầy đủ khi user không cấp bất kỳ health permission nào.
- App có loading, empty, error và retry state cho tất cả luồng chính.
- Có Android internal build đã kiểm thử trên emulator và thiết bị thật.
