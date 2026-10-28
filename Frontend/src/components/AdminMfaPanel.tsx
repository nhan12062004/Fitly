import { useEffect, useState } from 'react';
import { supabase } from '../lib/Supabase';

/** Only render for app_metadata.role=admin. The server independently enforces
 * AAL2; changing client state cannot grant access to an admin endpoint. */
export function AdminMfaPanel({ onVerified }: { onVerified?: () => void }) {
  const [factorId,setFactorId] = useState<string | null>(null);
  const [qr,setQr] = useState<string | null>(null);
  const [code,setCode] = useState('');
  const [verified,setVerified] = useState(false);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  useEffect(() => {
    let mounted = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      void supabase.auth.mfa.getAuthenticatorAssuranceLevel().then((result) => {
        if (mounted) setVerified(result.data?.currentLevel === 'aal2');
      });
    });
    void Promise.all([supabase.auth.mfa.listFactors(),supabase.auth.mfa.getAuthenticatorAssuranceLevel()]).then(([factors,assurance]) => {
      if (!mounted) return;
      setFactorId(factors.data?.totp.find((factor) => factor.status === 'verified')?.id || null);
      setVerified(assurance.data?.currentLevel === 'aal2');
      if (factors.error || assurance.error) setMessage('Chưa tải được cấu hình xác minh hai bước.');
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  },[]);
  const enroll = async () => {
    setBusy(true); setMessage('');
    try {
      const factors = await supabase.auth.mfa.listFactors();
      if (factors.error) throw factors.error;
      for (const factor of factors.data.all.filter((entry) => entry.factor_type === 'totp' && entry.status === 'unverified')) {
        const removed = await supabase.auth.mfa.unenroll({factorId:factor.id}); if (removed.error) throw removed.error;
      }
      const result = await supabase.auth.mfa.enroll({factorType:'totp',friendlyName:'Fitly Admin'});
      if (result.error) throw result.error;
      setFactorId(result.data.id); setQr(result.data.totp.qr_code);
    } catch { setMessage('Chưa thiết lập được. Kiểm tra TOTP đã được bật trong cấu hình Auth.'); }
    finally { setBusy(false); }
  };
  const verify = async () => {
    if (!factorId || !/^\d{6}$/.test(code)) return;
    setBusy(true); setMessage('');
    try {
      const result = await supabase.auth.mfa.challengeAndVerify({factorId,code});
      if (result.error) throw result.error;
      setVerified(true); setQr(null); setCode(''); setMessage('Phiên quản trị đã được xác minh hai bước.');
      onVerified?.();
    } catch { setMessage('Mã chưa đúng hoặc đã hết hạn. Hãy thử mã mới trong ứng dụng xác thực.'); }
    finally { setBusy(false); }
  };
  return <section className="space-y-3 rounded-xl border border-border-primary bg-bg-secondary p-4">
    <h2 className="font-bold">Xác minh hai bước cho quản trị</h2>
    {verified ? <p>Phiên hiện tại đã được xác minh. Bạn có thể xem dữ liệu quản trị.</p> : <>
      <p className="text-sm text-text-secondary">Dùng ứng dụng xác thực TOTP để bảo vệ các thao tác quản trị.</p>
      {!factorId && <button type="button" disabled={busy} onClick={() => void enroll()} className="min-h-11 rounded-lg bg-accent px-4 font-bold text-text-inverse">Thiết lập xác minh hai bước</button>}
      {qr && <img src={qr} alt="Mã QR thiết lập ứng dụng xác thực của bạn" className="h-48 w-48 bg-white p-2" />}
      {factorId && <div className="flex flex-wrap gap-2">
        <input aria-label="Mã xác thực 6 chữ số" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g,''))} className="h-11 rounded-lg border border-border-primary bg-bg-tertiary px-3" />
        <button type="button" disabled={busy || code.length !== 6} onClick={() => void verify()} className="min-h-11 rounded-lg bg-accent px-4 font-bold text-text-inverse">Xác minh phiên quản trị</button>
      </div>}
    </>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
