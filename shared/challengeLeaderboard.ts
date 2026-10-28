export type ChallengeParticipantProgress = {
  user_id: string;
  display_name: string;
  role: 'owner' | 'member';
  joined_at: string;
  checkin_dates: string[];
};

export type ChallengeLeaderboardEntry = ChallengeParticipantProgress & {
  rank: number;
  score: number;
  total_checkins: number;
  eligible_days: number;
  eligible_start_date: string;
  joined_late: boolean;
  current_streak: number;
  longest_streak: number;
  completion_rate: number;
  checked_in_today: boolean;
};

const addDateKeyDays = (dateKey: string, amount: number): string => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
};

const vietnamDateKey = (date: Date): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

const calendarDays = (start: string, end: string): number => Math.round((
  new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()
) / 86_400_000) + 1;

const getStreaks = (dateKeys: string[], referenceDate: string) => {
  const uniqueDates = [...new Set(dateKeys)].sort();
  const dateSet = new Set(uniqueDates);
  let longestStreak = 0;
  let runningStreak = 0;
  let previousDate = '';

  uniqueDates.forEach((dateKey) => {
    runningStreak = previousDate && addDateKeyDays(previousDate, 1) === dateKey
      ? runningStreak + 1
      : 1;
    longestStreak = Math.max(longestStreak, runningStreak);
    previousDate = dateKey;
  });

  let currentStreak = 0;
  let cursor = dateSet.has(referenceDate) ? referenceDate : addDateKeyDays(referenceDate, -1);
  while (dateSet.has(cursor)) {
    currentStreak += 1;
    cursor = addDateKeyDays(cursor, -1);
  }

  return { currentStreak, longestStreak };
};

export const buildChallengeLeaderboard = (
  participants: ChallengeParticipantProgress[],
  totalDays: number,
  today: string,
  endDate: string | null,
  startDate: string,
  awardFullCompletionBonus = true,
): ChallengeLeaderboardEntry[] => {
  const referenceDate = endDate && today > endDate ? endDate : today;
  const entries = participants.map((participant) => {
    const checkinDates = [...new Set(participant.checkin_dates)].sort();
    const joinedDate = vietnamDateKey(new Date(participant.joined_at));
    const eligibleStart = joinedDate > startDate ? joinedDate : startDate;
    const eligibleDays = Math.max(1, calendarDays(eligibleStart, endDate || today));
    const { currentStreak, longestStreak } = getStreaks(checkinDates, referenceDate);
    const totalCheckins = checkinDates.length;
    const streakBonus = Math.max(0, longestStreak - 1) * 20;
    const fullCompletionBonus = awardFullCompletionBonus && endDate && totalCheckins >= totalDays ? 200 : 0;

    return {
      ...participant,
      checkin_dates: checkinDates,
      rank: 0,
      score: totalCheckins * 100 + streakBonus + fullCompletionBonus,
      total_checkins: totalCheckins,
      eligible_days: eligibleDays,
      eligible_start_date: eligibleStart,
      joined_late: eligibleStart > startDate,
      current_streak: currentStreak,
      longest_streak: longestStreak,
      completion_rate: Math.min(100, Math.round((totalCheckins / eligibleDays) * 100)),
      checked_in_today: checkinDates.includes(today),
    };
  });

  entries.sort((left, right) => (
    right.score - left.score
    || right.total_checkins - left.total_checkins
    || right.longest_streak - left.longest_streak
    || Number(right.checked_in_today) - Number(left.checked_in_today)
    || new Date(left.joined_at).getTime() - new Date(right.joined_at).getTime()
  ));

  let previousScore = -1;
  let previousRank = 0;
  return entries.map((entry, index) => {
    const rank = entry.score === previousScore ? previousRank : index + 1;
    previousScore = entry.score;
    previousRank = rank;
    return { ...entry, rank };
  });
};
