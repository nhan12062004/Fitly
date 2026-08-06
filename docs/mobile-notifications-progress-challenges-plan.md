# Kế hoạch mobile: Theo dõi, thông báo, tiến độ và thử thách

Mục tiêu là đưa các dữ liệu đã có trên web (`daily_progress_logs`, `user_notifications`, thử thách) vào một trải nghiệm mobile gọn, ưu tiên hành động nhanh và có thông báo hệ thống thật trên iOS/Android.

## Quy ước hoàn thành

- Một mục chỉ được đánh dấu `[x]` sau khi đã có mã nguồn và kiểm tra phù hợp.
- Các mục cần thông báo native phải được kiểm tra thêm trên development build; Expo Go hoặc bản Android cũ không đủ để kết luận.
- Mọi lịch nhắc dùng múi giờ `Asia/Ho_Chi_Minh`, có chống gửi trùng và tôn trọng quyền hệ thống.
- Trạng thái hiện tại: `expo-dev-client` và cấu hình native notification đã có trong dự án. Bản Android đang cài trên máy được build trước thay đổi này, nên app chủ động tắt phần native notification để không treo; cần một development build Android/iOS mới để bật và kiểm thử mục 3.4–3.7.
- Android development build đã được gửi lên EAS Build ngày 05/08/2026; chỉ đánh dấu mục native sau khi cài APK và hoàn tất checklist trên thiết bị.

## Giai đoạn 1 — Nền tảng dữ liệu và điều hướng

- [x] 1.1 Kiểm tra và chuẩn hoá read model cho nước, giấc ngủ, mục tiêu hằng ngày và thông báo chưa đọc.
- [x] 1.2 Thêm các route mobile cho Theo dõi, Thông báo, Thử thách và chi tiết thử thách.
- [x] 1.3 Thêm chuông thông báo có badge trên trang Hôm nay; mở đúng trung tâm thông báo.

## Giai đoạn 2 — Theo dõi nước và giấc ngủ

- [x] 2.1 Tạo màn Theo dõi hằng ngày: nước và giấc ngủ có thiết kế riêng, chọn ngày và trạng thái trống.
- [ ] 2.2 Thêm ghi nước nhanh (`+250`, `+500`, tự nhập) với cập nhật lạc quan và đồng bộ `daily_progress_logs`.
- [ ] 2.3 Thêm ghi giấc ngủ qua bottom sheet; ghi số giờ và chất lượng ngủ khi dữ liệu hỗ trợ.
- [ ] 2.4 Đồng bộ hành động nước/ngủ với check-in thử thách hiện có.

## Giai đoạn 3 — Thông báo trong app và thông báo hệ thống

- [x] 3.1 Tạo trung tâm thông báo mobile: phân nhóm thời gian, đọc/chưa đọc, lọc và điều hướng sâu.
- [ ] 3.2 Thêm action nhanh cho nhắc nước và giấc ngủ từ hộp thư trong app.
- [x] 3.3 Thêm trang cài đặt nhắc nhở: từng loại nhắc, giờ nhắc, giờ yên tĩnh và trạng thái quyền.
- [ ] 3.4 Cài đặt `expo-notifications`, xin quyền theo ngữ cảnh và đăng ký thiết bị.
- [ ] 3.5 Lập lịch local notification cho nước, ngủ, bài tập và thực đơn; thay lịch khi cài đặt thay đổi.
- [ ] 3.6 Thêm push token/API backend cho AI Coach và thử thách; chống gửi trùng.
- [ ] 3.7 Kiểm thử notification trên Android development build và iPhone development build.

## Giai đoạn 4 — Tiến độ và thử thách

- [x] 4.1 Thiết kế lại Tiến độ: bộ chọn 7/30/90 ngày, nhịp tuần, chhể và thành tích.
- [x] 4.2 Tạo trang Thử thách: đang tham gia, khám phá, đã hoàn thành và trạng thái trống.
- [x] 4.3 Tạo/tham gia thử thách qua modal; hỗ trợ mục tiêu tập luyện, nước, ngủ và dinh dưỡng.
- [x] 4.4 Tạo trang chi tiết thử thách: lịch check-in, tiến độ nhóm/cá nhân và thành viên.
- [ ] 4.5 Đồng bộ tự động từ bài tập, nước, ngủ và bữa ăn vào thử thách.

## Giai đoạn 5 — Hoàn thiện và phát hành thử

- [ ] 5.1 Rà soát safe area, bàn phím, màn hình nhỏ và khả năng chạm trên iOS/Android.
- [ ] 5.2 Kiểm tra TypeScript, lint và các luồng lỗi/mất mạng.
- [x] 5.3 Lập checklist test thủ công: app mở, nền, tắt hẳn, từ chối quyền, đổi múi giờ và bấm notification action.
- [ ] 5.4 Tạo development build iOS/Android để kiểm thử thông báo native.

## Checklist kiểm thử thủ công

### Luồng app hằng ngày

- [x] App mở lại trên Android development client cũ mà không hiện red screen hoặc treo splash.
- [ ] Ghi `+250 ml`, xác nhận số nước tăng tức thì, tắt/mở app và đối chiếu `daily_progress_logs`.
- [ ] Ghi giờ ngủ, xác nhận số giờ đổi tức thì, tắt/mở app và đối chiếu `daily_progress_logs`.
- [ ] Với thử thách nước/ngủ đang hoạt động, xác nhận hành động trên tạo check-in đúng một lần trong ngày.
- [ ] Tạo thử thách mới cho từng mục tiêu: tập luyện, nước, ngủ, dinh dưỡng và linh hoạt.
- [ ] Điểm danh thử thách linh hoạt; thử thách có mục tiêu cụ thể phải dẫn tới đúng trang hành động thay vì cho điểm danh tay.

### Notification native (sau khi cài development build mới)

- [ ] Lần mở đầu: chọn Cho phép quyền; token thiết bị được đăng ký và lịch local được tạo.
- [ ] Từ chối quyền: app vẫn dùng được, trang Nhắc nhở hiển thị trạng thái rõ ràng và không tạo lịch hệ thống.
- [ ] Chuyển app nền/tắt hẳn: nhắc nước, ngủ, tập và bữa ăn xuất hiện đúng giờ tại `Asia/Ho_Chi_Minh`.
- [ ] Giờ yên tĩnh 22:30–07:00 chặn các lịch rơi trong khoảng này.
- [ ] Bấm notification nước/ngủ mở Theo dõi; Coach mở AI Coach; thử thách mở đúng chi tiết thử thách.
- [ ] Sau 15 phút, kiểm tra push receipt và tắt token có lỗi `DeviceNotRegistered`.
- [ ] Lặp lại trên iPhone development build, kiểm tra safe area, quyền iOS và badge.
