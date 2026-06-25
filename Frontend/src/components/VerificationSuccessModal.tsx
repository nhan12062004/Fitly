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

      <div className="relative w-full max-w-[21rem] max-h-[88dvh] overflow-hidden rounded-[22px] border border-border-primary bg-bg-secondary shadow-2xl animate-in zoom-in slide-in-from-bottom-8 duration-500 sm:max-w-md sm:rounded-[2rem]">
        <div className="p-4 text-center sm:p-6 md:p-8">
          <h2 className="mb-2 text-lg font-bold tracking-tight text-text-primary sm:mb-4 sm:text-3xl">
            {'Xác thực email thành công'}
          </h2>

          <p className="mx-auto mb-5 max-w-[17rem] text-sm leading-6 text-text-secondary sm:mb-10 sm:max-w-[320px] sm:text-base sm:leading-relaxed">
            {
              'Tài khoản của bạn đã được xác thực. Bạn có thể đăng nhập và bắt đầu hành trình luyện tập cùng Fitly - Trợ lý cá nhân.'
            }
          </p>

          <div className="grid gap-3 sm:gap-4">
            <button
              onClick={onLoginClick}
              className="group flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 text-sm font-bold text-text-inverse shadow-[0_18px_36px_rgb(0_0_0_/_0.22)] transition-all hover:scale-[1.02] hover:bg-accent-hover active:scale-[0.98] sm:rounded-2xl sm:py-4 sm:text-base"
            >
              {'Đăng nhập'}
              <ArrowRight className="h-4 w-4 -translate-x-4 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100 sm:h-5 sm:w-5" />
            </button>

            <button
              onClick={onClose}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-border-primary bg-bg-tertiary py-3 text-sm font-bold text-text-secondary transition-all hover:bg-bg-primary hover:text-text-primary sm:rounded-2xl sm:py-4 sm:text-base"
            >
              <Home className="h-4 w-4 sm:h-5 sm:w-5" />
              {'Về trang chủ'}
            </button>
          </div>
        </div>

        <div className="h-1.5 w-full bg-gradient-to-r from-transparent via-accent/30 to-transparent sm:h-2" />
      </div>
    </div>
  );
}
