import { AlertTriangle, ArrowLeft, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const sections = [
  {
    title: 'Chấp nhận điều khoản',
    paragraphs: [
      'Khi tạo tài khoản, truy cập hoặc sử dụng Fitly, bạn đồng ý tuân thủ các điều khoản này. Nếu bạn không đồng ý, vui lòng ngừng sử dụng dịch vụ.',
      'Fitly có thể cập nhật điều khoản khi sản phẩm thay đổi. Các thay đổi quan trọng sẽ được thông báo trong ứng dụng hoặc trên website.',
    ],
  },
  {
    title: 'Mô tả dịch vụ',
    paragraphs: [
      'Fitly cung cấp công cụ hỗ trợ xây dựng thói quen tập luyện và ăn uống, bao gồm lịch tập, thực đơn tham khảo, theo dõi chỉ số, thử thách và trò chuyện với AI Coach.',
    ],
    bullets: [
      'Kế hoạch được cá nhân hóa dựa trên thông tin bạn cung cấp.',
      'Nội dung AI tạo ra nhằm hỗ trợ ra quyết định, không tự động thay bạn thực hiện kế hoạch.',
      'Một số tính năng có thể yêu cầu tài khoản, credit AI hoặc gói trả phí.',
    ],
  },
  {
    title: 'Tuyên bố miễn trừ y tế',
    paragraphs: [
      'Fitly không phải là dịch vụ y tế, bác sĩ, chuyên gia dinh dưỡng lâm sàng hoặc huấn luyện viên cá nhân được cấp phép cho từng người dùng.',
    ],
    callout:
      'Các gợi ý về tập luyện, calories, protein và thực đơn chỉ mang tính tham khảo. Hãy hỏi ý kiến chuyên gia y tế trước khi bắt đầu nếu bạn có bệnh nền, chấn thương, đang mang thai hoặc có chế độ ăn đặc biệt.',
  },
  {
    title: 'Tài khoản người dùng',
    paragraphs: [
      'Bạn chịu trách nhiệm bảo mật thông tin đăng nhập và mọi hoạt động diễn ra trong tài khoản của mình.',
      'Thông tin hồ sơ, mục tiêu, lịch tập và dữ liệu dinh dưỡng bạn cung cấp cần chính xác ở mức hợp lý để Fitly có thể đưa ra gợi ý phù hợp hơn.',
    ],
  },
  {
    title: 'Thanh toán và gói dịch vụ',
    paragraphs: [
      'Fitly có thể cung cấp gói miễn phí, gói trả phí hoặc credit AI. Giá, quyền lợi và chu kỳ thanh toán sẽ được hiển thị trước khi bạn xác nhận mua.',
      'Việc hoàn tiền, hủy gia hạn hoặc thay đổi gói sẽ tuân theo chính sách hiển thị tại thời điểm mua và quy định pháp luật áp dụng.',
    ],
  },
  {
    title: 'Hành vi không được phép',
    bullets: [
      'Sử dụng Fitly để gây hại, quấy rối, lừa đảo hoặc vi phạm pháp luật.',
      'Cố gắng truy cập trái phép vào hệ thống, dữ liệu hoặc tài khoản của người khác.',
      'Sao chép, bán lại, khai thác hàng loạt hoặc đảo ngược kỹ thuật dịch vụ khi chưa được cho phép.',
      'Cung cấp dữ liệu sai lệch nhằm phá vỡ hoạt động của hệ thống hoặc AI.',
    ],
  },
  {
    title: 'Giới hạn trách nhiệm',
    paragraphs: [
      'Fitly cố gắng duy trì dịch vụ ổn định và hữu ích, nhưng không đảm bảo mọi gợi ý luôn chính xác tuyệt đối hoặc phù hợp với mọi tình huống cá nhân.',
      'Bạn là người quyết định cuối cùng khi áp dụng bài tập, thực đơn hoặc lời khuyên từ AI Coach.',
    ],
  },
  {
    title: 'Liên hệ',
    paragraphs: [
      'Nếu bạn có câu hỏi về điều khoản dịch vụ, vui lòng liên hệ Fitly qua kênh hỗ trợ trong ứng dụng hoặc thông tin liên hệ được công bố trên website.',
    ],
  },
];

export default function TermsOfServicePage() {
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
            <img src="/logo.png" alt="Fitly" className="h-10 w-10 shrink-0 object-contain" />
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
            Điều Khoản Dịch Vụ
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
                {section.callout ? (
                  <div className="mt-5 flex gap-3 rounded-lg border border-warning/35 bg-warning/10 p-4 text-warning">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                    <p className="text-sm font-bold leading-7">{section.callout}</p>
                  </div>
                ) : null}
              </section>
            ))}
          </div>
        </div>

        <div className="mt-8 flex items-start gap-3 rounded-lg border border-accent/25 bg-accent/10 p-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
          <p className="text-sm font-semibold leading-7 text-text-secondary">
            Nếu bạn cần làm rõ điều khoản sử dụng, hãy liên hệ Fitly qua kênh hỗ trợ trong ứng dụng.
          </p>
        </div>
      </main>
    </div>
  );
}
