import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';

import { AppIcon } from '@/components/ui/app-icon';
import { Screen } from '@/components/ui/screen';
import { defaultReminderSettings, hasNativeNotifications, loadReminderSettings, rescheduleLocalReminders, saveReminderSettings, type ReminderSettings } from '@/lib/mobile-notifications';
import { tokens } from '@/theme/tokens';

type ReminderKey = 'waterEnabled' | 'sleepEnabled' | 'workoutEnabled' | 'mealEnabled';

const timeOptions = ['07:00', '08:00', '09:00', '11:30', '12:00', '18:00', '19:00', '20:00', '21:00'];

const timeLabel = (value: string) => value.replace(':', ' giờ ');

export default function RemindersScreen() {
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    try { setSettings(await loadReminderSettings()); }
    catch { setSettings(defaultReminderSettings); Alert.alert('Chưa đọc được lịch nhắc', 'Hãy kiểm tra và lưu lại lựa chọn của bạn.'); }
  }, []);
  useEffect(() => {
    const task = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(task);
  }, [load]);

  const persist = async (next: ReminderSettings) => {
    setSettings(next);
    setIsSaving(true);
    try {
      await saveReminderSettings(next);
      const allowed = await rescheduleLocalReminders(next);
      if (!allowed) Alert.alert('Chưa bật thông báo', hasNativeNotifications() ? 'Bạn có thể cấp quyền thông báo cho Fitly trong Cài đặt hệ thống bất cứ lúc nào.' : 'Thiết bị hoặc phiên bản này chưa hỗ trợ thông báo. Lựa chọn của bạn đã được lưu.');
    } catch (error) {
      Alert.alert('Chưa cập nhật được nhắc nhở', error instanceof Error ? error.message : 'Hãy thử lại sau.');
      await load();
    } finally { setIsSaving(false); }
  };

  const toggle = (key: ReminderKey) => {
    if (!settings || isSaving) return;
    void persist({ ...settings, [key]: !settings[key] });
  };

  const selectTime = (key: 'sleepTime' | 'workoutTime' | 'mealTime', current: string) => {
    if (!settings || isSaving) return;
    const index = Math.max(0, timeOptions.indexOf(current));
    const nextTime = timeOptions[(index + 1) % timeOptions.length];
    void persist({ ...settings, [key]: nextTime });
  };

  if (!settings) return <Screen scroll={false} contentStyle={styles.loading}><ActivityIndicator color={tokens.colors.lime} size="large" /></Screen>;

  return <Screen contentStyle={styles.content}>
    <View style={styles.topRow}><Pressable onPress={() => router.back()} hitSlop={8} style={styles.back}><AppIcon name="arrow-left" color={tokens.colors.lime} size={17} /><Text style={styles.backText}>Quay lại</Text></Pressable>{isSaving ? <ActivityIndicator color={tokens.colors.lime} size="small" /> : null}</View>
    <View><Text style={styles.kicker}>THÔNG BÁO HỆ THỐNG</Text><Text style={styles.title}>Nhắc đúng lúc</Text><Text style={styles.subtitle}>Fitly chỉ nhắc những điều giúp bạn duy trì nhịp sống, không làm phiền quá mức.</Text></View>
    <View style={styles.permissionNote}><View style={styles.permissionIcon}><AppIcon name="bell" color={tokens.colors.canvas} size={18} /></View><Text style={styles.permissionText}>Khi bật một mục, Fitly sẽ hỏi quyền thông báo nếu bạn chưa cấp.</Text></View>
    <View style={styles.section}><Text style={styles.sectionLabel}>LỊCH NHẮC</Text><ReminderRow title="Uống nước" detail={`${settings.waterTimes.length} lần mỗi ngày · ${settings.waterTimes.join(' · ')}`} enabled={settings.waterEnabled} tone="#69CEED" onToggle={() => toggle('waterEnabled')} /><ReminderRow title="Ghi giấc ngủ" detail={`Mỗi ngày lúc ${timeLabel(settings.sleepTime)}`} enabled={settings.sleepEnabled} tone="#D2AEFC" onToggle={() => toggle('sleepEnabled')} onTime={() => selectTime('sleepTime', settings.sleepTime)} /><ReminderRow title="Buổi tập" detail={`Nhắc lúc ${timeLabel(settings.workoutTime)}`} enabled={settings.workoutEnabled} tone={tokens.colors.lime} onToggle={() => toggle('workoutEnabled')} onTime={() => selectTime('workoutTime', settings.workoutTime)} /><ReminderRow title="Ghi bữa ăn" detail={`Nhắc lúc ${timeLabel(settings.mealTime)}`} enabled={settings.mealEnabled} tone="#FFCA6D" onToggle={() => toggle('mealEnabled')} onTime={() => selectTime('mealTime', settings.mealTime)} /></View>
    <View style={styles.quietCard}><Text style={styles.quietKicker}>GIỜ YÊN TĨNH</Text><Text style={styles.quietTitle}>{timeLabel(settings.quietStart)} — {timeLabel(settings.quietEnd)}</Text><Text style={styles.quietText}>Các lịch nhắc rơi vào khoảng này sẽ không được tạo trên thiết bị.</Text></View>
    <Text style={styles.timeHint}>Chạm vào giờ nhắc để chọn giờ kế tiếp. Trình chọn giờ đầy đủ sẽ được bổ sung cùng đợt kiểm thử native.</Text>
  </Screen>;
}

function ReminderRow({ title, detail, enabled, tone, onToggle, onTime }: { title: string; detail: string; enabled: boolean; tone: string; onToggle: () => void; onTime?: () => void }) {
  return <View style={styles.reminderRow}><View style={[styles.reminderDot, { backgroundColor: tone }]} /><View style={styles.reminderCopy}><Text style={styles.reminderTitle}>{title}</Text><Pressable disabled={!onTime} onPress={onTime}><Text style={[styles.reminderDetail, onTime && styles.reminderDetailAction]}>{detail}</Text></Pressable></View><Switch value={enabled} onValueChange={onToggle} trackColor={{ false: '#323934', true: '#527E2D' }} thumbColor={enabled ? tokens.colors.lime : '#9DA79F'} /></View>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: tokens.spacing.lg, paddingTop: tokens.spacing.md, paddingBottom: 36, gap: 15 },
  loading: { alignItems: 'center', justifyContent: 'center' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 6 },
  backText: { color: tokens.colors.lime, fontSize: 13, fontWeight: '900' },
  kicker: { color: tokens.colors.lime, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  title: { marginTop: 3, color: tokens.colors.ink, fontSize: 28, fontWeight: '900' },
  subtitle: { marginTop: 5, color: tokens.colors.muted, fontSize: 12, lineHeight: 18 },
  permissionNote: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderRadius: 18, backgroundColor: '#18251B' },
  permissionIcon: { alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 12, backgroundColor: tokens.colors.lime },
  permissionText: { flex: 1, color: '#C6D3C8', fontSize: 11, lineHeight: 16, fontWeight: '700' },
  section: { gap: 1, padding: 5, borderRadius: 22, backgroundColor: '#121713' },
  sectionLabel: { marginHorizontal: 9, marginTop: 7, marginBottom: 5, color: '#8A9A90', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  reminderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 69, paddingHorizontal: 10, borderRadius: 17 },
  reminderDot: { width: 8, height: 8, borderRadius: 4 },
  reminderCopy: { flex: 1, gap: 3 },
  reminderTitle: { color: tokens.colors.ink, fontSize: 14, fontWeight: '900' },
  reminderDetail: { color: tokens.colors.muted, fontSize: 10, lineHeight: 14 },
  reminderDetailAction: { color: '#C9D8CC', textDecorationLine: 'underline' },
  quietCard: { gap: 4, padding: 16, borderRadius: 21, backgroundColor: '#201C24' },
  quietKicker: { color: '#CBA9F4', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  quietTitle: { color: tokens.colors.ink, fontSize: 20, fontWeight: '900' },
  quietText: { color: '#C3B5CC', fontSize: 11, lineHeight: 16 },
  timeHint: { color: '#7F8A82', fontSize: 10, lineHeight: 15, textAlign: 'center' },
});
