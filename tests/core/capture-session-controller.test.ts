import { describe, expect, it, vi } from 'vitest';

import {
  CaptureSessionController,
  type CaptureSessionDependencies,
  type SessionSettings,
  type TabMessage,
  whisperPrompt,
} from '../../src/core/capture-session-controller';
import { ChunkTranslationError } from '../../src/read-ahead/gemini-chunk-translation';

const settings: SessionSettings = {
  backgroundOpacity: 78,
  geminiApiKey: 'gemini-key',
  geminiSourceLanguage: 'auto',
  geminiTargetLanguage: 'zh-Hant',
  groqApiKey: 'groq-key',
  localWhisperModel: 'turbo',
  preferCaptionTracks: true,
  wordHighlight: true,
  maxLineWidth: 90,
  readAheadRecognizer: 'gemini',
  transcriber: 'gemini',
  originalFontSize: 24,
  originalTextColor: '#ffffff',
  translationFontSize: 22,
  translationTextColor: '#fde68a',
};

function createHarness() {
  const dependencies: CaptureSessionDependencies = {
    ensureContentScript: vi.fn().mockResolvedValue(undefined),
    ensureOffscreen: vi.fn().mockResolvedValue(undefined),
    getStreamId: vi.fn().mockResolvedValue('stream-id'),
    getOverlayLayout: vi.fn().mockResolvedValue(undefined),
    sendToOffscreen: vi.fn().mockResolvedValue(undefined),
    sendToTab: vi.fn().mockResolvedValue(undefined),
    startReadAhead: vi.fn().mockResolvedValue(undefined),
    stopReadAhead: vi.fn().mockResolvedValue(undefined),
    translateChunk: vi.fn().mockResolvedValue([]),
    transcribeChunk: vi.fn().mockResolvedValue({ sentences: [] }),
    translateOnWeb: vi.fn().mockResolvedValue([]),
  };
  return {
    controller: new CaptureSessionController(dependencies),
    dependencies,
  };
}

async function startSession(
  harness: ReturnType<typeof createHarness>,
  overrides: Partial<SessionSettings> = {},
): Promise<string> {
  await harness.controller.start(42, { ...settings, ...overrides });
  const startMessage = vi
    .mocked(harness.dependencies.sendToOffscreen)
    .mock.calls.map(([message]) => message)
    .find((message) => message.type === 'CAPTURE_START');
  if (startMessage?.type !== 'CAPTURE_START') throw new Error('missing start');
  vi.mocked(harness.dependencies.sendToTab).mockClear();
  return startMessage.payload.sessionId;
}

function windowsSentTo(harness: ReturnType<typeof createHarness>) {
  return vi
    .mocked(harness.dependencies.sendToTab)
    .mock.calls.map(([, message]) => message)
    .filter(
      (message): message is Extract<TabMessage, { type: 'CAPTION_WINDOW' }> =>
        message.type === 'CAPTION_WINDOW',
    );
}

describe('CaptureSessionController', () => {
  it('ensures the target tab receiver exists immediately before starting capture', async () => {
    const { controller, dependencies } = createHarness();

    await controller.start(42, settings);

    expect(dependencies.ensureContentScript).toHaveBeenCalledWith(42);
    const receiverOrder = vi.mocked(dependencies.ensureContentScript).mock
      .invocationCallOrder[0]!;
    expect(
      vi.mocked(dependencies.getStreamId).mock.invocationCallOrder[0],
    ).toBeLessThan(receiverOrder);
    expect(receiverOrder).toBeLessThan(
      vi.mocked(dependencies.sendToOffscreen).mock.invocationCallOrder[0]!,
    );
  });

  it('starts Gemini live in one tab only after offscreen and stream setup succeed', async () => {
    const { controller, dependencies } = createHarness();

    await controller.start(42, settings);

    expect(dependencies.ensureOffscreen).toHaveBeenCalledOnce();
    expect(dependencies.getStreamId).toHaveBeenCalledWith(42);
    expect(dependencies.sendToOffscreen).toHaveBeenCalledWith({
      target: 'offscreen',
      type: 'CAPTURE_START',
      payload: {
        apiKey: 'gemini-key',
        maxLineWidth: 90,
        sessionId: expect.any(String),
        streamId: 'stream-id',
        targetLanguage: 'zh-Hant',
      },
    });
    expect(dependencies.sendToTab).toHaveBeenCalledWith(42, {
      type: 'OVERLAY_SHOW',
      payload: {
        appearance: expect.objectContaining({
          backgroundOpacity: settings.backgroundOpacity,
        }),
        layout: undefined,
        placement: 'video-bottom',
      },
    });
    expect(controller.status()).toEqual({ state: 'running', tabId: 42 });
  });

  it('preflights a transfer before stopping the current tab', async () => {
    const harness = createHarness();
    const { controller, dependencies } = harness;
    await startSession(harness);
    vi.mocked(dependencies.sendToOffscreen).mockClear();
    vi.mocked(dependencies.ensureContentScript).mockRejectedValueOnce(
      new Error('tab access revoked'),
    );

    await expect(controller.transfer(43)).rejects.toThrow('tab access revoked');

    expect(controller.status()).toEqual({ state: 'running', tabId: 42 });
    expect(dependencies.sendToOffscreen).not.toHaveBeenCalled();
    expect(dependencies.sendToTab).not.toHaveBeenCalledWith(42, {
      type: 'OVERLAY_HIDE',
    });
  });

  it('replaces the active capture with a fresh session on an authorized tab', async () => {
    const harness = createHarness();
    const { controller, dependencies } = harness;
    vi.mocked(dependencies.getStreamId).mockImplementation(
      async (tabId) => `stream-${tabId}`,
    );
    await startSession(harness);
    vi.mocked(dependencies.sendToOffscreen).mockClear();
    vi.mocked(dependencies.sendToTab).mockClear();

    await controller.transfer(43);

    expect(dependencies.ensureContentScript).toHaveBeenCalledWith(43);
    expect(dependencies.getStreamId).toHaveBeenLastCalledWith(43);
    expect(dependencies.sendToOffscreen).toHaveBeenNthCalledWith(1, {
      target: 'offscreen',
      type: 'CAPTURE_STOP',
      payload: { sessionId: expect.any(String) },
    });
    expect(dependencies.sendToOffscreen).toHaveBeenNthCalledWith(2, {
      target: 'offscreen',
      type: 'CAPTURE_START',
      payload: expect.objectContaining({
        sessionId: expect.any(String),
        streamId: 'stream-43',
      }),
    });
    expect(dependencies.sendToTab).toHaveBeenCalledWith(42, {
      type: 'OVERLAY_HIDE',
    });
    expect(dependencies.sendToTab).toHaveBeenCalledWith(43, {
      type: 'OVERLAY_SHOW',
      payload: expect.objectContaining({ placement: 'video-bottom' }),
    });
    expect(controller.status()).toEqual({ state: 'running', tabId: 43 });
  });

  it('replays the current window when the content script reports ready', async () => {
    const harness = createHarness();
    const sessionId = await startSession(harness);
    await harness.controller.acceptCaptionPairs(sessionId, [
      { id: 'turn-0#0', original: 'Hello there.', translation: '你好。' },
    ]);
    vi.mocked(harness.dependencies.sendToTab).mockClear();

    await harness.controller.handleContentReady(42);

    const types = vi
      .mocked(harness.dependencies.sendToTab)
      .mock.calls.map(([, message]) => message.type);
    expect(types).toContain('OVERLAY_SHOW');
    expect(windowsSentTo(harness).at(-1)!.payload.pairs).toEqual([
      { id: 'turn-0#0', original: 'Hello there.', translation: '你好。' },
    ]);
  });

  it('starts the next session, and a restored one, with an empty window', async () => {
    const harness = createHarness();
    const first = await startSession(harness);
    await harness.controller.acceptCaptionPairs(first, [
      { id: 'turn-0#0', original: 'Old.', translation: '舊。' },
    ]);
    await harness.controller.stop();
    vi.mocked(harness.dependencies.sendToOffscreen).mockClear();
    const second = await startSession(harness);
    await harness.controller.acceptCaptionPairs(second, [
      { id: 'turn-0#1', original: 'New.', translation: '新。' },
    ]);
    expect(windowsSentTo(harness).at(-1)!.payload.pairs).toEqual([
      { id: 'turn-0#1', original: 'New.', translation: '新。' },
    ]);

    harness.controller.restore({ sessionId: 'restored', settings, tabId: 42 });
    vi.mocked(harness.dependencies.sendToTab).mockClear();
    await harness.controller.acceptCaptionPairs('restored', [
      { id: 'turn-0#2', original: 'Again.', translation: '再。' },
    ]);
    expect(windowsSentTo(harness).at(-1)!.payload.pairs).toEqual([
      { id: 'turn-0#2', original: 'Again.', translation: '再。' },
    ]);
  });

  it('stops capture and removes the overlay even when offscreen stop fails', async () => {
    const { controller, dependencies } = createHarness();
    await controller.start(42, settings);
    vi.mocked(dependencies.sendToOffscreen).mockRejectedValueOnce(
      new Error('already disconnected'),
    );

    await controller.stop();

    expect(dependencies.sendToTab).toHaveBeenLastCalledWith(42, {
      type: 'OVERLAY_HIDE',
    });
    expect(controller.status()).toEqual({ state: 'idle' });
  });

  it('marks the session as errored after an unexpected disconnect', async () => {
    const { controller, dependencies } = createHarness();
    await controller.start(42, settings);
    const startMessage = vi.mocked(dependencies.sendToOffscreen).mock.calls[0]![0];
    if (startMessage.type !== 'CAPTURE_START') throw new Error('missing start');

    await controller.handleDisconnect(startMessage.payload.sessionId);

    expect(dependencies.sendToTab).toHaveBeenLastCalledWith(42, {
      type: 'SESSION_ERROR',
      payload: { code: 'gemini_disconnected' },
    });
    expect(controller.status()).toEqual({
      error: 'gemini_disconnected',
      state: 'error',
      tabId: 42,
    });
  });

  it('reports the reason a provider gave for dropping out', async () => {
    const { controller, dependencies } = createHarness();
    await controller.start(42, settings);
    const startMessage = vi.mocked(dependencies.sendToOffscreen).mock.calls[0]![0];
    if (startMessage.type !== 'CAPTURE_START') throw new Error('missing start');

    await controller.handleDisconnect(
      startMessage.payload.sessionId,
      'gemini_quota_exceeded',
    );

    expect(dependencies.sendToTab).toHaveBeenLastCalledWith(42, {
      type: 'SESSION_ERROR',
      payload: { code: 'gemini_quota_exceeded' },
    });
  });

  it('renders a row Gemini already translated', async () => {
    const harness = createHarness();
    const sessionId = await startSession(harness);

    await harness.controller.acceptCaptionPairs(sessionId, [{
      id: 'turn-0#0',
      original: 'Hello there',
      translation: '你好',
    }]);

    expect(windowsSentTo(harness).at(-1)?.payload.pairs).toEqual([
      { id: 'turn-0#0', original: 'Hello there', translation: '你好' },
    ]);
  });

  it('applies a sentence batch in one render and never resurrects an old row', async () => {
    const harness = createHarness();
    const sessionId = await startSession(harness);

    await harness.controller.acceptCaptionPairs(sessionId, [
      { id: 'turn-0#0', original: 'One.', translation: '一。' },
      { id: 'turn-0#1', original: 'Two.', translation: '二。' },
    ]);

    expect(windowsSentTo(harness)).toHaveLength(1);
    expect(windowsSentTo(harness)[0]!.payload.pairs).toHaveLength(2);

    vi.mocked(harness.dependencies.sendToTab).mockClear();
    await harness.controller.acceptCaptionPairs(sessionId, [
      { id: 'turn-0#0', translation: '遲到的一。' },
    ]);

    expect(windowsSentTo(harness)[0]!.payload.pairs[0]).toMatchObject({
      id: 'turn-0#0',
      translation: '遲到的一。',
    });
  });

  it('forwards a live maximum-width change to the active Gemini session', async () => {
    const harness = createHarness();
    await startSession(harness);
    vi.mocked(harness.dependencies.sendToOffscreen).mockClear();

    harness.controller.applyLayout({
      maxLineWidth: 60,
    });

    expect(harness.dependencies.sendToOffscreen).toHaveBeenCalledWith({
      target: 'offscreen',
      type: 'CAPTURE_CONFIG_UPDATE',
      payload: { maxLineWidth: 60, sessionId: expect.any(String) },
    });
  });

  it('grows a row in place and rolls the window on at the next turn', async () => {
    const harness = createHarness();
    const sessionId = await startSession(harness);

    await harness.controller.acceptCaptionPairs(sessionId, [{
      id: 'turn-0#0',
      original: 'Hello',
    }]);
    await harness.controller.acceptCaptionPairs(sessionId, [{
      id: 'turn-0#0',
      original: 'Hello there',
      translation: '你好',
    }]);
    await harness.controller.acceptCaptionPairs(sessionId, [{
      id: 'turn-1#0',
      original: 'Goodbye',
      translation: '再見',
    }]);

    const windows = windowsSentTo(harness);
    expect(windows[1]?.payload.pairs).toEqual([
      { id: 'turn-0#0', original: 'Hello there', translation: '你好' },
    ]);
    expect(windows.at(-1)?.payload.pairs).toEqual([
      { id: 'turn-0#0', original: 'Hello there', translation: '你好' },
      { id: 'turn-1#0', original: 'Goodbye', translation: '再見' },
    ]);
  });

  it('ignores caption rows from a session that is no longer running', async () => {
    const harness = createHarness();
    const sessionId = await startSession(harness);
    await harness.controller.stop();
    vi.mocked(harness.dependencies.sendToTab).mockClear();

    await harness.controller.acceptCaptionPairs(sessionId, [{
      id: 'turn-0#0',
      original: 'Hello',
      translation: '你好',
    }]);

    expect(windowsSentTo(harness)).toHaveLength(0);
  });

  it('rolls back offscreen capture when the target page cannot host captions', async () => {
    const { controller, dependencies } = createHarness();
    vi.mocked(dependencies.sendToTab).mockRejectedValueOnce(
      new Error('content script unavailable'),
    );

    await expect(controller.start(42, settings)).rejects.toThrow(
      'content script unavailable',
    );

    expect(dependencies.sendToOffscreen).toHaveBeenLastCalledWith({
      target: 'offscreen',
      type: 'CAPTURE_STOP',
      payload: { sessionId: expect.any(String) },
    });
  });

  it('cancels a start that is waiting for the tab stream ID', async () => {
    const { controller, dependencies } = createHarness();
    let releaseStream!: (streamId: string) => void;
    vi.mocked(dependencies.getStreamId).mockReturnValueOnce(
      new Promise((resolve) => {
        releaseStream = resolve;
      }),
    );

    const starting = controller.start(42, settings);
    await vi.waitFor(() => expect(dependencies.getStreamId).toHaveBeenCalled());
    const stopping = controller.stop();
    releaseStream('stream-id');
    await Promise.all([starting, stopping]);

    expect(dependencies.sendToOffscreen).toHaveBeenLastCalledWith({
      target: 'offscreen',
      type: 'CAPTURE_STOP',
      payload: { sessionId: expect.any(String) },
    });
    expect(controller.status()).toEqual({ state: 'idle' });
  });

  it('lets stop complete while offscreen start is still pending', async () => {
    const { controller, dependencies } = createHarness();
    let releaseStart!: () => void;
    vi.mocked(dependencies.sendToOffscreen).mockImplementation((message) =>
      message.type === 'CAPTURE_START'
        ? new Promise<void>((resolve) => { releaseStart = resolve; })
        : Promise.resolve(),
    );
    const starting = controller.start(42, settings);
    await vi.waitFor(() => {
      expect(dependencies.sendToOffscreen).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'CAPTURE_START' }),
      );
    });

    await controller.stop();

    expect(controller.status()).toEqual({ state: 'idle' });
    expect(dependencies.sendToOffscreen).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CAPTURE_STOP' }),
    );
    releaseStart();
    await starting;
  });

  it('ignores caption rows and disconnects from an older session', async () => {
    const { controller, dependencies } = createHarness();
    await controller.start(42, settings);
    const firstStart = vi.mocked(dependencies.sendToOffscreen).mock.calls[0]![0];
    if (firstStart.type !== 'CAPTURE_START') throw new Error('missing start');
    await controller.start(43, settings);
    vi.mocked(dependencies.sendToTab).mockClear();

    await controller.acceptCaptionPairs(firstStart.payload.sessionId, [
      { id: 'old#0', original: 'stale', translation: '舊' },
    ]);
    await controller.handleDisconnect(firstStart.payload.sessionId);

    expect(dependencies.sendToTab).not.toHaveBeenCalled();
    expect(controller.status()).toEqual({ state: 'running', tabId: 43 });
  });

  it('restores the overlay when the content script becomes ready after navigation', async () => {
    const { controller, dependencies } = createHarness();
    controller.restore({ sessionId: 'restored', settings, tabId: 42 });

    await controller.handleContentReady(42);

    expect(dependencies.sendToTab).toHaveBeenCalledWith(42, {
      type: 'OVERLAY_SHOW',
      payload: {
        appearance: expect.objectContaining({
          backgroundOpacity: settings.backgroundOpacity,
        }),
        layout: undefined,
      },
    });
  });
});

describe('CaptureSessionController read-ahead mode', () => {
  const readAhead = { geminiSourceLanguage: 'auto', transcriber: 'gemini-read-ahead' } as const;

  async function startReadAhead(
    harness: ReturnType<typeof createHarness>,
    overrides: Partial<SessionSettings> = {},
  ): Promise<string> {
    await harness.controller.start(42, { ...settings, ...readAhead, ...overrides });
    const [, request] = vi.mocked(harness.dependencies.startReadAhead).mock.calls.at(-1)!;
    vi.mocked(harness.dependencies.sendToTab).mockClear();
    return request.sessionId;
  }

  it('starts in the tab without capturing tab audio, leaving the source to the model by default', async () => {
    const harness = createHarness();
    await startReadAhead(harness);

    expect(harness.dependencies.ensureOffscreen).not.toHaveBeenCalled();
    expect(harness.dependencies.getStreamId).not.toHaveBeenCalled();
    expect(harness.dependencies.sendToOffscreen).not.toHaveBeenCalled();
    expect(harness.dependencies.startReadAhead).toHaveBeenCalledWith(42, {
      preferCaptionTracks: true,
      sessionId: expect.any(String),
      targetLanguage: 'zh-Hant',
    });
    expect(harness.controller.status()).toEqual({ state: 'running', tabId: 42 });
  });

  it('passes a chosen source language to the tab and to each chunk request with the shared key', async () => {
    const harness = createHarness();
    const sessionId = await startReadAhead(harness, { geminiSourceLanguage: 'ja' });
    expect(vi.mocked(harness.dependencies.startReadAhead).mock.calls[0]![1].sourceLanguage).toBe('ja');

    await harness.controller.translateReadAheadChunk(sessionId, 42, 'UklGRg==');
    expect(harness.dependencies.translateChunk).toHaveBeenCalledWith({
      apiKey: 'gemini-key',
      audioBase64: 'UklGRg==',
      sourceLanguage: 'ja',
      targetLanguage: 'zh-Hant',
    });
  });

  it('refuses chunk translations from another session or tab', async () => {
    const harness = createHarness();
    const sessionId = await startReadAhead(harness);
    await expect(harness.controller.translateReadAheadChunk('other', 42, 'x')).rejects.toThrow();
    await expect(harness.controller.translateReadAheadChunk(sessionId, 7, 'x')).rejects.toThrow();
    expect(harness.dependencies.translateChunk).not.toHaveBeenCalled();
  });

  describe('with Groq Whisper', () => {
    const groq = { readAheadRecognizer: 'groq' } as const;
    const heard = (...originals: string[]) => ({
      language: 'en',
      sentences: originals.map((original, index) => ({
        cut: false, end: index + 1, original, sameLanguage: false, start: index, translation: '',
      })),
    });

    it("hands the page what Groq heard to translate with Chrome's built-in Translator", async () => {
      const harness = createHarness();
      const sessionId = await startReadAhead(harness, groq);
      vi.mocked(harness.dependencies.transcribeChunk).mockResolvedValue(heard('Hello.'));

      await expect(harness.controller.translateReadAheadChunk(sessionId, 42, 'wav')).resolves.toEqual({
        sentences: [expect.objectContaining({ original: 'Hello.', translation: '' })],
        translateInPage: { sourceLanguage: 'en', targetLanguage: 'zh-Hant' },
      });
      expect(harness.dependencies.transcribeChunk).toHaveBeenCalledWith({
        apiKey: 'groq-key',
        audioBase64: 'wav',
        provider: 'groq',
      });
      expect(harness.dependencies.translateChunk).not.toHaveBeenCalled();
    });

    it('steers Whisper to Traditional Chinese only for speech set as Traditional Chinese', async () => {
      const harness = createHarness();
      const sessionId = await startReadAhead(harness, { ...groq, geminiSourceLanguage: 'zh-HK' });
      vi.mocked(harness.dependencies.transcribeChunk).mockResolvedValue(heard('你好。'));
      await harness.controller.translateReadAheadChunk(sessionId, 42, 'wav');
      expect(harness.dependencies.transcribeChunk).toHaveBeenCalledWith(expect.objectContaining({
        prompt: '以下是繁體中文的句子。',
        sourceLanguage: 'zh-HK',
      }));
      expect(whisperPrompt('en')).toBeUndefined();
      expect(whisperPrompt(undefined)).toBeUndefined();
      expect(whisperPrompt('zh-Hans')).toBeUndefined();
    });

    it('recognizes with Local Whisper on this computer, offering Groq when it is too slow', async () => {
      const harness = createHarness();
      const sessionId = await startReadAhead(harness, { localWhisperModel: 'small', readAheadRecognizer: 'local' });
      vi.mocked(harness.dependencies.transcribeChunk).mockResolvedValue({ sentences: heard('Hello.').sentences });

      await expect(harness.controller.translateReadAheadChunk(sessionId, 42, 'wav')).resolves.toMatchObject({
        translateInPage: { targetLanguage: 'zh-Hant' },
      });
      expect(harness.dependencies.transcribeChunk).toHaveBeenCalledWith({
        audioBase64: 'wav',
        model: 'small',
        provider: 'local',
      });

      vi.mocked(harness.dependencies.transcribeChunk).mockRejectedValue(new ChunkTranslationError('timeout'));
      await expect(harness.controller.translateReadAheadChunk(sessionId, 42, 'wav'))
        .rejects.toMatchObject({ code: 'local_timeout' });
      vi.mocked(harness.dependencies.sendToTab).mockClear();
      await harness.controller.acceptReadAheadStatus(sessionId, 42, 'local_timeout');
      expect(harness.dependencies.sendToTab).toHaveBeenCalledWith(42, {
        type: 'SESSION_ERROR',
        payload: { action: 'switch_to_groq', code: 'local_timeout' },
      });
    });

    it('leaves speech already in the target language untranslated', async () => {
      const harness = createHarness();
      const sessionId = await startReadAhead(harness, { ...groq, geminiTargetLanguage: 'en' });
      vi.mocked(harness.dependencies.transcribeChunk).mockResolvedValue(heard('Hello.'));

      const { sentences, translateInPage } = await harness.controller.translateReadAheadChunk(sessionId, 42, 'wav');

      expect(sentences[0]).toMatchObject({ sameLanguage: true, translation: '' });
      expect(translateInPage).toBeUndefined();
    });

    it('names the provider whose quota ran out', async () => {
      const harness = createHarness();
      const sessionId = await startReadAhead(harness, groq);
      vi.mocked(harness.dependencies.transcribeChunk)
        .mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'quota_exceeded' }));
      await expect(harness.controller.translateReadAheadChunk(sessionId, 42, 'wav'))
        .rejects.toMatchObject({ code: 'groq_quota_exceeded' });
    });

    it("translates the page's fallback sentences on the web, only for the active session's tab", async () => {
      const harness = createHarness();
      const sessionId = await startReadAhead(harness, groq);
      vi.mocked(harness.dependencies.translateOnWeb).mockResolvedValue(['你好。']);
      const texts = { sourceLanguage: 'en', targetLanguage: 'zh-Hant', texts: ['Hello.'] };

      await expect(harness.controller.translateReadAheadTexts(sessionId, 42, texts, 5_000))
        .resolves.toEqual(['你好。']);
      expect(harness.dependencies.translateOnWeb).toHaveBeenCalledWith(texts, 5_000);
      await expect(harness.controller.translateReadAheadTexts(sessionId, 7, texts, 5_000)).rejects.toThrow();
      await expect(harness.controller.translateReadAheadTexts('other', 42, texts, 5_000)).rejects.toThrow();
    });

    it('tags a Gemini failure as Gemini', async () => {
      const harness = createHarness();
      const sessionId = await startReadAhead(harness);
      vi.mocked(harness.dependencies.translateChunk)
        .mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'quota_exceeded' }));
      await expect(harness.controller.translateReadAheadChunk(sessionId, 42, 'wav'))
        .rejects.toMatchObject({ code: 'gemini_quota_exceeded' });
    });

    it('offers no switch to Groq when Groq is already doing the recognizing', async () => {
      const harness = createHarness();
      const sessionId = await startReadAhead(harness, groq);
      await harness.controller.acceptReadAheadStatus(sessionId, 42, 'gemini_quota_exceeded');
      expect(harness.dependencies.sendToTab).toHaveBeenLastCalledWith(42, {
        type: 'SESSION_ERROR',
        payload: { code: 'gemini_quota_exceeded' },
      });
    });
  });

  it('shows only the current cue on the page but keeps every reached cue for the side panel', async () => {
    const harness = createHarness();
    const sessionId = await startReadAhead(harness);

    await harness.controller.acceptReadAheadCue(sessionId, 42, { id: 'c1', original: 'One.', translation: '一。' });
    await harness.controller.acceptReadAheadCue(sessionId, 42, { id: 'c2', original: 'Two.', translation: '二。' });
    await harness.controller.acceptReadAheadCue(sessionId, 42, undefined);

    expect(windowsSentTo(harness).map((message) => message.payload.pairs)).toEqual([
      [{ id: 'c1', original: 'One.', translation: '一。' }],
      [{ id: 'c2', original: 'Two.', translation: '二。' }],
      [],
    ]);
    expect(harness.controller.captionPairs().map((pair) => pair.id)).toEqual(['c1', 'c2']);
  });

  it('shows hold and failure statuses on the overlay and clears them', async () => {
    const harness = createHarness();
    const sessionId = await startReadAhead(harness);

    await harness.controller.acceptReadAheadStatus(sessionId, 42, 'loading');
    await harness.controller.acceptReadAheadStatus(sessionId, 42, 'failed');
    await harness.controller.acceptReadAheadStatus(sessionId, 42, 'gemini_quota_exceeded');
    await harness.controller.acceptReadAheadStatus(sessionId, 42, 'groq_quota_exceeded');
    await harness.controller.acceptReadAheadStatus(sessionId, 42, 'translator_unsupported');
    await harness.controller.acceptReadAheadStatus(sessionId, 42, undefined);

    expect(vi.mocked(harness.dependencies.sendToTab).mock.calls.map(([, message]) => message)).toEqual([
      { type: 'SESSION_ERROR', payload: { code: 'read_ahead_loading' } },
      { type: 'SESSION_ERROR', payload: { code: 'read_ahead_failed' } },
      // A used-up Gemini quota offers the switch to Groq Whisper.
      { type: 'SESSION_ERROR', payload: { action: 'switch_to_groq', code: 'gemini_quota_exceeded' } },
      { type: 'SESSION_ERROR', payload: { code: 'groq_quota_exceeded' } },
      { type: 'SESSION_ERROR', payload: { code: 'read_ahead_translator_unsupported' } },
      { type: 'SESSION_ERROR_CLEAR' },
    ]);
    expect(harness.controller.status()).toEqual({ state: 'running', tabId: 42 });
  });

  it("keeps a provider's failure reason, and offers the next recognizer only where another service helps", async () => {
    const harness = createHarness();
    const sessionId = await startReadAhead(harness);

    await harness.controller.acceptReadAheadStatus(sessionId, 42, 'gemini_rate_limited');
    await harness.controller.acceptReadAheadStatus(sessionId, 42, 'gemini_timeout');
    await harness.controller.acceptReadAheadStatus(sessionId, 42, 'gemini_invalid_credentials');
    await harness.controller.acceptReadAheadStatus(sessionId, 42, 'page_timeout');
    await harness.controller.acceptReadAheadStatus(sessionId, 42, 'web_translation_failed');

    expect(vi.mocked(harness.dependencies.sendToTab).mock.calls.map(([, message]) => message)).toEqual([
      { type: 'SESSION_ERROR', payload: { action: 'switch_to_groq', code: 'gemini_rate_limited' } },
      { type: 'SESSION_ERROR', payload: { action: 'switch_to_groq', code: 'gemini_timeout' } },
      // Another service does not fix a wrong key.
      { type: 'SESSION_ERROR', payload: { code: 'gemini_invalid_credentials' } },
      { type: 'SESSION_ERROR', payload: { code: 'read_ahead_page_timeout' } },
      { type: 'SESSION_ERROR', payload: { code: 'read_ahead_web_translation_failed' } },
    ]);
  });

  it('offers Local Whisper when Groq cannot serve, only where this computer can run it', async () => {
    const harness = createHarness();
    harness.dependencies.localWhisperUsable = vi.fn().mockResolvedValue(true);
    const sessionId = await startReadAhead(harness, { readAheadRecognizer: 'groq' });
    await harness.controller.acceptReadAheadStatus(sessionId, 42, 'groq_timeout');
    await harness.controller.acceptReadAheadStatus(sessionId, 42, 'groq_rate_limited');
    await harness.controller.acceptReadAheadStatus(sessionId, 42, 'groq_invalid_credentials');

    const noGpu = createHarness();
    noGpu.dependencies.localWhisperUsable = vi.fn().mockResolvedValue(false);
    const other = await startReadAhead(noGpu, { readAheadRecognizer: 'groq' });
    await noGpu.controller.acceptReadAheadStatus(other, 42, 'groq_timeout');

    expect(vi.mocked(harness.dependencies.sendToTab).mock.calls.map(([, message]) => message)).toEqual([
      { type: 'SESSION_ERROR', payload: { action: 'switch_to_local', code: 'groq_timeout' } },
      { type: 'SESSION_ERROR', payload: { action: 'switch_to_local', code: 'groq_rate_limited' } },
      { type: 'SESSION_ERROR', payload: { code: 'groq_invalid_credentials' } },
    ]);
    expect(vi.mocked(noGpu.dependencies.sendToTab).mock.calls.map(([, message]) => message)).toEqual([
      { type: 'SESSION_ERROR', payload: { code: 'groq_timeout' } },
    ]);
  });

  it('passes the words of a cue to the overlay only with word highlight on', async () => {
    const cue = { id: 'c1', original: 'Hi there.', translation: '嗨。', words: [{ end: 1, start: 0, text: 'Hi' }] };
    const on = createHarness();
    const onSession = await startReadAhead(on);
    await on.controller.acceptReadAheadCue(onSession, 42, cue);
    expect(on.dependencies.sendToTab).toHaveBeenLastCalledWith(42, { type: 'CAPTION_WINDOW', payload: { pairs: [cue] } });

    const off = createHarness();
    const offSession = await startReadAhead(off, { wordHighlight: false });
    await off.controller.acceptReadAheadCue(offSession, 42, cue);
    expect(off.dependencies.sendToTab).toHaveBeenLastCalledWith(42, {
      type: 'CAPTION_WINDOW',
      payload: { pairs: [{ id: 'c1', original: 'Hi there.', translation: '嗨。' }] },
    });
  });

  it('keeps the words in the side panel history and the playback clock, only with word highlight on', async () => {
    const cue = { id: 'c1', original: 'Hi there.', translation: '嗨。', words: [{ end: 1, start: 0, text: 'Hi' }] };
    const clock = { at: 1_000, paused: false, rate: 1, time: 12 };
    const on = createHarness();
    const onSession = await startReadAhead(on);
    await on.controller.acceptReadAheadCue(onSession, 42, cue);
    on.controller.acceptReadAheadClock(onSession, 42, clock);
    expect(on.controller.captionPairs()).toEqual([cue]);
    expect(on.controller.playbackClock()).toEqual(clock);
    // Another session's clock is ignored.
    on.controller.acceptReadAheadClock('other', 42, { ...clock, time: 99 });
    expect(on.controller.playbackClock()).toEqual(clock);

    const off = createHarness();
    const offSession = await startReadAhead(off, { wordHighlight: false });
    await off.controller.acceptReadAheadCue(offSession, 42, cue);
    off.controller.acceptReadAheadClock(offSession, 42, clock);
    expect(off.controller.captionPairs()[0]!.words).toBeUndefined();
    expect(off.controller.playbackClock()).toBeUndefined();
  });

  it('says a caption track has no word highlight, offering speech recognition, only with highlighting on', async () => {
    const on = createHarness();
    const onSession = await startReadAhead(on);
    await on.controller.acceptReadAheadStatus(onSession, 42, 'captions_youtube');
    expect(on.dependencies.sendToTab).toHaveBeenLastCalledWith(42, {
      type: 'SESSION_ERROR',
      payload: { action: 'use_recognizer', code: 'read_ahead_captions_youtube_no_highlight' },
    });

    const off = createHarness();
    const offSession = await startReadAhead(off, { wordHighlight: false });
    await off.controller.acceptReadAheadStatus(offSession, 42, 'captions_youtube');
    expect(off.dependencies.sendToTab).toHaveBeenLastCalledWith(42, {
      type: 'SESSION_ERROR',
      payload: { code: 'read_ahead_captions_youtube' },
    });
    // The viewer's caption-track choice goes to the page.
    const skip = createHarness();
    await startReadAhead(skip, { preferCaptionTracks: false });
    expect(vi.mocked(skip.dependencies.startReadAhead).mock.calls.at(-1)![1]).toMatchObject({ preferCaptionTracks: false });
  });

  it('reports an unsupported page as an error the popup can explain, without switching modes', async () => {
    const harness = createHarness();
    const sessionId = await startReadAhead(harness);
    await harness.controller.acceptReadAheadStatus(sessionId, 42, 'unsupported');
    expect(harness.controller.status()).toEqual({
      error: 'read_ahead_unsupported',
      state: 'error',
      tabId: 42,
    });
    expect(harness.controller.snapshot()).toBeUndefined();
  });

  it('stops in the tab rather than in the offscreen document', async () => {
    const harness = createHarness();
    const sessionId = await startReadAhead(harness);
    await harness.controller.stop();
    expect(harness.dependencies.stopReadAhead).toHaveBeenCalledWith(42, sessionId);
    expect(harness.dependencies.sendToOffscreen).not.toHaveBeenCalled();
    expect(harness.controller.status()).toEqual({ state: 'idle' });
  });

  it('restarts read-ahead in the tab after the page reloads', async () => {
    const harness = createHarness();
    const sessionId = await startReadAhead(harness);
    await harness.controller.handleContentReady(42);
    expect(harness.dependencies.startReadAhead).toHaveBeenLastCalledWith(42, expect.objectContaining({ sessionId }));
  });

  it('stays on its tab instead of following another one', async () => {
    const harness = createHarness();
    await startReadAhead(harness);
    await harness.controller.transfer(7);
    expect(harness.controller.status()).toEqual({ state: 'running', tabId: 42 });
    expect(harness.dependencies.startReadAhead).toHaveBeenCalledTimes(1);
  });
});
