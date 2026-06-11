import React from 'react';
import { Home, ArrowRight } from 'lucide-react';

interface VerificationSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginClick: () => void;
}

export default function VerificationSuccessModal({
  isOpen,
  onClose,
  onLoginClick,
}: VerificationSuccessModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="themed-modal-backdrop absolute inset-0 backdrop-blur-md animate-in fade-in duration-500"
        onClick={onClose}
      />

      <div className="relative w-full max-w-md overflow-hidden rounded-[2.5rem] border border-border-primary bg-bg-secondary shadow-2xl animate-in zoom-in slide-in-from-bottom-8 duration-500">
        <div className="p-10 text-center">
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-text-primary">
            {'Xác thực email thành công'}
          </h2>

          <p className="mx-auto mb-10 max-w-[320px] leading-relaxed text-text-secondary">
            {
              'Tài khoản của bạn đã được xác thực. Bạn có thể đăng nhập và bắt đầu hành trình luyện tập cùng Fitly - Trợ lý cá nhân.'
            }
          </p>

          <div className="grid gap-4">
            <button
              onClick={onLoginClick}
              className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-accent py-4 font-bold text-text-inverse shadow-[0_18px_36px_rgb(0_0_0_/_0.22)] transition-all hover:scale-[1.02] hover:bg-accent-hover active:scale-[0.98]"
            >
              {'Đăng nhập'}
              <ArrowRight className="h-5 w-5 -translate-x-4 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
            </button>

            <button
              onClick={onClose}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border-primary bg-bg-tertiary py-4 font-bold text-text-secondary transition-all hover:bg-bg-primary hover:text-text-primary"
            >
              <Home className="h-5 w-5" />
              {'Về trang chủ'}
            </button>
          </div>
        </div>

        <div className="h-2 w-full bg-gradient-to-r from-transparent via-accent/30 to-transparent" />
      </div>
    </div>
  );
}
