# Fitly — tình trạng chuẩn bị phát hành

Cập nhật: 12/09/2026. Đây là kết quả kiểm tra mã nguồn và hướng dẫn phát hành, **chưa phải xác nhận đủ điều kiện gửi duyệt**. Chưa triển khai backend/web, chưa áp dụng migration lên Supabase, chưa tạo giao dịch thật, chưa gửi app lên cửa hàng.

## Những thay đổi đã thực hiện

- Mobile dùng cache dữ liệu theo tài khoản, loại dữ liệu, ngày Việt Nam và tham số màn hình. Trong 3 phút, quay lại màn hình dùng dữ liệu đã tải; dữ liệu cũ vẫn hiển thị khi làm mới thất bại. Cache chưa sử dụng được giữ tối đa 30 phút và xóa khi đổi tài khoản/đăng xuất. Cache chỉ nằm trong bộ nhớ: đóng hẳn app vẫn cần tải lại; đây chưa phải chế độ offline đầy đủ.
- Các màn hình chính dùng chung dữ liệu và yêu cầu đang chạy. Thông tin quota không chặn dữ liệu chính của trang chủ/hồ sơ. Cập nhật bài tập, bữa ăn, nhật ký và hồ sơ làm mới các dữ liệu liên quan.
- Đọc danh tính từ phiên đăng nhập cục bộ để tránh một lượt gọi xác thực dư; quyền đọc/ghi vẫn do RLS và backend kiểm tra. Request có giới hạn thời gian, hỗ trợ hủy, không tự gửi lại thao tác ghi khi timeout.
- Danh sách bài tập không tạo đồng thời nhiều trình phát video. Video vẫn có ở màn chi tiết/phiên tập. Đồng hồ nghỉ dùng thời điểm kết thúc, cập nhật lại khi app trở về foreground.
- Lịch sử Coach được tải lại từ server, giữ đề xuất và trạng thái áp dụng. Có báo cáo từng câu trả lời. Các nút camera/đính kèm chưa có luồng xử lý trong chat được bỏ; camera chọn ảnh đại diện vẫn hoạt động.
- Nhà cung cấp AI có timeout tổng và fallback khi model cấu hình không khả dụng. Bài tập hàng ngày nhận mục tiêu, thời lượng, địa điểm từ giao diện và vẫn áp dụng kiểm tra an toàn/danh mục bài tập.
- Premium dùng RevenueCat SDK để mua/khôi phục. Giá và chu kỳ lấy từ cửa hàng. Backend xác minh độc lập; client không được cấp quyền bằng cách gửi `tier` hoặc `userId` tùy ý. Quyền mua tách khỏi quyền giới thiệu/quản trị hiện có.
- Đồng ý gửi dữ liệu tới Groq được lưu theo tài khoản. Backend chặn AI khi chưa đồng ý; thu hồi trên web/mobile dừng các yêu cầu AI tiếp theo và kế hoạch tự động. Yêu cầu đã bắt đầu vẫn có thể hoàn tất.
- Có màn xóa tài khoản, chính sách offline trong mobile, chính sách/điều khoản dùng chung trên web, trang hỗ trợ và hộp phản hồi cho quản trị viên.
- Chuẩn bị EAS production AAB/iOS, version 1.0.0, target Android 36, loại quyền micro/kho ảnh rộng/dịch vụ nền chưa dùng; xin camera/thông báo theo nhu cầu. Không tự xin thông báo khi vừa mở app.

## Kiểm tra đã thực hiện

| Kiểm tra | Kết quả và giới hạn |
| --- | --- |
| Backend TypeScript + 86 kiểm thử | Qua; gồm kiểm tra xác thực webhook, quyền gửi/đọc phản hồi, consent AI, fallback model và hợp đồng API |
| Migration mới | Qua trên PostgreSQL WASM cô lập bằng PGlite: thực thi SQL, RLS đọc đúng chủ, chặn ghi quyền Premium từ client, bỏ qua snapshot cũ, consent đúng chủ và cascade khi xóa. Chưa kiểm tra toàn bộ lịch sử migration trên staging Supabase |
| Mobile TypeScript, ESLint, 6 kiểm thử cache | Qua; bao gồm gộp yêu cầu, giữ dữ liệu khi lỗi, phân tách tài khoản/ngày, xóa cache và phản hồi đến muộn |
| Expo export iOS/Android/web | Qua; đây là bundle JS/Hermes, chưa phải IPA/AAB đã ký |
| Giao diện web mobile 393 × 852 | Đăng nhập, chính sách công khai, tài khoản giả lập, màn tập/modal, Premium chưa cấu hình: không có lỗi JavaScript. Toàn bộ request bên ngoài được chặn/giả lập, không ghi dữ liệu thật |
| Quay lại tab Tập luyện trong kiểm tra giao diện | Một request bài tập trước khi chuyển tab, vẫn một request sau khi quay lại. Đây là số request ở kịch bản giả lập, không phải phép đo độ trễ mạng thật |
| Web Vite production + Playwright | Qua build và smoke trang công khai |
| Pixel 7/iPhone native | Chưa kiểm tra: không có thiết bị/emulator kết nối trong môi trường hiện tại |
| Mua/khôi phục/hoàn tiền thực tế | Chưa kiểm tra: chưa có tài khoản cửa hàng, sản phẩm, khóa RevenueCat và sandbox |

Lệnh kiểm tra thông thường:

```bash
cd Backend
npm ci
npm run typecheck
npm test
```

```bash
cd Mobile
npm ci
npm run typecheck
npm run lint
npm test
npx expo install --check
npm run check:release
npx expo export --platform all
```

```bash
cd Frontend
npm ci
npm run lint
npm run build
npx playwright install chromium
npm run test:smoke
```

## Những việc còn chặn phát hành

1. **Danh tính và tài khoản phát hành:** cần Apple Developer, Play Console, pháp nhân/tên công khai, email hỗ trợ, thông tin thuế/thanh toán và quyền quản lý khóa ký. Nếu thuê người hỗ trợ phát hành, cần thống nhất quyền sở hữu app và quyền truy cập lâu dài; không giao mật khẩu/khóa bí mật trong chat.
2. **Premium:** tạo subscription/product trên hai cửa hàng, kết nối RevenueCat, điền mô tả quyền lợi chính xác, kiểm thử mua/khôi phục/hủy/hoàn tiền/chuyển tài khoản. Không gửi một bản production có trang mua trống.
3. **Hỗ trợ và chính sách:** hoàn tất tên đơn vị phát hành, email có người tiếp nhận, thời hạn lưu/xóa bản sao lưu và điều kiện nhà cung cấp; triển khai công khai `/privacy`, `/terms`, `/support`, `/account-deletion`. Hiện form hỗ trợ yêu cầu đăng nhập; cần kênh liên hệ công khai cho người không đăng nhập được.
4. **Nội dung nhóm:** báo cáo thử thách đã có, nhưng còn thiếu chặn người dùng, lọc/gỡ nội dung vi phạm và quy trình xử lý cụ thể. Không coi việc đánh dấu phản hồi “đã xử lý” là đã gỡ nội dung. Hoàn tất kiểm duyệt trước khi phát hành tính năng nhóm.
5. **Bản native:** tạo bản ký thực, kiểm tra trên Pixel 7 và iPhone, kiểm tra manifest hợp nhất, privacy manifest của SDK, native crash và thư viện Android với trang nhớ 16 KB. Export JS không xác minh các yêu cầu này.
6. **Dữ liệu và vận hành:** áp dụng migration trên staging trước, kiểm thử tài khoản mới, dữ liệu cũ, xóa tài khoản và rollback. Chốt người theo dõi phản hồi/crash, sao lưu và xử lý sự cố; backend cần sẵn sàng trong quá trình review. Nếu hosting có chế độ ngủ, cold start phải được xử lý ở cấu hình vận hành.
7. **Khai báo cửa hàng:** App Privacy, Data safety, Health apps declaration, xếp hạng độ tuổi, tài khoản review, ảnh chụp thật và quyền sử dụng media/danh mục. Không khai “không thu thập dữ liệu”: app xử lý tài khoản, dữ liệu thể chất, hội thoại và giao dịch.
8. **Thông báo:** kiểm tra lại nhận push sau đăng xuất/đổi tài khoản trước khi bật gửi push từ server. Lịch nhắc cục bộ đã tách theo tài khoản; RPC hủy đăng ký push khi đăng xuất chưa có.

## Thứ tự triển khai

1. Sao lưu và áp dụng lịch sử migration trên **staging**; kiểm tra riêng `supabase/migrations/20260912120000_store_entitlements_and_feedback.sql` (store rights, feedback, consent). Bản backend mới yêu cầu bảng consent cho mọi request AI. Không triển khai backend mới trước migration hoặc bỏ quên cập nhật client consent.
2. Triển khai backend và web tương ứng lên staging. Kiểm tra API có TLS, CORS đúng và Supabase redirect cho `fitly://sign-in`, `fitly://reset-password` cùng URL web thực tế. Test email xác thực và khôi phục trên thiết bị.
3. Tạo hai subscription ứng với quyền lợi Plus/Pro. Trong RevenueCat tạo entitlement `fitly_plus`, `fitly_pro`, liên kết sản phẩm và một offering hiện hành. SDK dùng UUID Supabase làm App User ID; không dùng email hoặc ID ẩn danh.
4. Thiết lập secret backend:
   - `REVENUECAT_SECRET_API_KEY`: khóa server cho API v1, không đặt trong mobile/web.
   - `REVENUECAT_WEBHOOK_AUTHORIZATION`: giá trị header Authorization đầy đủ, đủ mạnh; điền chính xác cùng giá trị ở cấu hình webhook.
   - `REVENUECAT_PLUS_ENTITLEMENT=fitly_plus`, `REVENUECAT_PRO_ENTITLEMENT=fitly_pro`.
   - `REVENUECAT_ALLOW_SANDBOX=true` chỉ trên backend/môi trường kiểm thử. Production mặc định `false`; xác định riêng backend phù hợp cho TestFlight/review để reviewer không bị mất quyền sau giao dịch sandbox.
   - `GROQ_API_KEY` và model đang được cấp quyền; ví dụ hiện tại `openai/gpt-oss-120b`. Fallback không khắc phục khóa hết hạn, hết hạn mức hay sự cố toàn dịch vụ.
5. Webhook RevenueCat trỏ tới `POST /api/subscriptions/webhook`. Bật các sự kiện vòng đời đăng ký, gồm chuyển tài khoản. Backend refetch trạng thái hiện hành khi nhận sự kiện; lỗi trả non-2xx để provider gửi lại. Không thêm JWT người dùng vào webhook.
6. Thiết lập EAS environment cho đúng ứng dụng:
   - `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_API_URL`.
   - `EXPO_PUBLIC_REVENUECAT_IOS_KEY` (`appl_…`), `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` (`goog_…`). Đây là khóa public của SDK, không phải khóa server.
   - `EXPO_PUBLIC_RELEASE_CHANNEL=production` đã được đặt trong profile production.
7. Chạy từ thư mục `Mobile`: `eas build --profile preview --platform android` để kiểm thử; sau khi vượt các mục chặn, dùng `eas build --profile production --platform all`. EAS phải được đăng nhập bởi tài khoản có quyền sở hữu project hiện cấu hình. Lệnh build có thể phát sinh chi phí theo tài khoản.
8. Kiểm tra archive có cả `shared/` ở root repo vì mobile sử dụng nội dung chính sách và danh mục dùng chung. `.easignore` bỏ native local để EAS prebuild từ `app.json` và plugin. Đừng upload riêng thư mục Mobile đã tách khỏi repo rồi bỏ mất shared.
9. Sau khi có bản ký đã kiểm thử và hồ sơ cửa hàng hoàn chỉnh mới dùng `eas submit --profile production --platform ios` / `android` hoặc tải thủ công lên console.

## Ma trận kiểm thử trước khi gửi

- Tài khoản mới/cũ; xác thực email; reset link mới/hết hạn; đăng xuất và đổi tài khoản khi request đang chạy.
- Mạng chậm, mất mạng khi mở màn hình, khi ghi set/bữa ăn, và khi provider AI lỗi. Không được tăng set/quota hai lần sau timeout.
- Quay lại tab trong/sau thời hạn cache; kéo làm mới; qua nửa đêm Việt Nam; đưa phiên tập xuống nền trong lúc nghỉ.
- Từ chối/đồng ý/thu hồi AI ở thiết bị A rồi gửi từ B; cron phải bỏ qua tài khoản đã thu hồi.
- Mua thành công/hủy/chờ duyệt/lỗi mạng sau thanh toán; khôi phục sau cài lại; hết hạn/grace period/hoàn tiền; không cấp Premium khi chỉ sửa payload; không mua lại vì đồng bộ tạm lỗi.
- Xóa tài khoản có/không có avatar, hội thoại, dữ liệu nhóm và gói đang gia hạn; kiểm tra dữ liệu Supabase/Storage/RevenueCat và giải thích phần cửa hàng tự lưu.
- Từ chối camera/thông báo; chọn ảnh; cỡ chữ lớn; bàn phím; nút Back Android; safe area iPhone; TalkBack/VoiceOver và độ tương phản.

## Nguồn chính thức đã đối chiếu

- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/): kiểm tra hoàn thiện app, IAP, quyền riêng tư, chia sẻ dữ liệu với AI và nội dung người dùng.
- [Google Play — xóa tài khoản](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en): luồng trong app và liên kết web công khai.
- [Android target API](https://developer.android.com/google/play/requirements/target-sdk): app mới/cập nhật từ 31/08/2026 cần target API 36, với các ngoại lệ theo loại thiết bị.
- [Google Play — Health apps declaration](https://support.google.com/googleplay/android-developer/answer/14738291?hl=en).
- [Google Play — AI-generated content](https://support.google.com/googleplay/android-developer/answer/13985936?hl=en-GB).
- [RevenueCat React Native](https://www.revenuecat.com/docs/getting-started/installation/reactnative), [API v1](https://www.revenuecat.com/docs/api-v1), [webhooks](https://www.revenuecat.com/docs/integrations/webhooks).
- [EAS Build với monorepo](https://docs.expo.dev/build-reference/build-with-monorepos/), [TanStack Query trên React Native](https://tanstack.com/query/latest/docs/framework/react/react-native).

Các yêu cầu cửa hàng cần được đối chiếu lại vào ngày gửi thực tế. Nội dung chính sách hiện là bản kỹ thuật dựa trên hành vi app, còn cần đơn vị phát hành hoàn tất thông tin vận hành và chịu trách nhiệm về các khai báo.
