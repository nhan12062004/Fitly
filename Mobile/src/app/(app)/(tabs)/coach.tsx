import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { requestRecordingPermissionsAsync } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';

import { ApiClientError, apiRequest } from '@/lib/api-client';
import { AppIcon } from '@/components/ui/app-icon';
import { Screen } from '@/components/ui/screen';
import { tokens } from '@/theme/tokens';

type AiQuota = {
  chatMessages?: { used?: number; limit?: number };
  [key: string]: unknown;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  adjustmentId?: string | null;
  actionRequired?: boolean;
  actionType?: string | null;
  actionPayload?: Record<string, unknown> | null;
};

type QuotaResponse = {
  membershipTier: string;
  canChat: boolean;
  trialExpired: boolean;
  aiQuota: AiQuota;
};

type ChatResponse = {
  reply: string;
  intent: string;
  responseMode: string;
  confidence: number;
  actionRequired?: boolean;
  actionType?: string | null;
  actionPayload?: Record<string, unknown> | null;
  adjustmentId: string | null;
  aiQuota: AiQuota;
};

type ApplyResponse = {
  success: true;
  adjustmentId: string;
  alreadyApplied?: boolean;
  aiQuota?: AiQuota;
};

type WorkoutProposalExercise = {
  exercise_id?: string;
  name?: string;
  sets?: number;
  reps?: string;
  rest_seconds?: number;
  target_rpe?: number;
};

type WorkoutProposal = {
  duration_minutes?: number;
  exercises?: WorkoutProposalExercise[];
};

const makeClientId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const createApplyKey = (adjustmentId: string) => `fitly-mobile-apply-${adjustmentId}-${makeClientId()}`;

const asWorkoutProposal = (payload: Record<string, unknown> | null | undefined): WorkoutProposal | null => {
  if (!payload || !Array.isArray(payload.exercises)) return null;
  return {
    duration_minutes: typeof payload.duration_minutes === 'number' ? payload.duration_minutes : undefined,
    exercises: payload.exercises.filter((item): item is WorkoutProposalExercise => Boolean(item && typeof item === 'object')),
  };
};

const actionTitle = (actionType: string | null | undefined) => actionType === 'replace_today_workout'
  ? 'Đề xuất buổi tập mới'
  : 'Đề xuất điều chỉnh kế hoạch';

const formatQuotaBadge = (quota: AiQuota | null) => {
  const messages = quota?.chatMessages;
  if (typeof messages?.used === 'number' && typeof messages.limit === 'number') return `${Math.max(0, messages.limit - messages.used)} lượt`;
  return '— lượt';
};

export default function CoachScreen() {
  const [greetingTime] = useState(() => new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false }));
  const [quota, setQuota] = useState<QuotaResponse | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [isLoadingQuota, setIsLoadingQuota] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const [pendingAdjustments, setPendingAdjustments] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const applyKeysRef = useRef(new Map<string, string>());
  const pendingRef = useRef(new Set<string>());

  const loadQuota = useCallback(async () => {
    setIsLoadingQuota(true);
    try {
      const response = await apiRequest<QuotaResponse>('/api/ai/quota', { timeoutMs: 15_000 });
      setQuota(response);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Không thể tải AI Coach.');
    } finally {
      setIsLoadingQuota(false);
    }
  }, []);

  useEffect(() => {
    const task = setTimeout(() => { void loadQuota(); }, 0);
    return () => clearTimeout(task);
  }, [loadQuota]);

  const sendMessage = async () => {
    const content = draft.trim();
    if (!content || isSending) return;
    const userMessage: ChatMessage = { id: makeClientId(), role: 'user', content };
    const history = messages.slice(-10).map(({ role, content: historyContent }) => ({ role, content: historyContent }));
    setMessages((current) => [...current, userMessage]);
    setDraft('');
    setError(null);
    setIsSending(true);
    try {
      const response = await apiRequest<ChatResponse>('/api/ai/chat', {
        method: 'POST',
        body: { message: content, clientHistory: history },
        timeoutMs: 30_000,
      });
      setQuota((current) => current ? { ...current, aiQuota: response.aiQuota } : current);
      setMessages((current) => [...current, {
        id: makeClientId(),
        role: 'assistant',
        content: response.reply,
        adjustmentId: response.adjustmentId,
        actionRequired: response.actionRequired,
        actionType: response.actionType,
        actionPayload: response.actionPayload,
      }]);
    } catch (nextError) {
      setError(nextError instanceof ApiClientError
        ? nextError.message
        : 'Kết quả chat chưa chắc chắn. Không gửi lại tự động; hãy gửi yêu cầu mới khi sẵn sàng.');
    } finally {
      setIsSending(false);
    }
  };

  const markPending = (adjustmentId: string) => {
    pendingRef.current.add(adjustmentId);
    setPendingAdjustments(new Set(pendingRef.current));
  };

  const clearPending = (adjustmentId: string) => {
    pendingRef.current.delete(adjustmentId);
    setPendingAdjustments(new Set(pendingRef.current));
  };

  const applyAdjustment = async (adjustmentId: string) => {
    if (pendingRef.current.has(adjustmentId)) return;
    const key = applyKeysRef.current.get(adjustmentId) ?? createApplyKey(adjustmentId);
    applyKeysRef.current.set(adjustmentId, key);
    markPending(adjustmentId);
    setError(null);
    try {
      const response = await apiRequest<ApplyResponse>('/api/ai/apply-adjustment', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: { adjustmentId },
        timeoutMs: 20_000,
      });
      if (response.aiQuota) {
        const nextQuota = response.aiQuota;
        setQuota((current) => current ? { ...current, aiQuota: nextQuota } : current);
      }
      setMessages((current) => current.map((message) => message.adjustmentId === adjustmentId
        ? { ...message, actionRequired: false, content: `${message.content}\n\n${response.alreadyApplied ? 'Đề xuất này đã được áp dụng trước đó.' : 'Đề xuất đã được áp dụng.'}` }
        : message));
      applyKeysRef.current.delete(adjustmentId);
    } catch (nextError) {
      setError(nextError instanceof ApiClientError
        ? nextError.message
        : 'Không chắc đề xuất đã được áp dụng. Không tạo key mới; bấm Áp dụng lại sẽ dùng cùng key.');
    } finally {
      clearPending(adjustmentId);
    }
  };

  const rejectAdjustment = async (adjustmentId: string) => {
    if (pendingRef.current.has(adjustmentId)) return;
    markPending(adjustmentId);
    setError(null);
    try {
      await apiRequest<{ success: true; adjustmentId: string }>('/api/ai/reject-adjustment', {
        method: 'POST', body: { adjustmentId }, timeoutMs: 15_000,
      });
      setMessages((current) => current.map((message) => message.adjustmentId === adjustmentId
        ? { ...message, actionRequired: false, content: `${message.content}\n\nĐề xuất đã bị từ chối.` }
        : message));
      clearPending(adjustmentId);
    } catch (nextError) {
      setError(nextError instanceof ApiClientError
        ? nextError.message
        : 'Kết quả từ chối chưa chắc chắn. Nút này được khóa để tránh gửi lại; hãy tải lại Coach.');
      // Reject has no idempotency key. Keep it locked after an uncertain result.
    }
  };

  const launchCamera = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Chưa có quyền camera', 'Hãy cấp quyền Camera trong cài đặt để chụp ảnh gửi cho AI Coach.');
      return;
    }
    await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
  }, []);

  const takePhoto = useCallback(() => {
    setIsAttachmentMenuOpen(false);
    Alert.alert(
      'Cần cấp quyền camera',
      'Fitly cần sử dụng camera để bạn chụp ảnh gửi cho AI Coach.',
      [
        { text: 'Để sau', style: 'cancel' },
        { text: 'Cấp quyền', onPress: () => void launchCamera() },
      ],
    );
  }, [launchCamera]);

  const openImageLibrary = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Chưa có quyền thư viện ảnh', 'Hãy cấp quyền Ảnh trong cài đặt để chọn ảnh từ thiết bị.');
      return;
    }
    await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
  }, []);

  const pickFromDevice = useCallback(() => {
    setIsAttachmentMenuOpen(false);
    Alert.alert(
      'Chọn ảnh từ thiết bị',
      'Fitly cần quyền truy cập thư viện ảnh để bạn chọn ảnh gửi cho AI Coach.',
      [
        { text: 'Để sau', style: 'cancel' },
        { text: 'Cấp quyền', onPress: () => void openImageLibrary() },
      ],
    );
  }, [openImageLibrary]);

  const requestMicrophonePermission = useCallback(() => {
    Alert.alert(
      'Cần cấp quyền micro',
      'Fitly cần sử dụng micro để bạn ghi âm tin nhắn cho AI Coach.',
      [
        { text: 'Để sau', style: 'cancel' },
        {
          text: 'Cấp quyền',
          onPress: () => void requestRecordingPermissionsAsync().then((permission) => {
            if (!permission.granted) Alert.alert('Chưa có quyền micro', 'Hãy cấp quyền Micro trong cài đặt để sử dụng ghi âm.');
          }),
        },
      ],
    );
  }, []);

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.chatShell}>
        <View style={styles.chatHeader}>
          <View style={styles.brandRow}>
            <View style={styles.botAvatar}><AppIcon name="bot" color={tokens.colors.ink} size={19} /><View style={styles.botStatus} /></View>
            <View style={styles.brandCopy}><Text style={styles.title}>AI Coach</Text></View>
          </View>
          <View style={styles.quotaPill}>
            {isLoadingQuota ? <ActivityIndicator color={tokens.colors.lime} size="small" /> : <><AppIcon name="zap" color={tokens.colors.lime} size={15} /><Text style={styles.quotaValue}>{formatQuotaBadge(quota?.aiQuota ?? null)}</Text></>}
          </View>
        </View>

        <View style={styles.conversation}>
          {messages.length === 0 ? <View style={styles.messageWrap}>
            <View style={[styles.message, styles.coachMessage]}>
              <Text style={styles.messageText}>Chào bạn, mình là huấn luyện viên AI của bạn. Bạn muốn mình tư vấn gì hôm nay: bài tập, dinh dưỡng hay điều chỉnh kế hoạch?</Text>
            </View>
            <Text style={styles.messageTime}>{greetingTime}</Text>
          </View> : messages.map((message) => (
            <View key={message.id} style={[styles.messageWrap, message.role === 'user' && styles.userMessageWrap]}>
              <View style={[styles.message, message.role === 'user' ? styles.userMessage : styles.coachMessage]}>
          <Text style={styles.messageText}>{message.content}</Text>
          {message.actionRequired && message.adjustmentId ? <View style={styles.proposal}>
            <Text style={styles.proposalTitle}>Cần xác nhận</Text>
            <Text style={styles.proposalCopy}>{actionTitle(message.actionType)}</Text>
            {(() => {
              const proposal = asWorkoutProposal(message.actionPayload);
              if (!proposal) return <Text style={styles.proposalDetails}>Xem lại đề xuất trước khi xác nhận.</Text>;
              return <View style={styles.exercisePreview}>
                <Text style={styles.previewMeta}>{proposal.duration_minutes ? `${proposal.duration_minutes} phút` : 'Buổi tập hôm nay'} · {proposal.exercises?.length ?? 0} bài</Text>
                {proposal.exercises?.map((exercise, index) => <View key={`${exercise.exercise_id ?? exercise.name ?? 'exercise'}-${index}`} style={styles.exerciseRow}>
                  <View style={styles.exerciseIndex}><Text style={styles.exerciseIndexText}>{index + 1}</Text></View>
                  <View style={styles.exerciseTextWrap}>
                    <Text style={styles.exerciseName}>{exercise.name ?? 'Bài tập'}</Text>
                    <Text style={styles.exerciseMeta}>{exercise.sets ?? '—'} set · {exercise.reps ?? '—'} reps{exercise.rest_seconds ? ` · nghỉ ${exercise.rest_seconds}s` : ''}{exercise.target_rpe ? ` · RPE ${exercise.target_rpe}` : ''}</Text>
                  </View>
                </View>)}
              </View>;
            })()}
            <View style={styles.actionRow}>
              <Pressable disabled={pendingAdjustments.has(message.adjustmentId)} onPress={() => void rejectAdjustment(message.adjustmentId!)} style={[styles.rejectButton, pendingAdjustments.has(message.adjustmentId) && styles.disabledButton]}>
                <Text style={styles.rejectText}>Từ chối</Text>
              </Pressable>
              <Pressable disabled={pendingAdjustments.has(message.adjustmentId)} onPress={() => void applyAdjustment(message.adjustmentId!)} style={[styles.applyButton, pendingAdjustments.has(message.adjustmentId) && styles.disabledButton]}>
                {pendingAdjustments.has(message.adjustmentId) ? <ActivityIndicator color={tokens.colors.canvas} /> : <Text style={styles.applyText}>Áp dụng</Text>}
              </Pressable>
            </View>
          </View> : null}
              </View>
              <Text style={[styles.messageTime, message.role === 'user' && styles.userMessageTime]}>{message.role === 'user' ? 'Bạn' : 'Fitly Coach'}</Text>
            </View>
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.composer}>
          <Pressable accessibilityRole="button" accessibilityLabel="Thêm ảnh" hitSlop={8} onPress={() => setIsAttachmentMenuOpen(true)}>
            <AppIcon name="paperclip" color={tokens.colors.muted} size={20} />
          </Pressable>
          <TextInput value={draft} onChangeText={setDraft} editable={!isSending && quota?.canChat !== false} multiline maxLength={1000} placeholder="Nhắn tin cho AI Coach hôm nay..." placeholderTextColor={tokens.colors.muted} style={styles.input} />
          {draft.trim() ? <Pressable disabled={isSending || quota?.canChat === false} onPress={() => void sendMessage()} style={[styles.sendButton, (isSending || quota?.canChat === false) && styles.disabledButton]}>{isSending ? <ActivityIndicator color={tokens.colors.canvas} size="small" /> : <AppIcon name="send" color={tokens.colors.canvas} size={18} />}</Pressable> : <Pressable accessibilityRole="button" accessibilityLabel="Ghi âm" hitSlop={8} onPress={requestMicrophonePermission}><AppIcon name="mic" color={tokens.colors.muted} size={19} /></Pressable>}
        </View>
      </View>
      <Modal visible={isAttachmentMenuOpen} transparent animationType="fade" onRequestClose={() => setIsAttachmentMenuOpen(false)}>
        <View style={styles.attachmentOverlay}>
          <Pressable style={styles.attachmentBackdrop} onPress={() => setIsAttachmentMenuOpen(false)} />
          <View style={styles.attachmentSheet}>
            <Text style={styles.attachmentTitle}>Thêm ảnh cho AI Coach</Text>
            <Pressable accessibilityRole="button" onPress={takePhoto} style={styles.attachmentOption}>
              <View style={styles.attachmentIcon}><AppIcon name="camera" color={tokens.colors.lime} size={20} /></View>
              <View style={styles.attachmentCopy}><Text style={styles.attachmentOptionTitle}>Chụp ảnh</Text><Text style={styles.attachmentOptionHint}>Dùng camera của thiết bị</Text></View>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={pickFromDevice} style={styles.attachmentOption}>
              <View style={styles.attachmentIcon}><AppIcon name="image" color={tokens.colors.lime} size={20} /></View>
              <View style={styles.attachmentCopy}><Text style={styles.attachmentOptionTitle}>Chọn từ thiết bị</Text><Text style={styles.attachmentOptionHint}>Chọn ảnh trong thư viện</Text></View>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: tokens.spacing.sm, paddingBottom: 0 },
  chatShell: { minHeight: 520, backgroundColor: tokens.colors.canvas },
  chatHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: tokens.spacing.md, marginHorizontal: tokens.spacing.md, paddingVertical: tokens.spacing.md },
  brandRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm },
  botAvatar: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: tokens.colors.surfaceRaised, position: 'relative' },
  botStatus: { position: 'absolute', right: 0, bottom: 1, width: 8, height: 8, borderRadius: 4, backgroundColor: '#A97CFF', borderWidth: 1, borderColor: tokens.colors.surface },
  brandCopy: { flex: 1, gap: 2 },
  title: { color: tokens.colors.ink, fontSize: 18, fontWeight: '900' },
  quotaPill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, minWidth: 76, minHeight: 34, paddingHorizontal: tokens.spacing.sm, borderRadius: tokens.radius.pill, backgroundColor: '#0C2817', borderWidth: 1, borderColor: '#168C49' },
  quotaValue: { color: tokens.colors.lime, fontSize: 12, fontWeight: '900' },
  conversation: { flex: 1, minHeight: 280, padding: tokens.spacing.md, justifyContent: 'flex-start' },
  messageWrap: { alignSelf: 'flex-start', maxWidth: '88%', gap: 5, marginBottom: tokens.spacing.md },
  userMessageWrap: { alignSelf: 'flex-end' },
  message: { padding: tokens.spacing.md, borderRadius: tokens.radius.md },
  userMessage: { backgroundColor: '#143723', borderBottomRightRadius: 4 },
  coachMessage: { backgroundColor: '#111111', borderWidth: 1, borderColor: '#303330', borderBottomLeftRadius: 4 },
  messageText: { color: tokens.colors.ink, fontSize: 14, lineHeight: 22 },
  messageTime: { color: tokens.colors.muted, fontSize: 10, marginLeft: tokens.spacing.xs },
  userMessageTime: { alignSelf: 'flex-end', marginRight: tokens.spacing.xs },
  proposal: { gap: tokens.spacing.sm, marginTop: tokens.spacing.sm, paddingTop: tokens.spacing.md, borderTopWidth: 1, borderColor: tokens.colors.border },
  proposalTitle: { color: tokens.colors.coral, fontWeight: '900', fontSize: tokens.type.label },
  proposalCopy: { color: tokens.colors.ink, fontWeight: '700' },
  proposalDetails: { color: tokens.colors.muted, fontSize: tokens.type.body, lineHeight: 21 },
  exercisePreview: { gap: tokens.spacing.sm, padding: tokens.spacing.md, borderRadius: tokens.radius.md, backgroundColor: tokens.colors.surfaceRaised },
  previewMeta: { color: tokens.colors.lime, fontSize: tokens.type.caption, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  exerciseRow: { flexDirection: 'row', gap: tokens.spacing.sm, alignItems: 'center' },
  exerciseIndex: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.colors.canvas, borderWidth: 1, borderColor: tokens.colors.border },
  exerciseIndexText: { color: tokens.colors.lime, fontWeight: '900', fontSize: tokens.type.caption },
  exerciseTextWrap: { flex: 1, gap: 2 },
  exerciseName: { color: tokens.colors.ink, fontWeight: '800', fontSize: tokens.type.body },
  exerciseMeta: { color: tokens.colors.muted, fontSize: tokens.type.caption },
  actionRow: { flexDirection: 'row', gap: tokens.spacing.sm },
  applyButton: { flex: 1, minHeight: 48, borderRadius: tokens.radius.md, justifyContent: 'center', alignItems: 'center', backgroundColor: tokens.colors.lime },
  applyText: { color: tokens.colors.canvas, fontWeight: '900' },
  rejectButton: { flex: 1, minHeight: 48, borderRadius: tokens.radius.md, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: tokens.colors.coral },
  rejectText: { color: tokens.colors.coral, fontWeight: '900' },
  composer: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm, marginTop: tokens.spacing.md, marginHorizontal: tokens.spacing.md, marginBottom: tokens.spacing.xs, minHeight: 50, paddingLeft: tokens.spacing.md, paddingRight: tokens.spacing.sm, borderRadius: tokens.radius.pill, backgroundColor: '#0B0B0B', borderWidth: 1, borderColor: tokens.colors.border },
  input: { flex: 1, minHeight: 42, maxHeight: 96, color: tokens.colors.ink, fontSize: 13, textAlignVertical: 'center' },
  sendButton: { width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center', backgroundColor: tokens.colors.lime },
  attachmentOverlay: { flex: 1, justifyContent: 'flex-end' },
  attachmentBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0, 0, 0, 0.62)' },
  attachmentSheet: { marginHorizontal: tokens.spacing.lg, marginBottom: tokens.spacing.xxl, padding: tokens.spacing.lg, gap: tokens.spacing.sm, borderRadius: tokens.radius.lg, backgroundColor: tokens.colors.surface, borderWidth: 1, borderColor: tokens.colors.border },
  attachmentTitle: { color: tokens.colors.ink, fontSize: tokens.type.label, fontWeight: '900', marginBottom: tokens.spacing.xs },
  attachmentOption: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md, minHeight: 62, paddingHorizontal: tokens.spacing.sm, borderRadius: tokens.radius.md, backgroundColor: tokens.colors.surfaceRaised },
  attachmentIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: '#0C2817' },
  attachmentCopy: { flex: 1, gap: 2 },
  attachmentOptionTitle: { color: tokens.colors.ink, fontSize: tokens.type.body, fontWeight: '800' },
  attachmentOptionHint: { color: tokens.colors.muted, fontSize: tokens.type.caption },
  disabledButton: { opacity: 0.48 },
  error: { color: tokens.colors.danger, fontSize: tokens.type.body, lineHeight: 22 },
});
