import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callGroqJson, DEFAULT_GROQ_MODEL } from '../src/services/ai/groqJsonService';

const payload = { messages: [{ role: 'user', content: 'Return a workout as JSON.' }] };
const success = () => Response.json({ choices: [{ message: { content: '{"workout_plan":{}}' } }] });

describe('Groq JSON model fallback', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubEnv('GROQ_API_KEY', 'test-key');
    vi.stubEnv('GROQ_MODEL', 'llama-3.3-70b-versatile');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('recovers from the configured model_not_found error using a supported model', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: 'model_not_found' } }, { status: 404 }))
      .mockResolvedValueOnce(success());
    const result = await callGroqJson(payload);
    expect(result.choices[0].message.content).toBe('{"workout_plan":{}}');
    expect(fetchMock.mock.calls.map((call) => JSON.parse(call[1].body).model))
      .toEqual(['llama-3.3-70b-versatile', DEFAULT_GROQ_MODEL]);
    expect(fetchMock.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).response_format).toEqual({ type: 'json_object' });
  });

  it('does not retry invalid credentials or expose provider details', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { message: 'private provider detail' } }, { status: 401 }));
    await expect(callGroqJson(payload)).rejects.toMatchObject({ code: 'INTERNAL_CONFIGURATION_ERROR' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns an actionable safe error when all models are rate limited', async () => {
    fetchMock.mockImplementation(async () => Response.json({ error: { message: 'private quota detail' } }, { status: 429 }));
    await expect(callGroqJson(payload)).rejects.toMatchObject({
      status: 503, code: 'AI_TOKEN_LIMIT', publicMessage: 'AI đang quá tải. Vui lòng thử lại sau ít phút.',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('recovers from network failure and an HTML upstream error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('<html>Unavailable</html>', { status: 502 }))
      .mockResolvedValueOnce(success());
    await expect(callGroqJson(payload)).resolves.toHaveProperty('choices');
  });

  it('does not repeat the default model when it is already configured', async () => {
    vi.stubEnv('GROQ_MODEL', DEFAULT_GROQ_MODEL);
    fetchMock.mockImplementation(async () => new Response('', { status: 503 }));
    await expect(callGroqJson(payload)).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
