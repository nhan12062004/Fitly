import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
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
  const [searchParams] = useSearchParams();
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
  const [hasAcceptedTerms, setHasAcceptedTerms] = useState(false);

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
    setHasAcceptedTerms(false);
  }, [isLogin]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error, toast]);

  const isVerifiedEmail = isLogin && searchParams.get('verified') === '1';

  if (isLoggedIn && !isVerifiedEmail) {
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

      if (!hasAcceptedTerms) {
        throw new Error('Vui lòng đồng ý với Điều khoản dịch vụ và Chính sách bảo mật');
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
          },
          emailRedirectTo: `${window.location.origin}/login?verified=1`,
        },
      });

      if (signUpError) throw signUpError;

      if (data.user && data.user.identities && data.user.identities.length === 0) {
        throw new Error('User already registered');
      }

      if (data.session) {
        await supabase.auth.signOut();
      }

      setIsEmailSent(true);
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
      <div className="landing-page min-h-[100dvh] w-full min-w-0 max-w-[100vw] flex-1 basis-0 overflow-x-hidden bg-bg-primary text-text-primary">
        <div className="landing-grid absolute inset-0 opacity-70" />
        <main className="relative z-10 flex min-h-[100dvh] items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
          <div className="landing-product-card landing-surface w-full max-w-md rounded-xl border border-border-primary p-6 text-center sm:p-8">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-xl bg-accent text-text-inverse">
              <Mail className="h-8 w-8" strokeWidth={2.5} />
            </div>
            <h1 className="mt-6 text-2xl font-black text-text-primary">Kiểm tra email của bạn</h1>
            <p className="mt-4 text-sm font-semibold leading-7 text-text-secondary">
              Đăng ký thành công! Vui lòng kiểm tra Gmail để xác thực tài khoản trước khi đăng nhập.
              <br />
              Email đăng ký: <span className="text-accent">{email}</span>
            </p>
            <div className="mt-8 grid gap-3">
              <button
                type="button"
                onClick={() => navigate('/login', { replace: true })}
                className="inline-flex h-12 items-center justify-center rounded-xl bg-accent px-6 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover"
              >
                Đi tới đăng nhập
              </button>
              <Link
                to="/"
                className="inline-flex h-12 items-center justify-center rounded-xl border border-border-primary bg-bg-tertiary/45 px-6 text-sm font-black text-text-primary transition-colors hover:border-accent/30 hover:bg-bg-tertiary"
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
    <div className="landing-page min-h-[100dvh] w-full min-w-0 max-w-[100vw] flex-1 basis-0 overflow-x-hidden bg-bg-primary text-text-primary">
      <div className="landing-grid absolute inset-0 opacity-70" />

      <main className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-7xl flex-col justify-center px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex">
          <Link
            to="/"
            className="inline-flex h-11 items-center justify-center gap-2 px-1 text-sm font-black text-text-secondary transition-colors hover:text-accent"
          >
            <ArrowLeft className="h-4 w-4" />
            Quay về trang chủ
          </Link>
        </div>
        <section className="grid flex-1 grid-cols-1 items-start gap-8 md:items-center lg:grid-cols-[minmax(0,0.9fr)_minmax(360px,460px)] lg:gap-10">
          <ScrollReveal className="max-w-3xl lg:pr-4">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-accent">
              {isLogin ? 'Welcome Back' : 'Start Free'}
            </p>
            <div className="hidden sm:block">
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
            </div>
          </ScrollReveal>

          <ScrollReveal className="mx-auto w-full min-w-0 max-w-[460px]" delayMs={120}>
            <div className="landing-product-card landing-surface rounded-xl border border-border-primary p-5 shadow-[0_28px_90px_rgba(0,0,0,0.34)] sm:p-6">
              <div className="flex items-start justify-between gap-4 border-b border-border-primary pb-5">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-accent">
                    {isLogin ? 'Đăng nhập' : 'Đăng ký'}
                  </p>
                  <h2 className="mt-2 text-2xl font-black text-text-primary">
                    {isLogin ? 'Chào mừng trở lại' : 'Bắt đầu miễn phí'}
                  </h2>
                </div>
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-text-inverse">
                  {isLogin ? <ShieldCheck className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
                </div>
              </div>

              <form onSubmit={handleAuth} className="mt-6 space-y-4">
                {isVerifiedEmail && (
                  <div className="flex items-start gap-3 rounded-lg border border-accent/35 bg-accent/10 p-4 text-sm font-semibold leading-6 text-text-secondary">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                    <p>Email đã được xác thực thành công. Vui lòng đăng nhập để tiếp tục.</p>
                  </div>
                )}

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

                {!isLogin && (
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-transparent px-0 py-1 text-sm font-semibold leading-6 text-text-tertiary">
                    <input
                      type="checkbox"
                      checked={hasAcceptedTerms}
                      onChange={(event) => setHasAcceptedTerms(event.target.checked)}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-border-primary bg-bg-tertiary accent-accent"
                    />
                    <span>
                      Tôi đồng ý với{' '}
                      <Link to="/terms" className="font-black text-accent underline-offset-4 hover:underline">
                        Điều khoản dịch vụ
                      </Link>{' '}
                      và{' '}
                      <Link to="/privacy" className="font-black text-accent underline-offset-4 hover:underline">
                        Chính sách bảo mật
                      </Link>
                    </span>
                  </label>
                )}

                <button
                  type="submit"
                  disabled={loading || (!isLogin && !hasAcceptedTerms)}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent font-black text-text-inverse transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
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
        <div className="responsive-sheet-backdrop fixed inset-0 z-[120] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Đóng"
            onClick={() => setIsForgotPasswordOpen(false)}
            className="absolute inset-0 bg-black/65 backdrop-blur-md"
          />
          <div className="responsive-sheet-panel relative w-full max-w-[448px] rounded-xl border border-border-primary bg-bg-secondary/95 p-6 shadow-[0_26px_90px_rgba(0,0,0,0.42)]">
            <div>
              <div className="flex items-start justify-between gap-4">
                <h2 className="text-2xl font-black leading-tight text-text-primary">Quên mật khẩu?</h2>
                <button
                  type="button"
                  aria-label="Đóng modal quên mật khẩu"
                  onClick={() => setIsForgotPasswordOpen(false)}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="mt-3 max-w-[360px] text-sm font-semibold leading-6 text-text-secondary">
                Nhập email tài khoản của bạn, Supabase sẽ gửi link đặt lại mật khẩu.
              </p>
            </div>

            <div className="mt-6 space-y-2">
              <label className="text-xs font-bold text-text-secondary">Email nhận link đặt lại mật khẩu</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
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
                  className="landing-input h-12 w-full rounded-xl border border-border-primary pl-11 pr-4 text-sm font-semibold text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-accent"
                  autoFocus
                />
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setIsForgotPasswordOpen(false)}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-border-primary bg-bg-tertiary/45 px-6 text-sm font-black text-text-primary transition-colors hover:border-accent/30 hover:bg-bg-tertiary"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleSendPasswordReset}
                disabled={resetLoading}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-6 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
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
