import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  Flame,
  Loader2,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../contexts/AuthContext';
import {
  getChallengeDetail,
  manualCheckin,
  type ChallengeDetail,
  type ChallengeParticipantProgress,
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

export default function ChallengeDetails() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [detail, setDetail] = useState<ChallengeDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!id || !user?.id) return;
    setIsLoading(true);
    try {
      setDetail(await getChallengeDetail(id, user.id));
    } catch (error) {
      toast.error(getErrorText(error, 'Không thể tải chi tiết thử thách.'));
    } finally {
      setIsLoading(false);
    }
  }, [id, toast, user?.id]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const days = useMemo(() => {
    if (!detail) return [];
    const total = Math.min(7, Math.floor((
      new Date(`${detail.challenge.end_date}T00:00:00`).getTime()
      - new Date(`${detail.challenge.start_date}T00:00:00`).getTime()
    ) / DAY_MS) + 1);
    return Array.from({ length: total }, (_, index) => ({
      index,
      dateKey: addDays(detail.challenge.start_date, index),
      label: `Ngày ${index + 1}`,
    }));
  }, [detail]);

  const currentParticipant = detail?.participants.find((participant) => participant.user_id === user?.id);
  const checkedToday = currentParticipant?.checkin_dates.includes(getVietnamDateKey()) || false;
  const challengeIsActive = detail?.challenge.status === 'active'
    && getVietnamDateKey() >= (detail?.challenge.start_date || '')
    && getVietnamDateKey() <= (detail?.challenge.end_date || '');
  const currentDay = detail
    ? Math.max(1, Math.min(days.length, Math.floor((
        new Date(`${getVietnamDateKey()}T00:00:00`).getTime()
        - new Date(`${detail.challenge.start_date}T00:00:00`).getTime()
      ) / DAY_MS) + 1))
    : 1;

  const checkInToday = async () => {
    if (!user?.id || !detail || checkedToday || isCheckingIn) return;
    setIsCheckingIn(true);
    try {
      const created = await manualCheckin(detail.challenge.id, user.id);
      if (created) toast.success('Bạn đã hoàn thành thử thách hôm nay.');
      else toast.info('Hôm nay bạn đã điểm danh hoặc thử thách chưa hoạt động.');
      await loadDetail();
    } catch (error) {
      toast.error(getErrorText(error, 'Không thể điểm danh.'));
    } finally {
      setIsCheckingIn(false);
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
      <div className="dashboard-page-shell flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="dashboard-page-shell flex min-h-[60vh] flex-col items-center justify-center text-center">
        <ShieldCheck className="h-12 w-12 text-text-tertiary" />
        <h1 className="mt-4 text-xl font-black text-text-primary">Thử thách không tồn tại hoặc bạn chưa tham gia</h1>
        <button type="button" onClick={() => navigate('/challenges')} className="mt-5 rounded-xl bg-accent px-5 py-3 text-sm font-black text-text-inverse">
          Quay lại danh sách thử thách
        </button>
      </div>
    );
  }

  const { challenge, participants } = detail;
  const isCrew = challenge.mode === 'crew';

  return (
    <div className="dashboard-page-shell flex flex-col gap-4 pb-6 md:gap-5">
      <button
        type="button"
        onClick={() => navigate('/challenges')}
        className="inline-flex w-fit items-center gap-2 text-sm font-black text-text-secondary hover:text-accent"
      >
        <ArrowLeft className="h-4 w-4" />
        Tất cả thử thách
      </button>

      <section className="overflow-hidden rounded-2xl border border-border-primary bg-[radial-gradient(circle_at_top_right,rgba(34,197,94,0.16),transparent_36%),var(--bg-secondary)] p-5 md:p-7">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
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
                {formatDate(challenge.start_date)} – {formatDate(challenge.end_date)}
              </span>
              <span className="inline-flex items-center gap-2 rounded-lg bg-bg-tertiary px-3 py-2 text-xs font-bold text-text-secondary">
                <Users className="h-3.5 w-3.5" />
                {participants.length}/{challenge.max_members} thành viên
              </span>
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-stretch gap-2">
            {isCrew && challenge.invite_code && (
              <button
                type="button"
                onClick={copyInviteCode}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-ai/25 bg-ai/10 px-4 font-mono text-sm font-black tracking-[0.14em] text-ai"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {challenge.invite_code}
              </button>
            )}
            <button
              type="button"
              onClick={checkInToday}
              disabled={!challengeIsActive || checkedToday || isCheckingIn}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-black text-text-inverse disabled:cursor-default disabled:opacity-55"
            >
              {isCheckingIn ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : checkedToday ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Flame className="h-4 w-4" />
              )}
              {checkedToday ? 'Đã điểm danh hôm nay' : challengeIsActive ? 'Điểm danh hôm nay' : 'Thử thách chưa hoạt động'}
            </button>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-accent/15 bg-accent/8 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">Tiến độ hiện tại</p>
              <p className="mt-1 text-lg font-black text-text-primary">Ngày {currentDay}/{days.length}</p>
            </div>
            <p className={`text-sm font-black ${checkedToday ? 'text-accent' : 'text-warning'}`}>
              {checkedToday ? 'Bạn đã điểm danh' : 'Bạn chưa điểm danh hôm nay'}
            </p>
          </div>
        </div>
      </section>

      {isCrew ? (
        <section className="overflow-hidden rounded-2xl border border-border-primary bg-bg-secondary/80">
          <div className="border-b border-border-primary px-5 py-4 md:px-6">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-ai">Tiến độ của nhóm</p>
            <h2 className="mt-1 text-xl font-black text-text-primary">Cùng nhau duy trì đều đặn</h2>
          </div>
          <div className="overflow-x-auto custom-scrollbar">
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
                {participants.map((participant) => {
                  const checkedDates = new Set(participant.checkin_dates);
                  return (
                    <tr key={participant.user_id} className="border-b border-border-primary/70 last:border-0">
                      <td className="sticky left-0 z-10 bg-bg-secondary px-5 py-4">
                        <p className="text-sm font-black text-text-primary">
                          {participant.display_name}
                          {participant.user_id === user?.id && <span className="ml-1 text-accent">(Bạn)</span>}
                        </p>
                        <p className="mt-0.5 text-[11px] font-bold text-text-tertiary">
                          {participant.role === 'owner' ? 'Trưởng nhóm' : 'Thành viên'}
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
      ) : (
        <section className="rounded-2xl border border-border-primary bg-bg-secondary/80 p-5 md:p-6">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-accent">Hành trình 7 ngày</p>
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

      <section className="flex items-start gap-3 rounded-2xl border border-border-primary bg-bg-secondary/55 p-4 text-sm font-semibold leading-6 text-text-secondary">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
        <p>
          Việc ghi nước, bữa ăn, giấc ngủ và tập luyện sẽ tự động điểm danh. Thành viên chỉ thấy trạng thái theo ngày, không thấy dữ liệu sức khỏe riêng tư.
        </p>
      </section>
    </div>
  );
}
