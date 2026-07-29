import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Award,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  Crown,
  Flame,
  Loader2,
  Medal,
  ShieldCheck,
  Target,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../contexts/AuthContext';
import {
  buildChallengeLeaderboard,
  getChallengeDetail,
  leaveChallenge,
  manualCheckin,
  type ChallengeDetail,
  type ChallengeLeaderboardEntry,
} from '../lib/Challenges';
import { supabase } from '../lib/Supabase';

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

const getErrorText = (error: unknown, fallback: string): string => {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || fallback);
  }
  return fallback;
};

type DayState = 'checked' | 'missed' | 'today' | 'future';

const getDayState = (dateKey: string, checkedDates: Set<string>): DayState => {
  if (checkedDates.has(dateKey)) return 'checked';
  const today = getVietnamDateKey();
  if (dateKey < today) return 'missed';
  if (dateKey === today) return 'today';
  return 'future';
};

function StatusMark({ state, compact = false }: { state: DayState; compact?: boolean }) {
  const size = compact ? 'h-8 w-8' : 'h-10 w-10';
  if (state === 'checked') {
    return <span title="Đã điểm danh" className={`inline-flex ${size} items-center justify-center rounded-full bg-accent/15 text-accent`}><Check className="h-4 w-4" /></span>;
  }
  if (state === 'missed') {
    return <span title="Đã bỏ lỡ" className={`inline-flex ${size} items-center justify-center rounded-full bg-danger/10 font-black text-danger`}>×</span>;
  }
  if (state === 'today') {
    return <span title="Hôm nay" className={`inline-flex ${size} items-center justify-center rounded-full bg-warning/12 text-warning`}><Clock3 className="h-4 w-4" /></span>;
  }
  return <span title="Sắp tới" className={`inline-flex ${size} items-center justify-center rounded-full bg-bg-tertiary font-black text-text-tertiary`}>–</span>;
}

const getInitials = (name: string): string => name
  .trim()
  .split(/\s+/)
  .slice(-2)
  .map((part) => part.charAt(0))
  .join('')
  .toUpperCase() || 'F';

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return <span title="Hạng nhất" className="flex h-9 w-9 items-center justify-center rounded-xl bg-warning/15 text-warning"><Crown className="h-4 w-4" /></span>;
  }
  if (rank === 2) {
    return <span title="Hạng nhì" className="flex h-9 w-9 items-center justify-center rounded-xl bg-info/12 text-info"><Medal className="h-4 w-4" /></span>;
  }
  if (rank === 3) {
    return <span title="Hạng ba" className="flex h-9 w-9 items-center justify-center rounded-xl bg-ai/12 text-ai"><Award className="h-4 w-4" /></span>;
  }
  return <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-bg-tertiary text-sm font-black text-text-secondary">#{rank}</span>;
}

function PodiumCard({
  entry,
  isCurrentUser,
}: {
  entry: ChallengeLeaderboardEntry;
  isCurrentUser: boolean;
}) {
  return (
    <article className={`relative overflow-hidden rounded-2xl border p-4 ${
      entry.rank === 1
        ? 'border-warning/25 bg-warning/8'
        : isCurrentUser
          ? 'border-accent/25 bg-accent/8'
          : 'border-border-primary bg-bg-tertiary/40'
    }`}>
      {entry.rank === 1 && <Crown className="absolute right-3 top-3 h-5 w-5 text-warning" />}
      <div className="flex items-center gap-3">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-black ${
          entry.rank === 1 ? 'bg-warning text-white' : 'bg-bg-secondary text-text-primary'
        }`}>
          {getInitials(entry.display_name)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-text-primary">
            {entry.display_name}
            {isCurrentUser && <span className="ml-1 text-accent">(Bạn)</span>}
          </p>
          <p className="mt-0.5 text-xs font-bold text-text-tertiary">Hạng {entry.rank}</p>
        </div>
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-2xl font-black text-text-primary">{entry.score.toLocaleString('vi-VN')}</p>
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">điểm</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-bg-secondary px-2.5 py-1 text-xs font-black text-warning">
          <Flame className="h-3.5 w-3.5" />
          {entry.current_streak} ngày
        </span>
      </div>
    </article>
  );
}

export default function ChallengeDetails() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [detail, setDetail] = useState<ChallengeDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const loadDetail = useCallback(async (showLoading = true) => {
    if (!id || !user?.id) return;
    if (showLoading) setIsLoading(true);
    setErrorMessage('');
    try {
      setDetail(await getChallengeDetail(id, user.id));
    } catch (error) {
      const message = getErrorText(error, 'Không thể tải dữ liệu. Vui lòng thử lại sau.');
      setErrorMessage(message);
      toast.error(message);
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, [id, toast, user?.id]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    if (!id || !user?.id) return undefined;
    const channel = supabase
      .channel(`challenge-race-${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'challenge_checkins', filter: `challenge_id=eq.${id}` },
        () => void loadDetail(false),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'challenge_participants', filter: `challenge_id=eq.${id}` },
        () => void loadDetail(false),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id, loadDetail, user?.id]);

  const challengeTotalDays = useMemo(() => {
    if (!detail) return 0;
    const referenceEnd = detail.challenge.end_date || getVietnamDateKey();
    return Math.max(1, Math.floor((
      new Date(`${referenceEnd}T00:00:00`).getTime()
      - new Date(`${detail.challenge.start_date}T00:00:00`).getTime()
    ) / DAY_MS) + 1);
  }, [detail]);
  const days = useMemo(() => {
    if (!detail) return [];
    const visibleCount = Math.min(7, challengeTotalDays);
    const today = getVietnamDateKey();
    const elapsedDays = Math.max(1, Math.min(challengeTotalDays, Math.floor((
      new Date(`${today}T00:00:00`).getTime()
      - new Date(`${detail.challenge.start_date}T00:00:00`).getTime()
    ) / DAY_MS) + 1));
    const startIndex = Math.max(0, Math.min(challengeTotalDays - visibleCount, elapsedDays - visibleCount));
    return Array.from({ length: visibleCount }, (_, index) => ({
      index: startIndex + index,
      dateKey: addDays(detail.challenge.start_date, startIndex + index),
      label: `Ngày ${startIndex + index + 1}`,
    }));
  }, [challengeTotalDays, detail]);

  const todayKey = getVietnamDateKey();
  const leaderboard = useMemo(
    () => detail
      ? buildChallengeLeaderboard(detail.participants, challengeTotalDays, todayKey, detail.challenge.end_date)
      : [],
    [challengeTotalDays, detail, todayKey],
  );
  const currentParticipant = detail?.participants.find((participant) => participant.user_id === user?.id);
  const currentRanking = leaderboard.find((participant) => participant.user_id === user?.id);
  const completionPercent = currentRanking?.completion_rate || 0;
  const currentRankingIndex = leaderboard.findIndex((participant) => participant.user_id === user?.id);
  const nextRanking = currentRanking && currentRankingIndex > 0
    ? leaderboard
        .slice(0, currentRankingIndex)
        .reverse()
        .find((participant) => participant.rank < currentRanking.rank)
    : undefined;
  const checkedToday = currentParticipant?.checkin_dates.includes(todayKey) || false;
  const challengeIsActive = detail?.challenge.status === 'active'
    && todayKey >= (detail?.challenge.start_date || '')
    && (!detail?.challenge.end_date || todayKey <= detail.challenge.end_date);
  const currentDay = detail
    ? Math.max(1, Math.min(challengeTotalDays, Math.floor((
        new Date(`${todayKey}T00:00:00`).getTime()
        - new Date(`${detail.challenge.start_date}T00:00:00`).getTime()
      ) / DAY_MS) + 1))
    : 1;

  const completeToday = async () => {
    if (!user?.id || !detail || checkedToday || isCheckingIn) return;
    setIsCheckingIn(true);
    try {
      const created = await manualCheckin(detail.challenge.id, user.id);
      if (created) toast.success('Bạn đã hoàn thành thử thách hôm nay.');
      else toast.info('Hôm nay bạn đã điểm danh hoặc thử thách chưa hoạt động.');
      await loadDetail(false);
    } catch (error) {
      toast.error(getErrorText(error, 'Không thể điểm danh.'));
    } finally {
      setIsCheckingIn(false);
    }
  };

  const leaveCurrentChallenge = async () => {
    if (!user?.id || !detail || currentParticipant?.role !== 'member' || isLeaving) return;
    if (!window.confirm('Bạn có chắc muốn rời thử thách này? Tiến độ cá nhân trong thử thách sẽ bị xóa.')) return;
    setIsLeaving(true);
    try {
      const left = await leaveChallenge(user.id, detail.challenge.id);
      if (left) {
        toast.success('Bạn đã rời thử thách.');
        navigate('/challenges');
      }
    } catch (error) {
      toast.error(getErrorText(error, 'Không thể rời thử thách.'));
    } finally {
      setIsLeaving(false);
    }
  };

  const copyInviteCode = async () => {
    const code = detail?.challenge.invite_code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
      toast.success('Đã sao chép mã mời.');
    } catch {
      toast.info(`Mã mời: ${code}`);
    }
  };

  if (isLoading) {
    return (
      <div className="dashboard-page-shell flex min-h-[60vh] flex-col items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
        <p className="mt-3 text-sm font-bold text-text-secondary">Đang tải chi tiết thử thách...</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="dashboard-page-shell flex min-h-[60vh] flex-col items-center justify-center text-center">
        <ShieldCheck className="h-12 w-12 text-text-tertiary" />
        <h1 className="mt-4 text-xl font-black text-text-primary">{errorMessage || 'Thử thách không tồn tại hoặc bạn chưa tham gia'}</h1>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {errorMessage && <button type="button" onClick={() => void loadDetail()} className="rounded-xl bg-accent px-5 py-3 text-sm font-black text-text-inverse">Thử lại</button>}
          <button type="button" onClick={() => navigate('/challenges')} className="rounded-xl border border-border-primary bg-bg-secondary px-5 py-3 text-sm font-black text-text-primary">Quay lại danh sách thử thách</button>
        </div>
      </div>
    );
  }

  const { challenge, participants } = detail;
  const isCrew = challenge.mode === 'crew';
  const goalKey = typeof challenge.target.goal_key === 'string' ? challenge.target.goal_key : 'any';
  const goalLabel = typeof challenge.target.goal_label === 'string'
    ? challenge.target.goal_label
    : 'Hoàn thành một hoạt động lành mạnh mỗi ngày';
  const requiresTrackedActivity = goalKey !== 'any';
  const rewardBadge = typeof challenge.target.reward_badge === 'string'
    ? challenge.target.reward_badge
    : null;
  const rewardEarned = Boolean(
    rewardBadge
    && challenge.end_date
    && currentRanking
    && currentRanking.total_checkins >= challengeTotalDays,
  );
  const challengeEnded = challenge.status === 'completed' || Boolean(challenge.end_date && todayKey > challenge.end_date);
  const progressSummary = challenge.end_date
    ? `${currentRanking?.total_checkins || 0}/${challengeTotalDays} ngày hoàn thành`
    : `${currentRanking?.total_checkins || 0} ngày hoàn thành · Ngày ${currentDay}`;
  const progressPercentLabel = challenge.end_date
    ? `${completionPercent}%`
    : `Nhịp hiện tại ${completionPercent}%`;

  return (
    <div className="dashboard-page-shell flex flex-col gap-4 pb-6 md:gap-5">
      <button
        type="button"
        onClick={() => navigate('/challenges')}
        className="inline-flex w-fit items-center gap-2 text-sm font-black text-text-secondary hover:text-accent"
      >
        <ArrowLeft className="h-4 w-4" />
        Quay lại
      </button>

      <section className="overflow-hidden rounded-2xl border border-border-primary bg-[radial-gradient(circle_at_top_right,rgba(34,197,94,0.16),transparent_36%),var(--bg-secondary)] p-5 md:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.13em] ${
              isCrew ? 'bg-ai/10 text-ai' : 'bg-accent/10 text-accent'
            }`}>
              {isCrew ? <Users className="h-3 w-3" /> : <Flame className="h-3 w-3" />}
              {isCrew ? 'Thử thách nhóm' : 'Thử thách cá nhân'}
            </span>
            <h1 className="mt-3 text-2xl font-black text-text-primary md:text-3xl">{challenge.title}</h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-text-secondary">{challenge.description}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 rounded-lg bg-bg-tertiary px-3 py-2 text-xs font-bold text-text-secondary">
                <CalendarDays className="h-3.5 w-3.5" />
                {formatDate(challenge.start_date)} – {challenge.end_date ? formatDate(challenge.end_date) : 'Không giới hạn'}
              </span>
              <span className="inline-flex items-center gap-2 rounded-lg bg-accent/10 px-3 py-2 text-xs font-bold text-accent">
                <Target className="h-3.5 w-3.5" />
                {goalLabel}
              </span>
              <span className="inline-flex items-center gap-2 rounded-lg bg-bg-tertiary px-3 py-2 text-xs font-bold text-text-secondary">
                <Users className="h-3.5 w-3.5" />
                {participants.length}/{challenge.max_members} thành viên
              </span>
              {rewardBadge && <span className="inline-flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs font-bold text-warning">
                <Award className="h-3.5 w-3.5" />
                Huy hiệu: {rewardBadge}
              </span>}
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-stretch gap-2">
            {isCrew && challenge.invite_code && (
              <button
                type="button"
                onClick={copyInviteCode}
                title="Sao chép mã mời"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-ai/25 bg-ai/10 px-4 text-sm font-black text-ai"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span>Sao chép mã mời:</span>
                <span className="font-mono tracking-[0.14em]">{challenge.invite_code}</span>
              </button>
            )}
            {requiresTrackedActivity ? (
              <div className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 text-center text-sm font-black ${checkedToday ? 'border-accent/25 bg-accent/10 text-accent' : 'border-border-primary bg-bg-secondary text-text-secondary'}`}>
                {checkedToday ? <CheckCircle2 className="h-4 w-4" /> : <Target className="h-4 w-4 text-accent" />}
                {checkedToday ? 'Đã được ghi nhận hôm nay' : 'Hoàn thành đúng hoạt động để được ghi nhận'}
              </div>
            ) : (
              <button
                type="button"
                onClick={completeToday}
                disabled={!challengeIsActive || checkedToday || isCheckingIn}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-black text-text-inverse disabled:cursor-default disabled:opacity-55"
              >
                {isCheckingIn ? <Loader2 className="h-4 w-4 animate-spin" /> : checkedToday ? <CheckCircle2 className="h-4 w-4" /> : <Flame className="h-4 w-4" />}
                {challenge.status === 'completed' ? 'Thử thách đã hoàn thành' : checkedToday ? 'Đã hoàn thành hôm nay' : challengeIsActive ? 'Hoàn thành hôm nay' : 'Thử thách chưa hoạt động'}
              </button>
            )}
            {currentParticipant?.role === 'member' && challenge.status === 'active' && (
              <button type="button" onClick={leaveCurrentChallenge} disabled={isLeaving} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-danger/25 bg-danger/10 px-5 text-sm font-black text-danger disabled:opacity-50">
                {isLeaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Rời thử thách
              </button>
            )}
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-accent/15 bg-accent/8 p-4">
          <div className="flex flex-col gap-3 min-[430px]:flex-row min-[430px]:items-center min-[430px]:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">
                {isCrew
                  ? challengeEnded
                    ? 'Kết quả chung cuộc'
                    : 'Cuộc đua hiện tại'
                  : 'Tiến độ hiện tại'}
              </p>
              <p className="mt-1 text-lg font-black text-text-primary">
                {challenge.end_date ? `Ngày ${currentDay}/${challengeTotalDays}` : `Ngày ${currentDay} · Không giới hạn`}
              </p>
            </div>
            <div className="min-[430px]:text-right">
              {isCrew && currentRanking ? (
                <>
                  <p className="text-lg font-black text-text-primary">Hạng #{currentRanking.rank}</p>
                  <p className="text-xs font-bold text-text-secondary">
                    {currentRanking.score.toLocaleString('vi-VN')} điểm
                    {nextRanking
                      ? ` · kém hạng #${nextRanking.rank} ${nextRanking.score - currentRanking.score} điểm`
                      : ' · đang dẫn đầu'}
                  </p>
                </>
              ) : (
                <p className={`text-sm font-black ${checkedToday ? 'text-accent' : 'text-warning'}`}>
                  {checkedToday ? 'Bạn đã điểm danh' : 'Bạn chưa điểm danh hôm nay'}
                </p>
              )}
            </div>
          </div>
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between text-xs font-bold text-text-secondary">
              <span>{progressSummary}</span>
              <span className="text-text-primary">{progressPercentLabel}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-bg-tertiary">
              <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${completionPercent}%` }} />
            </div>
          </div>
        </div>
      </section>

      {isCrew ? (
        <>
          <section className="overflow-hidden rounded-2xl border border-warning/20 bg-bg-secondary/85">
            <div className="flex flex-col gap-4 border-b border-border-primary bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.14),transparent_38%)] px-5 py-5 md:flex-row md:items-start md:justify-between md:px-6">
              <div>
                <p className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.14em] text-warning">
                  <Trophy className="h-4 w-4" />
                  {challengeEnded
                    ? 'Bảng xếp hạng chung cuộc'
                    : 'Bảng xếp hạng'}
                </p>
                <h2 className="mt-1 text-xl font-black text-text-primary">Ai đang giữ nhịp tốt nhất?</h2>
                <p className="mt-1 max-w-xl text-sm font-semibold leading-6 text-text-secondary">
                  Thứ hạng cập nhật theo điểm và chuỗi ngày liên tiếp của từng thành viên.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border-primary bg-bg-secondary px-3 py-1.5 text-xs font-black text-text-secondary">
                  <CheckCircle2 className="h-3.5 w-3.5 text-accent" />
                  100 điểm / ngày
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/20 bg-warning/10 px-3 py-1.5 text-xs font-black text-warning">
                  <Zap className="h-3.5 w-3.5" />
                  +20 điểm chuỗi
                </span>
              </div>
            </div>

            {leaderboard.length === 1 && (
              <div className="mx-5 mt-5 flex items-start gap-3 rounded-xl border border-dashed border-ai/30 bg-ai/8 p-4 md:mx-6">
                <Users className="mt-0.5 h-5 w-5 shrink-0 text-ai" />
                <div>
                  <p className="text-sm font-black text-text-primary">Bạn đang một mình trên đường đua</p>
                  <p className="mt-1 text-xs font-semibold leading-5 text-text-secondary">
                    Sao chép mã mời phía trên và kéo thêm đồng đội vào để bảng xếp hạng bắt đầu nóng lên.
                  </p>
                </div>
              </div>
            )}

            <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3 md:p-6">
              {leaderboard.slice(0, 3).map((entry) => (
                <PodiumCard key={entry.user_id} entry={entry} isCurrentUser={entry.user_id === user?.id} />
              ))}
            </div>

            <div className="border-t border-border-primary">
              <div className="hidden grid-cols-[3rem_minmax(12rem,1fr)_8rem_8rem_8rem] items-center gap-3 bg-bg-tertiary/45 px-6 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary lg:grid">
                <span>Hạng</span>
                <span>Thành viên</span>
                <span>Hoàn thành</span>
                <span>Chuỗi ngày</span>
                <span className="text-right">Điểm</span>
              </div>
              <div className="divide-y divide-border-primary">
                {leaderboard.map((entry) => {
                  const isCurrentUser = entry.user_id === user?.id;
                  return (
                    <div
                      key={entry.user_id}
                      className={`grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3 px-5 py-4 lg:grid-cols-[3rem_minmax(12rem,1fr)_8rem_8rem_8rem] lg:items-center lg:px-6 ${
                        isCurrentUser ? 'bg-accent/7' : ''
                      }`}
                    >
                      <RankBadge rank={entry.rank} />
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border-primary bg-bg-tertiary text-xs font-black text-text-primary">
                          {getInitials(entry.display_name)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-black text-text-primary">
                            {entry.display_name}
                            {isCurrentUser && <span className="ml-1 text-accent">(Bạn)</span>}
                          </p>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
                            <div className="h-full rounded-full bg-accent" style={{ width: `${entry.completion_rate}%` }} />
                          </div>
                        </div>
                      </div>
                      <p className="col-start-2 text-sm font-black text-text-primary lg:col-start-auto">
                        <span className="mr-1 text-[10px] uppercase text-text-tertiary lg:hidden">Hoàn thành</span>
                        {challenge.end_date ? `${entry.total_checkins}/${challengeTotalDays} ngày` : `${entry.total_checkins} ngày`}
                      </p>
                      <p className="col-start-2 inline-flex items-center gap-1 text-sm font-black text-warning lg:col-start-auto">
                        <Flame className="h-4 w-4" />
                        {entry.current_streak} ngày
                      </p>
                      <div className="col-start-2 text-left lg:col-start-auto lg:text-right">
                        <p className="text-lg font-black text-text-primary">{entry.score.toLocaleString('vi-VN')}</p>
                        <p className={`text-[10px] font-black uppercase tracking-[0.1em] ${
                          entry.checked_in_today ? 'text-accent' : 'text-text-tertiary'
                        }`}>
                          {challengeEnded
                            ? 'Đã chốt kết quả'
                            : entry.checked_in_today ? 'Đã xong hôm nay' : 'Chưa xong hôm nay'}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-border-primary bg-bg-secondary/80">
            <div className="border-b border-border-primary px-5 py-4 md:px-6">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-ai">Đường đua từng ngày</p>
              <h2 className="mt-1 text-xl font-black text-text-primary">Lịch sử đối đầu</h2>
            </div>
            <div className="space-y-3 p-4 xl:hidden">
              {leaderboard.map((participant) => {
                const checkedDates = new Set(participant.checkin_dates);
                return (
                  <article key={participant.user_id} className={`rounded-xl border p-3 ${participant.user_id === user?.id ? 'border-accent/25 bg-accent/7' : 'border-border-primary bg-bg-tertiary/40'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-text-primary">
                          <span className="mr-1.5 text-warning">#{participant.rank}</span>
                          {participant.display_name}
                          {participant.user_id === user?.id && <span className="ml-1 text-accent">(Bạn)</span>}
                        </p>
                        <p className="mt-1 text-[11px] font-bold text-text-tertiary">{participant.score.toLocaleString('vi-VN')} điểm</p>
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning/10 px-2 py-1 text-[10px] font-black text-warning">
                        <Flame className="h-3 w-3" />{participant.current_streak} ngày
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-7 gap-1.5">
                      {days.map((day) => (
                        <div key={day.dateKey} className="text-center">
                          <p className="mb-1 text-[9px] font-black text-text-tertiary">{day.label.replace('Ngày ', 'N')}</p>
                          <StatusMark compact state={getDayState(day.dateKey, checkedDates)} />
                        </div>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="hidden xl:block">
              <table className="w-full min-w-[52rem] border-collapse">
                <thead>
                  <tr className="border-b border-border-primary bg-bg-tertiary/45">
                    <th className="sticky left-0 z-10 min-w-48 bg-bg-tertiary px-5 py-3 text-left text-xs font-black uppercase tracking-[0.12em] text-text-tertiary">
                      Thành viên
                    </th>
                    {days.map((day) => (
                      <th key={day.dateKey} className="min-w-20 px-3 py-3 text-center text-xs font-black text-text-tertiary">
                        {day.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((participant) => {
                    const checkedDates = new Set(participant.checkin_dates);
                    return (
                      <tr key={participant.user_id} className="border-b border-border-primary/70 last:border-0">
                        <td className="sticky left-0 z-10 bg-bg-secondary px-5 py-4">
                          <p className="text-sm font-black text-text-primary">
                            <span className="mr-2 text-warning">#{participant.rank}</span>
                            {participant.display_name}
                            {participant.user_id === user?.id && <span className="ml-1 text-accent">(Bạn)</span>}
                          </p>
                          <p className="mt-0.5 text-[11px] font-bold text-text-tertiary">
                            {participant.score.toLocaleString('vi-VN')} điểm
                          </p>
                        </td>
                        {days.map((day) => (
                          <td key={day.dateKey} className="px-3 py-3 text-center">
                            <StatusMark compact state={getDayState(day.dateKey, checkedDates)} />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="rounded-2xl border border-border-primary bg-bg-secondary/80 p-5 md:p-6">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-accent">
            {challenge.end_date ? `Hành trình ${challengeTotalDays} ngày` : 'Hành trình không giới hạn'}
          </p>
          <h2 className="mt-1 text-xl font-black text-text-primary">Một hành động lành mạnh là đủ</h2>
          <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
            {days.map((day) => {
              const checkedDates = new Set(currentParticipant?.checkin_dates || []);
              const state = getDayState(day.dateKey, checkedDates);
              return (
                <div key={day.dateKey} className="flex items-center gap-3 rounded-xl border border-border-primary bg-bg-tertiary/45 p-3 lg:flex-col lg:text-center">
                  <StatusMark state={state} />
                  <div>
                    <p className="text-sm font-black text-text-primary">{day.label}</p>
                    <p className="mt-0.5 text-[11px] font-bold text-text-tertiary">{formatDate(day.dateKey).slice(0, 5)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(17rem,0.65fr)]">
        <div className="overflow-hidden rounded-2xl border border-border-primary bg-bg-secondary/80">
          <div className="border-b border-border-primary px-5 py-4 md:px-6">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-warning">Cách tính điểm</p>
            <h2 className="mt-1 text-xl font-black text-text-primary">Mỗi hành động đều có giá trị</h2>
          </div>
          <div className="grid gap-px bg-border-primary sm:grid-cols-2">
            {[
              ['+100', 'Nhiệm vụ chính', 'Hoàn thành hành động lành mạnh trong ngày.'],
              ['+30', 'Nhiệm vụ tùy chọn', 'Chưa áp dụng vì thử thách hiện chưa có nhiệm vụ phụ.'],
              ['+20', 'Thưởng chuỗi ngày', 'Cộng mỗi ngày liên tiếp, bắt đầu từ ngày thứ hai.'],
              ['+200', 'Hoàn thành trọn thử thách', 'Thưởng khi hoàn thành đủ mọi ngày của thử thách có thời hạn.'],
            ].map(([points, title, description]) => (
              <div key={title} className="bg-bg-secondary p-4 md:px-5">
                <div className="flex items-start gap-3">
                  <span className="rounded-lg bg-warning/10 px-2.5 py-1.5 text-sm font-black text-warning">{points}</span>
                  <div>
                    <p className="text-sm font-black text-text-primary">{title}</p>
                    <p className="mt-1 text-xs font-semibold leading-5 text-text-secondary">{description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="border-t border-border-primary px-5 py-3 text-xs font-semibold text-text-tertiary md:px-6">
            Bỏ lỡ một ngày sẽ ngắt chuỗi hiện tại nhưng không trừ số điểm bạn đã kiếm được.
          </p>
        </div>

        <aside className="relative overflow-hidden rounded-2xl border border-warning/20 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.16),transparent_42%),var(--bg-secondary)] p-5">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-warning/15 text-warning">
            <Award className="h-5 w-5" />
          </span>
          <p className="mt-4 text-xs font-black uppercase tracking-[0.14em] text-warning">Phần thưởng</p>
          <h2 className="mt-1 text-xl font-black text-text-primary">{rewardBadge || 'Chưa có huy hiệu'}</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-text-secondary">
            {!rewardBadge
              ? 'Thử thách này chưa được cấu hình huy hiệu phần thưởng.'
              : rewardEarned
              ? 'Huy hiệu đã được mở khóa và lưu trong bộ sưu tập thử thách của bạn.'
              : challenge.end_date
                ? `Hoàn thành ${challengeTotalDays} ngày để mở khóa huy hiệu này.`
                : 'Duy trì thử thách để tiến gần hơn đến huy hiệu này.'}
          </p>
          <div className="mt-5 flex items-center justify-between rounded-xl border border-border-primary bg-bg-tertiary/55 p-3">
            <span className="text-xs font-bold text-text-secondary">Điểm hiện tại</span>
            <span className="text-lg font-black text-text-primary">{(currentRanking?.score || 0).toLocaleString('vi-VN')}</span>
          </div>
        </aside>
      </section>

      <section className="flex items-start gap-3 rounded-2xl border border-border-primary bg-bg-secondary/55 p-4 text-sm font-semibold leading-6 text-text-secondary">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
        <p>
          {requiresTrackedActivity
            ? `Thử thách này chỉ tự động ghi nhận khi bạn ${goalLabel.charAt(0).toLowerCase()}${goalLabel.slice(1)}. Thành viên chỉ thấy trạng thái theo ngày, không thấy dữ liệu sức khỏe riêng tư.`
            : 'Việc ghi nước, bữa ăn, giấc ngủ và tập luyện sẽ tự động điểm danh. Thành viên chỉ thấy trạng thái theo ngày, không thấy dữ liệu sức khỏe riêng tư.'}
        </p>
      </section>
    </div>
  );
}
