import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useResource } from '@/hooks/use-resource';
import { requireSessionUser } from '@/lib/account-read-model';
import { supabase } from '@/lib/supabase';
import { ensureAiConsent } from '@/lib/ai-consent';

import { ApiClientError, apiRequest } from '@/lib/api-client';
import { AppIcon } from '@/components/ui/app-icon';
import { Screen } from '@/components/ui/screen';
import { tokens } from '@/theme/tokens';

type AiQuota = {
  limits?: { chatMessages?: number };
  usage?: { chatMessages?: number };
  remaining?: { chatMessages?: number };
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

const formatQuotaBadge = (quota: AiQuota | null) => typeof quota?.remaining?.chatMessages === 'number' ? `${quota.remaining.chatMessages} lượt` : '— lượt';

async function loadChatHistory(): Promise<ChatMessage[]> {
  const user = await requireSessionUser();
  const [messages, proposals] = await Promise.all([
    supabase.from('ai_chat_messages').select('id, role, content, action_type, action_payload').eq('user_id', user.id).order('created_at', { ascending: false }).limit(40),
    supabase.from('ai_plan_adjustments').select('id, chat_message_id, status').eq('user_id', user.id).eq('source_type', 'chat').order('created_at', { ascending: false }).limit(40),
  ]);
  if (messages.error) throw messages.error;
  if (proposals.error) throw proposals.error;
  const byMessage = new Map((proposals.data ?? []).map((item) => [item.chat_message_id, item]));
  return (messages.data ?? []).reverse().map((item) => ({
    id: item.id, role: item.role === 'user' ? 'user' : 'assistant', content: item.content,
    actionType: item.action_type, actionPayload: item.action_payload,
    adjustmentId: byMessage.get(item.id)?.id ?? null,
    actionRequired: byMessage.get(item.id)?.status === 'proposed',
  }));
}

export default function CoachScreen() {
  const [greetingTime] = useState(() => new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false }));
  const quotaResource = useResource('quota', () => apiRequest<QuotaResponse>('/api/ai/quota'));
  const historyResource = useResource('chat-history', loadChatHistory, [], Infinity);
  const quota = quotaResource.data;
  const messages = useMemo(() => historyResource.data ?? [], [historyResource.data]);
  const { setData: setQuotaData } = quotaResource;
  const { setData: setHistoryData } = historyResource;
  const setQuota = useCallback((updater: (current: QuotaResponse | undefined) => QuotaResponse | undefined) => setQuotaData(updater), [setQuotaData]);
  const setMessages = useCallback((updater: (current: ChatMessage[]) => ChatMessage[]) => setHistoryData((current) => updater(current ?? []).slice(-200)), [setHistoryData]);
  const isLoadingQuota = quotaResource.isPending;
  const { refreshing, refresh } = quotaResource;
  const [draft, setDraft] = useState('');
  const [draftHeight, setDraftHeight] = useState(34);
  const [isSending, setIsSending] = useState(false);
  const [pendingAdjustments, setPendingAdjustments] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const applyKeysRef = useRef(new Map<string, string>());
  const pendingRef = useRef(new Set<string>());
  const chatScrollRef = useRef<ScrollView>(null);
  const sendingRef = useRef(false);

  const sendMessage = async (messageOverride?: string) => {
    const content = (messageOverride ?? draft).trim();
    if (!content || sendingRef.current || historyResource.isPending) return;
    sendingRef.current = true;
    setIsSending(true);
    setError(null);
    try {
      const user = await requireSessionUser();
      if (!await ensureAiConsent(user.id)) return;
    const userMessage: ChatMessage = { id: makeClientId(), role: 'user', content };
    const history = messages.slice(-10).map(({ role, content: historyContent }) => ({ role, content: historyContent.slice(0, 1200) }));
    setMessages((current) => [...current, userMessage]);
    setDraft('');
    setDraftHeight(34);
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
      sendingRef.current = false;
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

  return (
    <KeyboardAvoidingView style={styles.keyboardView} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <Screen scroll={false}>
      <View style={styles.chatShell}>
        <View style={styles.chatHeader}>
          <View style={styles.brandRow}>
            <View style={styles.botAvatar}><AppIcon name="bot" color={tokens.colors.ink} size={19} /><View style={styles.botStatus} /></View>
            <View style={styles.brandCopy}><Text style={styles.title}>AI Coach</Text></View>
          </View>
          <View style={styles.quotaPill}>
            {isLoadingQuota && !quota ? <ActivityIndicator color={tokens.colors.lime} size="small" /> : <><AppIcon name="zap" color={tokens.colors.lime} size={15} /><Text style={styles.quotaValue}>{formatQuotaBadge(quota?.aiQuota ?? null)}</Text></>}
          </View>
        </View>

        <ScrollView ref={chatScrollRef} contentContainerStyle={styles.conversation} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[tokens.colors.lime]} tintColor={tokens.colors.lime} progressBackgroundColor="#151A16" />} onContentSizeChange={() => chatScrollRef.current?.scrollToEnd({ animated: false })}>
          <View style={styles.messageWrap}>
            <View style={[styles.message, styles.coachMessage]}>
              <Text style={styles.messageText}>Chào bạn, mình là huấn luyện viên AI của bạn. Bạn muốn mình tư vấn gì hôm nay: bài tập, dinh dưỡng hay điều chỉnh kế hoạch?</Text>
            </View>
            <Text style={styles.messageTime}>{greetingTime}</Text>
          </View>
          {messages.length === 0 ? <View style={styles.suggestions}>
            <Text style={styles.suggestionLabel}>HỎI NHANH</Text>
            <View style={styles.suggestionRow}>
              {['Lên bài tập hôm nay', 'Gợi ý bữa ăn', 'Điều chỉnh kế hoạch'].map((suggestion) => <Pressable key={suggestion} disabled={isSending || quota?.canChat === false} onPress={() => void sendMessage(suggestion)} style={({ pressed }) => [styles.suggestionChip, pressed && styles.suggestionPressed, (isSending || quota?.canChat === false) && styles.disabledButton]}><Text style={styles.suggestionText}>{suggestion}</Text></Pressable>)}
            </View>
          </View> : null}
          {messages.map((message) => (
            <View key={message.id} style={[styles.messageWrap, message.role === 'user' && styles.userMessageWrap]}>
              <View style={[styles.message, message.role === 'user' ? styles.userMessage : styles.coachMessage]}>
          <Text selectable style={styles.messageText}>{message.content}</Text>
          {message.role === 'assistant' && <Pressable accessibilityRole="button" accessibilityLabel="Báo cáo câu trả lời AI" hitSlop={8} onPress={() => router.push({ pathname: '/(app)/support', params: { category: 'ai_report', context: message.content.slice(0, 5000) } })}><Text style={styles.messageTime}>Báo cáo nội dung</Text></Pressable>}
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
          {isSending ? <View style={[styles.messageWrap, styles.thinkingWrap]}><View style={[styles.message, styles.coachMessage, styles.thinkingMessage]}><ActivityIndicator color={tokens.colors.lime} size="small" /><Text style={styles.thinkingText}>AI Coach đang suy nghĩ...</Text></View></View> : null}
        </ScrollView>

        {(error || quotaResource.errorMessage || historyResource.errorMessage) ? <Text style={styles.error}>{error || quotaResource.errorMessage || historyResource.errorMessage}</Text> : null}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16 }}>
          <Text style={styles.messageTime}>AI có thể sai · Không thay thế tư vấn y tế</Text>
          <Pressable accessibilityRole="button" disabled={isSending || historyResource.isPending} onPress={() => Alert.alert('Xóa hội thoại?', 'Lịch sử trò chuyện sẽ bị xóa. Hạn mức AI không thay đổi.', [{ text: 'Hủy', style: 'cancel' }, { text: 'Xóa', style: 'destructive', onPress: () => { void apiRequest('/api/ai/chat/clear', { method: 'POST', body: {} }).then(() => setHistoryData([])).catch(() => Alert.alert('Chưa xóa được', 'Vui lòng thử lại.')); } }])}><Text style={styles.messageTime}>Xóa lịch sử</Text></Pressable>
        </View>
        <View style={styles.composer}>
          <View style={styles.inputWrap}>
            {!draft ? <View pointerEvents="none" style={styles.inputPlaceholderWrap}><Text style={styles.inputPlaceholder}>Nhắn tin cho AI Coach hôm nay...</Text></View> : null}
            <TextInput value={draft} onChangeText={setDraft} onContentSizeChange={(event) => setDraftHeight(Math.min(96, Math.max(34, event.nativeEvent.contentSize.height)))} onFocus={() => setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 120)} editable={!isSending && quota?.canChat !== false} multiline maxLength={1000} style={[styles.input, { height: draftHeight }]} />
          </View>
          {draft.trim() ? <Pressable disabled={isSending || quota?.canChat === false} onPress={() => void sendMessage()} style={[styles.sendButton, (isSending || quota?.canChat === false) && styles.disabledButton]}>{isSending ? <ActivityIndicator color={tokens.colors.canvas} size="small" /> : <AppIcon name="send" color={tokens.colors.canvas} size={18} />}</Pressable> : null}
        </View>
      </View>
    </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardView: { flex: 1, backgroundColor: tokens.colors.canvas },
  chatShell: { flex: 1, padding: tokens.spacing.sm, backgroundColor: tokens.colors.canvas },
  chatHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: tokens.spacing.md, marginHorizontal: tokens.spacing.md, paddingVertical: tokens.spacing.md },
  brandRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm },
  botAvatar: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: tokens.colors.surfaceRaised, position: 'relative' },
  botStatus: { position: 'absolute', right: 0, bottom: 1, width: 8, height: 8, borderRadius: 4, backgroundColor: '#A97CFF', borderWidth: 1, borderColor: tokens.colors.surface },
  brandCopy: { flex: 1, gap: 2 },
  title: { color: tokens.colors.ink, fontSize: 18, fontWeight: '900' },
  quotaPill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, minWidth: 76, minHeight: 34, paddingHorizontal: tokens.spacing.sm, borderRadius: tokens.radius.pill, backgroundColor: '#0C2817', borderWidth: 1, borderColor: '#168C49' },
  quotaValue: { color: tokens.colors.lime, fontSize: 12, fontWeight: '900' },
  conversation: { flexGrow: 1, minHeight: 280, padding: tokens.spacing.md, justifyContent: 'flex-start' },
  messageWrap: { alignSelf: 'flex-start', maxWidth: '88%', gap: 5, marginBottom: tokens.spacing.md },
  userMessageWrap: { alignSelf: 'flex-end' },
  message: { padding: tokens.spacing.md, borderRadius: tokens.radius.md },
  userMessage: { backgroundColor: '#143723', borderBottomRightRadius: 4 },
  coachMessage: { backgroundColor: '#151516', borderBottomLeftRadius: 4 },
  messageText: { color: tokens.colors.ink, fontSize: 14, lineHeight: 22 },
  messageTime: { color: tokens.colors.muted, fontSize: 10, marginLeft: tokens.spacing.xs },
  thinkingWrap: { marginBottom: 0 },
  thinkingMessage: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm, paddingVertical: tokens.spacing.sm },
  thinkingText: { color: tokens.colors.muted, fontSize: 12, fontStyle: 'italic' },
  suggestions: { gap: 8, marginTop: tokens.spacing.sm },
  suggestionLabel: { color: '#8F9992', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  suggestionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  suggestionChip: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: tokens.radius.pill, backgroundColor: '#1D1924' },
  suggestionPressed: { opacity: 0.68 },
  suggestionText: { color: '#D4B8F5', fontSize: 10, fontWeight: '800' },
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
  inputWrap: { flex: 1, minHeight: 34, maxHeight: 96, justifyContent: 'flex-end' },
  inputPlaceholderWrap: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'center' },
  inputPlaceholder: { color: tokens.colors.muted, fontSize: 13 },
  input: { width: '100%', minHeight: 34, maxHeight: 96, paddingTop: 9, paddingBottom: 0, color: tokens.colors.ink, fontSize: 13, textAlignVertical: 'top' },
  sendButton: { width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center', backgroundColor: tokens.colors.lime },
  disabledButton: { opacity: 0.48 },
  error: { color: tokens.colors.danger, fontSize: tokens.type.body, lineHeight: 22 },
});
