import { describe, expect, it, vi } from 'vitest';

import {
  CaptureSessionController,
  type CaptureSessionDependencies,
  type SessionSettings,
} from '../../src/core/capture-session-controller';

const settings: SessionSettings = {
  deepgramApiKey: 'deepgram-key',
  deeplApiKey: 'deepl-key:fx',
  sourceLanguage: 'EN',
  sourceLocale: 'en-US',
  targetLanguage: 'ZH-HANT',
  originalFontSize: 24,
  translationFontSize: 22,
};

function createHarness() {
  const dependencies: CaptureSessionDependencies = {
    ensureContentScript: vi.fn().mockResolvedValue(undefined),
    ensureOffscreen: vi.fn().mockResolvedValue(undefined),
    getStreamId: vi.fn().mockResolvedValue('stream-id'),
    sendToOffscreen: vi.fn().mockResolvedValue(undefined),
    sendToTab: vi.fn().mockResolvedValue(undefined),
    translate: vi.fn().mockResolvedValue('翻譯'),
  };
  return {
    controller: new CaptureSessionController(dependencies),
    dependencies,
  };
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
        sessionId: expect.any(String),
        streamId: 'stream-id',
      },
    });
    expect(dependencies.sendToTab).toHaveBeenCalledWith(42, {
      type: 'OVERLAY_SHOW',
      payload: { originalFontSize: 24, translationFontSize: 22 },
    });
    expect(controller.status()).toEqual({ state: 'running', tabId: 42 });
  });

  it('sends interim original text immediately and translates stable phrases', async () => {
    const { controller, dependencies } = createHarness();
    await controller.start(42, settings);
    vi.mocked(dependencies.sendToTab).mockClear();
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
      revision: 2,
      segmentId: 'segment-1',
      text: 'Good morning everyone',
    });

    expect(dependencies.sendToTab).toHaveBeenNthCalledWith(1, 42, {
      type: 'CAPTION_ORIGINAL',
      payload: { segmentId: 'segment-1', text: 'Good morning' },
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
      type: 'CAPTION_TRANSLATION',
      payload: {
        isFinal: false,
        mode: 'append',
        revision: 2,
        segmentId: 'segment-1',
        text: '翻譯',
      },
    });
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
      payload: { originalFontSize: 24, translationFontSize: 22 },
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
    const { controller, dependencies } = createHarness();
    vi.mocked(dependencies.translate).mockRejectedValue(
      Object.assign(new Error('translation_disabled'), {
        code: 'translation_disabled',
      }),
    );
    await controller.start(42, settings);
    const startMessage = vi.mocked(dependencies.sendToOffscreen).mock.calls[0]![0];
    if (startMessage.type !== 'CAPTURE_START') throw new Error('missing start');
    vi.mocked(dependencies.sendToTab).mockClear();

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
    await controller.acceptTranscript(startMessage.payload.sessionId, {
      isFinal: false,
      revision: 3,
      segmentId: 'segment-1',
      text: 'Good morning everyone here',
    });

    expect(dependencies.sendToTab).toHaveBeenCalledWith(42, {
      type: 'CAPTION_ORIGINAL',
      payload: {
        segmentId: 'segment-1',
        text: 'Good morning everyone here',
      },
    });
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
      'CAPTION_ORIGINAL',
      'CAPTION_ORIGINAL',
      'SESSION_ERROR',
      'CAPTION_ORIGINAL',
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
      'CAPTION_ORIGINAL',
      'CAPTION_ORIGINAL',
      'SESSION_ERROR',
      'CAPTION_ORIGINAL',
      'SESSION_ERROR_CLEAR',
      'CAPTION_TRANSLATION',
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
});
