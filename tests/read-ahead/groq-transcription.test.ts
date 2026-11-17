import { describe, expect, it, vi } from 'vitest';

import { CHUNK_REQUEST_TIMEOUT_MS } from '../../src/read-ahead/gemini-chunk-translation';
import {
  GROQ_MODEL,
  sentencesFromWords,
  transcribeChunk,
  whisperLanguageCode,
} from '../../src/read-ahead/groq-transcription';

const words = (...rows: Array<[string, number, number]>) =>
  rows.map(([word, start, end]) => ({ end, start, word }));

function groqReply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const request = { apiKey: 'gq-key', audioBase64: btoa('RIFF....') };

describe('sentencesFromWords', () => {
  it('ends a sentence at a word carrying its punctuation, timed from its first to last word', () => {
    // The shape Groq returned for the TED clip.
    expect(sentencesFromWords(words(
      ['And', 0, 1.2], ['like', 1.2, 1.44], ['teacher,', 1.62, 2.62], ['assignments.', 4.72, 5.4],
      ['When', 5.24, 6.14], ['grades.', 7.9, 8.48],
    ))).toEqual([
      { cut: false, end: 5.4, original: 'And like teacher, assignments.', sameLanguage: false, start: 0, translation: '' },
      { cut: false, end: 8.48, original: 'When grades.', sameLanguage: false, start: 5.24, translation: '' },
    ]);
  });

  it('marks a sentence the chunk cut off at either end', () => {
    const sentences = sentencesFromWords(words(
      ['between', 0, 0.3], ['my', 0.3, 0.4], ['students.', 0.4, 1],
      ['Some', 1.2, 1.4], ['of', 1.4, 1.5], ['my', 1.5, 1.6],
    ));
    expect(sentences.map((sentence) => [sentence.original, sentence.cut])).toEqual([
      ['between my students.', true],
      ['Some of my', true],
    ]);
  });

  it('splits speech Whisper left without punctuation at its pauses, at most 8 s a sentence', () => {
    // Lowercase, unpunctuated, as Groq returned a fast casual talk.
    const talk = words(
      ['one', 0.5, 0.8], ['is', 0.8, 1], ['to', 1, 1.2], ['follow', 1.2, 1.8], ['tdd', 1.8, 2.2],
      ['matt', 3, 3.3], ['pocock', 3.3, 3.8], ['and', 3.8, 4], ['also', 4, 4.4],
      ...Array.from({ length: 20 }, (_, index) => [`w${index}`, 4.4 + index * 0.5, 4.9 + index * 0.5] as [string, number, number]),
    );
    const sentences = sentencesFromWords(talk);
    expect(sentences.map((sentence) => [sentence.original.split(' ')[0], sentence.start, sentence.cut]))
      .toEqual([['one', 0.5, false], ['matt', 3, false], ['w13', 10.9, true]]);
    expect(sentences.every((sentence) => sentence.end - sentence.start <= 8)).toBe(true);
    // Without capitals, only speech right at the chunk's start is a fragment.
    expect(sentencesFromWords(words(['so', 0.1, 0.3], ['we', 0.3, 0.5]))[0]!.cut).toBe(true);
  });

  it('keeps a closing quote with the sentence and joins CJK without spaces', () => {
    expect(sentencesFromWords(words(['He', 0, 0.2], ['said', 0.2, 0.4], ['"stop."', 0.4, 0.8]))
      .map((sentence) => sentence.original)).toEqual(['He said "stop."']);
    expect(sentencesFromWords(words(['大家', 0, 0.4], ['好。', 0.4, 0.8], ['今天', 1, 1.4], ['很好。', 1.4, 2]))
      .map((sentence) => sentence.original)).toEqual(['大家好。', '今天很好。']);
  });
});

describe('whisperLanguageCode', () => {
  it('maps the language name Whisper reports to a code', () => {
    expect(whisperLanguageCode('English')).toBe('en');
    expect(whisperLanguageCode('chinese')).toBe('zh');
    expect(whisperLanguageCode('Klingon')).toBeUndefined();
    expect(whisperLanguageCode(undefined)).toBeUndefined();
  });
});

describe('transcribeChunk', () => {
  it('asks for word timestamps from the turbo model with the key in a header', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(groqReply({
      language: 'English',
      segments: [{ end: 2, no_speech_prob: 0, start: 0 }],
      words: words(['Hello', 0, 0.5], ['there.', 0.5, 1]),
    }));

    const result = await transcribeChunk({ ...request, sourceLanguage: 'zh-Hant' }, fetcher);

    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(init!.headers).toEqual({ authorization: 'Bearer gq-key' });
    const form = init!.body as FormData;
    expect(form.get('model')).toBe(GROQ_MODEL);
    expect(form.get('response_format')).toBe('verbose_json');
    expect(form.getAll('timestamp_granularities[]')).toEqual(['word', 'segment']);
    // Whisper takes the bare language.
    expect(form.get('language')).toBe('zh');
    expect(result).toEqual({
      language: 'en',
      sentences: [expect.objectContaining({ original: 'Hello there.', start: 0 })],
    });
  });

  it('drops words from a segment Whisper itself thinks is not speech', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(groqReply({
      segments: [
        { end: 2, no_speech_prob: 0.01, start: 0 },
        { end: 4, no_speech_prob: 0.9, start: 2 },
      ],
      words: words(['Real.', 0, 1], ['Thank', 2.5, 2.8], ['you.', 2.8, 3]),
    }));

    const { sentences } = await transcribeChunk(request, fetcher);

    expect(sentences.map((sentence) => sentence.original)).toEqual(['Real.']);
  });

  it.each([
    [401, '{}', 'invalid_credentials'],
    [429, '{"error":{"message":"Rate limit reached ... on requests per day (RPD): Limit 2000"}}', 'quota_exceeded'],
    [429, '{"error":{"message":"Rate limit reached ... on requests per minute (RPM): Limit 20"}}', 'rate_limited'],
    [503, '{}', 'provider_unavailable'],
  ] as const)('maps HTTP %i to %s', async (status, body, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status }));
    await expect(transcribeChunk(request, fetcher)).rejects.toMatchObject({ code });
  });

  it('gives up on a request that has not answered in time', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined));
      const result = transcribeChunk(request, fetcher).catch((caught: unknown) => caught);
      await vi.advanceTimersByTimeAsync(CHUNK_REQUEST_TIMEOUT_MS);
      expect(await result).toMatchObject({ code: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });
});
