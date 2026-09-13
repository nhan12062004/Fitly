import { Link, useNavigate } from 'react-router';
import { legalContent } from '../../../shared/legalContent';
import { supabase } from '../lib/Supabase';
import { useState } from 'react';

export default function LegalPage({ section }: { section: keyof typeof legalContent }) {
  const navigate = useNavigate();
  const content = legalContent[section];
  const [consentNotice, setConsentNotice] = useState('');
  const revokeConsent = async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) { setConsentNotice('Hãy đăng nhập để thay đổi lựa chọn quyền riêng tư của tài khoản.'); return; }
    const result = await supabase.from('ai_data_consents').delete().eq('user_id', data.session.user.id);
    setConsentNotice(result.error ? 'Chưa thu hồi được đồng ý AI. Vui lòng thử lại.' : 'Đã thu hồi đồng ý sử dụng AI trên mọi thiết bị, bao gồm tạo kế hoạch tự động. Yêu cầu đang xử lý có thể vẫn hoàn tất.');
  };
  return <main className="min-h-screen bg-bg-primary px-5 py-10 text-text-primary"><div className="mx-auto max-w-3xl">
    <button type="button" onClick={() => navigate(-1)} className="min-h-12 text-accent">← Quay lại</button>
    <h1 className="my-6 text-3xl font-black">{content.title}</h1>
    <p className="mb-6 text-sm text-text-secondary">Cập nhật ngày 12/09/2026</p>
    {content.sections.map((item) => <section key={item.title} className="mb-5 rounded-2xl border border-border-primary bg-bg-secondary p-6"><h2 className="mb-3 text-lg font-bold">{item.title}</h2><p className="text-sm leading-7 text-text-secondary">{item.text}</p></section>)}
    {section === 'privacy' && <div className="my-6"><button type="button" onClick={() => void revokeConsent()} className="min-h-12 text-accent">Thu hồi đồng ý sử dụng AI</button><p role="status" className="text-sm text-text-secondary">{consentNotice}</p></div>}
    <div className="flex flex-wrap gap-6 py-6"><Link to="/support" className="text-accent">Hỗ trợ và liên hệ</Link><Link to="/account-deletion" className="text-accent">Xóa tài khoản</Link><Link to={section === 'privacy' ? '/terms' : '/privacy'} className="text-accent">{section === 'privacy' ? 'Điều khoản sử dụng' : 'Quyền riêng tư'}</Link></div>
  </div></main>;
}
