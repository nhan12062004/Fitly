import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronDown,
  FileText, HeartPulse, List, LoaderCircle, LockKeyhole, MessageCircle,
  ShieldCheck, SlidersHorizontal, Sparkles,
} from 'lucide-react';
import { legalContent } from '../../../shared/legalContent';
import { supabase } from '../lib/Supabase';
import './LegalPage.css';
import FitlyLogo from './FitlyLogo';

type LegalSection = keyof typeof legalContent;

const pageDetails = {
  terms: {
    title: 'Điều khoản sử dụng',
    description: 'Hiểu rõ cách Fitly đồng hành cùng bạn, quyền lợi của bạn và những nguyên tắc khi sử dụng dịch vụ.',
    icon: FileText,
    highlights: [
      { icon: HeartPulse, title: 'Hiểu về dịch vụ', text: 'Hỗ trợ tập luyện và dinh dưỡng.' },
      { icon: ShieldCheck, title: 'Sử dụng có trách nhiệm', text: 'Cùng xây dựng trải nghiệm an toàn.' },
      { icon: SlidersHorizontal, title: 'Chủ động quản lý', text: 'Tài khoản và đăng ký của bạn.' },
    ],
  },
  privacy: {
    title: 'Chính sách bảo mật',
    description: 'Minh bạch về dữ liệu bạn chia sẻ, cách Fitly sử dụng và những lựa chọn để bạn quản lý quyền riêng tư.',
    icon: ShieldCheck,
    highlights: [
      { icon: LockKeyhole, title: 'Không bán dữ liệu', text: 'Dữ liệu cá nhân không để mua bán.' },
      { icon: Sparkles, title: 'AI cần sự đồng ý', text: 'Bạn lựa chọn khi nào sử dụng AI.' },
      { icon: SlidersHorizontal, title: 'Bạn có quyền lựa chọn', text: 'Quản lý quyền và xóa tài khoản.' },
    ],
  },
};

export default function LegalPage({ section }: { section: LegalSection }) {
  const content = legalContent[section];
  const details = pageDetails[section];
  const PageIcon = details.icon;
  const otherSection = section === 'privacy' ? 'terms' : 'privacy';
  const [activeSection, setActiveSection] = useState(0);
  const [consentNotice, setConsentNotice] = useState('');
  const [revoking, setRevoking] = useState(false);
  const sectionId = (index: number) => `${section}-section-${index + 1}`;

  useEffect(() => {
    setActiveSection(0);
    setConsentNotice('');
    const previousTitle = document.title;
    document.title = `${pageDetails[section].title} | Fitly`;
    const elements = document.querySelectorAll<HTMLElement>('.legal-document-section');
    let frame = 0;
    const syncActiveSection = () => {
      let current = 0;
      elements.forEach((element, index) => {
        if (element.getBoundingClientRect().top <= Math.min(180, window.innerHeight * 0.25)) current = index;
      });
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4) current = elements.length - 1;
      setActiveSection(current);
    };
    const scheduleSync = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => { frame = 0; syncActiveSection(); });
    };
    window.addEventListener('scroll', scheduleSync, { passive: true });
    window.addEventListener('resize', scheduleSync);
    // Restore an incoming section link after the lazy-loaded document mounts.
    const hash = window.location.hash.slice(1);
    const target = Array.from(elements).find((element) => element.id === hash);
    if (target) target.scrollIntoView();
    syncActiveSection();
    return () => {
      window.removeEventListener('scroll', scheduleSync);
      window.removeEventListener('resize', scheduleSync);
      window.cancelAnimationFrame(frame);
      document.title = previousTitle;
    };
  }, [section]);

  const revokeConsent = async () => {
    if (revoking) return;
    setRevoking(true);
    setConsentNotice('');
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (!data.session) {
        setConsentNotice('Hãy đăng nhập để thay đổi lựa chọn quyền riêng tư của tài khoản.');
        return;
      }
      const result = await supabase.from('ai_data_consents').delete().eq('user_id', data.session.user.id);
      if (result.error) throw result.error;
      setConsentNotice('Đã thu hồi đồng ý sử dụng AI trên mọi thiết bị, bao gồm tạo kế hoạch tự động. Yêu cầu đang xử lý có thể vẫn hoàn tất.');
    } catch {
      setConsentNotice('Chưa thu hồi được đồng ý AI. Vui lòng thử lại.');
    } finally {
      setRevoking(false);
    }
  };

  const tableOfContents = (
    <ol className="legal-toc-list">
      {content.sections.map((item, index) => (
        <li key={item.title}>
          <a href={`#${sectionId(index)}`} onClick={(event) => {
            setActiveSection(index);
            event.currentTarget.closest('details')?.removeAttribute('open');
          }} aria-current={activeSection === index ? 'location' : undefined}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            {item.title}
            {activeSection === index && <span className="legal-toc-dot" />}
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="legal-page">
      <a href="#legal-content" className="legal-skip-link">Đến nội dung chính</a>
      <header className="legal-header">
        <div className="legal-container legal-header-inner">
          <Link to="/" className="legal-brand" aria-label="Fitly — Trang chủ">
            <FitlyLogo />
          </Link>
          <span className="legal-header-label">Thông tin & chính sách</span>
          <Link to="/" className="legal-back-link"><ArrowLeft size={16} aria-hidden="true" /> Về trang chủ</Link>
        </div>
      </header>

      <main id="legal-content" className="legal-container">
        <section className="legal-hero" aria-labelledby="legal-title">
          <div className="legal-hero-copy">
            <span className="legal-eyebrow"><span /> ĐỒNG HÀNH BẰNG SỰ MINH BẠCH</span>
            <h1 id="legal-title">{details.title}<span className="legal-title-dot">.</span></h1>
            <p className="legal-description">{details.description}</p>
            <div className="legal-metadata"><CalendarDays size={15} aria-hidden="true" /> Cập nhật ngày <time dateTime="2026-09-12">12/09/2026</time><span className="legal-metadata-divider" /> Fitly</div>
          </div>
          <div className="legal-hero-art" aria-hidden="true">
            <div className="legal-art-orbit legal-art-orbit-outer" />
            <div className="legal-art-orbit legal-art-orbit-inner" />
            <div className="legal-art-icon"><PageIcon size={61} strokeWidth={1.25} /></div>
            <span className="legal-art-check"><Check size={17} strokeWidth={2.5} /></span>
            <span className="legal-art-caption">Rõ ràng. Minh bạch. Vì bạn.</span>
          </div>
        </section>

        <nav className="legal-tabs" aria-label="Chính sách Fitly">
          <Link to="/terms" aria-current={section === 'terms' ? 'page' : undefined}><FileText size={17} aria-hidden="true" /> Điều khoản sử dụng</Link>
          <Link to="/privacy" aria-current={section === 'privacy' ? 'page' : undefined}><ShieldCheck size={17} aria-hidden="true" /> Chính sách bảo mật</Link>
        </nav>

        <div className="legal-highlights">
          {details.highlights.map(({ icon: Icon, title, text }) => (
            <div className="legal-highlight" key={title}>
              <span className="legal-highlight-icon"><Icon size={20} strokeWidth={1.6} aria-hidden="true" /></span>
              <div><h2>{title}</h2><p>{text}</p></div>
            </div>
          ))}
        </div>

        <div className="legal-layout">
          <aside className="legal-sidebar">
            <nav className="legal-desktop-toc" aria-label="Mục lục"><p className="legal-sidebar-label"><List size={15} aria-hidden="true" /> NỘI DUNG TRANG</p>{tableOfContents}</nav>
            <div className="legal-help-card">
              <MessageCircle size={22} strokeWidth={1.5} aria-hidden="true" />
              <h2>Bạn cần giải đáp?</h2>
              <p>Gửi câu hỏi về tài khoản, dữ liệu hoặc dịch vụ của Fitly.</p>
              <Link to="/support">Liên hệ hỗ trợ <ArrowUpRight size={16} aria-hidden="true" /></Link>
            </div>
          </aside>

          <div className="legal-main-column">
            <details className="legal-mobile-toc">
              <summary><span><List size={17} aria-hidden="true" /> Mục lục · {content.sections.length} mục</span><ChevronDown size={17} aria-hidden="true" /></summary>
              <nav aria-label="Mục lục trên điện thoại">{tableOfContents}</nav>
            </details>
            <article className="legal-document" aria-label={content.title}>
              <div className="legal-document-heading"><span>FITLY / {section === 'privacy' ? 'QUYỀN RIÊNG TƯ' : 'ĐIỀU KHOẢN'}</span><span>{String(content.sections.length).padStart(2, '0')} MỤC</span></div>
              {content.sections.map((item, index) => (
                <section id={sectionId(index)} data-index={index} key={item.title} className="legal-document-section" aria-labelledby={`${sectionId(index)}-title`}>
                  <span className="legal-section-number">{String(index + 1).padStart(2, '0')}</span>
                  <div><h2 id={`${sectionId(index)}-title`}>{item.title}</h2><p>{item.text}</p></div>
                </section>
              ))}
            </article>

            {section === 'privacy' && (
              <section className="legal-consent-card" aria-labelledby="legal-consent-title">
                <span className="legal-consent-icon"><SlidersHorizontal size={22} aria-hidden="true" /></span>
                <div className="legal-consent-copy">
                  <p className="legal-eyebrow">LỰA CHỌN CỦA BẠN</p>
                  <h2 id="legal-consent-title">Chủ động với quyền riêng tư</h2>
                  <p>Bạn có thể thu hồi đồng ý sử dụng AI bất cứ lúc nào. Lựa chọn này áp dụng cho tài khoản trên mọi thiết bị.</p>
                  <button type="button" onClick={() => void revokeConsent()} disabled={revoking} className="legal-consent-button">
                    {revoking && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}
                    {revoking ? 'Đang thu hồi…' : 'Thu hồi đồng ý sử dụng AI'}
                    {!revoking && <ArrowRight size={16} aria-hidden="true" />}
                  </button>
                  <p role="status" className="legal-consent-status">{consentNotice}</p>
                </div>
              </section>
            )}

            <Link to={`/${otherSection}`} className="legal-next-document">
              <div><span>TÌM HIỂU THÊM</span><h2>{pageDetails[otherSection].title}</h2></div>
              <span className="legal-next-arrow"><ArrowRight size={21} aria-hidden="true" /></span>
            </Link>
          </div>
        </div>
      </main>

      <footer className="legal-footer legal-container">
        <p>© {new Date().getFullYear()} Fitly<span>Đồng hành cùng lối sống khỏe.</span></p>
        <nav aria-label="Liên kết hỗ trợ"><Link to="/support">Hỗ trợ & liên hệ</Link><Link to="/account-deletion">Xóa tài khoản</Link><a href="#legal-title">Về đầu trang ↑</a></nav>
      </footer>
    </div>
  );
}
