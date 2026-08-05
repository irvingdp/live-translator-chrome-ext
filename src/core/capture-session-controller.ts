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
    };

export type SessionStatus =
  | { state: 'idle' }
  | { state: 'starting'; tabId: number }
  | { error?: string; state: 'running'; tabId: number }
  | { error: string; state: 'error'; tabId: number };

export interface CaptureSessionDependencies {
  ensureOffscreen(): Promise<void>;
  getStreamId(tabId: number): Promise<string>;
  sendToOffscreen(message: ExtensionMessage): Promise<unknown>;
  sendToTab(tabId: number, message: TabMessage): Promise<unknown>;
  translate(request: TranslationRequest, signal: AbortSignal): Promise<string>;
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
    this.translationCoordinator = this.createTranslationCoordinator(
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
    this.lastOriginal = undefined;
    this.lastTranslation = undefined;
    this.translationCoordinator = this.createTranslationCoordinator(settings);
    let captureStarted = false;

    try {
      await this.dependencies.ensureOffscreen();
      if (generation !== this.generation) return;
      const streamId = await this.dependencies.getStreamId(tabId);
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
    if (!update.translation) return;

    const phrase = update.translation;
    let result: CoordinatedTranslation | undefined;
    try {
      result = await this.translationCoordinator.translate({
        revision: phrase.revision,
        segmentId: phrase.segmentId,
        text: phrase.text,
      });
    } catch {
      if (
        generation === this.generation &&
        this.currentStatus.state === 'running'
      ) {
        this.currentStatus = {
          error: 'translation_failed',
          state: 'running',
          tabId,
        };
        await this.dependencies.sendToTab(tabId, {
          type: 'SESSION_ERROR',
          payload: { code: 'translation_failed' },
        });
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
    if (this.currentStatus.error) {
      this.currentStatus = { state: 'running', tabId };
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
  }

  private createTranslationCoordinator(
    settings: SessionSettings,
  ): TranslationCoordinator {
    return new TranslationCoordinator((text, signal) =>
      this.dependencies.translate(
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
