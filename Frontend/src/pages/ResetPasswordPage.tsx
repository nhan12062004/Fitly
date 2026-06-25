import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, KeyRound, Loader2, Lock } from 'lucide-react';
import { supabase } from '../lib/Supabase';
import { useToast } from '../components/ToastProvider';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      setHasRecoverySession(!!session);
      setCheckingSession(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) {
        setHasRecoverySession(true);
        setCheckingSession(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (password.length < 6) {
      toast.error('Mật khẩu mới phải có ít nhất 6 ký tự');
      return;
    }

    if (password !== confirmPassword) {
      toast.error('Mật khẩu xác nhận không khớp');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      toast.success('Đổi mật khẩu thành công. Bạn có thể tiếp tục sử dụng Fitly.');
      navigate('/overview', { replace: true });
    } catch (err: any) {
      toast.error(err.message || 'Không thể đổi mật khẩu, vui lòng mở lại link trong email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="landing-page min-h-[100dvh] w-full min-w-0 max-w-[100vw] flex-1 basis-0 overflow-x-hidden bg-bg-primary text-text-primary">
      <div className="landing-grid absolute inset-0 opacity-70" />

      <main className="relative z-10 flex min-h-[100dvh] items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
        <section className="landing-product-card landing-surface w-full max-w-md rounded-lg border border-border-primary p-5 shadow-[0_28px_90px_rgba(0,0,0,0.34)] sm:p-6">
          <div className="flex items-start justify-between gap-4 border-b border-border-primary pb-5">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-accent">Bảo mật</p>
              <h1 className="mt-2 text-2xl font-black text-text-primary">Đặt lại mật khẩu</h1>
              <p className="mt-2 text-sm font-semibold leading-6 text-text-secondary">
                Nhập mật khẩu mới cho tài khoản Fitly của bạn.
              </p>
            </div>
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent text-text-inverse">
              <KeyRound className="h-5 w-5" />
            </div>
          </div>

          {checkingSession ? (
            <div className="flex min-h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-accent" />
            </div>
          ) : hasRecoverySession ? (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-text-secondary">Mật khẩu mới</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Ít nhất 6 ký tự"
                    className="landing-input h-12 w-full rounded-lg border border-border-primary pl-11 pr-12 text-sm font-semibold text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-text-tertiary transition-colors hover:text-text-primary"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-text-secondary">Xác nhận mật khẩu</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Nhập lại mật khẩu mới"
                    className="landing-input h-12 w-full rounded-lg border border-border-primary pl-11 pr-4 text-sm font-semibold text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-accent"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="landing-action flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-accent font-black text-text-inverse transition-all hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    Cập nhật mật khẩu
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>
          ) : (
            <div className="mt-6 space-y-5 text-center">
              <p className="text-sm font-semibold leading-7 text-text-secondary">
                Link đặt lại mật khẩu đã hết hạn hoặc không hợp lệ. Vui lòng quay lại trang đăng nhập để gửi link mới.
              </p>
              <Link
                to="/login"
                className="landing-action inline-flex h-12 w-full items-center justify-center rounded-lg bg-accent px-6 text-sm font-black text-text-inverse transition-all hover:bg-accent-hover"
              >
                Quay lại đăng nhập
              </Link>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
