import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { fetchWithAuth } from '../lib/Api';
import { useAuth } from '../contexts/AuthContext';
import FitlyLogo from '../components/FitlyLogo';

export default function SupportPage() {
  const { user } = useAuth();
  const supportEmail = import.meta.env.VITE_SUPPORT_EMAIL?.trim();
  const [params] = useSearchParams();
  const targetType = params.get('target_type');
  const targetId = params.get('target_id');
  const context = params.get('context')?.slice(0, 5000);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const send = async () => {
    if (busy || message.trim().length < 5) return;
    setBusy(true);
    try {
      const response = await fetchWithAuth('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        category: targetId ? 'challenge_report' : 'support', message: message.trim(), ...(context ? { context } : {}),
        ...(['challenge', 'user'].includes(targetType || '') && targetId ? { target_type: targetType, target_id: targetId } : {}),
      }) });
      const result = await response.json();
      if (!response.ok) throw new Error('Chưa gửi được yêu cầu. Vui lòng thử lại.');
      setStatus(`Đã nhận phản hồi. Mã yêu cầu: ${result.id}`);
      setMessage('');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Vui lòng thử lại.'); }
    finally { setBusy(false); }
  };
  return <main className="min-h-screen bg-bg-primary px-5 py-10 text-text-primary"><div className="mx-auto max-w-2xl space-y-6">
    <Link to="/" className="inline-flex min-h-11 items-center gap-3 text-accent" aria-label="Fitly — Trang chủ">← <FitlyLogo size="compact" /></Link><h1 className="text-3xl font-black">Hỗ trợ Fitly</h1>
    <p className="leading-7 text-text-secondary">Gửi vấn đề về tài khoản, dữ liệu, giao dịch hoặc nội dung AI. Không gửi mật khẩu, mã xác thực hay thông tin thẻ thanh toán.</p>
    {supportEmail && <p className="text-text-secondary">Nếu không đăng nhập được, gửi yêu cầu tới <a className="text-accent underline" href={`mailto:${supportEmail}`}>{supportEmail}</a>.</p>}
    {context && <p className="rounded-xl bg-bg-secondary p-4 text-text-secondary">Nội dung được báo cáo: {context}</p>}
    {user ? <form onSubmit={(event) => { event.preventDefault(); void send(); }} className="space-y-4"><label htmlFor="support-message" className="block font-bold">Nội dung cần hỗ trợ</label><textarea id="support-message" required minLength={5} maxLength={5000} value={message} onChange={(event) => setMessage(event.target.value)} className="min-h-40 w-full rounded-xl border border-border-primary bg-bg-secondary p-4" /><button disabled={busy} className="min-h-12 rounded-xl bg-accent px-6 font-bold text-text-inverse">{busy ? 'Đang gửi…' : 'Gửi phản hồi'}</button><p role="status">{status}</p></form> : <Link to="/login" className="inline-block rounded-xl bg-accent px-6 py-4 font-bold text-text-inverse">Đăng nhập để gửi yêu cầu</Link>}
    <p className="text-text-secondary">Trong ứng dụng: Hồ sơ → Hỗ trợ và góp ý. Để xóa dữ liệu, mở Hồ sơ → Quyền riêng tư và tài khoản → Xóa tài khoản.</p>
    <div className="flex flex-wrap gap-6"><Link to="/privacy" className="text-accent">Quyền riêng tư</Link><Link to="/terms" className="text-accent">Điều khoản</Link><Link to="/account-deletion" className="text-accent">Xóa tài khoản</Link></div>
  </div></main>;
}
