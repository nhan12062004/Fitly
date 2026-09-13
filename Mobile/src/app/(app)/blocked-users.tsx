import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/ui/screen';
import { useResource } from '@/hooks/use-resource';
import { loadBlockedUsers, unblockChallengeMember } from '@/lib/challenge-model';
import { settingsStyles as styles } from '@/theme/settings-styles';
import { tokens } from '@/theme/tokens';

export default function BlockedUsersScreen() {
  const resource = useResource('blocked-users', loadBlockedUsers);
  const [busy, setBusy] = useState(false);
  const unblock = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try { await unblockChallengeMember(id); }
    catch { Alert.alert('Chưa bỏ chặn được', 'Vui lòng kiểm tra kết nối rồi thử lại.'); }
    finally { setBusy(false); }
  };
  return <Screen onRefresh={() => void resource.refresh()} refreshing={resource.refreshing}>
    <Pressable onPress={() => router.back()} style={styles.linkButton}><Text style={styles.link}>← Quay lại</Text></Pressable>
    <Text style={styles.title}>Thành viên đã chặn</Text>
    <Text style={styles.body}>Bỏ chặn cho phép tham gia cùng nhóm trở lại. Các nhóm đã rời và điểm danh đã xóa không tự khôi phục.</Text>
    {resource.state === 'loading' && <ActivityIndicator color={tokens.colors.lime} />}
    {resource.errorMessage && <Text style={styles.error}>{resource.errorMessage}</Text>}
    {resource.data?.map((person) => <View key={person.user_id} style={styles.card}><Text style={styles.subtitle}>{person.display_name}</Text><Pressable disabled={busy} style={styles.linkButton} onPress={() => void unblock(person.user_id)}><Text style={styles.link}>Bỏ chặn</Text></Pressable></View>)}
    {resource.data?.length === 0 && <Text style={styles.body}>Bạn chưa chặn thành viên nào.</Text>}
  </Screen>;
}
