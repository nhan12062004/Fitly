import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Copy,
  Flame,
  Loader2,
  Trophy,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../contexts/AuthContext';
import {
  createCrewChallenge,
  getUserChallenges,
  joinChallengeByInviteCode,
  type ChallengeSummary,
} from '../lib/Challenges';

const getErrorText = (error: unknown, fallback: string): string => {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || fallback);
  }
  return fallback;
};

const formatDate = (dateKey: string): string => new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
}).format(new Date(`${dateKey}T00:00:00`));

function ChallengeDialog({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <button type="button" aria-label="Đóng" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <section className="relative w-full max-w-lg rounded-2xl border border-border-primary bg-bg-secondary p-5 shadow-2xl md:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-text-primary">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-text-secondary">{description}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-border-primary p-2 text-text-secondary hover:text-text-primary">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function ChallengeCard({ challenge, onOpen }: { challenge: ChallengeSummary; onOpen: () => void }) {
  const isCrew = challenge.mode === 'crew';
  const isDefaultSolo = !isCrew && challenge.target?.is_default === true;
  const progressText = isCrew
    ? `${challenge.today_checkin_count}/${challenge.participant_count} thành viên đã điểm danh hôm nay`
    : challenge.user_checked_in
      ? 'Bạn đã hoàn thành thử thách hôm nay'
      : 'Điểm danh hôm nay để giữ vững thói quen';

  return (
    <article className="flex min-w-0 flex-col rounded-2xl border border-border-primary bg-bg-secondary/80 p-5 shadow-[0_18px_48px_rgba(0,0,0,0.14)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.12em] ${
            isCrew ? 'bg-ai/10 text-ai' : 'bg-accent/10 text-accent'
          }`}>
            {isCrew ? <Users className="h-3 w-3" /> : <Flame className="h-3 w-3" />}
            {isCrew ? 'Nhóm' : isDefaultSolo ? 'Cá nhân · Mặc định' : 'Cá nhân'}
          </span>
          <h3 className="mt-3 truncate text-lg font-black text-text-primary">{challenge.title}</h3>
        </div>
        {challenge.user_checked_in ? (
          <CheckCircle2 className="h-6 w-6 shrink-0 text-accent" />
        ) : (
          <Clock3 className="h-6 w-6 shrink-0 text-warning" />
        )}
      </div>

      <p className="mt-3 min-h-12 text-sm font-semibold leading-6 text-text-secondary">{progressText}</p>

      <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-text-tertiary">
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-bg-tertiary px-2.5 py-1.5">
          <CalendarDays className="h-3.5 w-3.5" />
          {formatDate(challenge.start_date)} – {formatDate(challenge.end_date)}
        </span>
        {isCrew && (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-bg-tertiary px-2.5 py-1.5">
            <Users className="h-3.5 w-3.5" />
            {challenge.participant_count}/{challenge.max_members}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onOpen}
        className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border-primary bg-bg-tertiary text-sm font-black text-text-primary transition-colors hover:border-accent/35 hover:text-accent"
      >
        Xem thử thách
        <ArrowRight className="h-4 w-4" />
      </button>
    </article>
  );
}

export default function Challenges() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [challenges, setChallenges] = useState<ChallengeSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dialog, setDialog] = useState<'crew' | 'join' | null>(null);
  const [crewTitle, setCrewTitle] = useState('Thử thách nhóm 7 ngày');
  const [inviteCode, setInviteCode] = useState('');

  const activeChallenges = useMemo(
    () => challenges.filter((challenge) => challenge.status === 'active'),
    [challenges],
  );
  const completedChallenges = useMemo(
    () => challenges.filter((challenge) => challenge.status !== 'active'),
    [challenges],
  );
  const loadChallenges = useCallback(async () => {
    if (!user?.id) return;
    setIsLoading(true);
    try {
      setChallenges(await getUserChallenges(user.id));
    } catch (error) {
      toast.error(getErrorText(error, 'Không thể tải danh sách thử thách.'));
    } finally {
      setIsLoading(false);
    }
  }, [toast, user?.id]);

  useEffect(() => {
    void loadChallenges();
  }, [loadChallenges]);

  const createCrew = async (event: FormEvent) => {
    event.preventDefault();
    if (!user?.id || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const challengeId = await createCrewChallenge(user.id, crewTitle.trim() || undefined);
      setDialog(null);
      toast.success('Thử thách nhóm đã sẵn sàng. Hãy gửi mã mời cho bạn bè.');
      navigate(`/challenges/${challengeId}`);
    } catch (error) {
      toast.error(getErrorText(error, 'Không thể tạo thử thách nhóm.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const joinCrew = async (event: FormEvent) => {
    event.preventDefault();
    if (!user?.id || inviteCode.length !== 8 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const challengeId = await joinChallengeByInviteCode(user.id, inviteCode);
      setDialog(null);
      toast.success('Bạn đã tham gia thử thách nhóm.');
      navigate(`/challenges/${challengeId}`);
    } catch (error) {
      toast.error(getErrorText(error, 'Không thể tham gia thử thách nhóm.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="dashboard-page-shell flex flex-col gap-5 pb-6">
      <section className="overflow-hidden rounded-2xl border border-border-primary bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,0.18),transparent_36%),radial-gradient(circle_at_bottom_left,rgba(34,197,94,0.14),transparent_36%),var(--bg-secondary)] p-5 md:p-7">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1.5 text-xs font-black uppercase tracking-[0.14em] text-accent">
              <Trophy className="h-3.5 w-3.5" />
              Thử thách
            </div>
            <h1 className="mt-4 text-2xl font-black text-text-primary md:text-3xl">Đều đặn quan trọng hơn cường độ</h1>
            <p className="mt-2 text-sm font-semibold leading-6 text-text-secondary md:text-base">
              Mỗi ngày hoàn thành một hành động lành mạnh, một mình hoặc cùng nhóm bạn thân.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setDialog('join')}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-border-primary bg-bg-secondary/80 px-4 text-sm font-black text-text-primary hover:border-ai/35"
            >
              <UserPlus className="h-4 w-4" />
              Tham gia bằng mã
            </button>
            <button
              type="button"
              onClick={() => setDialog('crew')}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-ai px-4 text-sm font-black text-white hover:opacity-90"
            >
              <Users className="h-4 w-4" />
              Tạo nhóm thử thách
            </button>
          </div>
        </div>
      </section>

      {isLoading ? (
        <section className="flex min-h-[22rem] items-center justify-center rounded-2xl border border-border-primary bg-bg-secondary/60">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </section>
      ) : challenges.length === 0 ? (
        <section className="flex min-h-[24rem] flex-col items-center justify-center rounded-2xl border border-dashed border-border-primary bg-bg-secondary/55 px-5 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 text-accent">
            <Flame className="h-8 w-8" />
          </div>
          <h2 className="mt-5 text-xl font-black text-text-primary">Chuỗi ngày đầu tiên bắt đầu từ một hành động nhỏ</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-text-secondary">
            Fitly đang chuẩn bị thử thách cá nhân mặc định. Uống nước, ghi bữa ăn, giấc ngủ hoặc tập luyện đều được tự động ghi nhận.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => setDialog('crew')} className="rounded-xl border border-border-primary px-5 py-3 text-sm font-black text-text-primary">
              Tạo thử thách nhóm
            </button>
          </div>
        </section>
      ) : (
        <>
          <section>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.15em] text-accent">Duy trì thói quen</p>
                <h2 className="mt-1 text-xl font-black text-text-primary">Thử thách đang diễn ra</h2>
              </div>
              <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-black text-accent">{activeChallenges.length}</span>
            </div>
            {activeChallenges.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {activeChallenges.map((challenge) => (
                  <ChallengeCard key={challenge.id} challenge={challenge} onOpen={() => navigate(`/challenges/${challenge.id}`)} />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border-primary bg-bg-secondary/50 px-5 py-8 text-center text-sm font-semibold text-text-secondary">
                Bạn chưa có thử thách đang hoạt động.
              </div>
            )}
          </section>

          {completedChallenges.length > 0 && (
            <section>
              <div className="mb-3 flex items-end justify-between gap-3">
                <h2 className="text-xl font-black text-text-primary">Thử thách đã hoàn thành</h2>
                <span className="rounded-full bg-bg-tertiary px-3 py-1 text-xs font-black text-text-secondary">{completedChallenges.length}</span>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {completedChallenges.map((challenge) => (
                  <ChallengeCard key={challenge.id} challenge={challenge} onOpen={() => navigate(`/challenges/${challenge.id}`)} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {dialog === 'crew' && (
        <ChallengeDialog
          title="Tạo thử thách nhóm"
          description="Thử thách riêng tư kéo dài 7 ngày, tối đa 5 người. Bạn sẽ nhận được mã mời sau khi tạo."
          onClose={() => setDialog(null)}
        >
          <form onSubmit={createCrew} className="mt-5 space-y-4">
            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.12em] text-text-tertiary">Tên thử thách</span>
              <input
                autoFocus
                value={crewTitle}
                onChange={(event) => setCrewTitle(event.target.value)}
                maxLength={80}
                className="mt-2 h-12 w-full rounded-xl border border-border-primary bg-bg-tertiary px-4 text-sm font-bold text-text-primary outline-none focus:border-ai/50"
              />
            </label>
            <div className="rounded-xl bg-bg-tertiary/60 p-4 text-sm font-semibold leading-6 text-text-secondary">
              Mục tiêu: mỗi người hoàn thành ít nhất một hành động lành mạnh mỗi ngày trong 7 ngày.
            </div>
            <button
              type="submit"
              disabled={crewTitle.trim().length < 2 || isSubmitting}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-ai text-sm font-black text-white disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
              Tạo thử thách nhóm
            </button>
          </form>
        </ChallengeDialog>
      )}

      {dialog === 'join' && (
        <ChallengeDialog
          title="Tham gia thử thách nhóm"
          description="Nhập mã mời gồm 8 ký tự do một thành viên trong nhóm chia sẻ."
          onClose={() => setDialog(null)}
        >
          <form onSubmit={joinCrew} className="mt-5 space-y-4">
            <input
              autoFocus
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
              placeholder="AB12CD34"
              className="h-14 w-full rounded-xl border border-border-primary bg-bg-tertiary px-4 text-center font-mono text-xl font-black uppercase tracking-[0.25em] text-text-primary outline-none placeholder:text-text-tertiary focus:border-ai/50"
            />
            <button
              type="submit"
              disabled={inviteCode.length !== 8 || isSubmitting}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-ai text-sm font-black text-white disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Tham gia thử thách
            </button>
          </form>
        </ChallengeDialog>
      )}
    </div>
  );
}
