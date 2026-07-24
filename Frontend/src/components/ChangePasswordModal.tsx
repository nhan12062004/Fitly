import React, { useState } from 'react';
import { Lock, Loader2, X, Eye, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/Supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from './ToastProvider';
import PasswordRequirements from './PasswordRequirements';
import { parsePasswordError, validatePassword } from '../lib/passwordValidator';
interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ChangePasswordModal({ isOpen, onClose }: ChangePasswordModalProps) {
  const { user } = useAuth();
  const toast = useToast();
const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  React.useEffect(() => {
    if (!message.text) return;
    if (message.type === 'success') {
      toast.success(message.text);
    } else {
      toast.error(message.text);
    }
  }, [message, toast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage({ type: '', text: '' });

    if (!user?.email) {
      setMessage({ type: 'error', text: "Không tìm thấy thông tin email người dùng" });
      return;
    }

    if (!validatePassword(newPassword).isValid) {
      setMessage({ type: 'error', text: 'Mật khẩu mới chưa đủ mạnh. Vui lòng thỏa mãn đủ 4 tiêu chí bên dưới.' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'Mật khẩu xác nhận không khớp' });
      return;
    }

    setLoading(true);
    try {
      // BƯỚC 1: Xác thực mật khẩu cũ bằng cách thử đăng nhập lại
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: oldPassword
      });

      if (authError) {
        throw new Error("Mật khẩu hiện tại không chính xác");
      }

      // BƯỚC 2: Cập nhật mật khẩu mới
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (updateError) throw updateError;

      setMessage({ type: 'success', text: "Đổi mật khẩu thành công!" });
      setTimeout(() => {
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
        onClose();
        setMessage({ type: '', text: '' });
      }, 2000);
    } catch (err: any) {
      setMessage({ type: 'error', text: parsePasswordError(err.message) || 'Có lỗi xảy ra, vui lòng thử lại' });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="responsive-sheet-backdrop change-password-backdrop fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 themed-modal-backdrop backdrop-blur-md" onClick={onClose} />

      <div className="responsive-sheet-panel change-password-panel relative w-full max-w-md bg-bg-secondary border border-border-primary rounded-[2rem] shadow-2xl overflow-hidden p-6 md:p-8 animate-in zoom-in duration-300">
        <button onClick={onClose} className="absolute right-4 top-4 p-2 hover:bg-bg-tertiary rounded-xl transition-colors text-text-tertiary hover:text-text-primary">
          <X className="w-5 h-5" />
        </button>

        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-16 h-16 bg-accent/10 rounded-2xl flex items-center justify-center mb-4 border border-accent/20">
            <Lock className="w-8 h-8 text-accent" />
          </div>
          <h2 className="text-xl font-black text-text-primary uppercase tracking-tight">{"Đổi mật khẩu mới"}</h2>
          <p className="text-xs text-text-secondary mt-1">{"Vui lòng nhập mật khẩu mới để bảo mật tài khoản của bạn"}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider ml-1">{"Mật khẩu hiện tại"}</label>
            <div className="relative">
              <input
                required
                type={showPassword ? "text" : "password"}
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                className="w-full bg-bg-tertiary border border-border-primary rounded-xl py-3 px-4 text-sm outline-none focus:border-red-500/50 text-text-primary pr-12"
                placeholder={"Nhập mật khẩu hiện tại"}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider ml-1">{"Mật khẩu mới"}</label>
            <div className="relative">
              <input
                required
                type={showPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full bg-bg-tertiary border border-border-primary rounded-xl py-3 px-4 text-sm outline-none focus:border-accent text-text-primary pr-12"
                placeholder={"Nhập mật khẩu mới"}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <PasswordRequirements password={newPassword} />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider ml-1">{"Xác nhận mật khẩu"}</label>
            <div className="relative">
              <input
                required
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`w-full bg-bg-tertiary border rounded-xl py-3 pl-4 pr-12 text-sm outline-none transition-colors text-text-primary ${
                  confirmPassword.length > 0
                    ? confirmPassword !== newPassword
                      ? 'border-red-500 bg-red-500/5 focus:border-red-500'
                      : 'border-accent/70 bg-accent/5 focus:border-accent'
                    : 'border-border-primary focus:border-accent'
                }`}
                placeholder={"Nhập lại mật khẩu mới"}
              />
              {confirmPassword.length > 0 && (
                confirmPassword !== newPassword ? (
                  <AlertCircle className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-red-500 animate-in fade-in zoom-in duration-200" />
                ) : (
                  <CheckCircle2 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-accent animate-in fade-in zoom-in duration-200" />
                )
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent text-text-inverse font-black py-3 rounded-xl hover:bg-accent-hover hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-[0_20px_40px_rgb(0_0_0_/_0.22)] mt-2 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "XÁC NHẬN THAY ĐỔI"}
          </button>
        </form>
      </div>
    </div>
  );
}
