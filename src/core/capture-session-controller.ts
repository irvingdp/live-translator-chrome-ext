import type { CaptureStartRequest } from '../audio/offscreen-capture-controller';
import type { TranslationRequest } from '../providers/deepl';
import type { ExtensionMessage } from './messages';
import {
  TranscriptStabilizer,
  type TranscriptEvent,
} from './transcript-stabilizer';
import {
  TranslationCoordinator,
  type CoordinatedTranslation,
} from './translation-coordinator';

export interface SessionSettings {
  deepgramApiKey: string;
  deeplApiKey: string;
  sourceLanguage: string;
  sourceLocale: string;
  targetLanguage: string;
  originalFontSize: number;
  translationFontSize: number;
}

export type TabMessage =
  | { type: 'CONTENT_PING' }
  | {
      type: 'OVERLAY_SHOW';
      payload: { originalFontSize: number; translationFontSize: number };
    }
  | { type: 'OVERLAY_HIDE' }
  | {
      type: 'CAPTION_ORIGINAL';
      payload: { segmentId: string; text: string };
    }
  | {
      type: 'CAPTION_TRANSLATION';
      payload: {
        isFinal: boolean;
        mode: 'append' | 'replace';
        revision: number;
        segmentId: string;
        text: string;
      };
    }
  | {
      type: 'SESSION_ERROR';
      payload: { code: string };
    }
  | { type: 'SESSION_ERROR_CLEAR' };

export type SessionStatus =
  | { state: 'idle' }
  | { state: 'starting'; tabId: number }
  | { error?: string; state: 'running'; tabId: number }
  | { error: string; state: 'error'; tabId: number };

const translationFailureCodes = new Set([
  'invalid_credentials',
  'invalid_response',
  'provider_unavailable',
  'quota_exceeded',
  'rate_limited',
  'translation_disabled',
]);

function translationFailureCode(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    translationFailureCodes.has(error.code)
  ) return error.code;
  return 'translation_failed';
}

export interface CaptureSessionDependencies {
  ensureContentScript(tabId: number): Promise<void>;
  ensureOffscreen(): Promise<void>;
  getStreamId(tabId: number): Promise<string>;
  sendToOffscreen(message: ExtensionMessage): Promise<unknown>;
  sendToTab(tabId: number, message: TabMessage): Promise<unknown>;
  translate(
    sessionId: string,
    request: TranslationRequest,
    signal: AbortSignal,
  ): Promise<string>;
}

export interface ActiveSessionSnapshot {
  sessionId: string;
  settings: SessionSettings;
  tabId: number;
}

export class CaptureSessionController {
  private activeSessionId?: string;
  private generation = 0;
  private lifecycleTail: Promise<void> = Promise.resolve();
  private settings?: SessionSettings;
  private lastOriginal?: Extract<TabMessage, { type: 'CAPTION_ORIGINAL' }>;
  private lastTranslation?: Extract<TabMessage, { type: 'CAPTION_TRANSLATION' }>;
  private stabilizer = new TranscriptStabilizer();
  private currentStatus: SessionStatus = { state: 'idle' };
  private translationErrorVersion = 0;
  private translationCoordinator?: TranslationCoordinator;

  constructor(private readonly dependencies: CaptureSessionDependencies) {}

  status(): SessionStatus {
    return this.currentStatus;
  }

  snapshot(): ActiveSessionSnapshot | undefined {
    if (
      !this.activeSessionId ||
      !this.settings ||
      this.currentStatus.state !== 'running'
    ) return undefined;
    return {
      sessionId: this.activeSessionId,
      settings: this.settings,
      tabId: this.currentStatus.tabId,
    };
  }

  restore(snapshot: ActiveSessionSnapshot): void {
    this.translationCoordinator?.dispose();
    this.activeSessionId = snapshot.sessionId;
    this.settings = snapshot.settings;
    this.stabilizer = new TranscriptStabilizer();
    this.translationErrorVersion = 0;
    this.translationCoordinator = this.createTranslationCoordinator(
      snapshot.sessionId,
      snapshot.settings,
    );
    this.currentStatus = { state: 'running', tabId: snapshot.tabId };
  }

  start(tabId: number, settings: SessionSettings): Promise<void> {
    return this.enqueueLifecycle(() => this.startInternal(tabId, settings));
  }

  private async startInternal(
    tabId: number,
    settings: SessionSettings,
  ): Promise<void> {
    if (this.currentStatus.state !== 'idle') await this.stopInternal();
    const generation = ++this.generation;
    const sessionId = crypto.randomUUID();
    this.activeSessionId = sessionId;
    this.currentStatus = { state: 'starting', tabId };
    this.settings = settings;
    this.stabilizer = new TranscriptStabilizer();
    this.translationErrorVersion = 0;
    this.lastOriginal = undefined;
    this.lastTranslation = undefined;
    this.translationCoordinator = this.createTranslationCoordinator(
      sessionId,
      settings,
    );
    let captureStarted = false;

    try {
      await this.dependencies.ensureOffscreen();
      if (generation !== this.generation) return;
      const streamId = await this.dependencies.getStreamId(tabId);
      if (generation !== this.generation) return;
      await this.dependencies.ensureContentScript(tabId);
      if (generation !== this.generation) return;
      const payload: CaptureStartRequest = {
        apiKey: settings.deepgramApiKey,
        language: settings.sourceLocale,
        sessionId,
        streamId,
      };
      await this.dependencies.sendToOffscreen({
        target: 'offscreen',
        type: 'CAPTURE_START',
        payload,
      });
      captureStarted = true;
      if (generation !== this.generation) {
        await this.dependencies
          .sendToOffscreen({
            target: 'offscreen',
            type: 'CAPTURE_STOP',
            payload: { sessionId },
          })
          .catch(() => undefined);
        return;
      }
      await this.dependencies.sendToTab(tabId, {
        type: 'OVERLAY_SHOW',
        payload: {
          originalFontSize: settings.originalFontSize,
          translationFontSize: settings.translationFontSize,
        },
      });
      this.currentStatus = { state: 'running', tabId };
    } catch (error) {
      if (captureStarted) {
        await this.dependencies
          .sendToOffscreen({
            target: 'offscreen',
            type: 'CAPTURE_STOP',
            payload: { sessionId },
          })
          .catch(() => undefined);
      }
      if (generation === this.generation) {
        this.currentStatus = {
          error: error instanceof Error ? error.message : 'capture_start_failed',
          state: 'error',
          tabId,
        };
      }
      throw error;
    }
  }

  async acceptTranscript(
    sessionId: string,
    event: TranscriptEvent,
  ): Promise<void> {
    if (
      sessionId !== this.activeSessionId ||
      this.currentStatus.state !== 'running' ||
      !this.settings ||
      !this.translationCoordinator
    ) {
      return;
    }
    const tabId = this.currentStatus.tabId;
    const generation = this.generation;
    const update = this.stabilizer.ingest(event);
    if (!update) return;

    this.lastOriginal = {
      type: 'CAPTION_ORIGINAL',
      payload: { segmentId: event.segmentId, text: update.originalText },
    };
    await this.dependencies.sendToTab(tabId, this.lastOriginal);
    if (this.currentStatus.error === 'translation_disabled') return;
    if (!update.translation) return;

    const phrase = update.translation;
    const errorVersionAtStart = this.translationErrorVersion;
    let result: CoordinatedTranslation | undefined;
    try {
      result = await this.translationCoordinator.translate({
        revision: phrase.revision,
        segmentId: phrase.segmentId,
        text: phrase.text,
      });
    } catch (error) {
      if (
        generation === this.generation &&
        this.currentStatus.state === 'running'
      ) {
        const code = translationFailureCode(error);
        const shouldNotify =
          code !== 'translation_disabled' ||
          this.currentStatus.error !== 'translation_disabled';
        this.translationErrorVersion += 1;
        this.currentStatus = {
          error: code,
          state: 'running',
          tabId,
        };
        if (shouldNotify) {
          await this.dependencies.sendToTab(tabId, {
            type: 'SESSION_ERROR',
            payload: { code },
          });
        }
      }
      return;
    }
    if (
      !result ||
      generation !== this.generation ||
      this.currentStatus.state !== 'running'
    ) {
      return;
    }
    const clearsCurrentError =
      Boolean(this.currentStatus.error) &&
      this.currentStatus.error !== 'translation_disabled' &&
      errorVersionAtStart === this.translationErrorVersion;
    if (clearsCurrentError) {
      this.currentStatus = { state: 'running', tabId };
      await this.dependencies.sendToTab(tabId, {
        type: 'SESSION_ERROR_CLEAR',
      });
    }
    this.lastTranslation = {
      type: 'CAPTION_TRANSLATION',
      payload: {
        isFinal: phrase.isFinal,
        mode: phrase.mode ?? 'append',
        revision: phrase.revision,
        segmentId: phrase.segmentId,
        text: result.text,
      },
    };
    await this.dependencies.sendToTab(tabId, this.lastTranslation);
  }

  stop(): Promise<void> {
    return this.stopInternal();
  }

  private async stopInternal(): Promise<void> {
    const tabId = 'tabId' in this.currentStatus ? this.currentStatus.tabId : undefined;
    const sessionId = this.activeSessionId;
    this.generation += 1;
    this.translationCoordinator?.dispose();
    try {
      if (sessionId) {
        await this.dependencies.sendToOffscreen({
          target: 'offscreen',
          type: 'CAPTURE_STOP',
          payload: { sessionId },
        });
      }
    } catch {
      // The offscreen document may already have torn itself down.
    } finally {
      if (tabId !== undefined) {
        await this.dependencies
          .sendToTab(tabId, { type: 'OVERLAY_HIDE' })
          .catch(() => undefined);
      }
      this.settings = undefined;
      this.activeSessionId = undefined;
      this.lastOriginal = undefined;
      this.lastTranslation = undefined;
      this.translationErrorVersion = 0;
      this.translationCoordinator = undefined;
      this.currentStatus = { state: 'idle' };
    }
  }

  async handleDisconnect(sessionId: string): Promise<void> {
    if (
      sessionId !== this.activeSessionId ||
      this.currentStatus.state !== 'running'
    ) return;
    const tabId = this.currentStatus.tabId;
    this.generation += 1;
    this.translationCoordinator?.dispose();
    this.currentStatus = {
      error: 'deepgram_disconnected',
      state: 'error',
      tabId,
    };
    await this.dependencies.sendToTab(tabId, {
      type: 'SESSION_ERROR',
      payload: { code: 'deepgram_disconnected' },
    });
  }

  async handleContentReady(tabId: number): Promise<void> {
    if (
      this.currentStatus.state !== 'running' ||
      this.currentStatus.tabId !== tabId ||
      !this.settings
    ) return;
    await this.dependencies.sendToTab(tabId, {
      type: 'OVERLAY_SHOW',
      payload: {
        originalFontSize: this.settings.originalFontSize,
        translationFontSize: this.settings.translationFontSize,
      },
    });
    if (this.lastOriginal) {
      await this.dependencies.sendToTab(tabId, this.lastOriginal);
    }
    if (this.lastTranslation) {
      await this.dependencies.sendToTab(tabId, this.lastTranslation);
    }
    if (
      this.currentStatus.state === 'running' &&
      this.currentStatus.tabId === tabId &&
      this.currentStatus.error
    ) {
      await this.dependencies.sendToTab(tabId, {
        type: 'SESSION_ERROR',
        payload: { code: this.currentStatus.error },
      });
    }
  }

  private createTranslationCoordinator(
    sessionId: string,
    settings: SessionSettings,
  ): TranslationCoordinator {
    return new TranslationCoordinator((text, signal) =>
      this.dependencies.translate(
        sessionId,
        {
          apiKey: settings.deeplApiKey,
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
          text,
        },
        signal,
      ),
    );
  }

  private enqueueLifecycle(operation: () => Promise<void>): Promise<void> {
    const result = this.lifecycleTail.then(operation, operation);
    this.lifecycleTail = result.catch(() => undefined);
    return result;
  }
}
