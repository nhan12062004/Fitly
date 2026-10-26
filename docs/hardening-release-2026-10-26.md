# Fitly: bản hoàn thiện bảo mật và dữ liệu ngày 26/10/2026

## Phạm vi bàn giao

Thay đổi trong repo cho web, API, schema và các đường dữ liệu dùng chung với mobile. Chưa triển khai lên production hoặc thay đổi tài khoản cloud. Báo cáo audit ban đầu được giữ tại [production-readiness-audit-2026-10-26.md](production-readiness-audit-2026-10-26.md); các vị trí dòng trong báo cáo đó mô tả revision trước khi sửa.

| Audit | Đã triển khai |
| --- | --- |
| F01 referral | RPC yêu cầu tài khoản xác nhận email, referral không đổi/reset, ledger UNIQUE theo người được giới thiệu; web nhận mã lúc đăng ký và claim sau đăng nhập |
| F02 quota | Ledger backend cho mọi loại quota, backfill lịch sử; client không sửa/xóa adjustment hoặc tự ghi hội thoại assistant |
| F03 quota đồng thời | Admission RPC, giữ chỗ nguyên tử, khóa theo user, idempotency gắn hash nội dung, replay kết quả; giới hạn tác vụ và ngân sách gọi provider/token áp dụng cả cron |
| F04 thực đơn | API kiểm tra eligibility, version, snapshot sức khỏe và catalog; RPC lưu trong một transaction, giữ ID món còn dùng; web/mobile cùng dùng API; đổi món và tính lượt cùng luồng lưu |
| F05 tìm giá | Tắt mặc định; nếu bật chỉ gửi tên mặt hàng từ allowlist, không gửi nguyên câu hỏi; cache và timeout |
| F06 phân quyền | Auth chung trước API, dùng client RLS cho HTTP handlers cá nhân, service role rõ ở mutation hệ thống/RPC; role admin lấy từ app_metadata; MFA quản trị có màn hình thiết lập và kiểm tra AAL2 phía server |
| F07 toàn vẹn | Transaction cho hoàn thành set/buổi tập, khảo sát web, apply meal adjustment và xuất bản kế hoạch AI; version/số set mục tiêu chống retry; kế hoạch cũ giữ nguyên khi publication lỗi |
| F08 vận hành | Rate limit theo user sau Auth, hạn mức IP trước Auth, health không dùng quota chung; khóa job trong DB chống chạy trùng ngày/giờ; lệnh chạy cron riêng |
| F09 headers | CSP chống nhúng trang và object được enforce; CSP tài nguyên ở Report-Only để kiểm tra trước khi enforce đầy đủ; nosniff/referrer/permissions policy trên Vercel |
| F10 quyền riêng tư | Consent RPC có thời gian server và lịch sử; xuất dữ liệu JSON; yêu cầu đăng nhập gần đây để xóa; lưu trạng thái xóa và retry; chặn avatar mới khi đang xóa; hạn chế tên file; giảm tên thật trong prompt; loại dữ liệu nhạy cảm khỏi Sentry/error logs |
| F11 kiểm thử | PostgreSQL embedded chạy migrations thực, regression tests, E2E web; CI thêm Supabase local cho Auth/PostgREST/Storage/API và ownership pgTAP |
| F12 hiệu năng | Timeout DB và AI, deadline tác vụ AI, gom polling thông báo và ngừng poll khi tab ẩn; metrics vận hành; công cụ seed dữ liệu giả và đo tải staging |

Các helper nội bộ xử lý tác vụ hệ thống và RPC cần quyền đặc biệt vẫn dùng service role, với `user_id` đã xác minh. Migration không tự thu hồi Plus/Pro được cấp trong quá khứ vì profile hiện chưa phân biệt hoàn toàn nguồn cấp referral/admin. Cần rà soát lịch sử trước khi thay đổi quyền lợi thật.

## Quy tắc quota và retry

- Client mới gửi `Idempotency-Key`; cùng tài khoản + cùng key nhưng khác đường dẫn/nội dung bị từ chối.
- Mỗi user có tối đa một tác vụ AI đang chạy trong cửa sổ lease. Đồng thời có admission theo năng lực hệ thống và hạn mức provider trong DB, dùng chung giữa các instance.
- Lượt được giữ trước khi thực thi. Thành công xác nhận một lần. Lỗi đã biết trước khi ghi dữ liệu nghiệp vụ được hoàn lượt.
- Nếu timeout/crash có thể xảy ra sau khi dữ liệu đã commit, giữ reservation để tránh cấp thêm lượt cho kết quả chưa xác định. Không tự hoàn các lượt này. Dùng request ID/operation record để đối chiếu rồi hỗ trợ người dùng.
- Trong cùng phiên ứng dụng, web/mobile giữ mã yêu cầu khi kết nối không chắc chắn để retry cùng key. Đổi tài khoản/đăng xuất xóa bộ nhớ này. Sau reload/khởi động lại ứng dụng, cần tải lại kế hoạch/trạng thái trước khi tạo thao tác mới.
- Kết quả replay được dọn sau 7 ngày bởi privacy job; key và usage vẫn còn đến khi xóa tài khoản. Replay quá hạn trả 410, không chạy lại tác vụ.
- Token budget mặc định dùng ngày UTC. Nếu provider không trả usage vì lỗi mạng, giữ mức token dự trù bảo thủ. Ngân sách token là hàng rào kỹ thuật, không thay thế giới hạn chi tiêu trên tài khoản Groq.

## Thứ tự triển khai

**Đây là thay đổi cần phối hợp API, web và mobile.** Migration thu hồi các đường ghi trực tiếp cũ; không áp dụng riêng migration rồi tiếp tục vận hành client cũ như trước.

1. Trên staging riêng, tạo backup database và Storage; xác nhận có thể khôi phục. Chạy đủ CI, bao gồm job Supabase local và E2E.
2. Kiểm tra migration drift với schema thực tế, kiểm tra số referral/usage lịch sử. Migrations mới bắt đầu bằng `20261026090000` và kết thúc bằng `20261026104000`; bản cuối thu hồi quyền mặc định cũ của Supabase. `/ready` kiểm tra cả bản vá phân quyền này.
3. Chuẩn bị cùng phiên bản API, web và mobile. Thông báo/giới hạn client cũ khi cần, chọn cửa sổ bảo trì ngắn cho rollout đầu tiên.
4. Áp dụng migration lên staging trước, deploy API và client, chạy smoke tests bên dưới. `/ready` của API mới phải trả 200 sau khi đủ schema.
5. Cấu hình cron privacy và premium theo mô hình worker dưới đây; xác minh job thật đã chạy và có người nhận cảnh báo.
6. Đo tải staging, ghi kết quả p95/5xx/429/tài nguyên và chi phí AI. Chỉ chốt năng lực 1.000 tài khoản theo hồ sơ tải đã đo.
7. Thực hiện cùng quy trình cho production sau khi review kết quả staging và có backup mới. Thay đổi Vercel headers cần deploy frontend mới.

Rollback ứng dụng phải dùng phiên bản tương thích các RPC mới. Không khôi phục `GRANT ALL` cho client để chạy lại frontend cũ. Khi có sự cố, đặt `AI_ENABLED=false`, giữ các đường đọc và API lưu an toàn, rồi sửa bản tương thích. Nếu cần khôi phục dữ liệu, thực hiện theo phương án restore đã diễn tập, bao gồm dữ liệu xóa tài khoản cần loại lại sau restore.

## Cấu hình cần xác minh trên cloud

Các giá trị mẫu ở `Backend/.env.example` và `Frontend/.env.example`. Không commit secret.

- `NODE_ENV=production`; origin `FRONTEND_URL` chỉ gồm các domain thật. Xác minh số proxy hop với `trust proxy` hiện là 1.
- Supabase URL/service key/publishable key đúng môi trường. Bật xác nhận email, SMTP thật, redirect URL chính xác, mật khẩu ít nhất 8 ký tự gồm chữ thường/hoa/số; cấu hình chống bot và giới hạn Auth phù hợp.
- Bật TOTP trên Auth. Admin vào Hồ sơ → Xác minh hai bước cho quản trị để enroll/verify; production mặc định yêu cầu AAL2. Dùng `REQUIRE_ADMIN_MFA=true` để khai báo rõ chính sách. MFA tài khoản quản trị Supabase/hosting cũng cần bật riêng.
- `AI_ENABLED`, `AI_MAX_CONCURRENT`, `AI_DAILY_REQUEST_LIMIT`, `AI_DAILY_PROVIDER_CALL_LIMIT`, `AI_DAILY_TOKEN_LIMIT`: chọn theo ngân sách và quota Groq thực tế. Giá trị mặc định là điểm bắt đầu bảo thủ, chưa phải sizing cho 1.000 concurrent.
- Xác minh Groq Data Controls, chính sách lưu dữ liệu và lựa chọn Zero Data Retention. Rà soát vùng xử lý, độ tuổi/phạm vi dịch vụ và hồ sơ pháp lý về dữ liệu sức khỏe/chuyển dữ liệu với người phụ trách phù hợp.
- `MARKET_PRICE_SEARCH_ENABLED=false` mặc định. Nếu bật, kiểm tra request chỉ có tên mặt hàng và công bố DuckDuckGo đã có trong chính sách.
- `VITE_SUPPORT_EMAIL` phải là địa chỉ hỗ trợ thật trước khi công khai. Trường này hiển thị ở trang `/support` cho cả người chưa đăng nhập; không có địa chỉ giả trong repo.
- Backup cả database và file Storage, thời hạn lưu, RPO/RTO đã thống nhất; restore thử trên project riêng. Backup DB Supabase không bao gồm nội dung file Storage: [tài liệu chính thức](https://supabase.com/docs/guides/platform/backups).
- `SENTRY_DSN` nếu dùng; cấu hình người nhận cảnh báo, uptime monitor `/health` và `/ready`, log/metrics về 5xx/429, token budget, job thất bại và backlog xóa tài khoản.
- Kiểm tra CSP Report-Only với origin/API/media thực tế rồi enforce chính sách tài nguyên đầy đủ. Các chỉ thị chống nhúng trang/object đã được enforce ngay trong cấu hình mới.

Config Supabase local đã được làm chặt hơn; file local không tự áp dụng các lựa chọn Auth/SMTP/MFA lên project hosted.

## Chạy background jobs

Khuyến nghị web instances dùng `ENABLE_JOBS=false`, chạy các lệnh sau trong dedicated cron/worker, thư mục `Backend`, có cùng server secrets và schema:

```sh
npm run jobs:premium
npm run jobs:privacy
```

- Premium: mỗi ngày lúc 00:05 giờ Việt Nam, quyền sở hữu job theo ngày. Nếu nền tảng cron dùng UTC thì tương ứng 17:05 UTC ngày trước.
- Privacy: mỗi giờ phút 35, dọn kết quả replay và retry tối đa 100 yêu cầu xóa. Quyền sở hữu job theo giờ Việt Nam; dừng sớm khi lỗi nhà cung cấp lặp lại 5 lần.
- Cả hai có khóa UNIQUE trong DB nên cron trùng instance/triển khai không thực thi lại cùng run key. Job đang chạy/crash không được tự nhận lại; kiểm tra và đối chiếu trước khi can thiệp thủ công.
- Với một instance beta, `ENABLE_JOBS=true` vẫn hỗ trợ scheduler trong process; không dùng đồng thời hai cơ chế như hai nguồn lịch độc lập. DB guard giúp chống trùng, nhưng dedicated cron dễ theo dõi hơn.

`GET /api/ai/metrics` yêu cầu admin và MFA khi bật enforcement. Có các bộ đếm HTTP của instance, bucket latency, tổng lời gọi/token provider trong ngày, pending operations quá lease, job lỗi và số account đang chờ xóa. Bộ đếm HTTP reset khi restart; dùng log/monitoring bên ngoài để giữ lịch sử.

## Kiểm tra và xử lý sự cố

Smoke tests staging: đăng ký → xác nhận email → đăng nhập → claim referral; khảo sát; tạo kế hoạch; sửa thực đơn trên hai tab; hoàn thành set rồi retry cùng số; thu hồi consent; export JSON; enroll/verify MFA quản trị; xóa tài khoản có avatar; webhook RevenueCat bằng sandbox riêng.

Các tình huống bắt buộc:

- Không token trả 401; user thường không gọi được API admin; admin AAL1 không gọi được API admin khi enforcement bật.
- User A không đọc/ghi dữ liệu B; gọi trực tiếp Data API không sửa được ledger, membership, referral hoặc nội dung thực đơn.
- Khi còn một lượt, 20 request chỉ một request được reserve; replay không tạo thêm kế hoạch/usage.
- Lỗi SQL giữa thay thực đơn/xuất bản kế hoạch không làm mất kế hoạch cũ. Version cũ và snapshot sức khỏe đã thay đổi trả xung đột.
- Provider tắt/quá tải không làm mất dữ liệu; kết quả không chắc chắn phải tải lại/đối chiếu trước khi hoàn lượt.
- Xóa tài khoản xóa metadata/ledger/history liên kết và ảnh; nếu RevenueCat hoặc Storage lỗi, request còn trạng thái để retry. Không tự hủy đăng ký cửa hàng.

Truy vấn riêng cho operator, không đưa ra API người dùng:

```sql
-- Đối chiếu referral lịch sử, không tự thu hồi quyền cấp riêng/admin.
select p.id, p.referral_count, count(e.referred_user_id) as distinct_referrals
from public.profiles p left join public.referral_events e on e.referrer_id = p.id
group by p.id, p.referral_count
having p.referral_count <> count(e.referred_user_id);

-- Kết quả chưa xác định: kiểm tra kế hoạch/log trước khi hoàn hoặc thực thi lại.
select id, user_id, action, quota_key, created_at
from public.api_operations where state = 'pending' and expires_at < now();

select job_name, run_key, state, created_at, finished_at
from public.background_job_runs where state <> 'completed' order by created_at desc;
```

Không xóa operation keys để “retry cho nhanh”. Sau khi xác nhận một tác vụ không hề commit, operator có thể dùng `finish_api_operation` để ghi kết quả lỗi và hoàn reservation; việc điều chỉnh phải có đối chiếu/request ID và nhật ký vận hành.

## Seed và đo tải staging

Đọc `--help` trước. Các script không dùng credentials production theo mặc định; seeder/runner từ chối project trùng `Backend/.env`, runner cũng chặn hai host production đang ghi trong repo. Vẫn phải tự xác minh đúng project staging.

```sh
cd Backend
node scripts/seed-staging.mjs --help
node scripts/load-test.mjs --help
```

Thiết lập bằng secret manager hoặc biến môi trường phiên shell, không đưa key/token vào command history:

```text
LOAD_CONFIRM_STAGING=FITLY_STAGING_ONLY
LOAD_SUPABASE_URL=<staging>
LOAD_SUPABASE_SERVICE_ROLE_KEY=<server secret, chỉ seeder>
LOAD_SUPABASE_KEY=<staging publishable/anon key>
LOAD_USERS=1000
LOAD_SESSION_COUNT=100
LOAD_API_URL=<API staging>
LOAD_FIXTURES_FILE=load-fixtures/sessions.json
LOAD_VUS=10,50,100
LOAD_PHASE_SECONDS=600
LOAD_REPORT_FILE=/tmp/fitly-load-report.json
```

```sh
npm run load:seed
npm run test:load
node scripts/seed-staging.mjs --cleanup
```

Seeder tạo 1.000 tài khoản giả với 90 ngày progress/body metrics và lịch tập, sau đó tạo 100 phiên kiểm thử. Cần Auth rate limit riêng của staging cho việc tạo phiên; không nới rate limit production. File session/manifest có quyền 0600 trong thư mục bị Git ignore; không đưa vào CI artifacts hoặc gửi qua chat. Cleanup chỉ xóa user trong manifest của đúng project.

Runner dùng một user khác nhau cho mỗi virtual user; thử API profile/quota và đọc/ghi progress trực tiếp qua RLS, có think time. Xuất p50/p95/p99, 5xx/network errors, 429 và các mã trạng thái. Không ghi token, dữ liệu sức khỏe, user ID hoặc body vào report. Không gọi AI thật. Phiên phải còn hạn cho cả bài đo; runner kiểm tra trước khi bắt đầu.

Mục tiêu ban đầu: 100 phiên hoạt động trong hồ sơ tải trên, API thường p95 < 1 giây, lỗi 5xx/network < 1%, không có 401/403/429 ngoài dự kiến, CPU/RAM/DB có dư địa. Thử AI thật riêng với ngân sách nhỏ và đo thêm quota/provider latency; bài đo này không chứng minh 1.000 concurrent hoặc mọi luồng sản phẩm.

## Kết quả xác minh

Lượt xác minh local ngày 26/10/2026: 38 test backend đạt, 8 E2E web đạt trên Chrome, typecheck backend/web/mobile đạt, web build đạt, mobile lint và kiểm tra cấu hình release cơ bản đạt; audit dependency backend/frontend không báo lỗ hổng. Supabase CLI xác nhận không có Docker engine trên máy nên chưa chạy được job integration đầy đủ của nền tảng. Chưa chạy các script seed/load lên cloud.

Kết quả cuối cùng được ghi trong phản hồi bàn giao và có thể chạy lại bằng:

```sh
cd Backend
npm test
npm run typecheck
cd ../Frontend
npm run lint
npm run build
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e
cd ../Mobile
npm run typecheck
npm run lint
```

E2E local dùng Chrome cài sẵn; CI cài Chromium theo bản Playwright đã pin. Bộ PostgreSQL embedded xác minh schema/policy/transaction thật với stubs cho lớp Auth/Storage của nền tảng. Job Supabase local kiểm tra thêm Auth/PostgREST/Storage/API; cần Docker và chưa được xác nhận chạy thành công trên máy hiện tại. Chưa chạy load test hay diễn tập restore trên cloud; không tuyên bố năng lực 1.000 người dùng đã được đo.
