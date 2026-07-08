import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const sections = [
  {
    title: 'Thông tin chúng tôi thu thập',
    paragraphs: [
      'Fitly thu thập thông tin bạn cung cấp trực tiếp và dữ liệu phát sinh khi bạn sử dụng ứng dụng.',
    ],
    bullets: [
      'Thông tin tài khoản như tên, email, ảnh đại diện hoặc phương thức đăng nhập.',
      'Thông tin mục tiêu và hồ sơ như chiều cao, cân nặng, tuổi, giới tính, mức vận động và mục tiêu tập luyện.',
      'Dữ liệu sử dụng như lịch tập, thực đơn, calories, protein, tiến độ, thử thách và nội dung bạn nhập khi trò chuyện với AI Coach.',
      'Dữ liệu kỹ thuật như thiết bị, trình duyệt, nhật ký lỗi và thông tin bảo mật cần thiết để vận hành dịch vụ.',
    ],
  },
  {
    title: 'Cách chúng tôi sử dụng dữ liệu',
    bullets: [
      'Cá nhân hóa bài tập, thực đơn, mục tiêu và nhắc nhở hằng ngày.',
      'Cung cấp phản hồi từ AI Coach và cải thiện chất lượng gợi ý.',
      'Theo dõi tiến độ, hiển thị báo cáo và giúp bạn duy trì thói quen.',
      'Bảo vệ tài khoản, phát hiện lạm dụng và xử lý lỗi kỹ thuật.',
      'Gửi thông báo liên quan đến sản phẩm, tài khoản hoặc thay đổi quan trọng.',
    ],
  },
  {
    title: 'Xử lý dữ liệu bởi AI',
    paragraphs: [
      'Khi bạn dùng các tính năng AI, Fitly có thể gửi nội dung cần thiết như mục tiêu, lịch tập, nhật ký ăn uống hoặc câu hỏi của bạn tới hệ thống AI để tạo phản hồi.',
      'Bạn không nên nhập thông tin quá nhạy cảm, hồ sơ bệnh án chi tiết hoặc dữ liệu của người khác nếu không có quyền.',
    ],
  },
  {
    title: 'Chia sẻ thông tin',
    paragraphs: [
      'Fitly không bán dữ liệu cá nhân của bạn. Chúng tôi chỉ chia sẻ dữ liệu khi cần thiết để vận hành dịch vụ hoặc khi pháp luật yêu cầu.',
    ],
    bullets: [
      'Nhà cung cấp hạ tầng, xác thực, cơ sở dữ liệu, phân tích lỗi, thanh toán hoặc thông báo.',
      'Đối tác AI xử lý dữ liệu theo yêu cầu tính năng bạn sử dụng.',
      'Cơ quan có thẩm quyền khi có yêu cầu hợp lệ theo pháp luật.',
    ],
  },
  {
    title: 'Bảo mật và lưu trữ',
    paragraphs: [
      'Chúng tôi áp dụng các biện pháp kỹ thuật và tổ chức hợp lý để bảo vệ dữ liệu khỏi truy cập, mất mát hoặc sử dụng trái phép.',
      'Dữ liệu được lưu trong thời gian cần thiết để cung cấp dịch vụ, đáp ứng nghĩa vụ pháp lý hoặc giải quyết tranh chấp.',
    ],
  },
  {
    title: 'Quyền của bạn',
    bullets: [
      'Xem, cập nhật hoặc chỉnh sửa thông tin tài khoản và hồ sơ.',
      'Yêu cầu xóa tài khoản hoặc dữ liệu cá nhân khi điều kiện pháp lý cho phép.',
      'Tắt một số thông báo không bắt buộc.',
      'Liên hệ Fitly nếu bạn muốn hỏi về cách dữ liệu của mình được xử lý.',
    ],
  },
  {
    title: 'Người dùng trẻ tuổi',
    paragraphs: [
      'Fitly không hướng tới trẻ em dưới 13 tuổi. Nếu chúng tôi phát hiện dữ liệu được cung cấp bởi người dùng không đủ tuổi theo quy định, dữ liệu đó có thể bị xóa.',
    ],
  },
  {
    title: 'Cập nhật chính sách',
    paragraphs: [
      'Khi chính sách bảo mật thay đổi, Fitly sẽ cập nhật ngày hiệu lực và thông báo nếu thay đổi có ảnh hưởng đáng kể đến quyền riêng tư của bạn.',
    ],
  },
];

export default function PrivacyPolicyPage() {
  const navigate = useNavigate();

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate('/');
  };

  return (
    <div className="min-h-[100dvh] w-full flex-1 overflow-x-hidden bg-[#0b0d10] text-text-primary">
      <div className="pointer-events-none fixed inset-0 bg-[#0b0d10]" />

      <header className="relative z-10 border-b border-white/[0.06] bg-[#0b0d10]">
        <div className="mx-auto flex h-20 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <button type="button" onClick={() => navigate('/')} className="flex min-w-0 items-center gap-3 text-left">
            <img src="/logo.svg" alt="Fitly" className="h-10 w-10 shrink-0 object-contain" />
            <span className="min-w-0">
              <span className="block truncate text-base font-black text-text-primary sm:text-lg">Fitly</span>
              <span className="mt-0.5 block truncate text-xs font-semibold text-text-tertiary">Trợ lý cá nhân</span>
            </span>
          </button>
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 px-1 text-sm font-black text-text-secondary transition-colors hover:text-accent"
          >
            <ArrowLeft className="h-4 w-4" />
            Quay lại
          </button>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 md:py-16 lg:px-8">
        <div className="text-left">
          <h1 className="text-4xl font-black leading-tight tracking-normal text-text-primary sm:text-5xl">
            Chính Sách Bảo Mật
          </h1>
          <p className="mt-4 text-sm font-semibold text-text-tertiary">Cập nhật lần cuối: Tháng 7, 2026</p>
        </div>

        <div className="mt-10">
          <div className="space-y-8">
            {sections.map((section, index) => (
              <section
                key={section.title}
                className="border-t border-white/[0.07] pt-8 first:border-t-0 first:pt-0"
              >
                <h2 className="text-xl font-black leading-8 text-text-primary">
                  {index + 1}. {section.title}
                </h2>
                {section.paragraphs?.map((paragraph) => (
                  <p key={paragraph} className="mt-4 text-sm font-semibold leading-7 text-text-secondary">
                    {paragraph}
                  </p>
                ))}
                {section.bullets ? (
                  <ul className="mt-5 space-y-3">
                    {section.bullets.map((bullet) => (
                      <li key={bullet} className="flex gap-3 text-sm font-semibold leading-7 text-text-secondary">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>
        </div>

        <div className="mt-8 flex items-start gap-3 rounded-lg border border-accent/25 bg-accent/10 p-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
          <p className="text-sm font-semibold leading-7 text-text-secondary">
            Nếu bạn cần làm rõ quyền riêng tư, hãy liên hệ Fitly qua kênh hỗ trợ trong ứng dụng.
          </p>
        </div>
      </main>
    </div>
  );
}
