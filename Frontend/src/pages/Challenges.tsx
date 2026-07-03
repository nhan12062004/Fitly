import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Flame,
  Loader2,
  LockKeyhole,
  Sparkles,
  Trophy,
  UserPlus,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../contexts/AuthContext';
import {
  createCrewChallenge,
  getChallengeDetail,
  getUserChallenges,
  joinChallengeByInviteCode,
  type ChallengeDetail,
  type ChallengeSummary,
} from '../lib/Challenges';

const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DAY_MS = 86_400_000;

const getVietnamDateKey = (date = new Date()): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: VIETNAM_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};

const addDays = (dateKey: string, amount: number): string => {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + amount);
  return getVietnamDateKey(date);
};

const formatDate = (dateKey: string): string => new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
}).format(new Date(`${dateKey}T00:00:00`));

const formatShortDate = (dateKey: string): string => new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
}).format(new Date(`${dateKey}T00:00:00`));

const getErrorText = (error: unknown, fallback: string): string => {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || fallback);
  }
  return fallback;
};

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
      <button type="button" aria-label="Đóng" className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <section className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-border-primary bg-bg-secondary shadow-2xl">
        <div className="border-b border-border-primary bg-[linear-gradient(120deg,rgba(139,92,246,0.12),transparent_55%)] p-5 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-black text-text-primary">{title}</h2>
              <p className="mt-1 text-sm leading-6 text-text-secondary">{description}</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-full border border-border-primary bg-bg-secondary/80 p-2 text-text-secondary hover:text-text-primary">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="p-5 md:p-6">{children}</div>
      </section>
    </div>
  );
}

function CrewCard({ challenge, onOpen }: { challenge: ChallengeSummary; onOpen: () => void }) {
  const todayRate = Math.min(
    100,
    Math.round((challenge.today_checkin_count / Math.max(1, challenge.participant_count)) * 100),
  );

  return (
    <article className="group rounded-2xl border border-border-primary bg-bg-secondary/80 p-5 transition-colors hover:border-ai/30">
      <div className="flex items-start justify-between gap-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-ai/10 text-ai">
          <Users className="h-5 w-5" />
        </span>
        <span className="rounded-full border border-border-primary bg-bg-tertiary px-2.5 py-1 text-[11px] font-black text-text-secondary">
          {challenge.participant_count}/{challenge.max_members} người
        </span>
      </div>
      <h3 className="mt-4 truncate text-lg font-black text-text-primary">{challenge.title}</h3>
      <p className="mt-1 text-sm font-semibold text-text-secondary">
        {challenge.today_checkin_count}/{challenge.participant_count} thành viên đã điểm danh hôm nay
      </p>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-bg-tertiary">
        <div className="h-full rounded-full bg-ai transition-[width] duration-500" style={{ width: `${todayRate}%` }} />
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border-primary/70 pt-4">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-text-tertiary">
          <CalendarDays className="h-3.5 w-3.5" />
          Đến {formatDate(challenge.end_date)}
        </span>
        <button type="button" onClick={onOpen} className="inline-flex items-center gap-1.5 text-sm font-black text-ai">
          Xem chi tiết
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    </article>
  );
}

export default function Challenges() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [challenges, setChallenges] = useState<ChallengeSummary[]>([]);
  const [featuredDetail, setFeaturedDetail] = useState<ChallengeDetail | null>(null);
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
    () => challenges.filter((challenge) => challenge.status === 'completed'),
    [challenges],
  );
  const featuredChallenge = useMemo(
    () => activeChallenges.find((challenge) => challenge.mode === 'solo') || activeChallenges[0] || null,
    [activeChallenges],
  );
  const activeCrewChallenges = useMemo(
    () => activeChallenges.filter((challenge) => challenge.mode === 'crew' && challenge.id !== featuredChallenge?.id),
    [activeChallenges, featuredChallenge?.id],
  );
  const otherActiveChallenges = useMemo(
    () => activeChallenges.filter((challenge) => (
      challenge.id !== featuredChallenge?.id && challenge.mode !== 'crew'
    )),
    [activeChallenges, featuredChallenge?.id],
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

  useEffect(() => {
    let cancelled = false;
    if (!featuredChallenge || !user?.id) {
      setFeaturedDetail(null);
      return;
    }
    void getChallengeDetail(featuredChallenge.id, user.id)
      .then((detail) => {
        if (!cancelled) setFeaturedDetail(detail);
      })
      .catch(() => {
        if (!cancelled) setFeaturedDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [featuredChallenge, user?.id]);

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

  const featuredParticipant = featuredDetail?.participants.find((participant) => participant.user_id === user?.id);
  const featuredCheckedDates = new Set(featuredParticipant?.checkin_dates || []);
  const featuredDays = featuredChallenge
    ? Array.from({ length: 7 }, (_, index) => addDays(featuredChallenge.start_date, index))
    : [];
  const todayKey = getVietnamDateKey();
  const currentDay = featuredChallenge
    ? Math.max(1, Math.min(7, Math.floor((
        new Date(`${todayKey}T00:00:00`).getTime()
        - new Date(`${featuredChallenge.start_date}T00:00:00`).getTime()
      ) / DAY_MS) + 1))
    : 1;

  return (
    <div className="dashboard-page-shell flex flex-col gap-5 pb-6">
      <header className="flex flex-col gap-4 border-b border-border-primary pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-accent">
            <Trophy className="h-4 w-4" />
            Thử thách
          </div>
          <h1 className="mt-2 text-2xl font-black text-text-primary md:text-3xl">Mỗi ngày một bước nhỏ</h1>
          <p className="mt-1.5 max-w-2xl text-sm font-semibold leading-6 text-text-secondary">
            Fitly tự ghi nhận những hành động lành mạnh để bạn duy trì thói quen mà không cần thao tác rườm rà.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setDialog('join')}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-border-primary bg-bg-secondary px-4 text-sm font-black text-text-primary hover:border-ai/35"
          >
            <UserPlus className="h-4 w-4" />
            Nhập mã mời
          </button>
          <button
            type="button"
            onClick={() => setDialog('crew')}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-ai px-4 text-sm font-black text-white hover:bg-ai-hover"
          >
            <Users className="h-4 w-4" />
            Tạo nhóm thử thách
          </button>
        </div>
      </header>

      {isLoading ? (
        <section className="flex min-h-[28rem] items-center justify-center rounded-2xl border border-border-primary bg-bg-secondary/60">
          <div className="text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-accent" />
            <p className="mt-3 text-sm font-bold text-text-secondary">Đang chuẩn bị thử thách của bạn...</p>
          </div>
        </section>
      ) : featuredChallenge ? (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(18rem,0.75fr)]">
          <article className="relative overflow-hidden rounded-2xl border border-accent/20 bg-[radial-gradient(circle_at_top_right,rgba(34,197,94,0.18),transparent_34%),linear-gradient(145deg,var(--bg-secondary),var(--bg-primary))] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.20)] md:p-7">
            <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full border border-accent/10" />
            <div className="relative">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <span className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-accent">
                    {featuredChallenge.mode === 'solo' ? <Flame className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
                    {featuredChallenge.mode === 'solo' ? 'Thử thách cá nhân mặc định' : 'Thử thách nhóm'}
                  </span>
                  <h2 className="mt-4 text-2xl font-black text-text-primary">{featuredChallenge.title}</h2>
                  <p className="mt-2 max-w-xl text-sm font-semibold leading-6 text-text-secondary">
                    {featuredChallenge.description || 'Hoàn thành ít nhất một hành động lành mạnh mỗi ngày.'}
                  </p>
                </div>
                <div className={`flex shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-black ${
                  featuredChallenge.user_checked_in
                    ? 'border-accent/20 bg-accent/10 text-accent'
                    : 'border-warning/20 bg-warning/10 text-warning'
                }`}>
                  {featuredChallenge.user_checked_in ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                  {featuredChallenge.user_checked_in ? 'Đã hoàn thành hôm nay' : 'Chưa điểm danh hôm nay'}
                </div>
              </div>

              <div className="mt-7">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">Hành trình 7 ngày</p>
                  <p className="text-xs font-black text-text-secondary">Ngày {currentDay}/7</p>
                </div>
                <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                  {featuredDays.map((dateKey, index) => {
                    const checked = featuredCheckedDates.has(dateKey);
                    const isToday = dateKey === todayKey;
                    const isPastMissed = dateKey < todayKey && !checked;
                    return (
                      <div
                        key={dateKey}
                        className={`flex min-w-0 flex-col items-center rounded-xl border px-1 py-2.5 text-center sm:px-2 sm:py-3 ${
                          checked
                            ? 'border-accent/25 bg-accent/10'
                            : isToday
                              ? 'border-warning/30 bg-warning/10'
                              : 'border-border-primary bg-bg-tertiary/45'
                        }`}
                      >
                        <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-black sm:h-8 sm:w-8 ${
                          checked
                            ? 'bg-accent text-text-inverse'
                            : isPastMissed
                              ? 'bg-danger/10 text-danger'
                              : isToday
                                ? 'bg-warning/15 text-warning'
                                : 'bg-bg-secondary text-text-tertiary'
                        }`}>
                          {checked ? <Check className="h-3.5 w-3.5" /> : isPastMissed ? '×' : index + 1}
                        </span>
                        <span className="mt-1.5 hidden text-[10px] font-bold text-text-tertiary sm:block">{formatShortDate(dateKey)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-3 border-t border-border-primary/70 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-3 text-xs font-bold text-text-secondary">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5 text-accent" />
                    {formatDate(featuredChallenge.start_date)} – {formatDate(featuredChallenge.end_date)}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5 text-warning" />
                    Tự động ghi nhận hoạt động
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => navigate(`/challenges/${featuredChallenge.id}`)}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-black text-text-inverse"
                >
                  Xem chi tiết
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </article>

          <aside className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <div className="rounded-2xl border border-border-primary bg-bg-secondary/80 p-5">
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <CheckCircle2 className="h-5 w-5" />
                </span>
                <span className="text-3xl font-black text-text-primary">{activeChallenges.length}</span>
              </div>
              <p className="mt-4 text-sm font-black text-text-primary">Đang tham gia</p>
              <p className="mt-1 text-xs font-semibold leading-5 text-text-tertiary">Tổng số thử thách đang hoạt động</p>
            </div>
            <div className="rounded-2xl border border-border-primary bg-bg-secondary/80 p-5">
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-warning/10 text-warning">
                  <Trophy className="h-5 w-5" />
                </span>
                <span className="text-3xl font-black text-text-primary">{completedChallenges.length}</span>
              </div>
              <p className="mt-4 text-sm font-black text-text-primary">Đã hoàn thành</p>
              <p className="mt-1 text-xs font-semibold leading-5 text-text-tertiary">Những hành trình bạn đã đi qua</p>
            </div>
            <div className="rounded-2xl border border-ai/15 bg-ai/8 p-5 sm:col-span-2 xl:col-span-1">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ai/10 text-ai">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-black text-text-primary">Chỉ cần một hành động</p>
                  <p className="mt-1 text-xs font-semibold leading-5 text-text-secondary">
                    Uống nước, ghi bữa ăn, giấc ngủ hoặc bắt đầu tập đều được tính.
                  </p>
                </div>
              </div>
            </div>
          </aside>
        </section>
      ) : (
        <section className="flex min-h-[24rem] flex-col items-center justify-center rounded-2xl border border-dashed border-border-primary bg-bg-secondary/55 px-5 text-center">
          <Flame className="h-10 w-10 text-accent" />
          <h2 className="mt-4 text-xl font-black text-text-primary">Đang chuẩn bị thử thách mặc định</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-text-secondary">
            Thử thách cá nhân sẽ được tạo tự động sau khi bạn hoàn tất hồ sơ.
          </p>
        </section>
      )}

      {activeCrewChallenges.length > 0 && (
        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-ai">Cùng bạn bè</p>
              <h2 className="mt-1 text-xl font-black text-text-primary">Thử thách nhóm</h2>
            </div>
            <span className="rounded-full bg-ai/10 px-3 py-1 text-xs font-black text-ai">{activeCrewChallenges.length}</span>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {activeCrewChallenges.map((challenge) => (
              <CrewCard key={challenge.id} challenge={challenge} onOpen={() => navigate(`/challenges/${challenge.id}`)} />
            ))}
          </div>
        </section>
      )}

      {otherActiveChallenges.length > 0 && (
        <section>
          <h2 className="mb-3 text-xl font-black text-text-primary">Thử thách khác</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {otherActiveChallenges.map((challenge) => (
              <CrewCard key={challenge.id} challenge={challenge} onOpen={() => navigate(`/challenges/${challenge.id}`)} />
            ))}
          </div>
        </section>
      )}

      {completedChallenges.length > 0 && (
        <section className="rounded-2xl border border-border-primary bg-bg-secondary/55">
          <div className="flex items-center justify-between border-b border-border-primary px-5 py-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">Lịch sử</p>
              <h2 className="mt-1 text-lg font-black text-text-primary">Thử thách đã hoàn thành</h2>
            </div>
            <span className="text-sm font-black text-text-secondary">{completedChallenges.length}</span>
          </div>
          <div className="divide-y divide-border-primary">
            {completedChallenges.slice(0, 5).map((challenge) => (
              <button
                key={challenge.id}
                type="button"
                onClick={() => navigate(`/challenges/${challenge.id}`)}
                className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-bg-tertiary/45"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <CheckCircle2 className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-black text-text-primary">{challenge.title}</span>
                  <span className="mt-0.5 block text-xs font-semibold text-text-tertiary">
                    {formatDate(challenge.start_date)} – {formatDate(challenge.end_date)}
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-text-tertiary" />
              </button>
            ))}
          </div>
        </section>
      )}

      {dialog === 'crew' && (
        <ChallengeDialog
          title="Tạo thử thách nhóm"
          description="Một nhóm riêng tư tối đa 5 người, cùng duy trì thói quen trong 7 ngày."
          onClose={() => setDialog(null)}
        >
          <form onSubmit={createCrew} className="space-y-4">
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
            <div className="flex items-start gap-3 rounded-xl border border-ai/15 bg-ai/8 p-4">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-ai" />
              <p className="text-sm font-semibold leading-6 text-text-secondary">
                Chỉ người có mã mời mới tham gia được. Thành viên không nhìn thấy dữ liệu sức khỏe riêng tư của nhau.
              </p>
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
          title="Tham gia thử thách"
          description="Nhập mã mời gồm 8 ký tự được bạn bè chia sẻ."
          onClose={() => setDialog(null)}
        >
          <form onSubmit={joinCrew} className="space-y-4">
            <input
              autoFocus
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
              placeholder="AB12CD34"
              className="h-16 w-full rounded-xl border border-border-primary bg-bg-tertiary px-4 text-center font-mono text-2xl font-black uppercase tracking-[0.28em] text-text-primary outline-none placeholder:text-text-tertiary focus:border-ai/50"
            />
            <button
              type="submit"
              disabled={inviteCode.length !== 8 || isSubmitting}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-ai text-sm font-black text-white disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Tham gia nhóm
            </button>
          </form>
        </ChallengeDialog>
      )}
    </div>
  );
}
