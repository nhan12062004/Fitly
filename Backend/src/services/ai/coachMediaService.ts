import { callCoachCompletion, CoachChatMessage, sanitizeCoachReply } from './coachConversationService';

const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const MAX_MEDIA_CONTEXT_CHARS = 3500;

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
    'Bạn là Fitly AI, coach dinh dưỡng trong Fitly.',
    'Nhiệm vụ: nhìn ảnh bữa ăn và ước tính calories/macros một cách thực tế.',
    'Không đưa con số tuyệt đối. Luôn trả theo khoảng kcal và nói rõ độ tin cậy.',
    'Nếu không nhìn rõ món/khẩu phần, hỏi tối đa 1 câu làm rõ.',
    'Không chẩn đoán hay điều trị bệnh. Khi câu hỏi liên quan bệnh nền, dị ứng hoặc chế độ ăn điều trị, khuyến nghị tham khảo chuyên gia y tế phù hợp.',
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
    'Bạn là Fitly AI, coach dinh dưỡng và tập luyện trong Fitly.',
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
