import { supabase } from './Supabase';
import { buildChallengeLeaderboard, type ChallengeLeaderboardEntry, type ChallengeParticipantProgress } from '../../../shared/challengeLeaderboard';

export { buildChallengeLeaderboard };
export type { ChallengeLeaderboardEntry, ChallengeParticipantProgress };

export type ChallengeMode = 'solo' | 'crew';
export type ChallengeStatus = 'active' | 'completed' | 'cancelled';
export type ChallengeDifficulty = 'easy' | 'medium' | 'hard';
export type ChallengeGoalKey = 'any' | 'workout' | 'meal' | 'water' | 'sleep';

export type ChallengeTemplate = {
  id: string;
  slug: string;
  title: string;
  description: string;
  goal: string;
  duration_days: number | null;
  difficulty: ChallengeDifficulty;
  reward_badge: string | null;
  mode: ChallengeMode;
  is_active: boolean;
};

export type ChallengeSummary = {
  id: string;
  created_by: string;
  title: string;
  description: string | null;
  mode: ChallengeMode;
  challenge_type: 'daily_checkin';
  start_date: string;
  end_date: string | null;
  status: ChallengeStatus;
  target: Record<string, unknown>;
  invite_code: string | null;
  max_members: number;
  created_at: string;
  participant_count: number;
  today_checkin_count: number;
  user_checkin_count: number;
  user_checked_in: boolean;
};

export type ChallengeDetail = {
  challenge: ChallengeSummary;
  participants: ChallengeParticipantProgress[];
};

export type TodayChallengeStatus = {
  challenge: ChallengeSummary;
  userCheckedIn: boolean;
  checkedInCount: number;
  participantCount: number;
  rank: number | null;
  score: number;
  gapToNextRank: number;
  nextCompetitorName: string | null;
};

const assertCurrentUser = async (userId: string) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.id !== userId) {
    throw new Error('Phiên đăng nhập không hợp lệ.');
  }
};

const normalizeSummary = (row: ChallengeSummary): ChallengeSummary => ({
  ...row,
  title: row.title === '7-Day Check-in Challenge'
    ? 'Thử thách điểm danh 7 ngày'
    : row.title === '7-Day Crew Check-in'
      ? 'Thử thách nhóm 7 ngày'
      : row.title,
  description: row.description === 'Complete at least 1 healthy action per day.'
    ? 'Hoàn thành ít nhất một hành động lành mạnh mỗi ngày.'
    : row.description === 'Keep the habit going together for 7 days.'
      ? 'Cùng nhau duy trì thói quen lành mạnh trong 7 ngày.'
      : row.description,
  max_members: Number(row.max_members || 1),
  participant_count: Number(row.participant_count || 0),
  today_checkin_count: Number(row.today_checkin_count || 0),
  user_checkin_count: Number(row.user_checkin_count || 0),
  user_checked_in: Boolean(row.user_checked_in),
  target: row.target || {},
});

export const createSoloChallenge = async (
  userId: string,
  title = 'Thử thách điểm danh 7 ngày',
): Promise<string> => {
  await assertCurrentUser(userId);
  const { data, error } = await supabase.rpc('create_solo_challenge', {
    p_title: title,
  });
  if (error) throw error;
  return String(data);
};

export const createCrewChallenge = async (
  userId: string,
  title = 'Thử thách nhóm 7 ngày',
): Promise<string> => {
  await assertCurrentUser(userId);
  const { data, error } = await supabase.rpc('create_crew_challenge', {
    p_title: title,
  });
  if (error) throw error;
  return String(data);
};

export const createCustomChallenge = async (
  userId: string,
  input: {
    title: string;
    description?: string;
    mode: ChallengeMode;
    durationDays: number | null;
    goalKey?: ChallengeGoalKey;
    maxMembers?: number;
  },
): Promise<string> => {
  await assertCurrentUser(userId);
  const { data, error } = await supabase.rpc('create_configured_challenge', {
    p_title: input.title,
    p_description: input.description || null,
    p_mode: input.mode,
    p_duration_days: input.durationDays,
    p_goal_key: input.goalKey || 'any',
    p_max_members: input.mode === 'crew' ? input.maxMembers || 5 : 1,
  });
  if (error) throw error;
  return String(data);
};

export const getChallengeTemplates = async (): Promise<ChallengeTemplate[]> => {
  const { data, error } = await supabase
    .from('challenge_templates')
    .select('id, slug, title, description, goal, duration_days, difficulty, reward_badge, mode, is_active')
    .eq('is_active', true)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []) as ChallengeTemplate[];
};

export const startChallengeTemplate = async (
  userId: string,
  templateId: string,
): Promise<string> => {
  await assertCurrentUser(userId);
  const { data, error } = await supabase.rpc('start_challenge_template', {
    p_template_id: templateId,
  });
  if (error) throw error;
  return String(data);
};

export const leaveChallenge = async (
  userId: string,
  challengeId: string,
): Promise<boolean> => {
  await assertCurrentUser(userId);
  const { data, error } = await supabase.rpc('leave_challenge', {
    p_challenge_id: challengeId,
  });
  if (error) throw error;
  return Boolean(data);
};

export const cancelChallenge = async (userId: string, challengeId: string): Promise<boolean> => {
  await assertCurrentUser(userId);
  const { data, error } = await supabase.rpc('cancel_challenge', { p_challenge_id: challengeId });
  if (error) throw error;
  return Boolean(data);
};

export const rotateChallengeInviteCode = async (userId: string, challengeId: string): Promise<string> => {
  await assertCurrentUser(userId);
  const { data, error } = await supabase.rpc('rotate_challenge_invite_code', { p_challenge_id: challengeId });
  if (error) throw error;
  return String(data);
};

export const joinChallengeByInviteCode = async (
  userId: string,
  inviteCode: string,
): Promise<string> => {
  await assertCurrentUser(userId);
  const { data, error } = await supabase.rpc('join_challenge_by_invite_code', {
    p_invite_code: inviteCode.trim().toUpperCase(),
  });
  if (error) throw error;
  return String(data);
};

export const getUserChallenges = async (userId: string): Promise<ChallengeSummary[]> => {
  if (!userId) return [];
  const { error: ensureError } = await supabase.rpc('ensure_active_solo_challenge');
  if (ensureError) throw ensureError;

  const { data, error } = await supabase.rpc('get_user_challenge_summaries');
  if (error) throw error;
  return ((data || []) as ChallengeSummary[]).map(normalizeSummary);
};

export const selectPrimaryChallenge = (
  challenges: ChallengeSummary[],
): ChallengeSummary | null => {
  const activeChallenges = challenges
    .filter((challenge) => challenge.status === 'active')
    .sort((left, right) => {
      if (left.end_date === right.end_date) return 0;
      if (left.end_date === null) return 1;
      if (right.end_date === null) return -1;
      return left.end_date.localeCompare(right.end_date);
    });

  return activeChallenges.find((challenge) => challenge.mode === 'crew' && !challenge.user_checked_in)
    || activeChallenges.find((challenge) => challenge.mode === 'crew')
    || activeChallenges.find((challenge) => !challenge.user_checked_in)
    || activeChallenges[0]
    || null;
};

export const getChallengeDetail = async (
  challengeId: string,
  userId?: string,
): Promise<ChallengeDetail | null> => {
  if (!challengeId) return null;
  const summaries = await getUserChallenges(userId || 'current');
  const challenge = summaries.find((item) => item.id === challengeId);
  if (!challenge) return null;

  const { data, error } = await supabase.rpc('get_challenge_participant_progress', {
    p_challenge_id: challengeId,
  });
  if (error) throw error;

  const participants = ((data || []) as ChallengeParticipantProgress[]).map((participant) => ({
    ...participant,
    checkin_dates: (participant.checkin_dates || []).map(String),
  }));
  return { challenge, participants };
};

export const manualCheckin = async (
  challengeId: string,
  userId: string,
): Promise<boolean> => {
  await assertCurrentUser(userId);
  const { data, error } = await supabase.rpc('manual_challenge_checkin', {
    p_challenge_id: challengeId,
  });
  if (error) throw error;
  return Boolean(data);
};

export const getTodayChallengeStatus = async (
  userId: string,
): Promise<TodayChallengeStatus | null> => {
  const challenges = await getUserChallenges(userId);
  const challenge = selectPrimaryChallenge(challenges);
  if (!challenge) return null;

  let rank: number | null = null;
  let score = 0;
  let gapToNextRank = 0;
  let nextCompetitorName: string | null = null;

  if (challenge.mode === 'crew') {
    const { data, error } = await supabase.rpc('get_challenge_participant_progress', {
      p_challenge_id: challenge.id,
    });
    if (error) throw error;

    const participants = ((data || []) as ChallengeParticipantProgress[]).map((participant) => ({
      ...participant,
      checkin_dates: (participant.checkin_dates || []).map(String),
    }));
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const totalDays = challenge.end_date
      ? Math.max(
          1,
          Math.round((
            new Date(`${challenge.end_date}T00:00:00Z`).getTime()
            - new Date(`${challenge.start_date}T00:00:00Z`).getTime()
          ) / 86_400_000) + 1,
        )
      : Math.max(
          1,
          Math.round((
            new Date(`${today}T00:00:00Z`).getTime()
            - new Date(`${challenge.start_date}T00:00:00Z`).getTime()
          ) / 86_400_000) + 1,
        );
    const leaderboard = buildChallengeLeaderboard(participants, totalDays, today, challenge.end_date, challenge.start_date);
    const currentIndex = leaderboard.findIndex((entry) => entry.user_id === userId);

    if (currentIndex >= 0) {
      const current = leaderboard[currentIndex];
      const nextCompetitor = leaderboard
        .slice(0, currentIndex)
        .reverse()
        .find((entry) => entry.rank < current.rank);
      rank = current.rank;
      score = current.score;
      gapToNextRank = nextCompetitor ? Math.max(0, nextCompetitor.score - current.score) : 0;
      nextCompetitorName = nextCompetitor?.display_name || null;
    }
  }

  return {
    challenge,
    userCheckedIn: challenge.user_checked_in,
    checkedInCount: challenge.today_checkin_count,
    participantCount: challenge.participant_count,
    rank,
    score,
    gapToNextRank,
    nextCompetitorName,
  };
};

export const ensureChallengeNotifications = async (userId: string): Promise<void> => {
  const status = await getTodayChallengeStatus(userId);
  if (!status) return;

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const isCrewComplete = status.challenge.mode === 'crew'
    && status.participantCount > 0
    && status.checkedInCount >= status.participantCount;
  const title = isCrewComplete
    ? 'Cả nhóm đã hoàn thành thử thách hôm nay'
    : status.userCheckedIn
      ? 'Bạn đã hoàn thành thử thách hôm nay'
      : status.challenge.mode === 'crew' && status.nextCompetitorName && status.gapToNextRank > 0
        ? `Còn ${status.gapToNextRank} điểm để vượt ${status.nextCompetitorName}`
      : 'Hãy duy trì thói quen';
  const message = isCrewComplete
    ? 'Cả nhóm đã check in hôm nay. Một ngày rất đẹp của sự đều đặn.'
    : status.challenge.mode === 'crew'
      ? status.userCheckedIn
        ? `Bạn đang hạng #${status.rank || 1}. Nhóm đã có ${status.checkedInCount}/${status.participantCount} người hoàn thành hôm nay.`
        : `Nhóm đã có ${status.checkedInCount}/${status.participantCount} người hoàn thành và đang chờ bạn. Tập hôm nay để cải thiện thứ hạng.`
      : status.userCheckedIn
        ? 'Bạn đã hoàn thành ít nhất một hành động lành mạnh hôm nay.'
        : 'Bạn chưa điểm danh cho thử thách hôm nay.';

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('user_notifications')
    .upsert({
      user_id: userId,
      tone: 'progress',
      title,
      message,
      href: `/challenges/${status.challenge.id}`,
      source_type: 'challenge',
      source_id: status.challenge.id,
      dedupe_key: `challenge:${status.challenge.id}:${today}`,
      metadata: {
        challenge_id: status.challenge.id,
        mode: status.challenge.mode,
        checked_in_count: status.checkedInCount,
        participant_count: status.participantCount,
        rank: status.rank,
        score: status.score,
        gap_to_next_rank: status.gapToNextRank,
      },
      updated_at: now,
    }, { onConflict: 'user_id,dedupe_key' });

  if (error) throw error;
};
