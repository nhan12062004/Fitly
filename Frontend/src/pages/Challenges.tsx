import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowRight,
  Award,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  Crown,
  Flame,
  Loader2,
  LockKeyhole,
  Medal,
  Plus,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../contexts/AuthContext';
import {
  buildChallengeLeaderboard,
  createCustomChallenge,
  getChallengeDetail,
  getChallengeTemplates,
  getUserChallenges,
  joinChallengeByInviteCode,
  selectPrimaryChallenge,
  startChallengeTemplate,
  type ChallengeDifficulty,
  type ChallengeDetail,
  type ChallengeSummary,
  type ChallengeTemplate,
} from '../lib/Challenges';

const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DAY_MS = 86_400_000;

type ChallengeTab = 'active' | 'recommended' | 'group' | 'completed';

type BadgeDefinition = {
  name: string;
  description: string;
  earned: boolean;
};

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

const getDuration = (start: string, end: string | null): number | null => end
  ? Math.max(
      1,
      Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / DAY_MS) + 1,
    )
  : null;

const getElapsedDays = (challenge: ChallengeSummary): number => {
  const today = getVietnamDateKey();
  if (today < challenge.start_date) return 0;
  const duration = getDuration(challenge.start_date, challenge.end_date);
  const elapsed = Math.max(1, getDuration(challenge.start_date, today) || 1);
  return duration === null ? elapsed : Math.min(duration, elapsed);
};

const formatDate = (dateKey: string): string => new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
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
      <button type="button" aria-label="Đóng hộp thoại" className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
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

function DifficultyBadge({ value }: { value: ChallengeDifficulty }) {
  const style = value === 'easy'
    ? 'bg-accent/10 text-accent'
    : value === 'hard'
      ? 'bg-danger/10 text-danger'
      : 'bg-warning/10 text-warning';
  const label = value === 'easy' ? 'Dễ' : value === 'hard' ? 'Khó' : 'Trung bình';
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] ${style}`}>{label}</span>;
}

function LiveChallengeCard({
  challenge,
  onOpen,
}: {
  challenge: ChallengeSummary;
  onOpen: () => void;
}) {
  const duration = getDuration(challenge.start_date, challenge.end_date);
  const elapsed = getElapsedDays(challenge);
  const progress = challenge.status === 'completed'
    ? 100
    : duration === null ? null : Math.min(100, Math.round((challenge.user_checkin_count / duration) * 100));
  const isGroup = challenge.mode === 'crew';
  const difficultyValue = String(challenge.target.difficulty || '');
  const difficulty = ['easy', 'medium', 'hard'].includes(difficultyValue)
    ? difficultyValue as ChallengeDifficulty
    : null;
  const rewardBadge = typeof challenge.target.reward_badge === 'string' ? challenge.target.reward_badge : null;

  return (
    <article className="group flex min-w-0 flex-col rounded-2xl border border-border-primary bg-bg-secondary/85 p-5 shadow-[var(--app-shadow-soft)] transition-colors hover:border-accent/30">
      <div className="flex items-start justify-between gap-3">
        <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${isGroup ? 'bg-ai/10 text-ai' : 'bg-accent/10 text-accent'}`}>
          {isGroup ? <Users className="h-5 w-5" /> : <Flame className="h-5 w-5" />}
        </span>
        <div className="flex items-center gap-2">
          {difficulty && <DifficultyBadge value={difficulty} />}
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] ${
            challenge.status === 'completed' ? 'bg-info/10 text-info' : 'bg-accent/10 text-accent'
          }`}>
            {challenge.status === 'completed' ? 'Đã hoàn thành' : challenge.user_checked_in ? 'Đã tham gia' : 'Đang tham gia'}
          </span>
        </div>
      </div>
      <h3 className="mt-4 text-lg font-black text-text-primary">{challenge.title}</h3>
      <p className="mt-1 line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-text-secondary">
        {challenge.description || 'Hoàn thành một hành động lành mạnh mỗi ngày để duy trì nhịp độ.'}
      </p>
      <div className="mt-4 flex flex-wrap gap-3 text-xs font-bold text-text-tertiary">
        <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" />{duration === null ? 'Không giới hạn' : `${duration} ngày`}</span>
        {isGroup && <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />{challenge.participant_count}/{challenge.max_members}</span>}
        {rewardBadge && <span className="inline-flex items-center gap-1.5"><Award className="h-3.5 w-3.5" />{rewardBadge}</span>}
      </div>
      <div className="mt-5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-text-secondary">{challenge.status === 'completed' ? 'Đã hoàn thành thử thách' : duration === null ? `${challenge.user_checkin_count} ngày đã hoàn thành` : `${challenge.user_checkin_count}/${duration} ngày`}</span>
          <span className="font-black text-text-primary">{progress === null ? `Ngày ${elapsed}` : `${progress}%`}</span>
        </div>
        {progress !== null && (
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-bg-tertiary">
            <div className={`h-full rounded-full ${isGroup ? 'bg-ai' : 'bg-accent'}`} style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-border-primary pt-4">
        <span className={`inline-flex items-center gap-1.5 text-xs font-black ${challenge.user_checked_in ? 'text-accent' : 'text-warning'}`}>
          {challenge.user_checked_in ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
          {challenge.user_checked_in ? 'Đã xong hôm nay' : 'Hôm nay chưa hoàn thành'}
        </span>
        <button type="button" onClick={onOpen} className="inline-flex items-center gap-1.5 text-sm font-black text-text-primary group-hover:text-accent">
          {challenge.status === 'completed' ? 'Xem chi tiết' : 'Tiếp tục'}
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    </article>
  );
}

function TemplateCard({
  template,
  onJoin,
}: {
  template: ChallengeTemplate;
  onJoin: () => void;
}) {
  return (
    <article className="flex min-w-0 flex-col rounded-2xl border border-border-primary bg-bg-secondary/85 p-5 shadow-[var(--app-shadow-soft)]">
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-ai/10 text-ai">
          {template.mode === 'crew' ? <Users className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
        </span>
        <div className="flex flex-wrap justify-end gap-2">
          <DifficultyBadge value={template.difficulty} />
          <span className="rounded-full bg-ai/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-ai">Được gợi ý</span>
        </div>
      </div>
      <h3 className="mt-4 text-lg font-black text-text-primary">{template.title}</h3>
      <p className="mt-1 min-h-10 text-sm font-semibold leading-5 text-text-secondary">{template.description}</p>
      <div className="mt-4 rounded-xl border border-border-primary bg-bg-tertiary/45 p-3">
        <p className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">Mục tiêu</p>
        <p className="mt-1 text-xs font-bold leading-5 text-text-primary">{template.goal}</p>
      </div>
      <div className="mt-4 flex flex-wrap gap-3 text-xs font-bold text-text-tertiary">
        <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" />{template.duration_days === null ? 'Không giới hạn' : `${template.duration_days} ngày`}</span>
        {template.reward_badge && <span className="inline-flex items-center gap-1.5"><Award className="h-3.5 w-3.5" />{template.reward_badge}</span>}
        <span className="inline-flex items-center gap-1.5"><Target className="h-3.5 w-3.5" />{template.mode === 'crew' ? 'Nhóm' : 'Cá nhân'}</span>
      </div>
      <button type="button" onClick={onJoin} className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-black text-text-inverse">
        {template.mode === 'crew' ? <Users className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        Tham gia thử thách
      </button>
    </article>
  );
}

function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <section className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-border-primary bg-bg-secondary/55 px-5 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-bg-tertiary text-text-tertiary">{icon}</span>
      <h2 className="mt-4 text-lg font-black text-text-primary">{title}</h2>
      <p className="mt-2 max-w-md text-sm font-semibold leading-6 text-text-secondary">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </section>
  );
}

export default function Challenges() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [challenges, setChallenges] = useState<ChallengeSummary[]>([]);
  const [templates, setTemplates] = useState<ChallengeTemplate[]>([]);
  const [groupDetail, setGroupDetail] = useState<ChallengeDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [activeTab, setActiveTab] = useState<ChallengeTab>('active');
  const [dialog, setDialog] = useState<'create' | 'join' | null>(null);
  const [challengeTitle, setChallengeTitle] = useState('Thử thách 7 ngày của tôi');
  const [challengeDescription, setChallengeDescription] = useState('');
  const [challengeMode, setChallengeMode] = useState<'solo' | 'crew'>('solo');
  const [challengeDuration, setChallengeDuration] = useState<number | null>(7);
  const [inviteCode, setInviteCode] = useState('');
  const [copied, setCopied] = useState(false);

  const activeChallenges = useMemo(() => challenges.filter((challenge) => challenge.status === 'active'), [challenges]);
  const completedChallenges = useMemo(() => challenges.filter((challenge) => challenge.status === 'completed'), [challenges]);
  const groupChallenges = useMemo(() => activeChallenges.filter((challenge) => challenge.mode === 'crew'), [activeChallenges]);
  const primaryGroup = useMemo(
    () => selectPrimaryChallenge(groupChallenges) || groupChallenges[0] || null,
    [groupChallenges],
  );
  const primaryChallenge = useMemo(() => selectPrimaryChallenge(activeChallenges), [activeChallenges]);

  const loadChallenges = useCallback(async () => {
    if (!user?.id) return;
    setIsLoading(true);
    setErrorMessage('');
    try {
      const [nextChallenges, nextTemplates] = await Promise.all([
        getUserChallenges(user.id),
        getChallengeTemplates(),
      ]);
      setChallenges(nextChallenges);
      setTemplates(nextTemplates);
    } catch (error) {
      const message = getErrorText(error, 'Không thể tải dữ liệu. Vui lòng thử lại sau.');
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [toast, user?.id]);

  useEffect(() => {
    void loadChallenges();
  }, [loadChallenges]);

  useEffect(() => {
    let cancelled = false;
    if (!primaryGroup || !user?.id) {
      setGroupDetail(null);
      return;
    }
    void getChallengeDetail(primaryGroup.id, user.id)
      .then((detail) => {
        if (!cancelled) setGroupDetail(detail);
      })
      .catch(() => {
        if (!cancelled) setGroupDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [primaryGroup, user?.id]);

  const createChallenge = async (event: FormEvent) => {
    event.preventDefault();
    if (!user?.id || isSubmitting || challengeTitle.trim().length < 2) return;
    setIsSubmitting(true);
    try {
      const challengeId = await createCustomChallenge(user.id, {
        title: challengeTitle.trim(),
        description: challengeDescription.trim(),
        mode: challengeMode,
        durationDays: challengeDuration,
      });
      setDialog(null);
      toast.success(challengeMode === 'crew' ? 'Thử thách nhóm riêng tư đã sẵn sàng.' : 'Thử thách của bạn đã sẵn sàng.');
      navigate(`/challenges/${challengeId}`);
    } catch (error) {
      toast.error(getErrorText(error, 'Không thể tạo thử thách.'));
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
      toast.error(getErrorText(error, 'Không thể tham gia bằng mã này.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const joinTemplate = async (template: ChallengeTemplate) => {
    if (!user?.id || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const challengeId = await startChallengeTemplate(user.id, template.id);
      toast.success(`${template.title} đã sẵn sàng.`);
      navigate(`/challenges/${challengeId}`);
    } catch (error) {
      toast.error(getErrorText(error, 'Không thể bắt đầu mẫu thử thách này.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyInviteCode = async () => {
    const code = primaryGroup?.invite_code;
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

  const todayKey = getVietnamDateKey();
  const groupDuration = groupDetail
    ? getDuration(groupDetail.challenge.start_date, groupDetail.challenge.end_date) || getElapsedDays(groupDetail.challenge)
    : 1;
  const groupLeaderboard = useMemo(
    () => groupDetail
      ? buildChallengeLeaderboard(groupDetail.participants, groupDuration, todayKey, groupDetail.challenge.end_date)
      : [],
    [groupDetail, groupDuration, todayKey],
  );
  const currentGroupParticipant = groupDetail?.participants.find((participant) => participant.user_id === user?.id);
  const groupCheckedDates = new Set(currentGroupParticipant?.checkin_dates || []);
  const visibleGroupDays = Math.min(7, groupDuration);
  const groupElapsedDays = primaryGroup ? getElapsedDays(primaryGroup) : 1;
  const groupDayStartOffset = Math.max(0, Math.min(groupDuration - visibleGroupDays, groupElapsedDays - visibleGroupDays));
  const groupDays = primaryGroup
    ? Array.from({ length: visibleGroupDays }, (_, index) => {
        const date = new Date(`${primaryGroup.start_date}T00:00:00Z`);
        date.setUTCDate(date.getUTCDate() + groupDayStartOffset + index);
        return date.toISOString().slice(0, 10);
      })
    : [];

  const completedBadgeNames = new Set(completedChallenges
    .filter((challenge) => {
      const durationDays = Number(challenge.target.duration_days);
      return Number.isFinite(durationDays)
        && durationDays > 0
        && challenge.user_checkin_count >= durationDays;
    })
    .map((challenge) => challenge.target.reward_badge)
    .filter((badge): badge is string => typeof badge === 'string' && badge.length > 0));
  const badges: BadgeDefinition[] = [...new Map(
    templates
      .filter((template) => template.reward_badge)
      .map((template) => [template.reward_badge!, {
        name: template.reward_badge!,
        description: `Hoàn thành thử thách “${template.title}”`,
        earned: completedBadgeNames.has(template.reward_badge!),
      }]),
  ).values()];

  const tabs: Array<{ id: ChallengeTab; label: string; count?: number }> = [
    { id: 'active', label: 'Đang tham gia', count: activeChallenges.length },
    { id: 'recommended', label: 'Gợi ý', count: templates.length },
    { id: 'group', label: 'Nhóm', count: groupChallenges.length },
    { id: 'completed', label: 'Đã hoàn thành', count: completedChallenges.length },
  ];

  return (
    <div className="dashboard-page-shell flex flex-col gap-5 pb-6">
      <header className="flex flex-col gap-4 border-b border-border-primary pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-ai">
            <Trophy className="h-4 w-4" />
            Trung tâm thử thách
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-text-primary">Thử thách</h1>
          <p className="mt-1.5 max-w-2xl text-sm font-semibold leading-6 text-text-secondary">
            Xây dựng thói quen tập luyện đều đặn cùng các thử thách cá nhân và nhóm.
          </p>
        </div>
        <div className="grid w-full grid-cols-1 gap-2 min-[430px]:grid-cols-2 md:flex md:w-auto md:flex-wrap">
          <button type="button" onClick={() => setDialog('join')} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border-primary bg-bg-secondary px-4 text-sm font-black text-text-primary hover:border-ai/35">
            <UserPlus className="h-4 w-4" />Tham gia bằng mã
          </button>
          <button
            type="button"
            onClick={() => {
              setChallengeMode('solo');
              setChallengeTitle('Thử thách 7 ngày của tôi');
              setChallengeDescription('');
              setChallengeDuration(7);
              setDialog('create');
            }}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-black text-text-inverse hover:bg-accent-hover"
          >
            <Plus className="h-4 w-4" />Tạo thử thách
          </button>
        </div>
      </header>

      {errorMessage && (
        <div className="flex flex-col gap-3 rounded-xl border border-danger/20 bg-danger/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-bold text-danger">{errorMessage}</p>
          <button type="button" onClick={() => void loadChallenges()} className="h-10 rounded-xl border border-danger/25 px-4 text-sm font-black text-danger">Thử lại</button>
        </div>
      )}

      <nav className="overflow-x-auto custom-scrollbar border-b border-border-primary" aria-label="Danh mục thử thách">
        <div className="flex min-w-max gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`relative inline-flex h-12 items-center gap-2 px-4 text-sm font-black ${
                activeTab === tab.id ? 'text-accent' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {tab.label}
              <span className={`rounded-full px-2 py-0.5 text-[10px] ${activeTab === tab.id ? 'bg-accent/10 text-accent' : 'bg-bg-tertiary text-text-tertiary'}`}>{tab.count}</span>
              {activeTab === tab.id && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" />}
            </button>
          ))}
        </div>
      </nav>

      {isLoading ? (
        <section className="flex min-h-96 items-center justify-center rounded-2xl border border-border-primary bg-bg-secondary/60">
          <div className="text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-accent" />
            <p className="mt-3 text-sm font-bold text-text-secondary">Đang tải danh sách thử thách...</p>
          </div>
        </section>
      ) : (
        <>
          {activeTab === 'active' && (
            <div className="space-y-5">
              {primaryChallenge && (
                <section className="relative overflow-hidden rounded-2xl border border-accent/25 bg-[radial-gradient(circle_at_top_right,rgba(34,197,94,0.18),transparent_35%),linear-gradient(145deg,var(--bg-secondary),var(--bg-primary))] p-5 shadow-[var(--app-shadow-panel)] md:p-7">
                  <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                    <div className="max-w-2xl">
                      <span className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.13em] text-accent">
                        <Flame className="h-3.5 w-3.5" />Ưu tiên hôm nay
                      </span>
                      <h2 className="mt-4 text-2xl font-black text-text-primary md:text-3xl">{primaryChallenge.title}</h2>
                      <p className="mt-2 text-sm font-semibold leading-6 text-text-secondary">
                        {primaryChallenge.description || 'Hoàn thành một hành động lành mạnh hôm nay để giữ vững chuỗi ngày.'}
                      </p>
                      <div className="mt-5 flex flex-wrap gap-3 text-xs font-bold text-text-secondary">
                        <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-accent" />{formatDate(primaryChallenge.start_date)} – {primaryChallenge.end_date ? formatDate(primaryChallenge.end_date) : 'Không giới hạn'}</span>
                        {typeof primaryChallenge.target.reward_badge === 'string' && (
                          <span className="inline-flex items-center gap-1.5"><Award className="h-4 w-4 text-warning" />Huy hiệu: {primaryChallenge.target.reward_badge}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-stretch gap-3 sm:flex-row lg:flex-col lg:items-end">
                      <span className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-black ${
                        primaryChallenge.user_checked_in ? 'border-accent/25 bg-accent/10 text-accent' : 'border-warning/25 bg-warning/10 text-warning'
                      }`}>
                        {primaryChallenge.user_checked_in ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                        {primaryChallenge.user_checked_in ? 'Đã hoàn thành hôm nay' : 'Sẵn sàng cho hôm nay'}
                      </span>
                      <button type="button" onClick={() => navigate(`/challenges/${primaryChallenge.id}`)} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-black text-text-inverse">
                        Tiếp tục<ArrowRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </section>
              )}
              {activeChallenges.length > 0 ? (
                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <div><p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">Thử thách của bạn</p><h2 className="mt-1 text-xl font-black text-text-primary">Giữ vững nhịp độ</h2></div>
                    <span className="text-xs font-bold text-text-tertiary">{activeChallenges.length} đang tham gia</span>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {activeChallenges.map((challenge) => <LiveChallengeCard key={challenge.id} challenge={challenge} onOpen={() => navigate(`/challenges/${challenge.id}`)} />)}
                  </div>
                </section>
              ) : (
                <EmptyState
                  icon={<Target className="h-6 w-6" />}
                  title="Chuỗi ngày tiếp theo bắt đầu từ đây"
                  description="Bạn chưa tham gia thử thách nào. Hãy chọn một thử thách phù hợp hoặc tự tạo thử thách riêng."
                  action={<button type="button" onClick={() => setActiveTab('recommended')} className="rounded-xl bg-accent px-5 py-3 text-sm font-black text-text-inverse">Xem thử thách gợi ý</button>}
                />
              )}
            </div>
          )}

          {activeTab === 'recommended' && (
            <section>
              <div className="mb-4">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-ai">Mẫu thử thách gợi ý</p>
                <h2 className="mt-1 text-xl font-black text-text-primary">Mục tiêu rõ ràng cho từng kiểu tuần</h2>
                <p className="mt-1 text-sm font-semibold text-text-secondary">Chọn một mẫu phù hợp rồi để sự đều đặn tạo nên khác biệt.</p>
              </div>
              {templates.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {templates.map((template) => <TemplateCard key={template.id} template={template} onJoin={() => void joinTemplate(template)} />)}
                </div>
              ) : (
                <EmptyState icon={<Sparkles className="h-6 w-6" />} title="Chưa có thử thách gợi ý" description="Các mẫu thử thách đang được cập nhật. Bạn vẫn có thể tự tạo thử thách phù hợp." />
              )}
            </section>
          )}

          {activeTab === 'group' && (
            <div className="space-y-5">
              {primaryGroup && groupDetail ? (
                <section className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(19rem,0.75fr)]">
                  <article className="overflow-hidden rounded-2xl border border-ai/25 bg-bg-secondary/85 shadow-[var(--app-shadow-soft)]">
                    <div className="border-b border-border-primary bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,0.17),transparent_38%)] p-5 md:p-6">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.14em] text-ai"><Users className="h-4 w-4" />Thử thách nhóm</p>
                          <h2 className="mt-2 text-2xl font-black text-text-primary">{primaryGroup.title}</h2>
                          <p className="mt-1 text-sm font-semibold text-text-secondary">{primaryGroup.participant_count}/{primaryGroup.max_members} thành viên · {primaryGroup.today_checkin_count} người đã xong hôm nay</p>
                        </div>
                        {primaryGroup.invite_code && (
                          <button type="button" onClick={copyInviteCode} title="Sao chép mã mời" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-ai/25 bg-ai/10 px-4 font-mono text-sm font-black tracking-[0.15em] text-ai">
                            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{primaryGroup.invite_code}
                          </button>
                        )}
                      </div>
                      <div className="mt-5">
                        <div className="mb-2 flex items-center justify-between text-xs font-bold text-text-secondary">
                          <span>Tiến độ hằng ngày của bạn</span>
                          <span>{primaryGroup.end_date ? `${groupCheckedDates.size}/${groupDuration} ngày` : `${groupCheckedDates.size} ngày · Ngày ${groupElapsedDays}`}</span>
                        </div>
                        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(1, visibleGroupDays)}, minmax(0, 1fr))` }}>
                          {groupDays.map((dateKey, index) => {
                            const checked = groupCheckedDates.has(dateKey);
                            const missed = dateKey < todayKey && !checked;
                            return (
                              <div key={dateKey} className={`flex h-9 items-center justify-center rounded-lg border text-xs font-black ${
                                checked ? 'border-accent/25 bg-accent/10 text-accent' : missed ? 'border-danger/20 bg-danger/10 text-danger' : 'border-border-primary bg-bg-tertiary text-text-tertiary'
                              }`}>{checked ? <Check className="h-3.5 w-3.5" /> : missed ? '×' : index + 1}</div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    <div className="divide-y divide-border-primary">
                      {groupLeaderboard.slice(0, 5).map((entry) => (
                        <div key={entry.user_id} className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3 px-5 py-4 md:grid-cols-[2.5rem_minmax(0,1fr)_auto] md:px-6">
                          <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${entry.rank === 1 ? 'bg-warning/15 text-warning' : 'bg-bg-tertiary text-text-secondary'}`}>
                            {entry.rank === 1 ? <Crown className="h-4 w-4" /> : `#${entry.rank}`}
                          </span>
                          <div className="min-w-0"><p className="truncate text-sm font-black text-text-primary">{entry.display_name}{entry.user_id === user?.id && <span className="text-accent"> (Bạn)</span>}</p><p className="mt-0.5 text-xs font-semibold text-text-tertiary">{entry.total_checkins} lượt hoàn thành · chuỗi {entry.current_streak} ngày</p></div>
                          <p className="col-start-2 text-sm font-black text-text-primary md:col-start-auto">{entry.score.toLocaleString('vi-VN')} điểm</p>
                        </div>
                      ))}
                    </div>
                    <button type="button" onClick={() => navigate(`/challenges/${primaryGroup.id}`)} className="flex h-12 w-full items-center justify-center gap-2 border-t border-border-primary text-sm font-black text-ai">Mở bảng xếp hạng đầy đủ<ArrowRight className="h-4 w-4" /></button>
                  </article>

                  <aside className="space-y-4">
                    <div className="rounded-2xl border border-warning/20 bg-warning/8 p-5">
                      <div className="flex items-center justify-between"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-warning/10 text-warning"><Flame className="h-5 w-5" /></span><span className="text-3xl font-black text-text-primary">{Math.max(0, ...groupLeaderboard.map((entry) => entry.current_streak))}</span></div>
                      <p className="mt-4 text-sm font-black text-text-primary">Chuỗi ngày của nhóm</p>
                      <p className="mt-1 text-xs font-semibold leading-5 text-text-secondary">Chuỗi ngày đang hoạt động dài nhất trong nhóm.</p>
                    </div>
                    <div className="rounded-2xl border border-border-primary bg-bg-secondary/85 p-5">
                      <ShieldCheck className="h-5 w-5 text-accent" />
                      <p className="mt-3 text-sm font-black text-text-primary">Dữ liệu riêng tư luôn được bảo vệ</p>
                      <p className="mt-1 text-xs font-semibold leading-5 text-text-secondary">Thành viên chỉ có thể xem trạng thái hoàn thành và điểm số. Cân nặng, calories, chỉ số cơ thể và thông tin sức khỏe cá nhân sẽ không được hiển thị.</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <button type="button" onClick={() => setDialog('join')} className="rounded-xl border border-border-primary bg-bg-secondary px-3 py-3 text-xs font-black text-text-primary"><UserPlus className="mx-auto mb-1.5 h-4 w-4 text-ai" />Tham gia nhóm</button>
                      <button type="button" onClick={() => { setChallengeMode('crew'); setChallengeTitle('Thử thách nhóm của tôi'); setChallengeDescription(''); setChallengeDuration(7); setDialog('create'); }} className="rounded-xl border border-border-primary bg-bg-secondary px-3 py-3 text-xs font-black text-text-primary"><Plus className="mx-auto mb-1.5 h-4 w-4 text-accent" />Tạo nhóm</button>
                    </div>
                  </aside>
                </section>
              ) : (
                <EmptyState
                  icon={<Users className="h-6 w-6" />}
                  title="Tập luyện vui hơn khi có đồng đội"
                  description="Tạo thử thách nhóm riêng tư trong 7 ngày hoặc tham gia cùng bạn bè bằng mã mời."
                  action={<div className="grid w-full gap-2 min-[430px]:grid-cols-2"><button type="button" onClick={() => setDialog('join')} className="rounded-xl border border-border-primary bg-bg-secondary px-4 py-3 text-sm font-black text-text-primary">Tham gia bằng mã</button><button type="button" onClick={() => { setChallengeMode('crew'); setChallengeTitle('Thử thách nhóm của tôi'); setChallengeDescription(''); setChallengeDuration(7); setDialog('create'); }} className="rounded-xl bg-ai px-4 py-3 text-sm font-black text-white">Tạo nhóm</button></div>}
                />
              )}
              {groupChallenges.length > 1 && (
                <section>
                  <h2 className="mb-3 text-xl font-black text-text-primary">Các thử thách nhóm khác</h2>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {groupChallenges.filter((item) => item.id !== primaryGroup?.id).map((challenge) => <LiveChallengeCard key={challenge.id} challenge={challenge} onOpen={() => navigate(`/challenges/${challenge.id}`)} />)}
                  </div>
                </section>
              )}
            </div>
          )}

          {activeTab === 'completed' && (
            completedChallenges.length > 0 ? (
              <section>
                <div className="mb-4"><p className="text-xs font-black uppercase tracking-[0.14em] text-info">Lịch sử thử thách</p><h2 className="mt-1 text-xl font-black text-text-primary">Dấu ấn của sự bền bỉ</h2></div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {completedChallenges.map((challenge) => <LiveChallengeCard key={challenge.id} challenge={challenge} onOpen={() => navigate(`/challenges/${challenge.id}`)} />)}
                </div>
              </section>
            ) : (
              <EmptyState icon={<Medal className="h-6 w-6" />} title="Chưa có thử thách nào hoàn thành" description="Các thử thách đã hoàn thành và huy hiệu bạn kiếm được sẽ xuất hiện tại đây." />
            )
          )}
        </>
      )}

      {!isLoading && (
        <section className="overflow-hidden rounded-2xl border border-border-primary bg-bg-secondary/70">
          <div className="flex flex-col gap-3 border-b border-border-primary p-5 min-[430px]:flex-row min-[430px]:items-end min-[430px]:justify-between md:p-6">
            <div><p className="text-xs font-black uppercase tracking-[0.14em] text-warning">Huy hiệu và phần thưởng</p><h2 className="mt-1 text-xl font-black text-text-primary">Bộ sưu tập sự đều đặn</h2><p className="mt-1 text-sm font-semibold text-text-secondary">Huy hiệu đã mở khóa sẽ nổi bật; huy hiệu bị khóa cho bạn biết mục tiêu tiếp theo.</p></div>
            <span className="text-sm font-black text-text-secondary">{badges.filter((badge) => badge.earned).length}/{badges.length} đã mở</span>
          </div>
          {badges.length > 0 ? (
            <div className="grid grid-cols-2 gap-px bg-border-primary lg:grid-cols-3 xl:grid-cols-6">
              {badges.map((badge) => (
                <article key={badge.name} className={`relative bg-bg-secondary p-4 ${badge.earned ? '' : 'grayscale'}`}>
                  {!badge.earned && <LockKeyhole className="absolute right-3 top-3 h-3.5 w-3.5 text-text-tertiary" />}
                  <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${badge.earned ? 'bg-warning/10 text-warning' : 'bg-bg-tertiary text-text-tertiary'}`}><Award className="h-5 w-5" /></span>
                  <p className={`mt-3 text-sm font-black ${badge.earned ? 'text-text-primary' : 'text-text-tertiary'}`}>{badge.name}</p>
                  <p className="mt-1 text-[11px] font-semibold leading-4 text-text-tertiary">{badge.description}</p>
                </article>
              ))}
            </div>
          ) : (
            <p className="p-5 text-sm font-semibold text-text-secondary md:p-6">Chưa có huy hiệu nào được cấu hình.</p>
          )}
        </section>
      )}

      {dialog === 'create' && (
        <ChallengeDialog title="Tạo thử thách" description="Chọn thử thách cá nhân hoặc nhóm riêng tư, sau đó đặt thời lượng phù hợp với mục tiêu." onClose={() => setDialog(null)}>
          <form onSubmit={createChallenge} className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {([
                ['solo', 'Cá nhân', <Flame className="h-4 w-4" />],
                ['crew', 'Nhóm', <Users className="h-4 w-4" />],
              ] as const).map(([mode, label, icon]) => (
                <button key={mode} type="button" onClick={() => setChallengeMode(mode)} className={`flex h-12 items-center justify-center gap-2 rounded-xl border text-sm font-black ${challengeMode === mode ? 'border-accent/30 bg-accent/10 text-accent' : 'border-border-primary bg-bg-tertiary text-text-secondary'}`}>{icon}{label}</button>
              ))}
            </div>
            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.12em] text-text-tertiary">Tên thử thách</span>
              <input autoFocus value={challengeTitle} onChange={(event) => setChallengeTitle(event.target.value)} maxLength={80} className="mt-2 h-12 w-full rounded-xl border border-border-primary bg-bg-tertiary px-4 text-sm font-bold text-text-primary outline-none focus:border-accent/50" />
            </label>
            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.12em] text-text-tertiary">Mô tả</span>
              <textarea value={challengeDescription} onChange={(event) => setChallengeDescription(event.target.value)} maxLength={500} rows={3} placeholder="Một mục tiêu ngắn gọn, dễ duy trì mỗi ngày." className="mt-2 w-full resize-none rounded-xl border border-border-primary bg-bg-tertiary px-4 py-3 text-sm font-semibold text-text-primary outline-none placeholder:text-text-tertiary focus:border-accent/50" />
            </label>
            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.12em] text-text-tertiary">Thời lượng</span>
              <select
                value={challengeDuration === null ? 'unlimited' : String(challengeDuration)}
                onChange={(event) => setChallengeDuration(event.target.value === 'unlimited' ? null : Number(event.target.value))}
                className="mt-2 h-12 w-full rounded-xl border border-border-primary bg-bg-tertiary px-4 text-sm font-bold text-text-primary outline-none focus:border-accent/50"
              >
                <option value="7">7 ngày</option>
                <option value="14">14 ngày</option>
                <option value="30">30 ngày</option>
                <option value="unlimited">Không giới hạn</option>
              </select>
            </label>
            {challengeMode === 'crew' && (
              <div className="flex items-start gap-3 rounded-xl border border-ai/15 bg-ai/8 p-4">
                <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-ai" />
                <p className="text-sm font-semibold leading-6 text-text-secondary">Chỉ người có mã mời mới có thể tham gia. Các chỉ số sức khỏe luôn được giữ riêng tư.</p>
              </div>
            )}
            <button type="submit" disabled={challengeTitle.trim().length < 2 || isSubmitting} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent text-sm font-black text-text-inverse disabled:opacity-50">
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : challengeMode === 'crew' ? <Users className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              Tạo thử thách {challengeMode === 'crew' ? 'nhóm' : 'cá nhân'}
            </button>
          </form>
        </ChallengeDialog>
      )}

      {dialog === 'join' && (
        <ChallengeDialog title="Tham gia bằng mã" description="Nhập mã mời gồm 8 ký tự do đồng đội chia sẻ." onClose={() => setDialog(null)}>
          <form onSubmit={joinCrew} className="space-y-4">
            <input autoFocus value={inviteCode} onChange={(event) => setInviteCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))} placeholder="AB12CD34" className="h-16 w-full rounded-xl border border-border-primary bg-bg-tertiary px-4 text-center font-mono text-2xl font-black uppercase tracking-[0.28em] text-text-primary outline-none placeholder:text-text-tertiary focus:border-ai/50" />
            <button type="submit" disabled={inviteCode.length !== 8 || isSubmitting} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-ai text-sm font-black text-white disabled:opacity-50">
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}Tham gia nhóm
            </button>
          </form>
        </ChallengeDialog>
      )}
    </div>
  );
}
