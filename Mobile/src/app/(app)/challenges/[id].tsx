import { useResource } from '@/hooks/use-resource';
import { useAuth } from '@/providers/auth-provider';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { AppIcon } from '@/components/ui/app-icon';
import { FoundationCard } from '@/components/ui/foundation-card';
import { Screen } from '@/components/ui/screen';
import { blockChallengeMember, cancelChallenge, challengeDuration, elapsedChallengeDays, goalLabel, leaveChallenge, loadChallengeDetail, manualChallengeCheckin, rotateChallengeInviteCode, todayKey, type ChallengeParticipant, type ChallengeSummary } from '@/lib/challenge-model';
import { tokens } from '@/theme/tokens';

type Detail = { challenge: ChallengeSummary; participants: ChallengeParticipant[] };

const addDays = (date: string, amount: number) => {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
};

const shortDay = (date: string) => new Intl.DateTimeFormat('vi-VN', { weekday: 'short' }).format(new Date(`${date}T12:00:00`)).replace('.', '').replace('Th ', 'T');

const initials = (name: string) => name.trim().split(/\s+/).slice(-2).map((part) => part.charAt(0)).join('').toUpperCase() || '?';

export default function ChallengeDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const userId = session?.user.id;
  const resource = useResource('challenge', () => loadChallengeDetail(params.id), [params.id]);
  const { data: detail, state, load } = resource;
  const [checkingIn, setCheckingIn] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [rotatingCode, setRotatingCode] = useState(false);

  const mine = useMemo(() => detail?.participants.find((item) => item.user_id === userId) ?? null, [detail, userId]);
  const checkedToday = Boolean(mine?.checkin_dates.includes(todayKey()));
  const days = useMemo(() => detail ? buildDays(detail.challenge) : [], [detail]);

  const completeManual = async () => {
    if (!detail) return;
    setCheckingIn(true);
    try {
      const success = await manualChallengeCheckin(detail.challenge.id);
      if (!success) Alert.alert('Chưa thể điểm danh', 'Thử thách này cần một hoạt động cụ thể để được ghi nhận.');
      await load();
    } catch (cause) {
      Alert.alert('Chưa thể điểm danh', cause instanceof Error ? cause.message : 'Hãy thử lại sau.');
    } finally { setCheckingIn(false); }
  };

  const openRequiredAction = () => {
    const key = detail?.challenge.target.goal_key;
    if (key === 'water' || key === 'sleep') router.push('/tracking');
    else if (key === 'workout') router.push('/workout');
    else if (key === 'meal') router.push('/meals');
    else void completeManual();
  };

  const confirmCancel = () => {
    if (!detail || cancelling) return;
    Alert.alert('Hủy thử thách?', 'Mọi người sẽ không thể điểm danh thêm. Lịch sử đã ghi nhận vẫn được giữ.', [
      { text: 'Giữ lại', style: 'cancel' },
      { text: 'Hủy thử thách', style: 'destructive', onPress: () => {
        setCancelling(true);
        void cancelChallenge(detail.challenge.id).then(async (cancelled) => {
          if (cancelled) await load();
          else Alert.alert('Chưa thể hủy', 'Thử thách đã kết thúc hoặc đã được hủy.');
        }).catch((error) => Alert.alert('Chưa thể hủy', error instanceof Error ? error.message : 'Hãy thử lại sau.'))
          .finally(() => setCancelling(false));
      } },
    ]);
  };

  const confirmLeave = () => {
    if (!detail || leaving) return;
    Alert.alert('Rời thử thách?', 'Tiến độ cá nhân trong nhóm này sẽ bị xóa.', [
      { text: 'Ở lại', style: 'cancel' },
      { text: 'Rời nhóm', style: 'destructive', onPress: () => {
        setLeaving(true);
        void leaveChallenge(detail.challenge.id).then((left) => {
          if (left) router.replace('/challenges');
          else Alert.alert('Chưa thể rời', 'Bạn không còn là thành viên nhóm.');
        }).catch((error) => Alert.alert('Chưa thể rời', error instanceof Error ? error.message : 'Hãy thử lại sau.'))
          .finally(() => setLeaving(false));
      } },
    ]);
  };

  const confirmRotateCode = () => {
    if (!detail || rotatingCode) return;
    Alert.alert('Đổi mã mời?', 'Mã cũ sẽ ngừng hoạt động. Hãy gửi mã mới cho người muốn tham gia.', [
      { text: 'Giữ mã cũ', style: 'cancel' },
      { text: 'Đổi mã', onPress: () => {
        setRotatingCode(true);
        void rotateChallengeInviteCode(detail.challenge.id).then(async (code) => {
          await load();
          Alert.alert('Đã đổi mã mời', `Mã mới: ${code}`);
        })
          .catch((error) => Alert.alert('Chưa thể đổi mã', error instanceof Error ? error.message : 'Hãy thử lại sau.'))
          .finally(() => setRotatingCode(false));
      } },
    ]);
  };

  return <Screen refreshing={state === 'loading' && Boolean(detail)} onRefresh={() => void load()} contentStyle={styles.content}>
    <Pressable onPress={() => router.back()} style={styles.back}><AppIcon name="arrow-left" size={18} color={tokens.colors.lime} /><Text style={styles.backText}>Thử thách</Text></Pressable>
    {state === 'loading' && !detail ? <View style={styles.center}><ActivityIndicator size="large" color={tokens.colors.lime} /></View> : null}
    {state === 'error' || !detail ? <FoundationCard title="Không tìm thấy thử thách" description="Thử thách có thể không còn khả dụng hoặc kết nối đang gặp sự cố."><Pressable onPress={() => void load()}><Text style={styles.retry}>Thử lại</Text></Pressable></FoundationCard> : null}
    {detail ? <ChallengeBody detail={detail} mine={mine} checkedToday={checkedToday} days={days} checkingIn={checkingIn} cancelling={cancelling} leaving={leaving} rotatingCode={rotatingCode} onAction={openRequiredAction} onCancel={confirmCancel} onLeave={confirmLeave} onRotateCode={confirmRotateCode} /> : null}
  </Screen>;
}

function ChallengeBody({ detail, mine, checkedToday, days, checkingIn, cancelling, leaving, rotatingCode, onAction, onCancel, onLeave, onRotateCode }: { detail: Detail; mine: ChallengeParticipant | null; checkedToday: boolean; days: string[]; checkingIn: boolean; cancelling: boolean; leaving: boolean; rotatingCode: boolean; onAction: () => void; onCancel: () => void; onLeave: () => void; onRotateCode: () => void }) {
  const { challenge, participants } = detail;
  const duration = challengeDuration(challenge);
  const currentDay = elapsedChallengeDays(challenge);
  const completion = duration ? Math.min(100, Math.round((challenge.user_checkin_count / duration) * 100)) : null;
  const goal = goalLabel(challenge.target);
  const isCrew = challenge.mode === 'crew';
  const isActive = challenge.status === 'active' && todayKey() >= challenge.start_date && (!challenge.end_date || todayKey() <= challenge.end_date);
  const statusMessage = !isActive ? 'Xem lại những ngày đã được ghi nhận.' : checkedToday ? 'Đã được Fitly ghi nhận hôm nay' : challenge.target.goal_key === 'any' || !challenge.target.goal_key ? 'Chọn điểm danh hôm nay hoặc hoàn thành một hoạt động lành mạnh.' : `Hoàn thành ${goal.toLowerCase()} để điểm danh`;

  return <>
    <View style={styles.hero}>
      <View style={styles.heroOrb} /><View style={styles.heroTop}><View style={styles.heroPill}><View style={styles.heroDot} /><Text style={styles.heroPillText}>{challenge.status === 'cancelled' ? 'ĐÃ HỦY' : challenge.status === 'active' ? 'ĐANG DIỄN RA' : 'ĐÃ KẾT THÚC'}</Text></View><Text style={styles.heroMode}>{isCrew ? 'NHÓM' : 'CÁ NHÂN'}</Text></View>
      <Text style={styles.heroTitle}>{challenge.title}</Text><Text style={styles.heroDescription}>{challenge.description || `Mục tiêu: ${goal}`}</Text>
      <View style={styles.heroStats}><View><Text style={styles.heroStatLabel}>{duration ? `NGÀY ${currentDay}/${duration}` : isActive ? `NGÀY ${currentDay}` : `${challenge.user_checkin_count} NGÀY GHI NHẬN`}</Text><Text style={styles.heroStatValue}>{goal}</Text></View><View style={styles.percentRing}><Text style={styles.percent}>{completion === null ? '—' : `${completion}%`}</Text></View></View>
      {completion !== null ? <View style={styles.heroProgress}><View style={[styles.heroProgressFill, { width: `${completion}%` }]} /></View> : null}<Text style={styles.heroProgressCaption}>{challenge.user_checkin_count}{duration ? `/${duration}` : ''} ngày đã ghi nhận</Text>
    </View>

    <View style={styles.todayCard}><View style={[styles.todayIcon, checkedToday && styles.todayIconDone]}><AppIcon name={checkedToday ? 'check' : 'target'} size={23} color={checkedToday ? '#0E1710' : tokens.colors.lime} /></View><View style={styles.todayCopy}><Text style={styles.todayKicker}>{isActive ? 'HÔM NAY' : 'KẾT QUẢ'}</Text><Text style={styles.todayTitle}>{challenge.status === 'cancelled' ? 'Thử thách đã hủy.' : !isActive ? 'Thử thách đã kết thúc.' : checkedToday ? 'Bạn đã giữ lời hứa.' : 'Một bước nữa là xong.'}</Text><Text style={styles.todayDetail}>{statusMessage}</Text></View></View>
    {isActive && !checkedToday ? <Pressable onPress={onAction} disabled={checkingIn} style={[styles.action, checkingIn && styles.actionDisabled]}>{checkingIn ? <ActivityIndicator color="#0A0D0A" /> : <><Text style={styles.actionText}>{!challenge.target.goal_key || challenge.target.goal_key === 'any' ? 'Điểm danh hôm nay' : `Đi tới ${goal.toLowerCase()}`}</Text><AppIcon name="arrow-right" size={20} color="#0A0D0A" /></>}</Pressable> : null}
    {isActive && mine?.role === 'owner' ? <Pressable accessibilityRole="button" onPress={onCancel} disabled={cancelling} style={{ alignSelf: 'flex-start', paddingVertical: 10 }}><Text style={{ color: '#F1A4A4', fontWeight: '800' }}>{cancelling ? 'Đang hủy...' : 'Hủy thử thách'}</Text></Pressable> : null}
    {isCrew && isActive && mine?.role === 'member' ? <Pressable accessibilityRole="button" onPress={onLeave} disabled={leaving} style={{ alignSelf: 'flex-start', paddingVertical: 10 }}><Text style={{ color: '#F1A4A4', fontWeight: '800' }}>{leaving ? 'Đang rời...' : 'Rời thử thách'}</Text></Pressable> : null}

    <View style={styles.sectionHeader}><View><Text style={styles.sectionKicker}>ĐƯỜNG ĐI</Text><Text style={styles.sectionTitle}>7 ngày gần đây</Text></View><Text style={styles.sectionCount}>{mine?.checkin_dates.length ?? 0} lần giữ nhịp</Text></View>
    <View style={styles.calendar}>{days.map((day) => { const checked = Boolean(mine?.checkin_dates.includes(day)); const isToday = day === todayKey(); return <View key={day} style={styles.day}><Text style={[styles.dayLabel, isToday && styles.dayLabelToday]}>{shortDay(day)}</Text><View style={[styles.dayMark, checked && styles.dayMarkChecked, isToday && !checked && styles.dayMarkToday]}>{checked ? <Text style={styles.check}>✓</Text> : <Text style={styles.dateNumber}>{day.slice(-2)}</Text>}</View></View>; })}</View>

    {isCrew ? <CrewSection challenge={challenge} participants={participants} canRotate={isActive && mine?.role === 'owner'} rotatingCode={rotatingCode} onRotateCode={onRotateCode} /> : <SoloSection goal={goal} isFlexible={challenge.target.goal_key === 'any' || !challenge.target.goal_key} />}
    <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/(app)/support", params: { category: "challenge_report", context: `${detail.challenge.title}\n${detail.challenge.description || ""}`, target_type: "challenge", target_id: detail.challenge.id } })}><Text style={styles.backText}>Báo cáo nội dung thử thách</Text></Pressable><View style={styles.privacy}><AppIcon name="check" size={18} color="#B9FF3A" /><Text style={styles.privacyText}>Fitly chỉ hiển thị trạng thái đã hoàn thành theo ngày, không chia sẻ dữ liệu sức khỏe chi tiết.</Text></View>
  </>;
}

function CrewSection({ challenge, participants, canRotate, rotatingCode, onRotateCode }: { challenge: ChallengeSummary; participants: ChallengeParticipant[]; canRotate: boolean; rotatingCode: boolean; onRotateCode: () => void }) {
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);
  const today = todayKey();
  const shareCode = () => {
    if (!challenge.invite_code) return;
    void Share.share({ message: `Tham gia thử thách Fitly “${challenge.title}” bằng mã ${challenge.invite_code}.` })
      .catch(() => Alert.alert('Chưa thể chia sẻ', 'Hãy thử lại sau.'));
  };
  const block = (person: ChallengeParticipant) => Alert.alert('Chặn thành viên?',
    'Bạn sẽ rời các nhóm chung không do bạn tạo; thành viên này sẽ bị đưa khỏi nhóm do bạn tạo. Điểm danh trong nhóm đã rời cũng được xóa. Hai bên không thể tham gia lại cùng nhóm cho đến khi bỏ chặn.', [
      { text: 'Hủy', style: 'cancel' },
      { text: 'Chặn', style: 'destructive', onPress: () => {
        setBusy(true);
        void blockChallengeMember(person.user_id).then(() => router.replace('/challenges'))
          .catch((error) => Alert.alert('Chưa chặn được', error instanceof Error ? error.message : 'Vui lòng thử lại.'))
          .finally(() => setBusy(false));
      } },
    ]);
  return <View style={styles.crew}>
    <View style={styles.sectionHeader}><View><Text style={styles.sectionKicker}>CÙNG GIỮ NHỊP</Text><Text style={styles.sectionTitle}>{participants.length} thành viên</Text></View>{challenge.invite_code && <View style={styles.code}><Text style={styles.codeCaption}>MÃ MỜI</Text><Text style={styles.codeValue}>{challenge.invite_code}</Text></View>}</View>
    {challenge.status === 'active' && challenge.invite_code ? <View style={{ flexDirection: 'row', gap: 18 }}><Pressable accessibilityRole="button" onPress={shareCode}><Text style={styles.backText}>Chia sẻ mã</Text></Pressable>{canRotate ? <Pressable accessibilityRole="button" onPress={onRotateCode} disabled={rotatingCode}><Text style={styles.backText}>{rotatingCode ? 'Đang đổi...' : 'Đổi mã mời'}</Text></Pressable> : null}</View> : null}
    <View style={styles.memberList}>{participants.map((person, index) => <View key={person.user_id} style={styles.member}>
      <View style={[styles.memberAvatar, { backgroundColor: ['#51366A', '#28495B', '#45401E', '#533236', '#234534'][index % 5] }]}><Text style={styles.memberInitial}>{initials(person.display_name)}</Text></View>
      <View style={styles.memberCopy}><Text style={styles.memberName}>{person.display_name}</Text><Text style={styles.memberMeta}>{person.checkin_dates.length} ngày ghi nhận{challenge.status === 'active' ? ` · ${person.checkin_dates.includes(today) ? 'Đã xong hôm nay' : 'Chờ'}` : ''}</Text>
        {person.user_id !== session?.user.id && <View style={{ flexDirection: 'row', gap: 16 }}>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => block(person)} style={{ paddingVertical: 12 }}><Text style={styles.backText}>Chặn</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/(app)/support', params: { category: 'challenge_report', target_type: 'user', target_id: person.user_id, context: `Thành viên: ${person.display_name}\nNhóm: ${challenge.title}` } })} style={{ paddingVertical: 12 }}><Text style={styles.backText}>Báo cáo</Text></Pressable>
        </View>}
      </View>
    </View>)}</View>
  </View>;
}

function SoloSection({ goal, isFlexible }: { goal: string; isFlexible: boolean }) { return <View style={styles.solo}><AppIcon name="zap" size={24} color="#D4A7FF" /><View style={styles.soloCopy}><Text style={styles.soloTitle}>Hành động nào được tính?</Text><Text style={styles.soloText}>{isFlexible ? 'Bạn có thể điểm danh trực tiếp hoặc để Fitly ghi nhận khi hoàn thành một hoạt động lành mạnh.' : `Fitly tự điểm danh khi bạn hoàn thành: ${goal.toLowerCase()}.`}</Text></View></View>; }

function buildDays(challenge: ChallengeSummary) {
  const today = todayKey();
  const cancelledDate = challenge.target.cancelled_date;
  const lastDate = challenge.status === 'cancelled' && typeof cancelledDate === 'string' ? cancelledDate : challenge.end_date && challenge.end_date < today ? challenge.end_date : today;
  return Array.from({ length: 7 }, (_, index) => addDays(lastDate, index - 6)).filter((date) => date >= challenge.start_date && (!challenge.end_date || date <= challenge.end_date));
}

const styles = StyleSheet.create({
  content: { paddingBottom: tokens.spacing.hero, gap: 17 }, back: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6 }, backText: { color: tokens.colors.lime, fontSize: 14, fontWeight: '800' }, center: { minHeight: 360, alignItems: 'center', justifyContent: 'center' }, retry: { color: tokens.colors.lime, marginTop: 8, fontWeight: '900' },
  hero: { overflow: 'hidden', padding: 20, borderRadius: 28, gap: 11, backgroundColor: '#251731' }, heroOrb: { position: 'absolute', right: -65, top: -84, width: 212, height: 212, borderRadius: 106, backgroundColor: '#6B3B8A', opacity: .55 }, heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, heroPill: { flexDirection: 'row', alignItems: 'center', gap: 6 }, heroDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: tokens.colors.lime }, heroPillText: { color: '#DFCCE9', fontSize: 10, letterSpacing: .9, fontWeight: '900' }, heroMode: { color: '#D4B4EB', fontSize: 10, letterSpacing: .9, fontWeight: '900' }, heroTitle: { color: tokens.colors.white, fontSize: 30, lineHeight: 35, fontWeight: '900', letterSpacing: -.6, maxWidth: '86%' }, heroDescription: { color: '#D0BFD9', fontSize: 13, lineHeight: 19, maxWidth: '88%' }, heroStats: { marginTop: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, heroStatLabel: { color: '#BFA8CC', fontSize: 11, letterSpacing: .8, fontWeight: '900' }, heroStatValue: { marginTop: 4, color: tokens.colors.white, fontSize: 18, fontWeight: '900' }, percentRing: { width: 58, height: 58, borderRadius: 30, borderWidth: 5, borderColor: tokens.colors.lime, backgroundColor: '#30203D', alignItems: 'center', justifyContent: 'center' }, percent: { color: tokens.colors.white, fontSize: 13, fontWeight: '900' }, heroProgress: { height: 8, marginTop: 3, overflow: 'hidden', borderRadius: 4, backgroundColor: 'rgba(255,255,255,.16)' }, heroProgressFill: { height: '100%', borderRadius: 4, backgroundColor: tokens.colors.lime }, heroProgressCaption: { color: '#BDA9C7', fontSize: 11, fontWeight: '800' },
  todayCard: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 16, borderRadius: 22, backgroundColor: '#121512' }, todayIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#243223' }, todayIconDone: { backgroundColor: tokens.colors.lime }, todayCopy: { flex: 1, gap: 2 }, todayKicker: { color: '#9FA89F', fontSize: 10, letterSpacing: .9, fontWeight: '900' }, todayTitle: { color: tokens.colors.ink, fontSize: 16, fontWeight: '900' }, todayDetail: { color: tokens.colors.muted, fontSize: 12, lineHeight: 17 }, action: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 17, backgroundColor: tokens.colors.lime }, actionDisabled: { opacity: .55 }, actionText: { color: '#0A0D0A', fontSize: 15, fontWeight: '900' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10 }, sectionKicker: { color: '#D4A7FF', fontSize: 10, letterSpacing: .9, fontWeight: '900' }, sectionTitle: { color: tokens.colors.ink, marginTop: 3, fontSize: 20, fontWeight: '900' }, sectionCount: { color: tokens.colors.muted, fontSize: 11, fontWeight: '800', paddingBottom: 2 }, calendar: { flexDirection: 'row', justifyContent: 'space-between', padding: 15, borderRadius: 23, backgroundColor: '#151615' }, day: { alignItems: 'center', gap: 8 }, dayLabel: { color: '#8C948D', fontSize: 10, fontWeight: '900' }, dayLabelToday: { color: tokens.colors.lime }, dayMark: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#292B29' }, dayMarkChecked: { backgroundColor: tokens.colors.lime }, dayMarkToday: { borderWidth: 1, borderColor: tokens.colors.lime }, check: { color: '#0C110C', fontSize: 18, fontWeight: '900' }, dateNumber: { color: '#A3AAA4', fontSize: 12, fontWeight: '900' },
  crew: { padding: 17, borderRadius: 24, gap: 15, backgroundColor: '#171319' }, code: { paddingVertical: 5, paddingHorizontal: 9, borderRadius: 11, backgroundColor: '#2C2232' }, codeCaption: { color: '#B3A3BD', fontSize: 8, letterSpacing: .7, fontWeight: '900' }, codeValue: { color: '#E7D5F4', marginTop: 1, fontSize: 12, letterSpacing: 1, fontWeight: '900' }, memberList: { gap: 10 }, member: { flexDirection: 'row', alignItems: 'center', gap: 10 }, memberAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, memberInitial: { color: tokens.colors.white, fontSize: 11, fontWeight: '900' }, memberCopy: { flex: 1 }, memberName: { color: tokens.colors.ink, fontSize: 13, fontWeight: '900' }, memberMeta: { color: tokens.colors.muted, fontSize: 11, marginTop: 2 }, memberStatus: { paddingVertical: 5, paddingHorizontal: 9, borderRadius: 12, backgroundColor: '#2D2E2D' }, memberStatusDone: { backgroundColor: '#274229' }, memberStatusText: { color: '#B2BAB2', fontSize: 10, fontWeight: '900' }, memberStatusTextDone: { color: '#C8EBCB' },
  solo: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 17, borderRadius: 23, backgroundColor: '#18131D' }, soloCopy: { flex: 1, gap: 4 }, soloTitle: { color: '#E2CFF1', fontSize: 15, fontWeight: '900' }, soloText: { color: '#B2A7B9', fontSize: 12, lineHeight: 18 }, privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 14, borderRadius: 17, backgroundColor: '#111211' }, privacyText: { flex: 1, color: tokens.colors.muted, fontSize: 11, lineHeight: 17 },
});
