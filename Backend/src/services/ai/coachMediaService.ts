import { callCoachCompletion, CoachChatMessage } from './coachConversationService';

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
    'Ban la TrendFit AI, chuyen gia dinh duong tren Telegram.',
    'Nhiem vu: nhin anh bua an va uoc tinh calories/macros mot cach thuc te.',
    'Khong dua con so tuyet doi. Luon tra theo khoang kcal va noi ro do tin cay.',
    'Neu khong nhin ro mon/khau phan, hoi toi da 1 cau lam ro.',
    'Khong tu dong khang dinh da ghi vao TrendFit. Neu user muon luu, huong dan nhan "ghi 650 kcal" hoac con so ho chon.',
    'Tra loi bang tieng Viet ngan gon, de doc tren dien thoai, khong dung bang markdown.',
  ].join('\n');

  const promptText = [
    `Nguoi dung: ${profileName || 'khach hang'}`,
    `Caption/cau hoi: ${truncate(userQuestion, 500) || 'Uoc tinh calories cua bua an trong anh.'}`,
    '',
    '[DU LIEU TRENDfit TOM TAT]',
    truncate(coachContext, MAX_MEDIA_CONTEXT_CHARS) || 'Chua co du lieu TrendFit kem theo.',
    '',
    'Hay tra loi theo format:',
    '- Mon/co thanh phan minh nhin thay',
    '- Uoc tinh kcal theo khoang va protein/carbs/fat neu co the',
    '- Gia dinh quan trong ve khau phan/dau/sot',
    '- Mot cau de user xac nhan hoac cach ghi vao TrendFit',
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

  const reply = String(result?.choices?.[0]?.message?.content || '').trim();
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
    'Ban la TrendFit AI, coach dinh duong va tap luyen tren Telegram.',
    'Nguoi dung vua gui ghi am; he thong da chuyen thanh text.',
    'Neu transcript mo ta bua an hoac hoi calories, hay uoc tinh calories/macros theo khoang, neu ro rang thi dua con so de user co the ghi lai.',
    'Neu transcript la cau hoi fitness/dinh duong khac, tra loi nhu AI Coach binh thuong.',
    'Khong dua con so tuyet doi khi thieu khau phan. Khong noi da ghi vao TrendFit neu user chua xac nhan bang text.',
    'Tra loi bang tieng Viet ngan gon, de doc tren dien thoai.',
    '',
    `[NGUOI DUNG] ${profileName || 'khach hang'}`,
    '[DU LIEU TRENDfit TOM TAT]',
    truncate(coachContext, MAX_MEDIA_CONTEXT_CHARS) || 'Chua co du lieu TrendFit kem theo.',
  ].join('\n');

  const userMessage = [
    userQuestion ? `Caption/cau hoi kem theo: ${truncate(userQuestion, 500)}` : '',
    `Transcript ghi am: ${truncate(transcript, 2500)}`,
    '',
    'Hay tra loi truc tiep. Neu day la mo ta bua an, uoc tinh kcal va noi ro cach user co the ghi vao TrendFit bang tin nhan "ghi ... kcal".',
  ].filter(Boolean).join('\n');

  return callCoachCompletion({
    systemPrompt,
    userMessage,
    history,
    maxTokens,
    temperature,
  });
};
