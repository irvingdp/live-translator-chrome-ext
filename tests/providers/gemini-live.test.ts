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
    const updates = accumulator.ingest({
      original: 'Hello there',
      turnComplete: false,
    });

    expect(updates).toEqual([
      { id: 'turn-0#0', original: 'Hello there' },
    ]);
  });

  it('accumulates a turn sent as separate fragments', () => {
    const accumulator = new GeminiCaptionAccumulator();

    accumulator.ingest({ original: 'Hello', turnComplete: false });
    const updates = accumulator.ingest({
      original: ' there',
      turnComplete: false,
    });

    expect(updates).toEqual([
      { id: 'turn-0#0', original: 'Hello there' },
    ]);
  });

  it('replaces an overlapping tail revision instead of creating a phantom row', () => {
    const accumulator = new GeminiCaptionAccumulator();

    accumulator.ingest({
      original:
        'Every generation will have a desktop, a laptop, a workstation, and a desktop.',
      turnComplete: false,
    });
    const revised = accumulator.ingest({
      original: ' a laptop, and workstation.',
      turnComplete: false,
    });

    expect(revised).toEqual([{
      id: 'turn-0#0',
      original: 'Every generation will have a desktop, a laptop, and workstation.',
    }]);
    expect(revised.some((update) => update.id === 'turn-0#1')).toBe(false);
  });

  it('keeps later translations aligned after an overlapping source revision', () => {
    const accumulator = new GeminiCaptionAccumulator();
    accumulator.ingest({
      original:
        'Every generation will have a desktop, a laptop, a workstation, and a desktop.',
      turnComplete: false,
    });
    accumulator.ingest({
      translation: '每一代都會有桌面機、筆記型電腦和工作站。',
      turnComplete: false,
    });
    accumulator.ingest({
      original: ' a laptop, and workstation.',
      turnComplete: false,
    });
    accumulator.ingest({
      original: ' And the whole industry joined us.',
      turnComplete: false,
    });

    const translated = accumulator.ingest({
      translation: '而整個產業都加入了我們。',
      turnComplete: false,
    });

    expect(translated.at(-1)).toEqual({
      id: 'turn-0#1',
      translation: '而整個產業都加入了我們。',
    });
    expect(translated.some((update) => update.id === 'turn-0#2')).toBe(false);
  });

  it('keeps the last sentence editable until the following sentence arrives', () => {
    const accumulator = new GeminiCaptionAccumulator();

    expect(
      accumulator.ingest({ original: 'Hello.', turnComplete: false }),
    ).toEqual([{ id: 'turn-0#0', original: 'Hello.' }]);

    expect(
      accumulator.ingest({ original: 'Hello. Next', turnComplete: false }),
    ).toEqual([
      { id: 'turn-0#0', original: 'Hello.' },
      { id: 'turn-0#1', original: 'Next' },
    ]);
  });

  it('treats punctuation removal as a cumulative revision, not a fragment', () => {
    const accumulator = new GeminiCaptionAccumulator();

    accumulator.ingest({ original: 'Hello.', turnComplete: false });

    expect(
      accumulator.ingest({ original: 'Hello', turnComplete: false }),
    ).toEqual([{ id: 'turn-0#0', original: 'Hello' }]);
  });

  it('splits at sentence punctuation without turning visual wraps into rows', () => {
    const accumulator = new GeminiCaptionAccumulator(10);

    expect(
      accumulator.ingest({
        original: '第一句。第二句。abcdefghijk',
        turnComplete: false,
      }),
    ).toEqual([
      { id: 'turn-0#0', original: '第一句。' },
      { id: 'turn-0#1', original: '第二句。' },
      { id: 'turn-0#2', original: 'abcdefghijk' },
    ]);
  });

  it('keeps different-length source and target sentences on one bilingual row', () => {
    const accumulator = new GeminiCaptionAccumulator(10);

    expect(accumulator.ingest({
      original: 'This sentence is much wider than ten columns.',
      turnComplete: true,
    })).toEqual([{
      id: 'turn-0#0',
      original: 'This sentence is much wider than ten columns.',
    }]);

    expect(accumulator.ingest({
      translation: '這是一個比十個字寬更長的句子。',
      turnComplete: false,
    })).toEqual([{
      id: 'turn-0#0',
      translation: '這是一個比十個字寬更長的句子。',
    }]);
  });

  it('keeps a late translation on the row it belongs to', () => {
    const accumulator = new GeminiCaptionAccumulator();

    accumulator.ingest({ original: 'Hello', turnComplete: false });
    accumulator.ingest({ turnComplete: true });
    // The translation of the finished turn is still arriving; it must not open
    // a new row, or the row the viewer is reading never gets its translation.
    const late = accumulator.ingest({
      translation: '你好',
      turnComplete: false,
    });

    expect(late).toEqual([{ id: 'turn-0#0', translation: '你好' }]);
  });

  it('caches target-first text until its source row exists', () => {
    const accumulator = new GeminiCaptionAccumulator();

    expect(
      accumulator.ingest({ translation: '你好', turnComplete: false }),
    ).toEqual([]);
    expect(
      accumulator.ingest({ original: 'Hello', turnComplete: false }),
    ).toEqual([
      { id: 'turn-0#0', original: 'Hello', translation: '你好' },
    ]);
  });

  it('anchors a batch of new target sentences to the latest source row', () => {
    const accumulator = new GeminiCaptionAccumulator();

    accumulator.ingest({ original: 'One. Two.', turnComplete: true });
    const translated = accumulator.ingest({
      translation: '一。二。三。',
      turnComplete: false,
    });

    expect(translated).toEqual([
      { id: 'turn-0#1', translation: '一。二。三。' },
    ]);
  });

  it('recovers after an extra source row without shifting later translations', () => {
    const accumulator = new GeminiCaptionAccumulator();

    accumulator.ingest({ original: 'First sentence.', turnComplete: false });
    accumulator.ingest({ translation: '第一句。', turnComplete: false });
    accumulator.ingest({ original: ' Phantom fragment.', turnComplete: false });
    accumulator.ingest({ original: ' Second real sentence.', turnComplete: false });

    const second = accumulator.ingest({
      translation: '第二句。',
      turnComplete: false,
    });
    expect(second.at(-1)).toEqual({
      id: 'turn-0#2',
      translation: '第二句。',
    });

    accumulator.ingest({ original: ' Third real sentence.', turnComplete: false });
    const third = accumulator.ingest({
      translation: '第三句。',
      turnComplete: false,
    });
    expect(third.at(-1)).toEqual({
      id: 'turn-0#3',
      translation: '第三句。',
    });
    expect([...second, ...third].some((update) => update.id === 'turn-0#1'))
      .toBe(false);
  });

  it('keeps a target revision on its locked row after a newer source arrives', () => {
    const accumulator = new GeminiCaptionAccumulator();

    accumulator.ingest({ original: 'First.', turnComplete: false });
    accumulator.ingest({ translation: '第一。', turnComplete: false });
    accumulator.ingest({ original: ' Second.', turnComplete: false });
    accumulator.ingest({ translation: '第二', turnComplete: false });
    accumulator.ingest({ original: ' Third.', turnComplete: false });

    const revision = accumulator.ingest({
      translation: '句。',
      turnComplete: false,
    });

    expect(revision.at(-1)).toEqual({
      id: 'turn-0#1',
      translation: '第二句。',
    });
    expect(revision.some((update) => update.id === 'turn-0#2')).toBe(false);
  });

  it('opens a new row once the next utterance starts', () => {
    const accumulator = new GeminiCaptionAccumulator();

    accumulator.ingest({ original: 'Hello', translation: '你好', turnComplete: true });
    const next = accumulator.ingest({ original: 'Goodbye', turnComplete: false });

    expect(next.at(-1)).toEqual({
      id: 'turn-1#0',
      original: 'Goodbye',
    });
  });

  it('does not splice a resumed session onto the interrupted row', () => {
    const accumulator = new GeminiCaptionAccumulator();

    accumulator.ingest({ original: 'Hello', turnComplete: false });
    accumulator.closeTurn();
    const resumed = accumulator.ingest({ original: 'Goodbye', turnComplete: false });

    expect(resumed).toEqual([
      { id: 'turn-1#0', original: 'Goodbye' },
    ]);
  });

  describe('retention', () => {
    it('keeps cumulative and fragment updates aligned after a sentence is frozen', () => {
      const cumulative = new GeminiCaptionAccumulator(10);
      const fragments = new GeminiCaptionAccumulator(10);

      cumulative.ingest({ original: 'First sentence. second', turnComplete: false });
      fragments.ingest({ original: 'First sentence. second', turnComplete: false });

      expect(
        cumulative.ingest({
          original: 'First sentence. second grows',
          turnComplete: false,
        }),
      ).toEqual([{ id: 'turn-0#1', original: 'second grows' }]);
      expect(
        fragments.ingest({ original: ' grows', turnComplete: false }),
      ).toEqual([{ id: 'turn-0#1', original: 'second grows' }]);
    });

    it('restarts the offset with the next turn', () => {
      const accumulator = new GeminiCaptionAccumulator(10);

      accumulator.ingest({
        original: 'abcdefghijklmnopqrst',
        turnComplete: true,
      });
      const updates = accumulator.ingest({
        original: 'Fresh',
        turnComplete: false,
      });

      expect(updates.at(-1)).toEqual({
        id: 'turn-1#0',
        original: 'Fresh',
      });
    });
  });

  it('does not change semantic row identity when visual width changes', () => {
    const accumulator = new GeminiCaptionAccumulator(10);

    accumulator.ingest({ original: 'abcdefgh', turnComplete: false });
    accumulator.setMaxLineWidth(5);

    expect(
      accumulator.ingest({ original: 'abcdefghij', turnComplete: false }),
    ).toEqual([
      { id: 'turn-0#0', original: 'abcdefghij' },
    ]);
  });

  it('emits nothing for a turn boundary that carries no text', () => {
    const accumulator = new GeminiCaptionAccumulator();

    expect(accumulator.ingest({ turnComplete: true })).toEqual([]);
    expect(accumulator.ingest({ original: '', turnComplete: false })).toEqual([]);
  });
});
