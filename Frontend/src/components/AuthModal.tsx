import React, { useState, useEffect } from 'react';
import { X, Mail, Lock, User, Loader2, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../lib/Supabase';

interface AuthModalProps {
  isOpen: boolean;
  initialMode?: 'login' | 'signup';
  onClose: () => void;
}

export default function AuthModal({ isOpen, initialMode = 'login', onClose }: AuthModalProps) {
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
            emailRedirectTo: window.location.origin, // Đảm bảo redirect về đúng domain hiện tại
          },
        });

        if (error) throw error;

        // Bắt trường hợp Supabase trả về thành công giả để chống dò email
        if (data.user && data.user.identities && data.user.identities.length === 0) {
          throw new Error('User already registered');
        }

        if (data.session) {
          // Signup thành công và email confirmation đang tắt
          onClose();
        } else {
          // Thành công và đang đợi xác thực email
          setIsEmailSent(true);
        }
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
        <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={handleClose} />
        <div className="relative w-full max-w-md bg-bg-secondary border border-border-primary rounded-[2.5rem] p-10 text-center shadow-2xl animate-in zoom-in slide-in-from-bottom-4 duration-500">
          <div className="relative mb-8 flex justify-center">
            <div className="absolute inset-0 bg-black/30 blur-3xl rounded-full scale-125" />
            <div className="relative w-24 h-24 bg-accent rounded-full flex items-center justify-center shadow-[0_18px_36px_rgb(0_0_0_/_0.24)]">
              <Mail className="w-12 h-12 text-black" strokeWidth={2.5} />
            </div>
          </div>

          <h2 className="text-3xl font-bold text-text-primary mb-4 tracking-tight">Kiểm tra email của bạn!</h2>
          <p className="text-text-secondary mb-10 leading-relaxed">
            Chúng tôi đã gửi một liên kết xác minh đến<br />
            <span className="text-accent font-semibold">{email}</span>.<br />
            Vui lòng kiểm tra hộp thư đến để kích hoạt tài khoản.
          </p>

          <button
            onClick={resetFields}
            className="w-full bg-accent text-black font-bold py-4 rounded-2xl hover:bg-accent-hover transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-[0_18px_36px_rgb(0_0_0_/_0.22)]"
          >
            Quay lại Đăng nhập
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal Content */}
      <div className="relative w-full max-w-md bg-bg-secondary border border-border-primary rounded-3xl overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-300">
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-text-tertiary hover:text-text-primary p-2 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-8">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-text-primary mb-2">
              {isLogin ? 'Chào mừng trở lại' : 'Tham gia Fitly - Trợ lý cá nhân'}
            </h2>
            <p className="text-sm text-text-secondary">
              {isLogin ? 'Đăng nhập vào tài khoản của bạn' : 'Tạo hồ sơ thể hình của bạn ngay hôm nay'}
            </p>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
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
                    className="w-full bg-bg-tertiary border border-border-primary rounded-xl py-3 pl-11 pr-4 text-sm focus:border-accent outline-none transition-colors"
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
                  className="w-full bg-bg-tertiary border border-border-primary rounded-xl py-3 pl-11 pr-4 text-sm focus:border-accent outline-none transition-colors"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-text-secondary ml-1">Mật khẩu</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-bg-tertiary border border-border-primary rounded-xl py-3 pl-11 pr-12 text-sm focus:border-accent outline-none transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {!isLogin && (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-text-secondary ml-1">Xác nhận mật khẩu</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-bg-tertiary border border-border-primary rounded-xl py-3 pl-11 pr-12 text-sm focus:border-accent outline-none transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary transition-colors"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/50 rounded-xl text-red-500 text-xs text-center">
                {error}
              </div>
            )}

            <button
              disabled={loading}
              className="w-full bg-accent text-black font-bold py-3 rounded-xl hover:bg-accent-hover transition-colors flex items-center justify-center gap-2 group"
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

          <div className="mt-8 pt-6 border-t border-border-primary text-center">
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
