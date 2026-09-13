import { ArrowLeft, LogIn, ShieldAlert, Trash2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router';

export default function AccountDeletionPage() {
  const navigate = useNavigate();

  return (
    <main className="min-h-screen bg-bg-primary px-4 py-8 text-text-primary">
      <div className="mx-auto max-w-2xl">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-sm font-black text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Quay lại
        </button>

        <section className="mt-6 rounded-2xl border border-border-primary bg-bg-secondary p-6 shadow-xl md:p-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-danger/10 text-danger">
            <Trash2 className="h-6 w-6" />
          </div>
          <h1 className="mt-5 text-2xl font-black">Yêu cầu xóa tài khoản Fitly</h1>
          <p className="mt-3 text-sm font-semibold leading-6 text-text-secondary">
            Bạn có thể tự xóa tài khoản và dữ liệu trực tiếp sau khi đăng nhập. Fitly yêu cầu xác nhận lại mật khẩu để ngăn người khác xóa nhầm tài khoản của bạn.
          </p>

          <ol className="mt-6 space-y-3 text-sm font-semibold leading-6 text-text-secondary">
            <li>1. Đăng nhập vào Fitly.</li>
            <li>2. Mở Hồ sơ, chọn biểu tượng Cài đặt.</li>
            <li>3. Chọn “Xóa tài khoản và dữ liệu”.</li>
            <li>4. Nhập mật khẩu và từ XÓA để xác nhận.</li>
          </ol>
          <p className="mt-4 text-sm leading-6 text-text-secondary">Trên ứng dụng Android/iOS: Hồ sơ → Quyền riêng tư và tài khoản → Xóa tài khoản. Đăng ký App Store/Google Play không tự hủy khi xóa tài khoản; hãy hủy gia hạn trong cửa hàng nếu bạn muốn dừng thanh toán.</p>
          <Link to="/support" className="mt-4 inline-block text-accent">Cần hỗ trợ xóa dữ liệu?</Link>

          <div className="mt-6 rounded-xl border border-danger/20 bg-danger/5 p-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
              <p className="text-sm font-semibold leading-6 text-text-secondary">
                Hồ sơ, dữ liệu sức khỏe, lịch tập, thực đơn, hội thoại AI và ảnh đại diện sẽ bị xóa vĩnh viễn. Thao tác không thể hoàn tác.
              </p>
            </div>
          </div>

          <Link
            to="/login"
            className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-black text-text-inverse"
          >
            <LogIn className="h-4 w-4" />
            Đăng nhập để xóa tài khoản
          </Link>
        </section>
      </div>
    </main>
  );
}
