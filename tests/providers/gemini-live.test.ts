import { describe, expect, it } from 'vitest';

import {
  buildGeminiSetupMessage,
  buildGeminiUrl,
  bytesToBase64,
  classifyGeminiClose,
  GEMINI_MODEL,
  GeminiCaptionAccumulator,
  parseGeminiMessage,
  readSocketFrame,
} from '../../src/providers/gemini-live';

describe('buildGeminiSetupMessage', () => {
  it('asks for both transcriptions and the requested target language', () => {
    const setup = JSON.parse(buildGeminiSetupMessage('zh-Hant')).setup;

    expect(setup.model).toBe(GEMINI_MODEL);
    // These two are what produce the source line and the translated line; the
    // feature is monolingual without them.
    expect(setup.inputAudioTranscription).toEqual({});
    expect(setup.outputAudioTranscription).toEqual({});
    expect(setup.generationConfig.translationConfig).toEqual({
      echoTargetLanguage: false,
      targetLanguageCode: 'zh-Hant',
    });
    expect(setup.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(setup.sessionResumption).toEqual({});
  });

  it('resumes the previous session when a handle is known', () => {
    const setup = JSON.parse(buildGeminiSetupMessage('ja', 'handle-1')).setup;

    expect(setup.sessionResumption).toEqual({ handle: 'handle-1' });
  });
});

describe('buildGeminiUrl', () => {
  it('escapes the key it has to smuggle through the query string', () => {
    expect(buildGeminiUrl('a b&c')).toContain('?key=a%20b%26c');
  });
});

describe('bytesToBase64', () => {
  it('encodes buffers past the fromCharCode argument limit', () => {
    const bytes = new Uint8Array(0x8000 * 2 + 5).fill(7);

    const encoded = bytesToBase64(bytes);

    expect(atob(encoded)).toHaveLength(bytes.length);
  });
});

describe('readSocketFrame', () => {
  // Chrome delivers this endpoint's JSON as Blobs, so a string-only handler
  // sees an empty conversation and blames it on the network.
  it('decodes every framing the endpoint can arrive in', async () => {
    const json = '{"setupComplete":{}}';

    await expect(readSocketFrame(json)).resolves.toBe(json);
    await expect(readSocketFrame(new Blob([json]))).resolves.toBe(json);
    await expect(
      readSocketFrame(new TextEncoder().encode(json).buffer),
    ).resolves.toBe(json);
    await expect(readSocketFrame(new TextEncoder().encode(json))).resolves.toBe(
      json,
    );
  });

  it('reports rather than guesses at a framing it does not know', async () => {
    await expect(readSocketFrame(42)).resolves.toBeUndefined();
  });
});

describe('classifyGeminiClose', () => {
  const base = { attempt: 0, code: 1006, maxAttempts: 3, reason: '' };

  it('backs off exponentially while attempts remain', () => {
    expect(classifyGeminiClose(base)).toEqual({ delayMs: 500, retry: true });
    expect(classifyGeminiClose({ ...base, attempt: 2 })).toEqual({
      delayMs: 2_000,
      retry: true,
    });
  });

  it('stops once the attempts are spent', () => {
    expect(classifyGeminiClose({ ...base, attempt: 3 })).toEqual({
      code: 'gemini_disconnected',
      retry: false,
    });
  });

  it.each([
    ['You exceeded your current quota', 'gemini_quota_exceeded'],
    ['API key not valid', 'gemini_invalid_credentials'],
    ['model not found', 'gemini_unavailable'],
  ])('never retries what the server will keep refusing: %s', (reason, code) => {
    expect(classifyGeminiClose({ ...base, reason })).toEqual({
      code,
      retry: false,
    });
  });

  it('reads the close code when the server sends no reason', () => {
    expect(classifyGeminiClose({ ...base, code: 4429 })).toEqual({
      code: 'gemini_quota_exceeded',
      retry: false,
    });
    expect(classifyGeminiClose({ ...base, code: 4401 })).toEqual({
      code: 'gemini_invalid_credentials',
      retry: false,
    });
  });
});

describe('parseGeminiMessage', () => {
  it('separates the source transcript from the translated one', () => {
    const events = parseGeminiMessage(
      JSON.stringify({
        serverContent: {
          inputTranscription: { text: 'Hello' },
          outputTranscription: { text: '你好' },
        },
      }),
    );

    expect(events).toEqual([
      { original: 'Hello', translation: '你好', turnComplete: false, type: 'serverContent' },
    ]);
  });

  it('ignores the translated audio it has no use for', () => {
    const events = parseGeminiMessage(
      JSON.stringify({
        serverContent: {
          modelTurn: { parts: [{ inlineData: { data: 'AAAA' } }] },
        },
      }),
    );

    expect(events).toEqual([]);
  });

  it('surfaces the lifecycle messages a long session depends on', () => {
    expect(
      parseGeminiMessage(
        JSON.stringify({ sessionResumptionUpdate: { newHandle: 'h1' } }),
      ),
    ).toEqual([{ handle: 'h1', type: 'resumption' }]);
    expect(parseGeminiMessage(JSON.stringify({ goAway: { timeLeft: '5s' } }))).toEqual([
      { type: 'goAway' },
    ]);
    expect(parseGeminiMessage(JSON.stringify({ setupComplete: {} }))).toEqual([
      { type: 'setupComplete' },
    ]);
  });

  it('survives a frame that is not JSON', () => {
    expect(parseGeminiMessage('<html>502</html>')).toEqual([]);
  });
});

describe('GeminiCaptionAccumulator', () => {
  it('accumulates a turn sent as growing cumulative text', () => {
    const accumulator = new GeminiCaptionAccumulator();

    accumulator.ingest({ original: 'Hello', turnComplete: false });
    const pair = accumulator.ingest({
      original: 'Hello there',
      turnComplete: false,
    });

    expect(pair).toEqual({
      original: 'Hello there',
      translation: '',
      turnId: 'turn-0',
    });
  });

  it('accumulates a turn sent as separate fragments', () => {
    const accumulator = new GeminiCaptionAccumulator();

    accumulator.ingest({ original: 'Hello', turnComplete: false });
    const pair = accumulator.ingest({ original: ' there', turnComplete: false });

    expect(pair?.original).toBe('Hello there');
  });

  it('keeps a late translation on the row it belongs to', () => {
    const accumulator = new GeminiCaptionAccumulator();

    accumulator.ingest({ original: 'Hello', turnComplete: false });
    accumulator.ingest({ turnComplete: true });
    // The translation of the finished turn is still arriving; it must not open
    // a new row, or the row the viewer is reading never gets its translation.
    const late = accumulator.ingest({ translation: '你好', turnComplete: false });

    expect(late).toEqual({
      original: 'Hello',
      translation: '你好',
      turnId: 'turn-0',
    });
  });

  it('opens a new row once the next utterance starts', () => {
    const accumulator = new GeminiCaptionAccumulator();

    accumulator.ingest({ original: 'Hello', translation: '你好', turnComplete: true });
    const next = accumulator.ingest({ original: 'Goodbye', turnComplete: false });

    expect(next).toEqual({
      original: 'Goodbye',
      translation: '',
      turnId: 'turn-1',
    });
  });

  it('does not splice a resumed session onto the interrupted row', () => {
    const accumulator = new GeminiCaptionAccumulator();

    accumulator.ingest({ original: 'Hello', turnComplete: false });
    accumulator.closeTurn();
    const resumed = accumulator.ingest({ original: 'Goodbye', turnComplete: false });

    expect(resumed).toEqual({
      original: 'Goodbye',
      translation: '',
      turnId: 'turn-1',
    });
  });

  // A turn stays open for as long as the speaker keeps talking, and the whole
  // row is re-sent to the tab on every update, so an uncapped turn becomes an
  // ever-larger message several times a second.
  describe('retention', () => {
    const long = (length: number, filler = 'a') => filler.repeat(length);

    it('keeps only the tail of a turn that never ends', () => {
      const accumulator = new GeminiCaptionAccumulator();

      const pair = accumulator.ingest({
        original: `${long(3_000)}TAIL`,
        turnComplete: false,
      });

      expect(pair?.original).toHaveLength(2_000);
      expect(pair?.original.endsWith('TAIL')).toBe(true);
    });

    it('keeps accumulating cumulative sends after the front is dropped', () => {
      const accumulator = new GeminiCaptionAccumulator();
      const first = long(2_500);

      accumulator.ingest({ original: first, turnComplete: false });
      const pair = accumulator.ingest({
        original: `${first} and then some`,
        turnComplete: false,
      });

      // Resent-in-full must still be recognised as the same text, not appended
      // to what was kept.
      expect(pair?.original).toHaveLength(2_000);
      expect(pair?.original.endsWith(' and then some')).toBe(true);
    });

    it('keeps accumulating incremental sends after the front is dropped', () => {
      const accumulator = new GeminiCaptionAccumulator();

      accumulator.ingest({ original: long(2_500), turnComplete: false });
      const pair = accumulator.ingest({ original: ' more', turnComplete: false });

      expect(pair?.original).toHaveLength(2_000);
      expect(pair?.original.endsWith('a more')).toBe(true);
    });

    it('restarts the offset with the next turn', () => {
      const accumulator = new GeminiCaptionAccumulator();

      accumulator.ingest({ original: long(2_500), turnComplete: true });
      const pair = accumulator.ingest({ original: 'Fresh', turnComplete: false });

      expect(pair).toEqual({
        original: 'Fresh',
        translation: '',
        turnId: 'turn-1',
      });
    });
  });

  it('emits nothing for a turn boundary that carries no text', () => {
    const accumulator = new GeminiCaptionAccumulator();

    expect(accumulator.ingest({ turnComplete: true })).toBeUndefined();
    expect(accumulator.ingest({ original: '', turnComplete: false })).toBeUndefined();
  });
});
