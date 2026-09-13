import { invalidateResources } from '@/lib/query-cache';
import { supabase } from '@/lib/supabase';
import { requireSessionUser } from '@/lib/account-read-model';

export type ChallengeMode = 'solo' | 'crew';
export type ChallengeStatus = 'active' | 'completed' | 'cancelled';
export type ChallengeGoal = 'any' | 'workout' | 'meal' | 'water' | 'sleep';

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

export type ChallengeParticipant = {
  user_id: string;
  display_name: string;
  role: 'owner' | 'member';
  joined_at: string;
  checkin_dates: string[];
};

const normalize = (row: ChallengeSummary): ChallengeSummary => ({
  ...row,
  title: row.title === '7-Day Check-in Challenge' ? 'Điểm danh 7 ngày' : row.title === '7-Day Crew Check-in' ? 'Nhóm cùng giữ nhịp' : row.title,
  description: row.description === 'Complete at least 1 healthy action per day.' ? 'Mỗi ngày, hoàn thành một hành động lành mạnh.' : row.description === 'Keep the habit going together for 7 days.' ? 'Cùng nhau duy trì một thói quen lành mạnh.' : row.description,
  target: row.target ?? {},
  participant_count: Number(row.participant_count ?? 0),
  today_checkin_count: Number(row.today_checkin_count ?? 0),
  user_checkin_count: Number(row.user_checkin_count ?? 0),
  max_members: Number(row.max_members ?? 1),
  user_checked_in: Boolean(row.user_checked_in),
});

export const goalLabel = (target: Record<string, unknown>) => {
  const key = target.goal_key;
  if (key === 'workout') return 'Tập luyện';
  if (key === 'meal') return 'Dinh dưỡng';
  if (key === 'water') return 'Uống nước';
  if (key === 'sleep') return 'Giấc ngủ';
  return 'Thói quen lành mạnh';
};

export const todayKey = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const item = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${item('year')}-${item('month')}-${item('day')}`;
};

export const challengeDuration = (challenge: ChallengeSummary) => {
  if (!challenge.end_date) return null;
  return Math.max(1, Math.round((new Date(`${challenge.end_date}T00:00:00Z`).getTime() - new Date(`${challenge.start_date}T00:00:00Z`).getTime()) / 86_400_000) + 1);
};

export const elapsedChallengeDays = (challenge: ChallengeSummary) => {
  const duration = challengeDuration(challenge);
  const elapsed = Math.max(1, Math.round((new Date(`${todayKey()}T00:00:00Z`).getTime() - new Date(`${challenge.start_date}T00:00:00Z`).getTime()) / 86_400_000) + 1);
  return duration ? Math.min(duration, elapsed) : elapsed;
};

export async function loadChallenges() {
  const { error: ensureError } = await supabase.rpc('ensure_active_solo_challenge');
  if (ensureError) throw ensureError;
  const { data, error } = await supabase.rpc('get_user_challenge_summaries');
  if (error) throw error;
  return ((data ?? []) as ChallengeSummary[]).map(normalize);
}

export async function createChallenge(input: { title: string; description?: string; mode: ChallengeMode; durationDays: number; goal: ChallengeGoal; maxMembers: number }) {
  const { data, error } = await supabase.rpc('create_configured_challenge', {
    p_title: input.title.trim() || 'Thử thách của tôi',
    p_description: input.description?.trim() || null,
    p_mode: input.mode,
    p_duration_days: input.durationDays,
    p_goal_key: input.goal,
    p_max_members: input.mode === 'crew' ? input.maxMembers : 1,
  });
  if (error) throw error;
  void invalidateResources('challenges', 'challenge');
  return String(data);
}

export async function joinChallengeByInviteCode(inviteCode: string) {
  const code = inviteCode.trim().toUpperCase();
  if (!code) throw new Error('Nhập mã mời để tham gia thử thách.');
  const { data, error } = await supabase.rpc('join_challenge_by_invite_code', { p_invite_code: code });
  if (error) throw error;
  void invalidateResources('challenges', 'challenge');
  return String(data);
}

export async function loadChallengeDetail(id: string) {
  const challenges = await loadChallenges();
  const challenge = challenges.find((item) => item.id === id) ?? null;
  if (!challenge) return null;
  const { data, error } = await supabase.rpc('get_challenge_participant_progress', { p_challenge_id: id });
  if (error) throw error;
  const participants = ((data ?? []) as ChallengeParticipant[]).map((item) => ({ ...item, checkin_dates: (item.checkin_dates ?? []).map(String) }));
  return { challenge, participants };
}

export async function manualChallengeCheckin(id: string) {
  const { data, error } = await supabase.rpc('manual_challenge_checkin', { p_challenge_id: id });
  if (error) throw error;
  void invalidateResources('challenges', 'challenge');
  return Boolean(data);
}

export async function blockChallengeMember(blockedId: string) {
  const user = await requireSessionUser();
  const { error } = await supabase.from('user_blocks').upsert({ blocker_id: user.id, blocked_id: blockedId }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true });
  if (error) throw error;
  await invalidateResources('challenges', 'challenge', 'blocked-users');
}

export async function loadBlockedUsers(): Promise<{ user_id: string; display_name: string }[]> {
  const { data, error } = await supabase.rpc('get_blocked_users');
  if (error) throw error;
  return data ?? [];
}

export async function unblockChallengeMember(blockedId: string) {
  const user = await requireSessionUser();
  const { error } = await supabase.from('user_blocks').delete().eq('blocker_id', user.id).eq('blocked_id', blockedId);
  if (error) throw error;
  await invalidateResources('blocked-users');
}
