# Fitly — Checklist kiểm duyệt trước khi phát hành app

Cập nhật: 28/07/2026

Quy ước:

- `[x]`: đã thực hiện và đã có kiểm tra tự động.
- `[~]`: đã giảm thiểu rủi ro, còn việc phải làm trước khi mở tính năng/phát hành.
- `[ ]`: chưa hoàn thành hoặc cần xác nhận thủ công.

## 1. Bảo mật Supabase

- [x] Đã áp dụng migration `20260728053215_harden_auth_profiles_and_rpc.sql` lên project production `TrendFit`.
- [x] Người dùng không thể cập nhật `role`, `membership_tier`, hạn gói, purchase flags, EXP hoặc level.
- [x] Các cột hồ sơ thông thường vẫn cập nhật được: tên, ngày sinh, avatar và cấu hình Telegram.
- [x] Backend không còn xác định admin từ `profiles.role`; quyền admin đọc từ Auth `app_metadata`.
- [x] Tài khoản admin hiện tại đã được đồng bộ sang Auth `app_metadata`.
- [x] Role `anon` không còn quyền trên các bảng `public`.
- [x] RPC `sync_challenge_checkin_for_user` và các hàm trigger/helper không còn gọi được bởi browser role.
- [x] Hai RPC xuất cấu trúc/toàn bộ dữ liệu database đã bị loại bỏ.
- [x] Avatar chỉ được list/update/delete trong thư mục UUID của chính người dùng.
- [x] Avatar bị giới hạn 5 MB và chỉ nhận JPEG, PNG, WebP hoặc GIF.
- [x] Các hàm database đã có `search_path` cố định.
- [x] Đã tắt `pg_graphql` vì dự án chỉ dùng PostgREST/Supabase JS.
- [x] File `supabase/verify_security_hardening.sql` trả về 7/7 kết quả `PASS`.
- [x] Đã kiểm tra transaction mô phỏng: cập nhật hồ sơ an toàn hoạt động, cập nhật membership trực tiếp bị từ chối.
- [x] Challenge RPC dành cho người đăng nhập vẫn hoạt động sau khi thu hồi quyền.
- [~] Supabase Advisor còn 10 cảnh báo `SECURITY DEFINER` cho các Challenge RPC chủ động gọi từ frontend. Các hàm đều lấy người dùng từ `auth.uid()`; đây là quyền có chủ đích, không phải anonymous exposure.
- [~] Ba bảng service-only không có RLS policy nhưng đã bị thu hồi toàn bộ quyền `anon` và `authenticated`; chỉ backend service role sử dụng.
- [ ] Bật Leaked Password Protection trong Supabase Dashboard nếu project đang dùng gói Pro trở lên.

## 2. Thanh toán và membership

- [x] Endpoint `/api/membership/renew` không còn tự cấp Plus/Pro.
- [x] Giao diện Premium không còn gửi yêu cầu kích hoạt gói giả.
- [x] Membership và purchase flags không thể sửa trực tiếp từ Supabase client.
- [~] Plus/Pro đang hiển thị trạng thái “Sắp mở bán”, an toàn để tiếp tục phát triển.
- [ ] Tạo product/subscription trên App Store Connect và Google Play Console.
- [ ] Tích hợp StoreKit/Google Play Billing hoặc RevenueCat.
- [ ] Xác thực receipt phía server và cập nhật entitlement bằng webhook đáng tin cậy.
- [ ] Kiểm tra restore, renew, cancel, refund, grace period và chuyển gói.

## 3. Xóa tài khoản và quyền riêng tư

- [x] Có API `DELETE /api/account`, bắt buộc access token và chuỗi xác nhận.
- [x] Người dùng phải nhập lại mật khẩu trước khi gửi lệnh xóa.
- [x] Auth user, profile và dữ liệu có foreign key cascade được xóa.
- [x] Đã bổ sung `ON DELETE CASCADE` cho `user_custom_foods`, không còn bảng dữ liệu người dùng bị bỏ sót.
- [x] Ảnh avatar được xóa trước khi xóa Auth user.
- [x] Có trang công khai `/account-deletion` hướng dẫn yêu cầu xóa tài khoản.
- [ ] Chạy thử luồng xóa bằng tài khoản test trên staging; không dùng tài khoản production thật.
- [ ] Bổ sung pháp nhân, email hỗ trợ, thời hạn lưu backup/log và danh sách nhà xử lý dữ liệu vào Privacy Policy.
- [ ] Điền Apple App Privacy, Google Data Safety và Health Apps Declaration.

## 4. Dependency và build

- [x] Frontend `npm audit`: 0 vulnerability.
- [x] Backend `npm audit`: 0 vulnerability.
- [x] Đã loại bỏ `axios`, `xlsx` và type package cũ không sử dụng.
- [x] Đã nâng `node-telegram-bot-api` lên 1.2.0 và cập nhật type import.
- [x] Đã nâng React Router lên 8.3.0 và React lên 19.2.8.
- [x] Đã pin `@supabase/supabase-js` 2.110.9 và giữ package lock trong Git.
- [x] Frontend TypeScript lint đạt.
- [x] Frontend production build đạt.
- [x] Backend TypeScript typecheck đạt.
- [x] Backend local smoke test đạt: health check trả `200`; endpoint gia hạn và xóa tài khoản đều chặn request chưa đăng nhập bằng `401`.
- [x] Đã tách route bằng `React.lazy`; main bundle giảm từ khoảng 1.130 KB xuống 484 KB.
- [ ] Bổ sung unit, integration và E2E test; dự án hiện chưa có test suite đầy đủ.

## 5. Migration và vận hành

- [x] Ba migration mới có version local trùng version đã áp dụng trên Supabase.
- [x] Đã ngừng track các file `supabase/.temp` chứa trạng thái máy cục bộ.
- [x] Có SQL verification độc lập để chạy lại sau mỗi lần deploy database.
- [~] 29 migration lịch sử cũ chỉ có trên Supabase migration history, chưa có file SQL trong repo.
- [ ] Cài Docker Desktop hoặc PostgreSQL `pg_dump`, sau đó tạo baseline schema có kiểm tra để lưu vào repo.
- [ ] Tạo Supabase project staging riêng và chạy migration/test ở staging trước những thay đổi tiếp theo.
- [ ] Kiểm tra backup và thử restore trước khi mở beta.

## 6. Deploy và kiểm tra nghiệm thu

- [ ] Deploy backend mới lên Render; nếu chưa deploy, endpoint xóa tài khoản và kiểm tra admin mới chưa có hiệu lực trên API production.
- [ ] Deploy frontend mới lên Vercel; nếu chưa deploy, Premium an toàn và trang xóa tài khoản mới chưa xuất hiện trên web production.
- [ ] Kiểm tra đăng ký, xác minh email, đăng nhập và reset password.
- [ ] Kiểm tra hoàn thành survey và cập nhật hồ sơ.
- [ ] Kiểm tra upload/replace avatar trên tài khoản thật.
- [ ] Kiểm tra tạo/join/check-in/leave Challenge.
- [ ] Kiểm tra AI Coach, quota, đổi bài tập và đổi món.
- [ ] Kiểm tra quyền admin bằng tài khoản admin và xác nhận tài khoản thường nhận HTTP 403.
- [ ] Kiểm tra Telegram Bot sau khi nâng SDK: polling, link tài khoản, menu, media và reminder.
- [ ] Kiểm tra xóa tài khoản trên staging và xác nhận dữ liệu/ảnh không còn.
- [ ] Theo dõi log Auth, Postgres, Storage và API ít nhất 24 giờ sau deploy.

## 7. App Store và Google Play

- [ ] Khởi tạo Capacitor và package ID cố định.
- [ ] Tạo project iOS/Android, deep link và universal/app links.
- [ ] Thêm push notification APNs/FCM.
- [ ] Thêm offline workout sync và xử lý mất mạng.
- [ ] Hoàn thiện native IAP trước khi mở Plus/Pro.
- [ ] Chuẩn bị icon 1024×1024, adaptive icon, splash và screenshots.
- [ ] TestFlight và Google Play internal/closed testing.
- [ ] Hoàn thiện privacy/support URLs, review notes và tài khoản demo.

## Tiêu chí cho phép phát hành beta

- [ ] Code hiện tại đã được deploy và smoke test trên production/staging.
- [ ] Không còn vulnerability mức critical/high.
- [ ] Không thể tự nâng admin hoặc membership.
- [ ] Xóa tài khoản hoạt động end-to-end.
- [ ] Thanh toán thật và restore purchase hoạt động, hoặc toàn bộ gói trả phí tiếp tục bị khóa.
- [ ] Core E2E auth → onboarding → workout/diet → progress đạt.
- [ ] Crash/error monitoring đã được cấu hình.
- [ ] Privacy/Data Safety/Health declarations khớp với dữ liệu thực tế.
