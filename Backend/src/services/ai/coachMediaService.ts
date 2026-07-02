import { callCoachCompletion, CoachChatMessage, sanitizeCoachReply } from './coachConversationService';

const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_AUDIO_TRANSCRIPTIONS_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const DEFAULT_TRANSCRIPTION_MODEL = 'whisper-large-v3-turbo';
const DEFAULT_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const MAX_MEDIA_CONTEXT_CHARS = 3500;

type TranscribeTelegramAudioInput = {
  fileUrl: string;
  fileName?: string;
  language?: string;
  prompt?: string;
};

type AnalyzeMealPhotoInput = {
  imageUrl: string;
  userQuestion?: string;
  profileName?: string | null;
  coachContext?: string;
  history?: CoachChatMessage[];
  maxTokens?: number;
  temperature?: number;
};

type AnswerVoiceCoachQuestionInput = {
  transcript: string;
  userQuestion?: string;
  profileName?: string | null;
  coachContext?: string;
  history?: CoachChatMessage[];
  maxTokens?: number;
  temperature?: number;
};

const ensureGroqKey = () => {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('Missing GROQ_API_KEY');
  }
  return process.env.GROQ_API_KEY;
};

const inferFileNameFromUrl = (url: string, fallback: string) => {
  try {
    const pathname = new URL(url).pathname;
    const name = pathname.split('/').filter(Boolean).pop();
    return name || fallback;
  } catch {
    return fallback;
  }
};

const inferMimeType = (fileName: string, fallback = 'application/octet-stream') => {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.oga') || lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.mp4')) return 'audio/mp4';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.webm')) return 'audio/webm';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return fallback;
};

const downloadFileAsBlob = async (fileUrl: string, fallbackName: string) => {
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Telegram file download failed: ${response.status}`);
  }

  const fileName = inferFileNameFromUrl(fileUrl, fallbackName);
  const contentType = response.headers.get('content-type') || inferMimeType(fileName);
  const arrayBuffer = await response.arrayBuffer();
  return {
    blob: new Blob([arrayBuffer], { type: contentType }),
    fileName,
  };
};

const normalizeHistory = (history?: CoachChatMessage[]) =>
  (history || [])
    .filter((item) => item.role === 'user' || item.role === 'assistant')
    .slice(-6)
    .map((item) => ({
      role: item.role,
      content: String(item.content || '').slice(0, 900),
    }));

const truncate = (value: string | undefined, maxLength: number) => {
  const text = String(value || '').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
};

export const transcribeTelegramAudio = async ({
  fileUrl,
  fileName = 'telegram-audio.ogg',
  language = 'vi',
  prompt,
}: TranscribeTelegramAudioInput): Promise<string> => {
  const groqKey = ensureGroqKey();
  const file = await downloadFileAsBlob(fileUrl, fileName);
  const form = new FormData();
  form.append('model', process.env.GROQ_TRANSCRIPTION_MODEL || DEFAULT_TRANSCRIPTION_MODEL);
  form.append('file', file.blob, file.fileName);
  form.append('response_format', 'json');
  form.append('temperature', '0');
  if (language) form.append('language', language);
  if (prompt) form.append('prompt', truncate(prompt, 500));

  const response = await fetch(GROQ_AUDIO_TRANSCRIPTIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${groqKey}`,
    },
    body: form,
  });

  const result: any = await response.json().catch(() => ({}));
  if (!response.ok || result?.error) {
    throw new Error(result?.error?.message || 'Groq transcription request failed');
  }

  const transcript = String(result?.text || '').trim();
  if (!transcript) {
    throw new Error('Groq transcription returned empty text');
  }
  return transcript;
};

export const analyzeMealPhotoCalories = async ({
  imageUrl,
  userQuestion,
  profileName,
  coachContext,
  history,
  maxTokens = 800,
  temperature = 0.35,
}: AnalyzeMealPhotoInput): Promise<string> => {
  const groqKey = ensureGroqKey();
  const systemPrompt = [
    'Bạn là Fitly AI, coach dinh dưỡng trên Telegram.',
    'Nhiệm vụ: nhìn ảnh bữa ăn và ước tính calories/macros một cách thực tế.',
    'Không đưa con số tuyệt đối. Luôn trả theo khoảng kcal và nói rõ độ tin cậy.',
    'Nếu không nhìn rõ món/khẩu phần, hỏi tối đa 1 câu làm rõ.',
    'Tuyệt đối không bảo người dùng tham khảo/hỏi/gặp chuyên gia dinh dưỡng, dietitian, nutritionist hay nutrition expert.',
    'Không tự động khẳng định đã ghi vào Fitly và không thêm hướng dẫn lưu; hệ thống sẽ tự thêm một câu lưu ngắn.',
    'Trả lời bằng tiếng Việt đầy đủ dấu, ngắn gọn, dễ đọc trên điện thoại, không dùng bảng markdown.',
  ].join('\n');

  const promptText = [
    `Người dùng: ${profileName || 'khách hàng'}`,
    `Caption/câu hỏi: ${truncate(userQuestion, 500) || 'Ước tính calories của bữa ăn trong ảnh.'}`,
    '',
    '[DỮ LIỆU FITLY TÓM TẮT]',
    truncate(coachContext, MAX_MEDIA_CONTEXT_CHARS) || 'Chưa có dữ liệu Fitly kèm theo.',
    '',
    'Hãy trả lời theo format:',
    '- Món/các thành phần mình nhìn thấy',
    '- Ước tính kcal theo khoảng và protein/carbs/fat nếu có thể',
    '- Giả định: tối đa một dòng ngắn về khẩu phần/dầu/sốt',
    'Kết thúc ngay sau dòng giả định, không thêm câu hỏi hay hướng dẫn lưu.',
  ].join('\n');

  const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${groqKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.GROQ_VISION_MODEL || DEFAULT_VISION_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...normalizeHistory(history),
        {
          role: 'user',
          content: [
            { type: 'text', text: promptText },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      temperature,
      max_tokens: maxTokens,
    }),
  });

  const result: any = await response.json().catch(() => ({}));
  if (!response.ok || result?.error) {
    throw new Error(result?.error?.message || 'Groq vision request failed');
  }

  const reply = sanitizeCoachReply(String(result?.choices?.[0]?.message?.content || '').trim());
  if (!reply) {
    throw new Error('Groq vision returned empty reply');
  }
  return reply;
};

export const answerVoiceCoachQuestion = ({
  transcript,
  userQuestion,
  profileName,
  coachContext,
  history,
  maxTokens = 800,
  temperature = 0.5,
}: AnswerVoiceCoachQuestionInput): Promise<string> => {
  const systemPrompt = [
    'Bạn là Fitly AI, coach dinh dưỡng và tập luyện trên Telegram.',
    'Người dùng vừa gửi ghi âm; hệ thống đã chuyển thành text.',
    'Nếu transcript mô tả bữa ăn hoặc hỏi calories, hãy ước tính calories/macros theo khoảng; nếu rõ ràng thì đưa con số để user có thể ghi lại.',
    'Nếu transcript là câu hỏi fitness/dinh dưỡng khác, trả lời như AI Coach bình thường.',
    'Không đưa con số tuyệt đối khi thiếu khẩu phần. Không nói đã ghi vào Fitly nếu user chưa xác nhận bằng text.',
    'Trả lời bằng tiếng Việt đầy đủ dấu, ngắn gọn, dễ đọc trên điện thoại.',
    '',
    `[NGƯỜI DÙNG] ${profileName || 'khách hàng'}`,
    '[DỮ LIỆU FITLY TÓM TẮT]',
    truncate(coachContext, MAX_MEDIA_CONTEXT_CHARS) || 'Chưa có dữ liệu Fitly kèm theo.',
  ].join('\n');

  const userMessage = [
    userQuestion ? `Caption/câu hỏi kèm theo: ${truncate(userQuestion, 500)}` : '',
    `Transcript ghi âm: ${truncate(transcript, 2500)}`,
    '',
    'Hãy trả lời trực tiếp. Nếu đây là mô tả bữa ăn, ước tính kcal và nói rõ cách user có thể ghi vào Fitly bằng tin nhắn "ghi ... kcal".',
  ].filter(Boolean).join('\n');

  return callCoachCompletion({
    systemPrompt,
    userMessage,
    history,
    maxTokens,
    temperature,
  });
};
