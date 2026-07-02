import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Flame, Loader2, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getTodayChallengeStatus, type TodayChallengeStatus } from '../lib/Challenges';

export default function ActiveChallengeCard() {
  const { user, refreshTick } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<TodayChallengeStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!user?.id) {
        setStatus(null);
        setIsLoading(false);
        return;
      }
      try {
        const next = await getTodayChallengeStatus(user.id);
        if (!cancelled) setStatus(next);
      } catch (error) {
        console.error('Lỗi tải thẻ thử thách đang hoạt động:', error);
        if (!cancelled) setStatus(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshTick, user?.id]);

  if (isLoading) {
    return (
      <section className="flex min-h-28 items-center justify-center rounded-xl border border-border-primary bg-bg-secondary/60">
        <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
      </section>
    );
  }

  if (!status) return null;

  const { challenge } = status;
  const isCrew = challenge.mode === 'crew';

  return (
    <section className="overflow-hidden rounded-xl border border-border-primary bg-[linear-gradient(110deg,rgba(34,197,94,0.10),transparent_46%),var(--bg-secondary)] p-4 md:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${isCrew ? 'bg-ai/10 text-ai' : 'bg-accent/10 text-accent'}`}>
            {isCrew ? <Users className="h-5 w-5" /> : <Flame className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-text-tertiary">
              {isCrew ? 'Thử thách nhóm' : 'Thử thách cá nhân'}
            </p>
            <h2 className="mt-1 truncate text-base font-black text-text-primary">{challenge.title}</h2>
            <p className="mt-1 text-sm font-semibold text-text-secondary">
              {isCrew
                ? `${status.checkedInCount}/${status.participantCount} thành viên đã điểm danh hôm nay`
                : status.userCheckedIn
                  ? 'Bạn đã hoàn thành thử thách hôm nay'
                  : 'Duy trì thói quen bằng một hành động lành mạnh'}
            </p>
            <p className={`mt-1.5 inline-flex items-center gap-1.5 text-xs font-black ${status.userCheckedIn ? 'text-accent' : 'text-warning'}`}>
              {status.userCheckedIn ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Flame className="h-3.5 w-3.5" />}
              {status.userCheckedIn ? 'Đã điểm danh hôm nay' : 'Bạn chưa điểm danh hôm nay'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate(`/challenges/${challenge.id}`)}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-black text-text-inverse"
        >
          Xem thử thách
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}
