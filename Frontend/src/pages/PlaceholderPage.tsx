import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { SkeletonBlock, SkeletonHero, SkeletonSurface } from '../components/PageSkeleton';

const placeholderPageCache = new Set<string>();

export function PlaceholderSkeleton() {
  return (
    <div className="dashboard-page-shell flex flex-col gap-4 md:gap-5 min-w-0 animate-pulse pb-4 md:pb-6 lg:pb-7">
      <SkeletonHero titleWidth="w-[44%] max-w-[16rem]" chips={2} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-5">
        <SkeletonSurface className="h-52" />
        <SkeletonSurface className="h-52" />
        <SkeletonSurface className="h-52" />
      </div>
      <SkeletonSurface className="p-5 md:p-6">
        {SkeletonBlock('h-6 w-52 rounded-xl')}
        {SkeletonBlock('mt-4 h-4 w-full rounded-lg')}
        {SkeletonBlock('mt-2 h-4 w-[86%] rounded-lg')}
        {SkeletonBlock('mt-6 h-11 w-40 rounded-xl')}
      </SkeletonSurface>
    </div>
  );
}

export default function PlaceholderPage({ title }: { title: string }) {
  const [loading, setLoading] = useState(() => !placeholderPageCache.has(title));
  const { refreshTick } = useAuth();

  useEffect(() => {
    // Giả lập loading 500ms mỗi khi chuyển danh mục hoặc refresh
    const hasCache = placeholderPageCache.has(title);
    setLoading(!hasCache);
    const timer = setTimeout(() => {
      placeholderPageCache.add(title);
      setLoading(false);
    }, hasCache ? 180 : 500);
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
