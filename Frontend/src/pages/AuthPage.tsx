import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import ScrollReveal from '../components/ScrollReveal';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/Supabase';
import { useToast } from '../components/ToastProvider';

type AuthPageProps = {
  initialMode: 'login' | 'signup';
};

const loginHighlights = [
  'Tiếp tục kế hoạch hôm nay',
  'Xem lại bài tập và thực đơn',
  'Hỏi AI Coach để điều chỉnh nhanh',
];

const signupHighlights = [
  'Miễn phí 7 ngày',
  'Không cần thẻ tín dụng',
  'Survey cá nhân hóa sau khi xác thực',
];

export default function AuthPage({ initialMode }: AuthPageProps) {
  const navigate = useNavigate();
  const { isLoggedIn } = useAuth();
  const toast = useToast();
  const [isLogin, setIsLogin] = useState(initialMode === 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [isForgotPasswordOpen, setIsForgotPasswordOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isEmailSent, setIsEmailSent] = useState(false);

  useEffect(() => {
    setIsLogin(initialMode === 'login');
    setError(null);
    setIsEmailSent(false);
  }, [initialMode]);

  useEffect(() => {
    setShowPassword(false);
    setShowConfirmPassword(false);
    setIsForgotPasswordOpen(false);
    setError(null);
  }, [isLogin]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error, toast]);

  if (isLoggedIn) {
    return <Navigate to="/overview" replace />;
  }

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isLogin) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) throw signInError;
        navigate('/overview', { replace: true });
        return;
      }

      if (password !== confirmPassword) {
        throw new Error('Mật khẩu không khớp');
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
          },
          emailRedirectTo: window.location.origin,
        },
      });

      if (signUpError) throw signUpError;

      if (data.user && data.user.identities && data.user.identities.length === 0) {
        throw new Error('User already registered');
      }

      if (data.session) {
        navigate('/overview', { replace: true });
      } else {
        setIsEmailSent(true);
      }
    } catch (err: any) {
      let errorMessage = err.message;
      if (errorMessage === 'Invalid login credentials') {
        errorMessage = 'Email hoặc mật khẩu không chính xác';
      } else if (errorMessage === 'User already registered') {
        errorMessage = 'Email này đã được đăng ký';
      } else if (errorMessage.includes('Password should be at least')) {
        errorMessage = 'Mật khẩu phải có ít nhất 6 ký tự';
      } else if (errorMessage === 'Email not confirmed') {
        errorMessage = 'Vui lòng xác nhận email trước khi đăng nhập';
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = () => {
    setResetEmail(email);
    setIsForgotPasswordOpen(true);
    setError(null);
  };

  const handleSendPasswordReset = async () => {
    setError(null);

    const trimmedEmail = resetEmail.trim();
    if (!trimmedEmail) {
      setError('Vui lòng nhập email để lấy lại mật khẩu');
      return;
    }

    setResetLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (resetError) throw resetError;

      setEmail(trimmedEmail);
      setIsForgotPasswordOpen(false);
      toast.success('Đã gửi email đặt lại mật khẩu. Vui lòng kiểm tra hộp thư của bạn.');
    } catch (err: any) {
      setError(err.message || 'Không thể gửi email đặt lại mật khẩu, vui lòng thử lại');
    } finally {
      setResetLoading(false);
    }
  };

  if (isEmailSent) {
    return (
      <div className="landing-page min-h-screen w-full min-w-0 max-w-[100vw] flex-1 basis-0 overflow-x-hidden bg-bg-primary text-text-primary">
        <div className="landing-grid absolute inset-0 opacity-70" />
        <main className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
          <div className="landing-product-card landing-surface w-full max-w-md rounded-lg border border-border-primary p-6 text-center sm:p-8">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-lg bg-accent text-text-inverse">
              <Mail className="h-8 w-8" strokeWidth={2.5} />
            </div>
            <h1 className="mt-6 text-2xl font-black text-text-primary">Kiểm tra email của bạn</h1>
            <p className="mt-4 text-sm font-semibold leading-7 text-text-secondary">
              Chúng tôi đã gửi liên kết xác minh đến <span className="text-accent">{email}</span>.
              Vui lòng kích hoạt tài khoản rồi quay lại đăng nhập.
            </p>
            <div className="mt-8 grid gap-3">
              <button
                type="button"
                onClick={() => navigate('/login', { replace: true })}
                className="landing-action inline-flex h-12 items-center justify-center rounded-lg bg-accent px-6 text-sm font-black text-text-inverse transition-all hover:bg-accent-hover"
              >
                Đi tới đăng nhập
              </button>
              <Link
                to="/"
                className="inline-flex h-12 items-center justify-center rounded-lg border border-border-primary bg-bg-secondary px-6 text-sm font-black text-text-primary transition-colors hover:border-accent/40 hover:text-accent"
              >
                Quay lại trang chủ
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const highlights = isLogin ? loginHighlights : signupHighlights;

  return (
    <div className="landing-page min-h-screen w-full min-w-0 max-w-[100vw] flex-1 basis-0 overflow-x-hidden bg-bg-primary text-text-primary">
      <div className="landing-grid absolute inset-0 opacity-70" />

      <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-7xl flex-col justify-center px-4 py-8 sm:px-6 lg:px-8">
        <section className="grid flex-1 grid-cols-1 items-start gap-8 md:items-center lg:grid-cols-[minmax(0,0.9fr)_minmax(360px,460px)] lg:gap-10">
          <ScrollReveal className="max-w-3xl lg:pr-4">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-accent">
              {isLogin ? 'Welcome Back' : 'Start Free'}
            </p>
            <h1 className="mt-5 max-w-[calc(100vw-2rem)] text-3xl font-black leading-[1.08] tracking-normal text-text-primary sm:max-w-3xl sm:text-5xl md:text-6xl">
              {isLogin ? (
                <>
                  <span className="block">Tiếp tục kế hoạch</span>
                  <span className="block">hôm nay của bạn.</span>
                </>
              ) : (
                <>
                  <span className="block">Tạo tài khoản</span>
                  <span className="block">và nhận kế hoạch cá nhân.</span>
                </>
              )}
            </h1>
            <p className="mt-5 max-w-2xl text-base font-semibold leading-8 text-text-secondary">
              {isLogin
                ? 'Đăng nhập để xem bài tập hôm nay, thực đơn hôm nay và các gợi ý mới từ AI Coach.'
                : 'Đăng ký, xác thực email, hoàn thành form đầu vào, rồi Fitly - Trợ lý cá nhân sẽ đưa bạn vào dashboard cá nhân hóa.'}
            </p>

            <div className="mt-8 grid max-w-xl gap-3 sm:grid-cols-3">
              {[
                ['25 phút', 'bài tập mẫu'],
                ['1.650 kcal', 'thực đơn mẫu'],
                ['AI Coach', 'điều chỉnh hằng ngày'],
              ].map(([value, label]) => (
                <div key={value} className="landing-card landing-surface rounded-lg border border-border-primary p-4">
                  <p className="text-lg font-black text-text-primary">{value}</p>
                  <p className="mt-1 text-xs font-semibold text-text-tertiary">{label}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 space-y-3">
              {highlights.map((item) => (
                <div key={item} className="flex items-center gap-3 text-sm font-semibold text-text-secondary">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
                    <Check className="h-4 w-4" />
                  </span>
                  {item}
                </div>
              ))}
            </div>
          </ScrollReveal>

          <ScrollReveal className="w-full min-w-0" delayMs={120}>
            <div className="landing-product-card landing-surface rounded-lg border border-border-primary p-5 shadow-[0_28px_90px_rgba(0,0,0,0.34)] sm:p-6">
              <div className="flex items-start justify-between gap-4 border-b border-border-primary pb-5">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-accent">
                    {isLogin ? 'Đăng nhập' : 'Đăng ký'}
                  </p>
                  <h2 className="mt-2 text-2xl font-black text-text-primary">
                    {isLogin ? 'Chào mừng trở lại' : 'Bắt đầu miễn phí'}
                  </h2>
                  <p className="mt-2 text-sm font-semibold text-text-secondary">
                    {isLogin ? 'Vào lại dashboard của bạn.' : 'Tạo tài khoản để bắt đầu survey cá nhân.'}
                  </p>
                </div>
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent text-text-inverse">
                  {isLogin ? <ShieldCheck className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
                </div>
              </div>

              <form onSubmit={handleAuth} className="mt-6 space-y-4">
                {!isLogin && (
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-secondary">Họ và tên</label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
                      <input
                        type="text"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Nguyen Van A"
                        className="landing-input h-12 w-full rounded-lg border border-border-primary pl-11 pr-4 text-sm font-semibold text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-accent"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-secondary">Địa chỉ email</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="email@vidu.com"
                      className="landing-input h-12 w-full rounded-lg border border-border-primary pl-11 pr-4 text-sm font-semibold text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-accent"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-secondary">Mật khẩu</label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="********"
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
                  {isLogin && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleForgotPassword}
                        disabled={resetLoading || loading}
                        className="inline-flex items-center gap-1.5 text-xs font-black text-accent transition-colors hover:text-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {resetLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                        Quên mật khẩu?
                      </button>
                    </div>
                  )}
                </div>

                {!isLogin && (
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-secondary">Xác nhận mật khẩu</label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="********"
                        className="landing-input h-12 w-full rounded-lg border border-border-primary pl-11 pr-12 text-sm font-semibold text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-accent"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-text-tertiary transition-colors hover:text-text-primary"
                      >
                        {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="landing-action flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-accent font-black text-text-inverse transition-all hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {loading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      {isLogin ? 'Đăng nhập' : 'Đăng ký'}
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </form>

              <div className="mt-6 border-t border-border-primary pt-5 text-center">
                {isLogin ? (
                  <p className="text-xs font-semibold text-text-tertiary">
                    Chưa có tài khoản?{' '}
                    <Link to="/signup" className="font-black text-text-secondary transition-colors hover:text-accent">
                      Đăng ký miễn phí
                    </Link>
                  </p>
                ) : (
                  <p className="text-xs font-semibold text-text-tertiary">
                    Đã có tài khoản?{' '}
                    <Link to="/login" className="font-black text-text-secondary transition-colors hover:text-accent">
                      Đăng nhập
                    </Link>
                  </p>
                )}
              </div>
            </div>
          </ScrollReveal>
        </section>
      </main>

      {isForgotPasswordOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Đóng"
            onClick={() => setIsForgotPasswordOpen(false)}
            className="absolute inset-0 bg-black/65 backdrop-blur-md"
          />
          <div className="relative w-full max-w-[448px] rounded-lg border border-white/10 bg-[#111111]/95 p-6 shadow-[0_26px_90px_rgba(0,0,0,0.55)]">
            <div>
              <div className="flex items-start justify-between gap-4">
                <h2 className="text-2xl font-black leading-tight text-white">Quên mật khẩu?</h2>
                <button
                  type="button"
                  aria-label="Đóng modal quên mật khẩu"
                  onClick={() => setIsForgotPasswordOpen(false)}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="mt-3 max-w-[360px] text-sm font-semibold leading-6 text-zinc-400">
                Nhập email tài khoản của bạn, Supabase sẽ gửi link đặt lại mật khẩu.
              </p>
            </div>

            <div className="mt-6 space-y-2">
              <label className="text-xs font-bold text-zinc-400">Email nhận link đặt lại mật khẩu</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  type="email"
                  value={resetEmail}
                  onChange={(event) => setResetEmail(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void handleSendPasswordReset();
                    }
                  }}
                  placeholder="email@vidu.com"
                  className="h-12 w-full rounded-lg border border-accent bg-black/25 pl-11 pr-4 text-sm font-semibold text-white outline-none transition-colors placeholder:text-zinc-500 focus:border-accent focus:ring-1 focus:ring-accent"
                  autoFocus
                />
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setIsForgotPasswordOpen(false)}
                className="inline-flex h-11 items-center justify-center rounded-lg border border-white/10 bg-transparent px-6 text-sm font-black text-zinc-200 transition-colors hover:border-white/20 hover:bg-white/5"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleSendPasswordReset}
                disabled={resetLoading}
                className="landing-action inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-accent px-6 text-sm font-black text-text-inverse transition-all hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
              >
                {resetLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                Gửi link
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
