import { describe, expect, it, vi } from 'vitest';

import {
  GROQ_TRANSLATION_MODEL,
  buildTranslationPrompt,
  parseTranslations,
  translateWithGroq,
} from '../../src/read-ahead/groq-translation';

function reply(content: unknown, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
}

const request = {
  apiKey: 'gsk-key',
  context: [{ original: 'My research team and I went to West Point.', translation: '我和研究團隊去了西點軍校。' }],
  sourceLanguage: 'en',
  targetLanguage: 'zh-Hant',
  texts: ['We studied the cadets.', 'Some dropped out.'],
};

describe('translateWithGroq', () => {
  it("sends the chunk's sentences to Qwen with the viewer's key, and returns one translation each", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply('{"1": "我們研究了學員。", "2": "有些人中途退學。"}'));

    await expect(translateWithGroq(request, fetcher)).resolves.toEqual(['我們研究了學員。', '有些人中途退學。']);

    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(init!.headers).toMatchObject({ authorization: 'Bearer gsk-key' });
    const body = JSON.parse(String(init!.body)) as { messages: Array<{ content: string }>; model: string };
    expect(body.model).toBe(GROQ_TRANSLATION_MODEL);
    expect(body.model).toBe('qwen/qwen3.8-27b');
    const prompt = body.messages[0]!.content;
    expect(prompt).toContain('{"1":"We studied the cadets.","2":"Some dropped out."}');
    expect(prompt).toContain('Taiwan');
  });

  it('gives the previous sentences as context only', () => {
    const prompt = buildTranslationPrompt(request);
    expect(prompt).toMatch(/context only.*do not translate/i);
    expect(prompt).toContain('我和研究團隊去了西點軍校。');
    expect(buildTranslationPrompt({ ...request, context: [] })).not.toMatch(/context only/i);
  });

  it('asks for the regional usage of the target language, or just names it', () => {
    expect(buildTranslationPrompt({ ...request, targetLanguage: 'zh-Hans' })).toMatch(/Simplified Chinese/);
    expect(buildTranslationPrompt({ ...request, targetLanguage: 'ja' })).toContain('(ja)');
  });

  it('reads the numbered translations out of a reply wrapped in a code fence or a sentence', () => {
    expect(parseTranslations('```json\n{"1": "一", "2": "二"}\n```', 2)).toEqual(['一', '二']);
    expect(parseTranslations('Here you go: {"2": "二", "1": " 一 "}', 2)).toEqual(['一', '二']);
    // A plain array still counts when it has one per sentence.
    expect(parseTranslations('["一", "二"]', 2)).toEqual(['一', '二']);
  });

  it('numbers every sentence, repeats included, so none is merged away', () => {
    const prompt = buildTranslationPrompt({ ...request, texts: ['아귀찜같이 만들었는데.', '아귀찜같이 만들었는데.', '음 어우'] });
    expect(prompt).toContain('{"1":"아귀찜같이 만들었는데.","2":"아귀찜같이 만들었는데.","3":"음 어우"}');
    expect(prompt).toMatch(/never merge, split, skip or add/);
  });

  it('treats a reply that is not one string per sentence as unreadable', async () => {
    expect(parseTranslations('{"1": "一"}', 2)).toBeUndefined();
    expect(parseTranslations('{"1": "一", "2": 2}', 2)).toBeUndefined();
    expect(parseTranslations('["一"]', 2)).toBeUndefined();
    expect(parseTranslations('沒有陣列', 2)).toBeUndefined();
    await expect(translateWithGroq(request, vi.fn<typeof fetch>().mockResolvedValue(reply('{"1": "一"}'))))
      .rejects.toMatchObject({ code: 'invalid_response', detail: '{"1": "一"}' });
    await expect(translateWithGroq(request, vi.fn<typeof fetch>().mockResolvedValue(new Response('not json'))))
      .rejects.toMatchObject({ code: 'invalid_response' });
  });

  it.each([
    [401, '', 'invalid_credentials'],
    [429, '{"error":{"message":"Rate limit reached ... on requests per day (RPD): Limit 1000"}}', 'quota_exceeded'],
    [429, '{"error":{"message":"Rate limit reached ... on tokens per minute (TPM): Limit 8000"}}', 'rate_limited'],
    [503, '', 'provider_unavailable'],
  ])('maps HTTP %i to %s', async (status, body, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status }));
    await expect(translateWithGroq(request, fetcher)).rejects.toMatchObject({ code });
  });

  it('fails as a network error when Groq cannot be reached, and times out', async () => {
    await expect(translateWithGroq(request, vi.fn<typeof fetch>().mockRejectedValue(new TypeError('down'))))
      .rejects.toMatchObject({ code: 'network_error' });
    const hanging = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined));
    await expect(translateWithGroq(request, hanging, 10)).rejects.toMatchObject({ code: 'timeout' });
  });

  it('sends nothing for no sentences', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(translateWithGroq({ ...request, texts: [] }, fetcher)).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
