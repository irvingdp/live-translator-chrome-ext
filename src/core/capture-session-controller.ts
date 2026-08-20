import type {
  CaptionPairUpdate,
  CaptureStartRequest,
} from '../audio/offscreen-capture-controller';
import type { TranslationRequest } from '../providers/deepl';
import { CaptionChunker, type CaptionUnit } from './caption-chunker';
import { CaptionWindow, type CaptionPair } from './caption-window';
import type { ExtensionMessage } from './messages';
import type { OverlayLayout } from './overlay-layout';
import {
  captionAppearance,
  type CaptionAppearance,
  type TranscriberId,
} from './settings';
import {
  TranscriptStabilizer,
  type TranscriptEvent,
} from './transcript-stabilizer';
import {
  TranslationCoordinator,
  type CoordinatedTranslation,
} from './translation-coordinator';

export interface SessionSettings {
  backgroundOpacity: number;
  deepgramApiKey: string;
  deeplApiKey: string;
  geminiApiKey: string;
  geminiTargetLanguage: string;
  maxLineWidth: number;
  minLineWidth: number;
  sourceLanguage: string;
  sourceLocale: string;
  targetLanguage: string;
  transcriber: TranscriberId;
  originalFontSize: number;
  originalTextColor: string;
  translationFontSize: number;
  translationTextColor: string;
}

export type TabMessage =
  | { type: 'CONTENT_PING' }
  | {
      type: 'OVERLAY_SHOW';
      payload: { appearance: CaptionAppearance; layout?: OverlayLayout };
    }
  | { type: 'OVERLAY_APPEARANCE'; payload: { appearance: CaptionAppearance } }
  | { type: 'OVERLAY_LAYOUT'; payload: { layout: OverlayLayout } }
  | { type: 'OVERLAY_HIDE' }
  | { type: 'CAPTION_WINDOW'; payload: { pairs: CaptionPair[] } }
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
  getOverlayLayout(tabId: number): Promise<OverlayLayout | undefined>;
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
  private readonly captionWindow = new CaptionWindow(50);
  private readonly chunker = new CaptionChunker();
  private readonly translatedSources = new Map<string, string>();
  private stabilizer = new TranscriptStabilizer();
  private currentStatus: SessionStatus = { state: 'idle' };
  private currentTranslationErrorAttemptId?: number;
  private lastSuccessfulTranslationAttemptId = 0;
  private translationAttemptSequence = 0;
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
    this.captionWindow.clear();
    this.translatedSources.clear();
    this.chunker.clear();
    this.currentTranslationErrorAttemptId = undefined;
    this.lastSuccessfulTranslationAttemptId = 0;
    this.translationAttemptSequence = 0;
    this.translationCoordinator = this.createTranslationCoordinator(
      snapshot.sessionId,
      snapshot.settings,
    );
    this.currentStatus = { state: 'running', tabId: snapshot.tabId };
  }

  // Units already in the window keep the width they were cut at; recutting
  // them would renumber ids the overlay is already showing.
  applyLayout(layout: {
    maxLineWidth: number;
    minLineWidth: number;
    backgroundOpacity?: number;
    originalFontSize?: number;
    originalTextColor?: string;
    translationFontSize?: number;
    translationTextColor?: string;
  }): void {
    if (!this.settings) return;
    this.settings = { ...this.settings, ...layout };
    if (this.activeSessionId && this.settings.transcriber === 'gemini') {
      void this.dependencies.sendToOffscreen({
        target: 'offscreen',
        type: 'CAPTURE_CONFIG_UPDATE',
        payload: {
          maxLineWidth: layout.maxLineWidth,
          sessionId: this.activeSessionId,
        },
      }).catch(() => undefined);
    }
    if (this.currentStatus.state === 'running') {
      void this.dependencies.sendToTab(this.currentStatus.tabId, {
        type: 'OVERLAY_APPEARANCE',
        payload: { appearance: captionAppearance(this.settings) },
      }).catch(() => undefined);
    }
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
    this.currentTranslationErrorAttemptId = undefined;
    this.lastSuccessfulTranslationAttemptId = 0;
    this.translationAttemptSequence = 0;
    this.captionWindow.clear();
    this.translatedSources.clear();
    this.chunker.clear();
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
      const payload: CaptureStartRequest =
        settings.transcriber === 'gemini'
          ? {
              apiKey: settings.geminiApiKey,
              maxLineWidth: this.settings?.maxLineWidth ?? settings.maxLineWidth,
              provider: 'gemini',
              sessionId,
              streamId,
              targetLanguage: settings.geminiTargetLanguage,
            }
          : {
              apiKey: settings.deepgramApiKey,
              language: settings.sourceLocale,
              provider: 'deepgram',
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
      const layout = await this.dependencies.getOverlayLayout(tabId);
      await this.dependencies.sendToTab(tabId, {
        type: 'OVERLAY_SHOW',
        payload: { appearance: captionAppearance(settings), layout },
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

    const units = this.chunker.ingest({
      isFinal: event.isFinal,
      maxWidth: this.settings.maxLineWidth,
      minWidth: this.settings.minLineWidth,
      rawText: update.originalText,
      segmentId: event.segmentId,
      stableText: update.stableText,
    });
    if (units.length === 0) return;

    for (const unit of units) {
      this.captionWindow.upsertOriginal(unit.id, unit.displayText);
    }
    await this.sendWindow(tabId);
    if (this.currentStatus.error === 'translation_disabled') return;

    for (const unit of units) {
      if (!unit.translateText) continue;
      // A unit is translated while it is still open and re-emitted when it
      // closes, usually with byte-identical text. Sending it twice spends
      // provider quota to receive an answer we already have.
      if (this.translatedSources.get(unit.id) === unit.translateText) continue;
      this.translatedSources.set(unit.id, unit.translateText);
      await this.translateUnit(unit, event.revision, tabId, generation);
    }
  }

  // The provider already did the transcribing and the translating, so the row
  // goes straight into the window: no stabilizer, no chunker, no translation
  // round trip. Everything downstream of the window is shared with Deepgram.
  async acceptCaptionPairs(
    sessionId: string,
    updates: CaptionPairUpdate[],
  ): Promise<void> {
    if (
      sessionId !== this.activeSessionId ||
      this.currentStatus.state !== 'running' ||
      !this.settings
    ) {
      return;
    }
    if (updates.length === 0) return;
    // Originals establish row identity. Applying every original first also
    // makes a target-first provider frame safe without allowing a translation
    // by itself to resurrect a row that already rolled out of the window.
    for (const update of updates) {
      if (update.original !== undefined) {
        this.captionWindow.upsertOriginal(update.id, update.original);
      }
    }
    for (const update of updates) {
      if (update.translation !== undefined) {
        this.captionWindow.upsertTranslation(update.id, update.translation);
      }
    }
    await this.sendWindow(this.currentStatus.tabId);
  }

  private async sendWindow(tabId: number): Promise<void> {
    await this.dependencies.sendToTab(tabId, {
      type: 'CAPTION_WINDOW',
      payload: { pairs: this.captionWindow.pairs() },
    });
  }

  captionPairs(): CaptionPair[] {
    return this.captionWindow.pairs();
  }

  appearance(): CaptionAppearance | undefined {
    return this.settings ? captionAppearance(this.settings) : undefined;
  }

  private async translateUnit(
    unit: CaptionUnit,
    revision: number,
    tabId: number,
    generation: number,
  ): Promise<void> {
    const attemptId = ++this.translationAttemptSequence;
    let result: CoordinatedTranslation | undefined;
    try {
      result = await this.translationCoordinator!.translate({
        revision,
        segmentId: unit.id,
        text: unit.translateText,
      });
    } catch (error) {
      if (
        generation === this.generation &&
        this.currentStatus.state === 'running'
      ) {
        const code = translationFailureCode(error);
        if (
          attemptId < this.lastSuccessfulTranslationAttemptId ||
          (this.currentTranslationErrorAttemptId !== undefined &&
            attemptId < this.currentTranslationErrorAttemptId)
        ) {
          return;
        }
        const shouldNotify =
          code !== 'translation_disabled' ||
          this.currentStatus.error !== 'translation_disabled';
        this.currentTranslationErrorAttemptId = attemptId;
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
    this.lastSuccessfulTranslationAttemptId = Math.max(
      this.lastSuccessfulTranslationAttemptId,
      attemptId,
    );
    const clearsCurrentError =
      Boolean(this.currentStatus.error) &&
      this.currentStatus.error !== 'translation_disabled' &&
      this.currentTranslationErrorAttemptId !== undefined &&
      attemptId > this.currentTranslationErrorAttemptId;
    if (clearsCurrentError) {
      this.currentTranslationErrorAttemptId = undefined;
      this.currentStatus = { state: 'running', tabId };
      await this.dependencies.sendToTab(tabId, {
        type: 'SESSION_ERROR_CLEAR',
      });
    }
    this.captionWindow.upsertTranslation(unit.id, result.text);
    await this.sendWindow(tabId);
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
      this.captionWindow.clear();
      this.translatedSources.clear();
      this.chunker.clear();
      this.currentTranslationErrorAttemptId = undefined;
      this.lastSuccessfulTranslationAttemptId = 0;
      this.translationAttemptSequence = 0;
      this.translationCoordinator = undefined;
      this.currentStatus = { state: 'idle' };
    }
  }

  async handleDisconnect(sessionId: string, code?: string): Promise<void> {
    if (
      sessionId !== this.activeSessionId ||
      this.currentStatus.state !== 'running'
    ) return;
    const tabId = this.currentStatus.tabId;
    // A provider that could say why it dropped out gets to; the rest fall back
    // to a generic "this provider disconnected".
    const errorCode =
      code ??
      (this.settings?.transcriber === 'gemini'
        ? 'gemini_disconnected'
        : 'deepgram_disconnected');
    this.generation += 1;
    this.translationCoordinator?.dispose();
    this.currentStatus = {
      error: errorCode,
      state: 'error',
      tabId,
    };
    await this.dependencies.sendToTab(tabId, {
      type: 'SESSION_ERROR',
      payload: { code: errorCode },
    });
  }

  async handleContentReady(tabId: number): Promise<void> {
    if (
      this.currentStatus.state !== 'running' ||
      this.currentStatus.tabId !== tabId ||
      !this.settings
    ) return;
    const layout = await this.dependencies.getOverlayLayout(tabId);
    await this.dependencies.sendToTab(tabId, {
      type: 'OVERLAY_SHOW',
      payload: { appearance: captionAppearance(this.settings), layout },
    });
    await this.sendWindow(tabId);
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

  // Gemini Live Translate returns the translation with the transcript, so its
  // sessions have no second provider to coordinate.
  private createTranslationCoordinator(
    sessionId: string,
    settings: SessionSettings,
  ): TranslationCoordinator | undefined {
    if (settings.transcriber === 'gemini') return undefined;
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
