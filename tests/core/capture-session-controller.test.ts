import { describe, expect, it, vi } from 'vitest';

import {
  CaptureSessionController,
  type CaptureSessionDependencies,
  type SessionSettings,
  type TabMessage,
} from '../../src/core/capture-session-controller';

const settings: SessionSettings = {
  backgroundOpacity: 78,
  deepgramApiKey: 'deepgram-key',
  deeplApiKey: 'deepl-key:fx',
  geminiApiKey: 'gemini-key',
  geminiTargetLanguage: 'zh-Hant',
  maxLineWidth: 90,
  minLineWidth: 40,
  sourceLanguage: 'EN',
  sourceLocale: 'en-US',
  targetLanguage: 'ZH-HANT',
  transcriber: 'deepgram',
  originalFontSize: 24,
  translationFontSize: 22,
};

function createHarness() {
  const dependencies: CaptureSessionDependencies = {
    ensureContentScript: vi.fn().mockResolvedValue(undefined),
    ensureOffscreen: vi.fn().mockResolvedValue(undefined),
    getStreamId: vi.fn().mockResolvedValue('stream-id'),
    getOverlayLayout: vi.fn().mockResolvedValue(undefined),
    sendToOffscreen: vi.fn().mockResolvedValue(undefined),
    sendToTab: vi.fn().mockResolvedValue(undefined),
    translate: vi.fn().mockResolvedValue('翻譯'),
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

// Leaves the window holding an open unit from one segment and a closed unit
// from another, and the chunker holding in-progress state for the first, so a
// reset that misses either collaborator shows up in the very next update.
async function seedWindow(
  harness: ReturnType<typeof createHarness>,
  sessionId: string,
): Promise<void> {
  await harness.controller.acceptTranscript(sessionId, {
    isFinal: false,
    revision: 1,
    segmentId: 'segment-1',
    text: 'Hello there.',
  });
  await harness.controller.acceptTranscript(sessionId, {
    isFinal: true,
    revision: 1,
    segmentId: 'segment-2',
    text: 'Second one.',
  });
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

  it('starts one tab only after offscreen and stream setup succeed', async () => {
    const { controller, dependencies } = createHarness();

    await controller.start(42, settings);

    expect(dependencies.ensureOffscreen).toHaveBeenCalledOnce();
    expect(dependencies.getStreamId).toHaveBeenCalledWith(42);
    expect(dependencies.sendToOffscreen).toHaveBeenCalledWith({
      target: 'offscreen',
      type: 'CAPTURE_START',
      payload: {
        apiKey: 'deepgram-key',
        language: 'en-US',
        provider: 'deepgram',
        sessionId: expect.any(String),
        streamId: 'stream-id',
      },
    });
    expect(dependencies.sendToTab).toHaveBeenCalledWith(42, {
      type: 'OVERLAY_SHOW',
      payload: {
        appearance: expect.objectContaining({
          backgroundOpacity: settings.backgroundOpacity,
        }),
        layout: undefined,
      },
    });
    expect(controller.status()).toEqual({ state: 'running', tabId: 42 });
  });

  it('sends interim original text immediately and translates stable text', async () => {
    const harness = createHarness();
    const { controller, dependencies } = harness;
    const sessionId = await startSession(harness);

    await controller.acceptTranscript(sessionId, {
      isFinal: false,
      revision: 1,
      segmentId: 'segment-1',
      text: 'Good morning',
    });
    await controller.acceptTranscript(sessionId, {
      isFinal: false,
      revision: 2,
      segmentId: 'segment-1',
      text: 'Good morning everyone',
    });

    expect(dependencies.sendToTab).toHaveBeenNthCalledWith(1, 42, {
      type: 'CAPTION_WINDOW',
      payload: {
        pairs: [
          { id: 'segment-1#0', original: 'Good morning', translation: '' },
        ],
      },
    });
    expect(dependencies.translate).toHaveBeenCalledWith(
      sessionId,
      {
        apiKey: 'deepl-key:fx',
        sourceLanguage: 'EN',
        targetLanguage: 'ZH-HANT',
        text: 'Good morning',
      },
      expect.any(AbortSignal),
    );
    expect(dependencies.sendToTab).toHaveBeenLastCalledWith(42, {
      type: 'CAPTION_WINDOW',
      payload: {
        pairs: [
          {
            id: 'segment-1#0',
            original: 'Good morning everyone',
            translation: '翻譯',
          },
        ],
      },
    });
  });

  it('sends a rolling window that never holds more than two units', async () => {
    const harness = createHarness();
    vi.mocked(harness.dependencies.translate).mockImplementation(
      async (_sessionId, request) => `[${request.text}]`,
    );
    const sessionId = await startSession(harness, { maxLineWidth: 20 });

    await harness.controller.acceptTranscript(sessionId, {
      isFinal: false,
      revision: 1,
      segmentId: 'segment-1',
      text: 'Hello there.',
    });
    await harness.controller.acceptTranscript(sessionId, {
      isFinal: false,
      revision: 2,
      segmentId: 'segment-1',
      text: 'Hello there. And now we',
    });
    await harness.controller.acceptTranscript(sessionId, {
      isFinal: false,
      revision: 3,
      segmentId: 'segment-1',
      text: 'Hello there. And now we go. Then more text arrives',
    });

    const windows = windowsSentTo(harness);
    expect(windows.length).toBeGreaterThan(0);
    for (const message of windows) {
      expect(message.payload.pairs.length).toBeLessThanOrEqual(2);
    }
    expect(
      vi.mocked(harness.dependencies.translate).mock.calls.map(
        ([, request]) => request.text,
      ),
    ).toContain('Hello there.');
  });

  it('translates each unit under its own key so pairs stay aligned', async () => {
    const harness = createHarness();
    vi.mocked(harness.dependencies.translate).mockImplementation(
      async (_sessionId, request) => `[${request.text}]`,
    );
    const sessionId = await startSession(harness, { maxLineWidth: 20 });

    await harness.controller.acceptTranscript(sessionId, {
      isFinal: false,
      revision: 1,
      segmentId: 'segment-1',
      text: 'Hello there.',
    });
    await harness.controller.acceptTranscript(sessionId, {
      isFinal: true,
      revision: 2,
      segmentId: 'segment-1',
      text: 'Hello there. And now.',
    });

    const pairs = windowsSentTo(harness).at(-1)!.payload.pairs;
    expect(pairs).toEqual([
      {
        id: 'segment-1#0',
        original: 'Hello there.',
        translation: '[Hello there.]',
      },
      { id: 'segment-1#1', original: 'And now.', translation: '[And now.]' },
    ]);
  });

  it('sends window payloads a later translation cannot rewrite', async () => {
    const harness = createHarness();
    vi.mocked(harness.dependencies.translate).mockImplementation(
      async (_sessionId, request) => `[${request.text}]`,
    );
    const sessionId = await startSession(harness, { maxLineWidth: 20 });

    await harness.controller.acceptTranscript(sessionId, {
      isFinal: true,
      revision: 1,
      segmentId: 'segment-1',
      text: 'Hello there.',
    });

    const windows = windowsSentTo(harness);
    expect(windows[0]!.payload.pairs).toEqual([
      { id: 'segment-1#0', original: 'Hello there.', translation: '' },
    ]);
    expect(windows.at(-1)!.payload.pairs).toEqual([
      {
        id: 'segment-1#0',
        original: 'Hello there.',
        translation: '[Hello there.]',
      },
    ]);
  });

  it('does not translate a unit with nothing newly stabilized', async () => {
    const harness = createHarness();
    const sessionId = await startSession(harness, { maxLineWidth: 20 });

    await harness.controller.acceptTranscript(sessionId, {
      isFinal: false,
      revision: 1,
      segmentId: 'segment-1',
      text: 'Hello',
    });

    expect(windowsSentTo(harness).at(-1)!.payload.pairs).toEqual([
      { id: 'segment-1#0', original: 'Hello', translation: '' },
    ]);
    expect(harness.dependencies.translate).not.toHaveBeenCalled();
  });

  it('does not pay for a second translation of text it already translated', async () => {
    const harness = createHarness();
    vi.mocked(harness.dependencies.translate).mockImplementation(
      async (_sessionId, request) => `[${request.text}]`,
    );
    const sessionId = await startSession(harness, { maxLineWidth: 20 });

    // Unit 0 is translated while it is still open, then the third event
    // closes it with byte-identical text. Re-sending that would spend
    // provider quota to receive an answer we already have.
    for (const [index, text] of [
      'Hello there.',
      'Hello there. And now we',
      'Hello there. And now we go. Then more',
    ].entries()) {
      await harness.controller.acceptTranscript(sessionId, {
        isFinal: false,
        revision: index + 1,
        segmentId: 'segment-1',
        text,
      });
    }

    const translated = vi
      .mocked(harness.dependencies.translate)
      .mock.calls.map(([, request]) => request.text);

    expect(translated).toEqual([...new Set(translated)]);
    expect(windowsSentTo(harness).at(-1)!.payload.pairs[0]).toMatchObject({
      id: 'segment-1#0',
      translation: '[Hello there.]',
    });
  });

  it('replays the current window when the content script reports ready', async () => {
    const harness = createHarness();
    const sessionId = await startSession(harness);
    await harness.controller.acceptTranscript(sessionId, {
      isFinal: false,
      revision: 1,
      segmentId: 'segment-1',
      text: 'Hello there.',
    });
    vi.mocked(harness.dependencies.sendToTab).mockClear();

    await harness.controller.handleContentReady(42);

    const types = vi
      .mocked(harness.dependencies.sendToTab)
      .mock.calls.map(([, message]) => message.type);
    expect(types).toContain('OVERLAY_SHOW');
    expect(types).toContain('CAPTION_WINDOW');
    expect(windowsSentTo(harness).at(-1)!.payload.pairs).toEqual([
      { id: 'segment-1#0', original: 'Hello there.', translation: '' },
    ]);
  });

  it('keeps a fixed history while visible rows are owned by the overlay height', async () => {
    const harness = createHarness();
    const sessionId = await startSession(harness, { maxLineWidth: 20 });

    await harness.controller.acceptTranscript(sessionId, {
      isFinal: true,
      revision: 1,
      segmentId: 'segment-1',
      text: 'One two three. Four five six. Seven eight nine.',
    });
    expect(windowsSentTo(harness).at(-1)!.payload.pairs.length).toBeGreaterThan(1);

    harness.controller.applyLayout({
      maxLineWidth: 20,
      minLineWidth: 0,
    });
    await harness.controller.acceptTranscript(sessionId, {
      isFinal: true,
      revision: 1,
      segmentId: 'segment-2',
      text: 'Ten eleven twelve.',
    });

    expect(windowsSentTo(harness).at(-1)!.payload.pairs.length).toBeGreaterThan(1);
  });

  it('never re-cuts a row the viewer already read when the width narrows', async () => {
    const harness = createHarness();
    // A window wide enough to hold every row: the rolling window would
    // otherwise drop the duplicated rows before they could be observed.
    const sessionId = await startSession(harness, {
      maxLineWidth: 90,
      minLineWidth: 0,
    });
    const spoken =
      'One two three four five six seven eight nine ten. Eleven twelve thirteen fourteen fifteen sixteen.';
    const text = `${spoken} Seventeen eighteen nineteen twenty.`;

    // Two revisions at the wide setting, because the stabilizer has nothing to
    // agree with on the first one and so freezes nothing.
    for (const revision of [1, 2]) {
      await harness.controller.acceptTranscript(sessionId, {
        isFinal: false,
        revision,
        segmentId: 'segment-1',
        text: spoken,
      });
    }
    harness.controller.applyLayout({
      maxLineWidth: 20,
      minLineWidth: 0,
    });
    // The speaker keeps going while the slider moves.
    await harness.controller.acceptTranscript(sessionId, {
      isFinal: false,
      revision: 3,
      segmentId: 'segment-1',
      text,
    });

    // The rolling window only ever holds the last few rows, so checking one
    // window would miss the duplication entirely. Every row this session
    // produced, in id order and taking each id's latest text, has to lay the
    // transcript end to end exactly once: a narrower re-cut that starts from
    // already-frozen text shows up here as repeated words.
    const latestById = new Map<string, string>();
    for (const message of windowsSentTo(harness)) {
      for (const pair of message.payload.pairs) {
        latestById.set(pair.id, pair.original);
      }
    }
    const inIdOrder = [...latestById.entries()]
      .sort(([left], [right]) => Number(left.split('#')[1]) - Number(right.split('#')[1]))
      .map(([, original]) => original);

    expect(inIdOrder.join(' ')).toBe(text);
  });

  it('applies a new line width to units that arrive afterwards', async () => {
    const harness = createHarness();
    const sessionId = await startSession(harness, { maxLineWidth: 140 });
    harness.controller.applyLayout({
      maxLineWidth: 20,
      minLineWidth: 0,
    });

    await harness.controller.acceptTranscript(sessionId, {
      isFinal: true,
      revision: 1,
      segmentId: 'segment-1',
      text: 'One two three four five six seven eight nine ten.',
    });

    const pairs = windowsSentTo(harness).at(-1)!.payload.pairs;
    expect(pairs.length).toBeGreaterThan(1);
    for (const pair of pairs) expect(pair.original.length).toBeLessThanOrEqual(20);
  });

  it('starts the next session with an empty window and a fresh chunker', async () => {
    const harness = createHarness();
    const first = await startSession(harness, { maxLineWidth: 20 });
    await seedWindow(harness, first);
    await harness.controller.stop();
    vi.mocked(harness.dependencies.sendToOffscreen).mockClear();

    const second = await startSession(harness, { maxLineWidth: 20 });
    await harness.controller.acceptTranscript(second, {
      isFinal: false,
      revision: 1,
      segmentId: 'segment-1',
      text: 'Hello there.',
    });

    const windows = windowsSentTo(harness);
    expect(windows).toHaveLength(1);
    expect(windows[0]!.payload.pairs).toEqual([
      { id: 'segment-1#0', original: 'Hello there.', translation: '' },
    ]);
  });

  it('restores a session with an empty window and a fresh chunker', async () => {
    const harness = createHarness();
    const first = await startSession(harness, { maxLineWidth: 20 });
    await seedWindow(harness, first);

    harness.controller.restore({
      sessionId: 'restored',
      settings: { ...settings, maxLineWidth: 20 },
      tabId: 42,
    });
    vi.mocked(harness.dependencies.sendToTab).mockClear();
    await harness.controller.acceptTranscript('restored', {
      isFinal: false,
      revision: 1,
      segmentId: 'segment-1',
      text: 'Hello there.',
    });

    const windows = windowsSentTo(harness);
    expect(windows).toHaveLength(1);
    expect(windows[0]!.payload.pairs).toEqual([
      { id: 'segment-1#0', original: 'Hello there.', translation: '' },
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

  it('marks the session as errored after an unexpected Deepgram disconnect', async () => {
    const { controller, dependencies } = createHarness();
    await controller.start(42, settings);
    const startMessage = vi.mocked(dependencies.sendToOffscreen).mock.calls[0]![0];
    if (startMessage.type !== 'CAPTURE_START') throw new Error('missing start');

    await controller.handleDisconnect(startMessage.payload.sessionId);

    expect(dependencies.sendToTab).toHaveBeenLastCalledWith(42, {
      type: 'SESSION_ERROR',
      payload: { code: 'deepgram_disconnected' },
    });
    expect(controller.status()).toEqual({
      error: 'deepgram_disconnected',
      state: 'error',
      tabId: 42,
    });
  });

  it('reports the reason a provider gave for dropping out', async () => {
    const { controller, dependencies } = createHarness();
    await controller.start(42, { ...settings, transcriber: 'gemini' });
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

  describe('Gemini Live Translate sessions', () => {
    it('starts the provider that does both jobs with only its own key', async () => {
      const { controller, dependencies } = createHarness();

      await controller.start(42, { ...settings, transcriber: 'gemini' });

      expect(dependencies.sendToOffscreen).toHaveBeenCalledWith({
        target: 'offscreen',
        type: 'CAPTURE_START',
        payload: {
          apiKey: 'gemini-key',
          maxLineWidth: 90,
          provider: 'gemini',
          sessionId: expect.any(String),
          streamId: 'stream-id',
          targetLanguage: 'zh-Hant',
        },
      });
    });

    it('renders a provider-translated row without calling a translator', async () => {
      const harness = createHarness();
      const sessionId = await startSession(harness, { transcriber: 'gemini' });

      await harness.controller.acceptCaptionPairs(sessionId, [{
        id: 'turn-0#0',
        original: 'Hello there',
        translation: '你好',
      }]);

      expect(windowsSentTo(harness).at(-1)?.payload.pairs).toEqual([
        { id: 'turn-0#0', original: 'Hello there', translation: '你好' },
      ]);
      expect(harness.dependencies.translate).not.toHaveBeenCalled();
    });

    it('applies a sentence batch in one render and never resurrects an old row', async () => {
      const harness = createHarness();
      const sessionId = await startSession(harness, {
        transcriber: 'gemini',
      });

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
      await startSession(harness, { transcriber: 'gemini' });
      vi.mocked(harness.dependencies.sendToOffscreen).mockClear();

      harness.controller.applyLayout({
        maxLineWidth: 60,
        minLineWidth: 40,
      });

      expect(harness.dependencies.sendToOffscreen).toHaveBeenCalledWith({
        target: 'offscreen',
        type: 'CAPTURE_CONFIG_UPDATE',
        payload: { maxLineWidth: 60, sessionId: expect.any(String) },
      });
    });

    it('grows a row in place and rolls the window on at the next turn', async () => {
      const harness = createHarness();
      const sessionId = await startSession(harness, {
        transcriber: 'gemini',
      });

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
      const sessionId = await startSession(harness, { transcriber: 'gemini' });
      await harness.controller.stop();
      vi.mocked(harness.dependencies.sendToTab).mockClear();

      await harness.controller.acceptCaptionPairs(sessionId, [{
        id: 'turn-0#0',
        original: 'Hello',
        translation: '你好',
      }]);

      expect(windowsSentTo(harness)).toHaveLength(0);
    });
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

  it('ignores transcripts and disconnects from an older session', async () => {
    const { controller, dependencies } = createHarness();
    await controller.start(42, settings);
    const firstStart = vi.mocked(dependencies.sendToOffscreen).mock.calls[0]![0];
    if (firstStart.type !== 'CAPTURE_START') throw new Error('missing start');
    await controller.start(43, settings);
    vi.mocked(dependencies.sendToTab).mockClear();

    await controller.acceptTranscript(firstStart.payload.sessionId, {
      isFinal: true,
      revision: 1,
      segmentId: 'old',
      text: 'stale',
    });
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

  it('keeps original captions running and surfaces a DeepL failure', async () => {
    const { controller, dependencies } = createHarness();
    vi.mocked(dependencies.translate).mockRejectedValue(new Error('quota'));
    await controller.start(42, settings);
    const startMessage = vi.mocked(dependencies.sendToOffscreen).mock.calls[0]![0];
    if (startMessage.type !== 'CAPTURE_START') throw new Error('missing start');
    await controller.acceptTranscript(startMessage.payload.sessionId, {
      isFinal: false,
      revision: 1,
      segmentId: 'segment-1',
      text: 'Good morning',
    });

    await controller.acceptTranscript(startMessage.payload.sessionId, {
      isFinal: false,
      revision: 2,
      segmentId: 'segment-1',
      text: 'Good morning everyone',
    });

    expect(dependencies.sendToTab).toHaveBeenLastCalledWith(42, {
      type: 'SESSION_ERROR',
      payload: { code: 'translation_failed' },
    });
    expect(controller.status()).toEqual({
      error: 'translation_failed',
      state: 'running',
      tabId: 42,
    });
  });

  it('preserves a categorized DeepL failure for the user-facing error', async () => {
    const { controller, dependencies } = createHarness();
    vi.mocked(dependencies.translate).mockRejectedValue(
      Object.assign(new Error('quota'), { code: 'quota_exceeded' }),
    );
    await controller.start(42, settings);
    const startMessage = vi.mocked(dependencies.sendToOffscreen).mock.calls[0]![0];
    if (startMessage.type !== 'CAPTURE_START') throw new Error('missing start');
    await controller.acceptTranscript(startMessage.payload.sessionId, {
      isFinal: true,
      revision: 1,
      segmentId: 'segment-1',
      text: 'Good morning',
    });

    expect(dependencies.sendToTab).toHaveBeenLastCalledWith(42, {
      type: 'SESSION_ERROR',
      payload: { code: 'quota_exceeded' },
    });
    expect(controller.status()).toEqual({
      error: 'quota_exceeded',
      state: 'running',
      tabId: 42,
    });
  });

  it('keeps original captions running when translation is disabled', async () => {
    const harness = createHarness();
    const { controller, dependencies } = harness;
    vi.mocked(dependencies.translate).mockRejectedValue(
      Object.assign(new Error('translation_disabled'), {
        code: 'translation_disabled',
      }),
    );
    const sessionId = await startSession(harness);

    await controller.acceptTranscript(sessionId, {
      isFinal: false,
      revision: 1,
      segmentId: 'segment-1',
      text: 'Good morning',
    });
    await controller.acceptTranscript(sessionId, {
      isFinal: false,
      revision: 2,
      segmentId: 'segment-1',
      text: 'Good morning everyone',
    });
    await controller.acceptTranscript(sessionId, {
      isFinal: false,
      revision: 3,
      segmentId: 'segment-1',
      text: 'Good morning everyone here',
    });

    expect(windowsSentTo(harness).at(-1)!.payload.pairs).toEqual([
      {
        id: 'segment-1#0',
        original: 'Good morning everyone here',
        translation: '',
      },
    ]);
    expect(dependencies.translate).toHaveBeenCalledOnce();
    expect(
      vi.mocked(dependencies.sendToTab).mock.calls.filter(
        ([, message]) => message.type === 'SESSION_ERROR',
      ),
    ).toHaveLength(1);
    expect(
      vi.mocked(dependencies.sendToTab).mock.calls.map(
        ([, message]) => message.type,
      ),
    ).toEqual([
      'CAPTION_WINDOW',
      'CAPTION_WINDOW',
      'SESSION_ERROR',
      'CAPTION_WINDOW',
    ]);
    expect(controller.status()).toEqual({
      error: 'translation_disabled',
      state: 'running',
      tabId: 42,
    });
  });

  it('restores circuit-open status when content is reinjected', async () => {
    const { controller, dependencies } = createHarness();
    vi.mocked(dependencies.translate).mockRejectedValue(
      Object.assign(new Error('translation_disabled'), {
        code: 'translation_disabled',
      }),
    );
    await controller.start(42, settings);
    const startMessage = vi.mocked(dependencies.sendToOffscreen).mock.calls[0]![0];
    if (startMessage.type !== 'CAPTURE_START') throw new Error('missing start');
    await controller.acceptTranscript(startMessage.payload.sessionId, {
      isFinal: true,
      revision: 1,
      segmentId: 'segment-1',
      text: 'Good morning',
    });
    vi.mocked(dependencies.sendToTab).mockClear();

    await controller.handleContentReady(42);

    expect(dependencies.sendToTab).toHaveBeenLastCalledWith(42, {
      type: 'SESSION_ERROR',
      payload: { code: 'translation_disabled' },
    });
  });

  it('emits circuit-open status once for concurrent translation failures', async () => {
    const { controller, dependencies } = createHarness();
    vi.mocked(dependencies.translate).mockRejectedValue(
      Object.assign(new Error('translation_disabled'), {
        code: 'translation_disabled',
      }),
    );
    await controller.start(42, settings);
    const startMessage = vi.mocked(dependencies.sendToOffscreen).mock.calls[0]![0];
    if (startMessage.type !== 'CAPTURE_START') throw new Error('missing start');
    const sessionId = startMessage.payload.sessionId;
    await controller.acceptTranscript(sessionId, {
      isFinal: false,
      revision: 1,
      segmentId: 'segment-1',
      text: 'Good morning',
    });
    await controller.acceptTranscript(sessionId, {
      isFinal: false,
      revision: 1,
      segmentId: 'segment-2',
      text: 'How are you',
    });
    vi.mocked(dependencies.sendToTab).mockClear();

    await Promise.all([
      controller.acceptTranscript(sessionId, {
        isFinal: false,
        revision: 2,
        segmentId: 'segment-1',
        text: 'Good morning everyone',
      }),
      controller.acceptTranscript(sessionId, {
        isFinal: false,
        revision: 2,
        segmentId: 'segment-2',
        text: 'How are you today',
      }),
    ]);

    expect(dependencies.translate).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(dependencies.sendToTab).mock.calls.filter(
        ([, message]) => message.type === 'SESSION_ERROR',
      ),
    ).toHaveLength(1);
  });

  it('clears a transient translation status after a later request succeeds', async () => {
    const { controller, dependencies } = createHarness();
    vi.mocked(dependencies.translate)
      .mockRejectedValueOnce(
        Object.assign(new Error('provider_unavailable'), {
          code: 'provider_unavailable',
        }),
      )
      .mockResolvedValueOnce('翻譯恢復');
    await controller.start(42, settings);
    const startMessage = vi.mocked(dependencies.sendToOffscreen).mock.calls[0]![0];
    if (startMessage.type !== 'CAPTURE_START') throw new Error('missing start');
    const sessionId = startMessage.payload.sessionId;
    vi.mocked(dependencies.sendToTab).mockClear();

    await controller.acceptTranscript(sessionId, {
      isFinal: false,
      revision: 1,
      segmentId: 'segment-1',
      text: 'Good morning',
    });
    await controller.acceptTranscript(sessionId, {
      isFinal: false,
      revision: 2,
      segmentId: 'segment-1',
      text: 'Good morning everyone',
    });
    await controller.acceptTranscript(sessionId, {
      isFinal: false,
      revision: 3,
      segmentId: 'segment-1',
      text: 'Good morning everyone here',
    });

    expect(
      vi.mocked(dependencies.sendToTab).mock.calls.map(
        ([, message]) => message.type,
      ),
    ).toEqual([
      'CAPTION_WINDOW',
      'CAPTION_WINDOW',
      'SESSION_ERROR',
      'CAPTION_WINDOW',
      'SESSION_ERROR_CLEAR',
      'CAPTION_WINDOW',
    ]);
    expect(controller.status()).toEqual({ state: 'running', tabId: 42 });
  });

  it.each(['quota_exceeded', 'translation_disabled'])(
    'does not clear a newer %s error when a stale concurrent request succeeds',
    async (code) => {
      const { controller, dependencies } = createHarness();
      let releaseSuccess!: (text: string) => void;
      vi.mocked(dependencies.translate)
        .mockImplementationOnce(
          () => new Promise<string>((resolve) => { releaseSuccess = resolve; }),
        )
        .mockRejectedValueOnce(Object.assign(new Error(code), { code }));
      await controller.start(42, settings);
      const startMessage = vi.mocked(dependencies.sendToOffscreen).mock.calls[0]![0];
      if (startMessage.type !== 'CAPTURE_START') throw new Error('missing start');
      const sessionId = startMessage.payload.sessionId;
      await controller.acceptTranscript(sessionId, {
        isFinal: false,
        revision: 1,
        segmentId: 'segment-1',
        text: 'Good morning',
      });
      await controller.acceptTranscript(sessionId, {
        isFinal: false,
        revision: 1,
        segmentId: 'segment-2',
        text: 'How are you',
      });
      vi.mocked(dependencies.sendToTab).mockClear();

      const staleSuccess = controller.acceptTranscript(sessionId, {
        isFinal: false,
        revision: 2,
        segmentId: 'segment-1',
        text: 'Good morning everyone',
      });
      await vi.waitFor(() => {
        expect(dependencies.translate).toHaveBeenCalledOnce();
      });
      await controller.acceptTranscript(sessionId, {
        isFinal: false,
        revision: 2,
        segmentId: 'segment-2',
        text: 'How are you today',
      });
      releaseSuccess('過時翻譯');
      await staleSuccess;

      expect(
        vi.mocked(dependencies.sendToTab).mock.calls.some(
          ([, message]) => message.type === 'SESSION_ERROR_CLEAR',
        ),
      ).toBe(false);
      expect(controller.status()).toEqual({
        error: code,
        state: 'running',
        tabId: 42,
      });
    },
  );

  it('clears an older concurrent error when a newer request succeeds', async () => {
    const { controller, dependencies } = createHarness();
    let rejectOlder!: (error: Error) => void;
    let resolveNewer!: (text: string) => void;
    vi.mocked(dependencies.translate)
      .mockImplementationOnce(
        () => new Promise<string>((_resolve, reject) => { rejectOlder = reject; }),
      )
      .mockImplementationOnce(
        () => new Promise<string>((resolve) => { resolveNewer = resolve; }),
      );
    await controller.start(42, settings);
    const startMessage = vi.mocked(dependencies.sendToOffscreen).mock.calls[0]![0];
    if (startMessage.type !== 'CAPTURE_START') throw new Error('missing start');
    const sessionId = startMessage.payload.sessionId;
    await controller.acceptTranscript(sessionId, {
      isFinal: false,
      revision: 1,
      segmentId: 'segment-1',
      text: 'Good morning',
    });
    await controller.acceptTranscript(sessionId, {
      isFinal: false,
      revision: 1,
      segmentId: 'segment-2',
      text: 'How are you',
    });
    vi.mocked(dependencies.sendToTab).mockClear();

    const olderFailure = controller.acceptTranscript(sessionId, {
      isFinal: false,
      revision: 2,
      segmentId: 'segment-1',
      text: 'Good morning everyone',
    });
    await vi.waitFor(() => {
      expect(dependencies.translate).toHaveBeenCalledOnce();
    });
    const newerSuccess = controller.acceptTranscript(sessionId, {
      isFinal: false,
      revision: 2,
      segmentId: 'segment-2',
      text: 'How are you today',
    });
    await vi.waitFor(() => {
      expect(dependencies.translate).toHaveBeenCalledTimes(2);
    });

    rejectOlder(
      Object.assign(new Error('provider_unavailable'), {
        code: 'provider_unavailable',
      }),
    );
    await olderFailure;
    resolveNewer('恢復翻譯');
    await newerSuccess;

    expect(
      vi.mocked(dependencies.sendToTab).mock.calls.map(
        ([, message]) => message.type,
      ),
    ).toContain('SESSION_ERROR_CLEAR');
    expect(controller.status()).toEqual({ state: 'running', tabId: 42 });
  });
});
