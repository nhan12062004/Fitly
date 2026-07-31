import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiClientError, apiRequest } from '@/lib/api-client';
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

const formatQuota = (quota: AiQuota | null) => {
  const messages = quota?.chatMessages;
  return typeof messages?.used === 'number' && typeof messages.limit === 'number'
    ? `${messages.used}/${messages.limit} lượt chat`
    : 'Quota được kiểm soát bởi server';
};

export default function CoachScreen() {
  const [quota, setQuota] = useState<QuotaResponse | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [isLoadingQuota, setIsLoadingQuota] = useState(true);
  const [isSending, setIsSending] = useState(false);
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
      if (response.aiQuota) setQuota((current) => current ? { ...current, aiQuota: response.aiQuota } : current);
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
    <Screen contentStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>AI PERFORMANCE PARTNER</Text>
        <Text style={styles.title}>Coach</Text>
        <Text style={styles.lead}>Hỏi về buổi tập, hồi phục hoặc điều chỉnh kế hoạch. Mọi thay đổi đều cần bạn xác nhận.</Text>
      </View>

      <View style={styles.quotaCard}>
        {isLoadingQuota ? <ActivityIndicator color={tokens.colors.lime} /> : <>
          <Text style={styles.quotaLabel}>{quota?.membershipTier?.toUpperCase() ?? 'AI COACH'}</Text>
          <Text style={styles.quotaValue}>{formatQuota(quota?.aiQuota ?? null)}</Text>
          <Text style={styles.quotaDetail}>{quota?.canChat ? 'Sẵn sàng hỗ trợ bạn.' : 'Chat hiện chưa khả dụng cho tài khoản này.'}</Text>
        </>}
      </View>

      {messages.length === 0 ? <View style={styles.emptyCard}>
        <Text style={styles.emptyTitle}>Bắt đầu cùng Coach</Text>
        <Text style={styles.emptyCopy}>Ví dụ: “Tôi đau vai, hãy đề xuất bài thay thế cho hôm nay.”</Text>
      </View> : messages.map((message) => (
        <View key={message.id} style={[styles.message, message.role === 'user' ? styles.userMessage : styles.coachMessage]}>
          <Text style={styles.messageLabel}>{message.role === 'user' ? 'BẠN' : 'FITLY COACH'}</Text>
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
      ))}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.composer}>
        <TextInput value={draft} onChangeText={setDraft} editable={!isSending && quota?.canChat !== false} multiline maxLength={1000} placeholder="Nhắn cho Coach…" placeholderTextColor={tokens.colors.muted} style={styles.input} />
        <Pressable disabled={isSending || !draft.trim() || quota?.canChat === false} onPress={() => void sendMessage()} style={[styles.sendButton, (isSending || !draft.trim() || quota?.canChat === false) && styles.disabledButton]}>
          {isSending ? <ActivityIndicator color={tokens.colors.canvas} /> : <Text style={styles.sendText}>Gửi</Text>}
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: tokens.spacing.hero },
  header: { gap: tokens.spacing.sm },
  eyebrow: { color: tokens.colors.lime, fontWeight: '900', fontSize: tokens.type.overline, letterSpacing: 1.4 },
  title: { color: tokens.colors.ink, fontSize: tokens.type.display, fontWeight: '900', letterSpacing: -1.2 },
  lead: { color: tokens.colors.muted, fontSize: tokens.type.body, lineHeight: 23 },
  quotaCard: { gap: tokens.spacing.xs, padding: tokens.spacing.lg, borderRadius: tokens.radius.lg, backgroundColor: tokens.colors.surfaceRaised, borderWidth: 1, borderColor: tokens.colors.border },
  quotaLabel: { color: tokens.colors.lime, fontWeight: '900', fontSize: tokens.type.overline, letterSpacing: 1.2 },
  quotaValue: { color: tokens.colors.ink, fontWeight: '900', fontSize: 22 },
  quotaDetail: { color: tokens.colors.muted, fontSize: tokens.type.body },
  emptyCard: { padding: tokens.spacing.xl, borderRadius: tokens.radius.lg, backgroundColor: tokens.colors.surface, gap: tokens.spacing.sm },
  emptyTitle: { color: tokens.colors.ink, fontSize: 20, fontWeight: '900' },
  emptyCopy: { color: tokens.colors.muted, fontSize: tokens.type.body, lineHeight: 23 },
  message: { padding: tokens.spacing.lg, borderRadius: tokens.radius.lg, gap: tokens.spacing.sm },
  userMessage: { backgroundColor: tokens.colors.surfaceRaised, marginLeft: tokens.spacing.xl },
  coachMessage: { backgroundColor: tokens.colors.surface, marginRight: tokens.spacing.sm, borderWidth: 1, borderColor: tokens.colors.border },
  messageLabel: { color: tokens.colors.lime, fontSize: tokens.type.overline, fontWeight: '900', letterSpacing: 1.1 },
  messageText: { color: tokens.colors.ink, fontSize: tokens.type.body, lineHeight: 23 },
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
  composer: { gap: tokens.spacing.sm, padding: tokens.spacing.md, borderRadius: tokens.radius.lg, backgroundColor: tokens.colors.surface, borderWidth: 1, borderColor: tokens.colors.border },
  input: { minHeight: 76, color: tokens.colors.ink, fontSize: tokens.type.body, textAlignVertical: 'top' },
  sendButton: { minHeight: 50, borderRadius: tokens.radius.md, justifyContent: 'center', alignItems: 'center', backgroundColor: tokens.colors.lime },
  sendText: { color: tokens.colors.canvas, fontWeight: '900', fontSize: tokens.type.label },
  disabledButton: { opacity: 0.48 },
  error: { color: tokens.colors.danger, fontSize: tokens.type.body, lineHeight: 22 },
});
