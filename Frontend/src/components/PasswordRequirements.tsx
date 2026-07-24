import { Check, CheckCircle2 } from 'lucide-react';
import { validatePassword } from '../lib/passwordValidator';

interface PasswordRequirementsProps {
  password: string;
}

export default function PasswordRequirements({ password }: PasswordRequirementsProps) {
  if (!password) return null;

  const checks = validatePassword(password);

  const items = [
    { label: 'Tối thiểu 8 ký tự', met: checks.minLength },
    { label: 'Chữ hoa', met: checks.hasUpper },
    { label: 'Chữ thường', met: checks.hasLower },
    { label: 'Số', met: checks.hasNumber },
  ];

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-1 text-[11px] select-none animate-in fade-in slide-in-from-top-1 duration-200">
      {items.map((item) => (
        <div
          key={item.label}
          className={`flex items-center gap-1.5 font-medium transition-colors duration-200 ${
            item.met ? 'text-accent font-semibold' : 'text-text-tertiary opacity-70'
          }`}
        >
          {item.met ? (
            <div className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-accent text-text-inverse">
              <Check className="h-2.5 w-2.5 stroke-[3]" />
            </div>
          ) : (
            <div className="h-3.5 w-3.5 shrink-0 rounded-full border border-text-tertiary/40 bg-bg-tertiary/50" />
          )}
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
