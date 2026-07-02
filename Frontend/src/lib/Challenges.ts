import { supabase } from './Supabase';

export type ChallengeMode = 'solo' | 'crew';
export type ChallengeStatus = 'active' | 'completed' | 'cancelled';
export type ChallengeSourceType = 'water' | 'meal' | 'workout' | 'sleep' | 'manual';

export type ChallengeSummary = {
  id: string;
  created_by: string;
  title: string;
  description: string | null;
  mode: ChallengeMode;
  challenge_type: 'daily_checkin';
  start_date: string;
  end_date: string;
  status: ChallengeStatus;
  target: Record<string, unknown>;
  invite_code: string | null;
  max_members: number;
  created_at: string;
  participant_count: number;
  today_checkin_count: number;
  user_checked_in: boolean;
};

export type ChallengeParticipantProgress = {
  user_id: string;
  display_name: string;
  role: 'owner' | 'member';
  joined_at: string;
  checkin_dates: string[];
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

export const syncChallengeCheckin = async (
  userId: string,
  sourceType: ChallengeSourceType,
  sourceId?: string,
): Promise<number> => {
  await assertCurrentUser(userId);
  const { data, error } = await supabase.rpc('sync_challenge_checkin', {
    p_source_type: sourceType,
    p_source_id: sourceId || null,
    p_metadata: {},
  });
  if (error) throw error;
  return Number(data || 0);
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
  const challenge = challenges.find((item) => item.status === 'active');
  if (!challenge) return null;
  return {
    challenge,
    userCheckedIn: challenge.user_checked_in,
    checkedInCount: challenge.today_checkin_count,
    participantCount: challenge.participant_count,
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
      : 'Hãy duy trì thói quen';
  const message = isCrewComplete
    ? 'Cả nhóm đã check in hôm nay. Một ngày rất đẹp của sự đều đặn.'
    : status.challenge.mode === 'crew'
      ? status.userCheckedIn
        ? `Nhóm của bạn đã có ${status.checkedInCount}/${status.participantCount} người điểm danh hôm nay.`
        : `Nhóm đã có ${status.checkedInCount}/${status.participantCount} người điểm danh và đang chờ bạn.`
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
      },
      updated_at: now,
    }, { onConflict: 'user_id,dedupe_key' });

  if (error) throw error;
};
