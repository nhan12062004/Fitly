import { describe, expect, it } from 'vitest';
import { buildChallengeLeaderboard } from '../../shared/challengeLeaderboard';

describe('challenge leaderboard', () => {
  it('measures a late member only from their Vietnam join date while ranking by earned points', () => {
    const leaderboard = buildChallengeLeaderboard([
      {
        user_id: 'early', display_name: 'Early', role: 'owner',
        joined_at: '2026-10-19T12:00:00Z',
        checkin_dates: ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'],
      },
      {
        user_id: 'late', display_name: 'Late', role: 'member',
        joined_at: '2026-10-24T18:00:00Z', // 25 October in Vietnam
        checkin_dates: ['2026-10-26'],
      },
    ], 7, '2026-10-26', '2026-10-26', '2026-10-20');

    expect(leaderboard.map((entry) => entry.user_id)).toEqual(['early', 'late']);
    expect(leaderboard[0]).toMatchObject({ eligible_days: 7, joined_late: false, completion_rate: 71 });
    expect(leaderboard[1]).toMatchObject({ eligible_days: 2, eligible_start_date: '2026-10-25', joined_late: true, completion_rate: 50 });
  });

  it('freezes a cancelled challenge at its final day without a completion bonus', () => {
    const [entry] = buildChallengeLeaderboard([{
      user_id: 'owner', display_name: 'Owner', role: 'owner',
      joined_at: '2026-10-20T01:00:00Z',
      checkin_dates: ['2026-10-20', '2026-10-21'],
    }], 2, '2026-10-28', '2026-10-21', '2026-10-20', false);

    expect(entry).toMatchObject({ current_streak: 2, eligible_days: 2, completion_rate: 100, score: 220 });
  });
});
