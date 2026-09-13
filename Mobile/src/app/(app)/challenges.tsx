import { useResource } from '@/hooks/use-resource';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { AppIcon } from '@/components/ui/app-icon';
import { FoundationCard } from '@/components/ui/foundation-card';
import { Screen } from '@/components/ui/screen';
import { challengeDuration, createChallenge, elapsedChallengeDays, goalLabel, joinChallengeByInviteCode, loadChallenges, type ChallengeGoal, type ChallengeMode, type ChallengeSummary } from '@/lib/challenge-model';
import { tokens } from '@/theme/tokens';

type Tab = 'active' | 'completed';

const goals: { id: ChallengeGoal; label: string; hint: string; icon: 'workout' | 'meals' | 'flame' | 'target' }[] = [
  { id: 'any', label: 'Linh hoạt', hint: 'Một hoạt động tốt mỗi ngày', icon: 'target' },
  { id: 'workout', label: 'Tập luyện', hint: 'Hoàn thành buổi tập', icon: 'workout' },
  { id: 'water', label: 'Uống nước', hint: 'Ghi lượng nước mỗi ngày', icon: 'flame' },
  { id: 'sleep', label: 'Giấc ngủ', hint: 'Ghi giờ ngủ mỗi ngày', icon: 'target' },
  { id: 'meal', label: 'Dinh dưỡng', hint: 'Hoàn thành bữa ăn', icon: 'meals' },
];

export default function ChallengesScreen() {
  const resource = useResource('challenges', loadChallenges);
  const items = useMemo(() => resource.data ?? [], [resource.data]);
  const { state, load, refresh, refreshing } = resource;
  const [tab, setTab] = useState<Tab>('active');
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState<ChallengeGoal>('any');
  const [mode, setMode] = useState<ChallengeMode>('solo');
  const [duration, setDuration] = useState(7);

  const active = useMemo(() => items.filter((item) => item.status === 'active'), [items]);
  const completed = useMemo(() => items.filter((item) => item.status !== 'active'), [items]);
  const primary = active[0] ?? null;
  const visible = tab === 'active' ? active : completed;

  const submit = async () => {
    setCreating(true);
    try {
      const id = await createChallenge({ title, mode, durationDays: duration, goal, maxMembers: mode === 'crew' ? 5 : 1 });
      setShowCreate(false);
      setTitle('');
      await load();
      router.push({ pathname: '/challenges/[id]', params: { id } });
    } catch (cause) {
      Alert.alert('Chưa thể tạo thử thách', cause instanceof Error ? cause.message : 'Hãy thử lại sau.');
    } finally {
      setCreating(false);
    }
  };

  const submitJoin = async () => {
    setJoining(true);
    try {
      const id = await joinChallengeByInviteCode(inviteCode);
      setShowJoin(false);
      setInviteCode('');
      await load();
      router.push({ pathname: '/challenges/[id]', params: { id } });
    } catch (cause) {
      Alert.alert('Chưa thể tham gia', cause instanceof Error ? cause.message : 'Hãy kiểm tra lại mã mời.');
    } finally {
      setJoining(false);
    }
  };

  return <Screen refreshing={refreshing} onRefresh={refresh} contentStyle={styles.content}>
    <View style={styles.topRow}>
      <Pressable onPress={() => router.back()} style={styles.back}><AppIcon name="arrow-left" size={18} color={tokens.colors.lime} /><Text style={styles.backText}>Hôm nay</Text></Pressable>
      <Pressable onPress={() => setShowCreate(true)} style={styles.addButton} accessibilityRole="button"><Text style={styles.addText}>＋</Text></Pressable>
    </View>

    <View style={styles.heading}><Text style={styles.kicker}>HÀNH TRÌNH CỦA BẠN</Text><Text style={styles.title}>Thử thách{`\n`}nhỏ, thay đổi lớn.</Text><Text style={styles.subtitle}>Tạo một cam kết vừa sức, rồi để Fitly tự ghi nhận từng ngày bạn làm được.</Text></View>

    {state === 'loading' && items.length === 0 ? <View style={styles.center}><ActivityIndicator color={tokens.colors.lime} size="large" /></View> : null}
    {state === 'error' ? <FoundationCard title="Chưa tải được thử thách" description="Kiểm tra lại kết nối rồi thử lại."><Pressable onPress={() => void load()}><Text style={styles.retry}>Thử lại</Text></Pressable></FoundationCard> : null}

    {primary ? <PrimaryChallenge item={primary} onOpen={() => router.push({ pathname: '/challenges/[id]', params: { id: primary.id } })} /> : <EmptyChallenge onCreate={() => setShowCreate(true)} />}

    <View style={styles.listHeader}><Text style={styles.listTitle}>Kho thử thách</Text><View style={styles.listActions}><Pressable onPress={() => setShowJoin(true)}><Text style={styles.joinLink}>Nhập mã</Text></Pressable><Pressable onPress={() => setShowCreate(true)}><Text style={styles.createLink}>Tạo mới</Text></Pressable></View></View>
    <View style={styles.tabs}>{([['active', `Đang tham gia ${active.length}`], ['completed', `Đã xong ${completed.length}`]] as [Tab, string][]).map(([item, label]) => <Pressable key={item} onPress={() => setTab(item)} style={[styles.tab, tab === item && styles.tabActive]}><Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{label}</Text></Pressable>)}</View>
    {state === 'ready' && visible.length === 0 ? <View style={styles.listEmpty}><Text style={styles.listEmptyTitle}>{tab === 'active' ? 'Bạn chưa có thử thách nào khác' : 'Chưa có hành trình đã hoàn thành'}</Text><Text style={styles.listEmptyBody}>Bắt đầu với 7 ngày là một nhịp vừa đẹp.</Text></View> : null}
    {visible.filter((item) => item.id !== primary?.id || tab === 'completed').map((item) => <ChallengeRow key={item.id} item={item} onOpen={() => router.push({ pathname: '/challenges/[id]', params: { id: item.id } })} />)}

    <View style={styles.tip}><AppIcon name="zap" size={20} color="#D4A7FF" /><View style={styles.tipCopy}><Text style={styles.tipTitle}>Fitly tự ghi nhận khi có thể</Text><Text style={styles.tipBody}>Tập, bữa ăn, nước hoặc giấc ngủ sẽ tự điểm danh nếu đúng với mục tiêu bạn chọn.</Text></View></View>

    <CreateChallengeModal visible={showCreate} title={title} goal={goal} mode={mode} duration={duration} creating={creating} onClose={() => !creating && setShowCreate(false)} onTitle={setTitle} onGoal={setGoal} onMode={setMode} onDuration={setDuration} onSubmit={() => void submit()} onJoin={() => { setShowCreate(false); setShowJoin(true); }} />
    <JoinChallengeModal visible={showJoin} inviteCode={inviteCode} joining={joining} onCode={setInviteCode} onClose={() => !joining && setShowJoin(false)} onSubmit={() => void submitJoin()} />
  </Screen>;
}

function PrimaryChallenge({ item, onOpen }: { item: ChallengeSummary; onOpen: () => void }) {
  const total = challengeDuration(item);
  const current = elapsedChallengeDays(item);
  const completed = item.user_checkin_count;
  const progress = total ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  return <Pressable onPress={onOpen} style={styles.primary} accessibilityRole="button">
    <View style={styles.primaryGlow} /><View style={styles.primaryTop}><View style={styles.primaryLabel}><View style={styles.liveDot} /><Text style={styles.primaryLabelText}>ĐANG DIỄN RA</Text></View><Text style={styles.primaryDay}>{total ? `NGÀY ${current}/${total}` : `NGÀY ${current}`}</Text></View>
    <Text style={styles.primaryTitle}>{item.title}</Text><Text style={styles.primaryDescription}>{item.description || `Mục tiêu: ${goalLabel(item.target)}`}</Text>
    <View style={styles.primaryBottom}><View style={styles.progressMeta}><Text style={styles.progressTitle}>{item.user_checked_in ? 'Bạn đã xong hôm nay' : `Hôm nay: ${goalLabel(item.target)}`}</Text><View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View><Text style={styles.progressCaption}>{completed}{total ? `/${total}` : ''} ngày được ghi nhận</Text></View><View style={[styles.orbit, item.user_checked_in && styles.orbitDone]}><Text style={styles.orbitValue}>{item.user_checked_in ? '✓' : `${progress}%`}</Text></View></View>
    <View style={styles.primaryFooter}><View style={styles.people}><View style={styles.avatar}><Text style={styles.avatarText}>B</Text></View><Text style={styles.peopleText}>{item.mode === 'crew' ? `${item.participant_count}/${item.max_members} thành viên` : 'Hành trình cá nhân'}</Text></View><AppIcon name="arrow-right" size={21} color={tokens.colors.lime} /></View>
  </Pressable>;
}

function ChallengeRow({ item, onOpen }: { item: ChallengeSummary; onOpen: () => void }) {
  const duration = challengeDuration(item);
  const totalLabel = duration ? `${item.user_checkin_count}/${duration} ngày` : `${item.user_checkin_count} ngày`;
  return <Pressable onPress={onOpen} style={styles.challengeRow} accessibilityRole="button"><View style={styles.rowIcon}><AppIcon name={item.mode === 'crew' ? 'profile' : 'target'} size={21} color="#D4A7FF" /></View><View style={styles.rowCopy}><Text style={styles.rowTitle}>{item.title}</Text><Text style={styles.rowMeta}>{goalLabel(item.target)} · {item.mode === 'crew' ? `${item.participant_count} thành viên` : 'Cá nhân'}</Text><Text style={styles.rowProgress}>{totalLabel}</Text></View><AppIcon name="arrow-right" size={19} color={tokens.colors.muted} /></Pressable>;
}

function EmptyChallenge({ onCreate }: { onCreate: () => void }) {
  return <View style={styles.empty}><View style={styles.emptyOrb}><AppIcon name="target" color={tokens.colors.lime} size={27} /></View><Text style={styles.emptyTitle}>Chọn một điều bạn muốn giữ đều</Text><Text style={styles.emptyBody}>Không cần thật lớn. Một hành động nhỏ mỗi ngày là đủ để bắt đầu.</Text><Pressable onPress={onCreate} style={styles.emptyButton}><Text style={styles.emptyButtonText}>Tạo thử thách</Text><AppIcon name="arrow-right" color="#0A0D0A" size={18} /></Pressable></View>;
}

type CreateProps = { visible: boolean; title: string; goal: ChallengeGoal; mode: ChallengeMode; duration: number; creating: boolean; onClose: () => void; onTitle: (value: string) => void; onGoal: (value: ChallengeGoal) => void; onMode: (value: ChallengeMode) => void; onDuration: (value: number) => void; onSubmit: () => void; onJoin: () => void };
function CreateChallengeModal({ visible, title, goal, mode, duration, creating, onClose, onTitle, onGoal, onMode, onDuration, onSubmit, onJoin }: CreateProps) {
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View style={styles.modalScrim}><Pressable style={StyleSheet.absoluteFill} onPress={onClose} /><View style={styles.sheet}><View style={styles.handle} /><View style={styles.sheetHeader}><View><Text style={styles.sheetKicker}>CAM KẾT MỚI</Text><Text style={styles.sheetTitle}>Tạo thử thách</Text></View><Pressable onPress={onClose} hitSlop={10}><Text style={styles.close}>×</Text></Pressable></View><Text style={styles.fieldLabel}>TÊN HÀNH TRÌNH</Text><TextInput value={title} onChangeText={onTitle} placeholder="Ví dụ: Uống đủ nước 7 ngày" placeholderTextColor="#778078" style={styles.input} maxLength={80} />
    <Text style={styles.fieldLabel}>MỤC TIÊU</Text><View style={styles.goalGrid}>{goals.map((item) => <Pressable key={item.id} onPress={() => onGoal(item.id)} style={[styles.goal, goal === item.id && styles.goalActive]}><AppIcon name={item.icon} size={18} color={goal === item.id ? '#0A0D0A' : '#C7CFC7'} /><Text style={[styles.goalText, goal === item.id && styles.goalTextActive]}>{item.label}</Text></Pressable>)}</View>
    <View style={styles.controlRow}><View style={styles.controlCopy}><Text style={styles.fieldLabel}>THỜI LƯỢNG</Text><Text style={styles.controlHint}>Số ngày duy trì</Text></View><View style={styles.stepper}><Pressable onPress={() => onDuration(Math.max(3, duration - 1))} style={styles.stepButton}><Text style={styles.stepText}>−</Text></Pressable><Text style={styles.duration}>{duration}</Text><Pressable onPress={() => onDuration(Math.min(30, duration + 1))} style={styles.stepButton}><Text style={styles.stepText}>＋</Text></Pressable></View></View>
    <Text style={styles.fieldLabel}>CÁCH THAM GIA</Text><View style={styles.modeRow}>{([['solo', 'Một mình'], ['crew', 'Cùng nhóm']] as [ChallengeMode, string][]).map(([item, label]) => <Pressable key={item} onPress={() => onMode(item)} style={[styles.mode, mode === item && styles.modeActive]}><Text style={[styles.modeText, mode === item && styles.modeTextActive]}>{label}</Text></Pressable>)}</View>
    <Pressable onPress={onSubmit} disabled={creating} style={[styles.submit, creating && styles.submitDisabled]}>{creating ? <ActivityIndicator color="#0A0D0A" /> : <><Text style={styles.submitText}>Bắt đầu {duration} ngày</Text><AppIcon name="arrow-right" color="#0A0D0A" size={20} /></>}</Pressable><Pressable onPress={onJoin} disabled={creating} style={styles.joinSheetLink}><Text style={styles.joinSheetText}>Bạn có mã mời? Tham gia cùng nhóm</Text></Pressable>
  </View></View></Modal>;
}

function JoinChallengeModal({ visible, inviteCode, joining, onCode, onClose, onSubmit }: { visible: boolean; inviteCode: string; joining: boolean; onCode: (value: string) => void; onClose: () => void; onSubmit: () => void }) {
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View style={styles.modalScrim}><Pressable style={StyleSheet.absoluteFill} onPress={onClose} /><View style={styles.joinSheet}><View style={styles.handle} /><View style={styles.sheetHeader}><View><Text style={styles.sheetKicker}>THAM GIA CÙNG NHÓM</Text><Text style={styles.sheetTitle}>Nhập mã mời</Text></View><Pressable onPress={onClose} hitSlop={10}><Text style={styles.close}>×</Text></Pressable></View><Text style={styles.joinDescription}>Mã gồm 8 ký tự do người tạo thử thách gửi cho bạn.</Text><TextInput value={inviteCode} onChangeText={(value) => onCode(value.replace(/\s/g, '').toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={8} placeholder="VÍ DỤ: AB12CD34" placeholderTextColor="#778078" style={styles.codeInput} /><Pressable onPress={onSubmit} disabled={joining || inviteCode.length < 6} style={[styles.submit, (joining || inviteCode.length < 6) && styles.submitDisabled]}>{joining ? <ActivityIndicator color="#0A0D0A" /> : <><Text style={styles.submitText}>Tham gia thử thách</Text><AppIcon name="arrow-right" color="#0A0D0A" size={20} /></>}</Pressable></View></View></Modal>;
}

const styles = StyleSheet.create({
  content: { paddingBottom: tokens.spacing.hero, gap: 17 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6 }, backText: { color: tokens.colors.lime, fontWeight: '800', fontSize: 14 },
  addButton: { width: 37, height: 37, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#202320' }, addText: { color: tokens.colors.lime, fontSize: 23, lineHeight: 26, fontWeight: '500' },
  heading: { gap: 7 }, kicker: { color: '#D4A7FF', fontSize: 11, letterSpacing: 1.3, fontWeight: '900' }, title: { color: tokens.colors.ink, fontSize: 35, lineHeight: 40, letterSpacing: -1.1, fontWeight: '900' }, subtitle: { color: tokens.colors.muted, fontSize: 14, lineHeight: 21, maxWidth: 330 },
  center: { minHeight: 310, alignItems: 'center', justifyContent: 'center' }, retry: { color: tokens.colors.lime, marginTop: 8, fontWeight: '900' },
  primary: { overflow: 'hidden', borderRadius: 27, padding: 19, gap: 12, backgroundColor: '#24162F' }, primaryGlow: { position: 'absolute', width: 210, height: 210, borderRadius: 105, right: -75, top: -90, backgroundColor: '#6B3E87', opacity: .6 }, primaryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, primaryLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 }, liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: tokens.colors.lime }, primaryLabelText: { color: '#D9C6E8', fontSize: 11, letterSpacing: .8, fontWeight: '900' }, primaryDay: { color: '#E7D4F7', fontSize: 11, letterSpacing: .8, fontWeight: '900' }, primaryTitle: { color: tokens.colors.white, fontSize: 26, lineHeight: 31, letterSpacing: -.5, fontWeight: '900', maxWidth: '85%' }, primaryDescription: { color: '#C8B8D4', fontSize: 13, lineHeight: 19, maxWidth: '88%' }, primaryBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14, marginTop: 2 }, progressMeta: { flex: 1, gap: 6 }, progressTitle: { color: '#F4EEFA', fontSize: 13, fontWeight: '800' }, progressTrack: { height: 7, overflow: 'hidden', borderRadius: 4, backgroundColor: 'rgba(255,255,255,.14)' }, progressFill: { height: '100%', borderRadius: 4, backgroundColor: tokens.colors.lime }, progressCaption: { color: '#BFAFCB', fontSize: 11, fontWeight: '700' }, orbit: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', borderWidth: 5, borderColor: '#A575CE', backgroundColor: '#2D1B3B' }, orbitDone: { borderColor: tokens.colors.lime }, orbitValue: { color: tokens.colors.white, fontSize: 13, fontWeight: '900' }, primaryFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 5, paddingTop: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,.13)' }, people: { flexDirection: 'row', alignItems: 'center', gap: 8 }, avatar: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#E5CCFF', alignItems: 'center', justifyContent: 'center' }, avatarText: { color: '#321C44', fontSize: 10, fontWeight: '900' }, peopleText: { color: '#D5C6DE', fontSize: 12, fontWeight: '800' },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 3 }, listTitle: { color: tokens.colors.ink, fontSize: 21, fontWeight: '900' }, listActions: { flexDirection: 'row', alignItems: 'center', gap: 13 }, joinLink: { color: '#D4A7FF', fontSize: 13, fontWeight: '900' }, createLink: { color: tokens.colors.lime, fontSize: 13, fontWeight: '900' }, tabs: { flexDirection: 'row', gap: 8 }, tab: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 18, backgroundColor: '#171917' }, tabActive: { backgroundColor: '#2D2138' }, tabText: { color: tokens.colors.muted, fontSize: 12, fontWeight: '800' }, tabTextActive: { color: '#E4CBFD' }, listEmpty: { padding: 17, borderRadius: 18, backgroundColor: '#101110', gap: 5 }, listEmptyTitle: { color: tokens.colors.ink, fontSize: 14, fontWeight: '900' }, listEmptyBody: { color: tokens.colors.muted, fontSize: 12, lineHeight: 18 },
  challengeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 19, backgroundColor: '#141514' }, rowIcon: { width: 43, height: 43, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#282030' }, rowCopy: { flex: 1, minWidth: 0, gap: 2 }, rowTitle: { color: tokens.colors.ink, fontSize: 15, fontWeight: '900' }, rowMeta: { color: tokens.colors.muted, fontSize: 12 }, rowProgress: { color: '#C5A5E7', fontSize: 11, fontWeight: '800', marginTop: 2 }, tip: { flexDirection: 'row', gap: 11, padding: 15, borderRadius: 19, backgroundColor: '#17131B' }, tipCopy: { flex: 1, gap: 3 }, tipTitle: { color: '#E5D3F4', fontSize: 13, fontWeight: '900' }, tipBody: { color: '#AFA5B5', fontSize: 12, lineHeight: 18 },
  empty: { alignItems: 'center', padding: 23, borderRadius: 27, backgroundColor: '#18141D', gap: 9 }, emptyOrb: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2A2032', marginBottom: 2 }, emptyTitle: { color: tokens.colors.ink, fontSize: 19, lineHeight: 24, textAlign: 'center', fontWeight: '900' }, emptyBody: { color: tokens.colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' }, emptyButton: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, paddingVertical: 13, paddingHorizontal: 18, borderRadius: tokens.radius.pill, backgroundColor: tokens.colors.lime }, emptyButtonText: { color: '#0A0D0A', fontSize: 14, fontWeight: '900' },
  modalScrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,.72)' }, sheet: { maxHeight: '93%', padding: 20, paddingBottom: 28, gap: 13, borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: '#151615' }, joinSheet: { padding: 20, paddingBottom: 28, gap: 14, borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: '#151615' }, handle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 4, backgroundColor: '#596059', marginBottom: 1 }, sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 3 }, sheetKicker: { color: '#D4A7FF', fontSize: 10, fontWeight: '900', letterSpacing: 1 }, sheetTitle: { color: tokens.colors.ink, fontSize: 26, fontWeight: '900', marginTop: 2 }, close: { color: tokens.colors.muted, fontSize: 28, lineHeight: 28 }, joinDescription: { color: tokens.colors.muted, fontSize: 13, lineHeight: 19 }, codeInput: { color: tokens.colors.ink, paddingHorizontal: 14, paddingVertical: 14, borderRadius: 14, backgroundColor: '#222421', fontSize: 17, letterSpacing: 2, fontWeight: '900' }, fieldLabel: { color: '#9EA69F', fontSize: 10, letterSpacing: .9, fontWeight: '900' }, input: { color: tokens.colors.ink, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, backgroundColor: '#222421', fontSize: 14, fontWeight: '700' }, goalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, goal: { width: '31.7%', minHeight: 62, padding: 9, justifyContent: 'space-between', borderRadius: 13, backgroundColor: '#222421' }, goalActive: { backgroundColor: tokens.colors.lime }, goalText: { color: '#C5CAC5', fontSize: 11, fontWeight: '900' }, goalTextActive: { color: '#101210' }, controlRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 }, controlCopy: { gap: 4 }, controlHint: { color: tokens.colors.muted, fontSize: 12 }, stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 }, stepButton: { width: 33, height: 33, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#282B28' }, stepText: { color: tokens.colors.lime, fontSize: 19, lineHeight: 21, fontWeight: '500' }, duration: { color: tokens.colors.ink, minWidth: 22, textAlign: 'center', fontSize: 18, fontWeight: '900' }, modeRow: { flexDirection: 'row', gap: 8 }, mode: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 13, backgroundColor: '#222421' }, modeActive: { backgroundColor: '#3B284B' }, modeText: { color: tokens.colors.muted, fontSize: 13, fontWeight: '900' }, modeTextActive: { color: '#E3CCFA' }, submit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4, paddingVertical: 15, borderRadius: 16, backgroundColor: tokens.colors.lime }, submitDisabled: { opacity: .55 }, submitText: { color: '#0A0D0A', fontSize: 15, fontWeight: '900' }, joinSheetLink: { alignItems: 'center', paddingVertical: 3 }, joinSheetText: { color: '#D4A7FF', fontSize: 12, fontWeight: '900' },
});
