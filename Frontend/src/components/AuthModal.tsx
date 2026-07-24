import React, { useState, useEffect } from 'react';
import { X, Mail, Lock, User, Loader2, Eye, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/Supabase';
import { useToast } from './ToastProvider';
import PasswordRequirements from './PasswordRequirements';
import { parsePasswordError, validatePassword } from '../lib/passwordValidator';

interface AuthModalProps {
  isOpen: boolean;
  initialMode?: 'login' | 'signup';
  onClose: () => void;
}

export default function AuthModal({ isOpen, initialMode = 'login', onClose }: AuthModalProps) {
  const toast = useToast();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isEmailSent, setIsEmailSent] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsLogin(initialMode !== 'signup');
    }
  }, [initialMode, isOpen]);

  useEffect(() => {
    if (isOpen) {
      setIsEmailSent(false);
      setError(null);
    }
    setShowPassword(false);
    setShowConfirmPassword(false);
  }, [isLogin, isOpen]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error, toast]);

  if (!isOpen) return null;

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        onClose();
      } else {
        if (!validatePassword(password).isValid) {
          throw new Error('Mật khẩu chưa đủ mạnh. Vui lòng thỏa mãn đủ 4 tiêu chí bên dưới.');
        }
        if (password !== confirmPassword) {
          throw new Error('Mật khẩu không khớp');
        }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
            },
            emailRedirectTo: `${window.location.origin}/login?verified=1`,
          },
        });

        if (error) throw error;

        // Bắt trường hợp Supabase trả về thành công giả để chống dò email
        if (data.user && data.user.identities && data.user.identities.length === 0) {
          throw new Error('User already registered');
        }

        if (data.session) {
          await supabase.auth.signOut();
        }

        setIsEmailSent(true);
      }
    } catch (err: any) {
      setError(parsePasswordError(err.message));
    } finally {
      setLoading(false);
    }
  };

  const resetFields = () => {
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setFullName('');
    setError(null);
    setIsEmailSent(false);
    setIsLogin(true);
  };

  const handleClose = () => {
    resetFields();
    onClose();
  };

  if (isEmailSent) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="themed-modal-backdrop absolute inset-0 backdrop-blur-md" onClick={handleClose} />
        <div className="relative w-full max-w-[21rem] max-h-[88dvh] overflow-y-auto bg-bg-secondary border border-border-primary rounded-[22px] p-4 text-center shadow-2xl animate-in zoom-in slide-in-from-bottom-4 duration-500 sm:max-w-md sm:rounded-[2rem] sm:p-6 md:p-8">
          <div className="relative mb-5 flex justify-center sm:mb-8">
            <div className="absolute inset-0 bg-black/30 blur-3xl rounded-full scale-125" />
            <div className="relative flex h-16 w-16 items-center justify-center rounded-xl bg-accent shadow-[0_18px_36px_rgb(0_0_0_/_0.18)] sm:h-24 sm:w-24 sm:rounded-2xl">
              <Mail className="w-8 h-8 text-text-inverse sm:w-12 sm:h-12" strokeWidth={2.5} />
            </div>
          </div>

          <h2 className="text-lg font-bold text-text-primary mb-2 tracking-tight sm:mb-4 sm:text-3xl">Kiểm tra email của bạn!</h2>
          <p className="text-sm text-text-secondary mb-5 leading-6 sm:mb-10 sm:text-base sm:leading-relaxed">
            Đăng ký thành công! Vui lòng kiểm tra Gmail để xác thực tài khoản trước khi đăng nhập.
            <br />
            Email đăng ký: <span className="text-accent font-semibold">{email}</span>
          </p>

          <button
            onClick={() => window.location.assign('/login')}
            className="w-full rounded-xl bg-accent py-3 text-sm font-bold text-text-inverse transition-colors hover:bg-accent-hover sm:py-4 sm:text-base"
          >
            Đi tới đăng nhập
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="themed-modal-backdrop absolute inset-0 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal Content */}
      <div className="relative w-full max-w-[21rem] max-h-[88dvh] overflow-y-auto bg-bg-secondary border border-border-primary rounded-[22px] shadow-2xl animate-in fade-in zoom-in duration-300 sm:max-w-md sm:rounded-[2rem]">
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 text-text-tertiary hover:text-text-primary p-2 transition-colors sm:top-4 sm:right-4"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-4 sm:p-6 md:p-8">
          <div className="text-center mb-5 sm:mb-8">
            <h2 className="text-lg font-bold text-text-primary mb-1.5 sm:mb-2 sm:text-2xl">
              {isLogin ? 'Chào mừng trở lại' : 'Tham gia Fitly - Trợ lý cá nhân'}
            </h2>
            <p className="text-xs text-text-secondary sm:text-sm">
              {isLogin ? 'Đăng nhập vào tài khoản của bạn' : 'Tạo hồ sơ thể hình của bạn ngay hôm nay'}
            </p>
          </div>

          <form onSubmit={handleAuth} className="space-y-3 sm:space-y-4">
            {!isLogin && (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-text-secondary ml-1">Họ và tên</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Nguyễn Văn A"
                    className="w-full bg-bg-tertiary border border-border-primary rounded-xl py-2.5 pl-11 pr-4 text-sm focus:border-accent outline-none transition-colors sm:py-3"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-semibold text-text-secondary ml-1">Địa chỉ Email</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@vidu.com"
                  className="w-full bg-bg-tertiary border border-border-primary rounded-xl py-2.5 pl-11 pr-4 text-sm focus:border-accent outline-none transition-colors sm:py-3"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold uppercase tracking-wider text-text-secondary ml-1">
                {isLogin ? 'Mật khẩu' : 'MẬT KHẨU'}
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-bg-tertiary border border-border-primary rounded-xl py-2.5 pl-11 pr-12 text-sm focus:border-accent outline-none transition-colors sm:py-3"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {!isLogin && <PasswordRequirements password={password} />}
            </div>

            {!isLogin && (
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-wider text-text-secondary ml-1">
                  XÁC NHẬN MẬT KHẨU
                </label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className={`w-full bg-bg-tertiary border rounded-xl py-2.5 pl-11 pr-20 text-sm outline-none transition-colors sm:py-3 ${
                      confirmPassword.length > 0
                        ? confirmPassword !== password
                          ? 'border-red-500 bg-red-500/5 focus:border-red-500'
                          : 'border-accent/70 bg-accent/5 focus:border-accent'
                        : 'border-border-primary focus:border-accent'
                    }`}
                  />
                  <div className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-2">
                    {confirmPassword.length > 0 && (
                      confirmPassword !== password ? (
                        <AlertCircle className="w-4 h-4 text-red-500 animate-in fade-in zoom-in duration-200" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 text-accent animate-in fade-in zoom-in duration-200" />
                      )
                    )}
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="text-text-tertiary hover:text-text-primary transition-colors"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <button
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 font-bold text-text-inverse transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  {isLogin ? 'Đăng nhập' : 'Đăng ký'}
                </>
              )}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-border-primary text-center sm:mt-8 sm:pt-6">
            {isLogin ? (
              <p className="text-xs text-text-tertiary font-medium">
                {'Chưa có tài khoản?'}{' '}
                <button
                  onClick={() => setIsLogin(false)}
                  className="font-bold text-text-secondary hover:text-accent transition-colors"
                >
                  {'Đăng ký'}
                </button>
              </p>
            ) : (
              <p className="text-xs text-text-tertiary font-medium">
                {'Đã có tài khoản?'}{' '}
                <button
                  onClick={() => setIsLogin(true)}
                  className="font-bold text-text-secondary hover:text-accent transition-colors"
                >
                  {'Đăng nhập'}
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
