import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

export function PlaceholderSkeleton() {
  return (
    <div className="flex-1 flex flex-col gap-4 md:gap-5 min-w-0 animate-pulse">
      <div className="rounded-2xl bg-bg-secondary/40 border border-border-primary/50 h-[220px] md:h-[260px] w-full" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-5">
        <div className="bg-bg-secondary/40 rounded-xl border border-border-primary/50 h-52" />
        <div className="bg-bg-secondary/40 rounded-xl border border-border-primary/50 h-52" />
        <div className="bg-bg-secondary/40 rounded-xl border border-border-primary/50 h-52" />
      </div>
      <div className="bg-bg-secondary/40 rounded-xl border border-border-primary/50 h-64" />
    </div>
  );
}

export default function PlaceholderPage({ title }: { title: string }) {
  const [loading, setLoading] = useState(true);
  const { refreshTick } = useAuth();

  useEffect(() => {
    // Giả lập loading 500ms mỗi khi chuyển danh mục hoặc refresh
    setLoading(true);
    const timer = setTimeout(() => setLoading(false), 500);
    return () => clearTimeout(timer);
  }, [title, refreshTick]);

  if (loading) return <PlaceholderSkeleton />;

  return (
    <div className="flex-1 flex items-center justify-center min-h-[50vh] animate-in fade-in duration-500">
      <div className="text-center">
        <h2 className="text-3xl font-bold text-text-primary mb-4 uppercase tracking-tighter">{title}</h2>
        <div className="w-20 h-1 bg-accent mx-auto mb-6 rounded-full"></div>
        <p className="text-text-secondary text-lg">Trang này đang được phát triển bởi đội ngũ <span className="text-accent font-bold">Fitly - Trợ lý cá nhân</span>.</p>
        <p className="text-text-tertiary mt-2">Vui lòng quay lại sau!</p>
      </div>
    </div>
  );
}
